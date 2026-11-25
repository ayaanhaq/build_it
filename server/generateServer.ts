/**
 * Local 3D Scene Generation HTTP/SSE Server
 *
 * Binds to 127.0.0.1 only (port 8787 by default, override via PORT).
 * Accepts POST /api/generate with { "request": string } (1..500 chars trimmed),
 * runs buildPrompt/generateScene via the configured LLM provider (gemini or groq),
 * and streams SSE events:
 *   - event: step  -> validated SceneStep JSON
 *   - event: done  -> { complete: true, stepCount }
 *   - event: error -> { message, complete: false, stepCount }
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_PALETTE_NAMES,
  buildPrompt,
  generateScene,
  type ModelClient,
  type ModelGenerateOptions,
  type ModelStreamMetadata,
} from "../src/generatePipeline.ts";
import { PRIMITIVE_BOUNDS } from "../src/sceneValidator.ts";
import {
  createProviderModelClient,
  getEnvSecretsForRedaction,
  getProviderEnvSpec,
  isProviderClientError,
  resolveLlmProvider,
  type LlmProvider,
} from "../src/model/provider.ts";
import type { SceneStep } from "../src/types.ts";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const ALLOWED_CORS_ORIGIN = "http://localhost:5173";
export const MAX_REQUEST_LENGTH = 500;
export const MAX_BODY_BYTES = 16 * 1024;

export interface GenerateServerDependencies {
  env?: Record<string, string | undefined>;
  clientFactory?: (options: {
    provider: LlmProvider;
    apiKey: string;
    model?: string;
  }) => ModelClient;
  schema?: unknown;
  port?: number;
  logDir?: string;
}

export interface FailedStepAttemptLog {
  attempt: number;
  finishReason: string | null;
  streamError: string | null;
  maxTokens?: number;
  errors: string[];
  rawText: string;
}

function getDefaultLogDir(): string {
  return fileURLToPath(new URL("../logs", import.meta.url));
}

function writeFailedStepLog(
  logDir: string,
  request: string,
  errorMessage: string,
  attempts: FailedStepAttemptLog[],
  secrets?: string[]
): string {
  mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const safeStamp = timestamp.replace(/[:.]/g, "-");
  const logPath = join(logDir, `failed-steps-${safeStamp}.json`);
  const payload = {
    timestamp,
    request: redactSecret(request, secrets),
    error: redactSecret(errorMessage, secrets),
    attempts: attempts.map((entry) => ({
      attempt: entry.attempt,
      finishReason: entry.finishReason ?? null,
      streamError: entry.streamError
        ? redactSecret(entry.streamError, secrets)
        : null,
      ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
      errors: entry.errors.map((e) => redactSecret(e, secrets)),
      rawText: redactSecret(entry.rawText, secrets),
    })),
  };
  const serialized = redactSecret(
    JSON.stringify(payload, null, 2) + "\n",
    secrets
  );
  writeFileSync(logPath, serialized, "utf8");
  return logPath;
}

class HttpRequestError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function loadSceneSchema(): unknown {
  const schemaUrl = new URL("../schemas/scene.schema.json", import.meta.url);
  return JSON.parse(readFileSync(schemaUrl, "utf8"));
}

export function parsePort(
  rawPort: string | undefined,
  defaultPort: number = DEFAULT_PORT
): number {
  if (rawPort === undefined || rawPort.trim() === "") {
    return defaultPort;
  }
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid PORT "${rawPort}". Must be an integer between 1 and 65535.`
    );
  }
  return parsed;
}

export function redactSecret(text: string, secret?: string | string[]): string {
  if (!secret) {
    return text;
  }
  const secrets = Array.isArray(secret) ? secret : [secret];
  let clean = text;
  for (const item of secrets) {
    if (item) {
      clean = clean.split(item).join("[REDACTED]");
    }
  }
  return clean;
}

function redactValue(value: unknown, secret?: string | string[]): unknown {
  if (!secret) {
    return value;
  }
  if (Array.isArray(secret) && secret.length === 0) {
    return value;
  }
  if (typeof value === "string") {
    return redactSecret(value, secret);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secret));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[redactSecret(k, secret)] = redactValue(v, secret);
    }
    return out;
  }
  return value;
}

export function formatSseEvent(
  eventName: string,
  data: unknown,
  secret?: string | string[]
): string {
  const safeData = redactValue(data, secret);
  const serialized = redactSecret(JSON.stringify(safeData), secret);
  return `event: ${eventName}\ndata: ${serialized}\n\n`;
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  secret?: string | string[]
): void {
  const safePayload = redactValue(payload, secret);
  const body = redactSecret(JSON.stringify(safePayload), secret);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

async function readAndValidateBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpRequestError(400, "Request body exceeds size limit.");
    }
    chunks.push(buf);
  }

  const rawText = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawText) {
    throw new HttpRequestError(400, "Request body must be valid JSON.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new HttpRequestError(400, "Request body must be valid JSON.");
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as { request?: unknown }).request !== "string"
  ) {
    throw new HttpRequestError(
      400,
      'Request body must be a JSON object with a string "request" field.'
    );
  }

  const trimmed = (parsed as { request: string }).request.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_REQUEST_LENGTH) {
    throw new HttpRequestError(
      400,
      `Field "request" must be 1 to ${MAX_REQUEST_LENGTH} characters after trimming.`
    );
  }

  return trimmed;
}

function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) {
    return true;
  }
  if (origin !== ALLOWED_CORS_ORIGIN) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_CORS_ORIGIN);
  res.setHeader("Vary", "Origin");
  return true;
}

/**
 * Ensures the prompt builder contract remains aligned with CLI & pipeline defaults.
 */
export function buildServerPromptPreview(
  request: string,
  schema: unknown
): string {
  return buildPrompt(request, schema, PRIMITIVE_BOUNDS, ALLOWED_PALETTE_NAMES);
}

export function createGenerateServer(
  deps: GenerateServerDependencies = {}
): Server {
  const env = deps.env ?? process.env;
  const provider = resolveLlmProvider(env);
  const providerSpec = getProviderEnvSpec(provider);
  const schema = deps.schema ?? loadSceneSchema();
  const logDir = deps.logDir ?? getDefaultLogDir();
  let isGenerating = false;

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const secretsForRedaction = getEnvSecretsForRedaction(env);

    if (!applyCors(req, res)) {
      sendJson(res, 403, { error: "Origin not allowed." }, secretsForRedaction);
      return;
    }

    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", `http://${DEFAULT_HOST}`).pathname;
    } catch {
      sendJson(res, 400, { error: "Invalid request URL." }, secretsForRedaction);
      return;
    }

    if (pathname !== "/api/generate") {
      sendJson(res, 404, { error: "Not found." }, secretsForRedaction);
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      sendJson(res, 405, { error: "Method not allowed." }, secretsForRedaction);
      return;
    }

    if (isGenerating) {
      sendJson(
        res,
        429,
        { error: "A generation is already in progress. Please try again later." },
        secretsForRedaction
      );
      return;
    }

    let trimmedRequest: string;
    try {
      trimmedRequest = await readAndValidateBody(req);
    } catch (err) {
      const status = err instanceof HttpRequestError ? err.status : 400;
      const msg =
        err instanceof Error ? err.message : "Invalid request payload.";
      sendJson(res, status, { error: msg }, secretsForRedaction);
      return;
    }

    const apiKey = env[providerSpec.apiKeyEnvVar]?.trim();
    if (!apiKey) {
      sendJson(res, 500, {
        error: `Server configuration error: ${providerSpec.apiKeyEnvVar} is missing.`,
      }, secretsForRedaction);
      return;
    }

    if (isGenerating) {
      sendJson(
        res,
        429,
        { error: "A generation is already in progress. Please try again later." },
        secretsForRedaction
      );
      return;
    }

    isGenerating = true;
    const model = env[providerSpec.modelEnvVar]?.trim() || undefined;

    let clientDisconnected = false;
    const abortError = new Error("Client disconnected.");
    let triggerDisconnect: (() => void) | undefined;

    const disconnectPromise = new Promise<never>((_, reject) => {
      triggerDisconnect = () => reject(abortError);
    });
    disconnectPromise.catch(() => {});

    const onClose = () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        triggerDisconnect?.();
      }
    };
    res.on("close", onClose);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const baseClient: ModelClient = deps.clientFactory
      ? deps.clientFactory({ provider, apiKey, model })
      : createProviderModelClient({ provider, apiKey, model });

    const streamChunksByCall: string[][] = [];
    const streamMetaByCall: ModelStreamMetadata[] = [];
    let currentRetryAttempt = 0;
    let failedAttempts: FailedStepAttemptLog[] = [];

    const guardedClient: ModelClient = {
      async *generateStream(
        prompt: string,
        genOptions?: ModelGenerateOptions
      ): AsyncIterable<string> {
        if (clientDisconnected) {
          throw abortError;
        }

        const chunkBucket: string[] = [];
        const bucketIdx = streamChunksByCall.length;
        streamChunksByCall[bucketIdx] = chunkBucket;
        const metaEntry: ModelStreamMetadata = {
          maxTokens: genOptions?.maxTokens,
        };
        streamMetaByCall[bucketIdx] = metaEntry;

        const innerStream = baseClient.generateStream(prompt, {
          ...genOptions,
          onMetadata: (meta) => {
            if (meta.finishReason !== undefined) {
              metaEntry.finishReason = meta.finishReason;
            }
            if (meta.streamError !== undefined) {
              metaEntry.streamError = redactSecret(
                meta.streamError,
                secretsForRedaction
              );
            }
            if (meta.maxTokens !== undefined) {
              metaEntry.maxTokens = meta.maxTokens;
            }
            genOptions?.onMetadata?.(meta);
          },
        });
        const asyncIterFn = (innerStream as AsyncIterable<string>)[
          Symbol.asyncIterator
        ];
        const iterator: AsyncIterator<string> | Iterator<string> = asyncIterFn
          ? asyncIterFn.call(innerStream)
          : (innerStream as Iterable<string>)[Symbol.iterator]();

        try {
          while (true) {
            if (clientDisconnected) {
              await iterator.return?.();
              throw abortError;
            }

            const next = await Promise.race([
              Promise.resolve(iterator.next()),
              disconnectPromise,
            ]);

            if (next.done) {
              break;
            }
            if (clientDisconnected) {
              await iterator.return?.();
              throw abortError;
            }
            if (typeof next.value === "string") {
              chunkBucket.push(redactSecret(next.value, secretsForRedaction));
            }
            yield next.value;
          }
        } catch (streamErr: unknown) {
          const msg =
            streamErr instanceof Error ? streamErr.message : String(streamErr);
          metaEntry.streamError = redactSecret(msg, secretsForRedaction);
          if (
            streamErr &&
            typeof streamErr === "object" &&
            typeof (streamErr as { finishReason?: unknown }).finishReason ===
              "string"
          ) {
            metaEntry.finishReason = (
              streamErr as { finishReason: string }
            ).finishReason;
          }
          throw streamErr;
        } finally {
          if (clientDisconnected) {
            try {
              await iterator.return?.();
            } catch {
              // Ignore iterator cleanup errors on disconnect
            }
          }
        }
      },
    };

    let stepCount = 0;

    try {
      const result = await generateScene(trimmedRequest, guardedClient, {
        schema,
        primitiveTable: PRIMITIVE_BOUNDS,
        paletteNames: ALLOWED_PALETTE_NAMES,
        onStep: (
          step: SceneStep | undefined,
          status: "valid" | "invalid",
          errors?: string[]
        ) => {
          if (status === "valid" && step) {
            stepCount++;
            failedAttempts = [];
            currentRetryAttempt = 0;
            if (!clientDisconnected && !res.writableEnded) {
              res.write(formatSseEvent("step", step, secretsForRedaction));
            }
          } else if (status === "invalid") {
            const callIdx = Math.max(0, streamChunksByCall.length - 1);
            const rawChunks = streamChunksByCall[callIdx] ?? [];
            const meta = streamMetaByCall[callIdx] ?? {};
            if (currentRetryAttempt === 0) {
              failedAttempts = [];
            }
            failedAttempts.push({
              attempt: currentRetryAttempt,
              finishReason: meta.finishReason ?? null,
              streamError: meta.streamError ?? null,
              maxTokens: meta.maxTokens,
              errors: (errors ?? []).map((e) =>
                redactSecret(e, secretsForRedaction)
              ),
              rawText: redactSecret(rawChunks.join(""), secretsForRedaction),
            });
          }
        },
        onRetry: (_stepNumber: number, attempt: number) => {
          currentRetryAttempt = attempt;
        },
      });

      if (clientDisconnected || res.writableEnded) {
        return;
      }

      if (!result.success) {
        const errMsg = redactSecret(
          result.error ?? "Generation failed validation.",
          secretsForRedaction
        );
        try {
          const logPath = writeFailedStepLog(
            logDir,
            trimmedRequest,
            errMsg,
            failedAttempts,
            secretsForRedaction
          );
          process.stderr.write(`Saved failed validation log: ${logPath}\n`);
        } catch {
          // Never mask the SSE error response if disk logging fails
        }
        res.write(
          formatSseEvent(
            "error",
            { message: errMsg, complete: false, stepCount },
            secretsForRedaction
          )
        );
        res.end();
        return;
      }

      if (result.steps.length === 0) {
        res.write(
          formatSseEvent(
            "error",
            {
              message: "Model stream produced zero valid steps.",
              complete: false,
              stepCount: 0,
            },
            secretsForRedaction
          )
        );
        res.end();
        return;
      }

      res.write(
        formatSseEvent(
          "done",
          { complete: true, stepCount },
          secretsForRedaction
        )
      );
      res.end();
    } catch (err: unknown) {
      if (!clientDisconnected && !res.writableEnded) {
        const rawMsg = isProviderClientError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
        const safeMsg = redactSecret(rawMsg, secretsForRedaction);
        res.write(
          formatSseEvent(
            "error",
            { message: safeMsg, complete: false, stepCount },
            secretsForRedaction
          )
        );
        res.end();
      }
    } finally {
      isGenerating = false;
      res.removeListener("close", onClose);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

export async function startGenerateServer(
  deps: GenerateServerDependencies = {}
): Promise<{ server: Server; port: number; url: string }> {
  const env = deps.env ?? process.env;
  const port = deps.port !== undefined ? deps.port : parsePort(env.PORT);
  const server = createGenerateServer(deps);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, DEFAULT_HOST);
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;
  return {
    server,
    port: actualPort,
    url: `http://${DEFAULT_HOST}:${actualPort}`,
  };
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)).toLowerCase() ===
      realpathSync(entry).toLowerCase()
    );
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  const { url } = await startGenerateServer();
  process.stdout.write(`Local generation server listening on ${url}\n`);
}
