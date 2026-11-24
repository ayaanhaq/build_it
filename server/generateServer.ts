/**
 * Local 3D Scene Generation HTTP/SSE Server
 *
 * Binds to 127.0.0.1 only (port 8787 by default, override via PORT).
 * Accepts POST /api/generate with { "request": string } (1..500 chars trimmed),
 * runs buildPrompt/generateScene via GeminiModelClient, and streams SSE events:
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
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_PALETTE_NAMES,
  buildPrompt,
  generateScene,
  type ModelClient,
} from "../src/generatePipeline.ts";
import { PRIMITIVE_BOUNDS } from "../src/sceneValidator.ts";
import {
  GeminiClientError,
  GeminiModelClient,
} from "../src/model/geminiClient.ts";
import type { SceneStep } from "../src/types.ts";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const ALLOWED_CORS_ORIGIN = "http://localhost:5173";
export const MAX_REQUEST_LENGTH = 500;
export const MAX_BODY_BYTES = 16 * 1024;

export interface GenerateServerDependencies {
  env?: Record<string, string | undefined>;
  clientFactory?: (options: { apiKey: string; model?: string }) => ModelClient;
  schema?: unknown;
  port?: number;
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

export function redactSecret(text: string, secret?: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join("[REDACTED]");
}

function redactValue(value: unknown, secret?: string): unknown {
  if (!secret) {
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
  secret?: string
): string {
  const safeData = redactValue(data, secret);
  const serialized = redactSecret(JSON.stringify(safeData), secret);
  return `event: ${eventName}\ndata: ${serialized}\n\n`;
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  secret?: string
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
  const schema = deps.schema ?? loadSceneSchema();
  let isGenerating = false;

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const apiKeyForRedaction = env.GEMINI_API_KEY?.trim();

    if (!applyCors(req, res)) {
      sendJson(res, 403, { error: "Origin not allowed." }, apiKeyForRedaction);
      return;
    }

    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", `http://${DEFAULT_HOST}`).pathname;
    } catch {
      sendJson(res, 400, { error: "Invalid request URL." }, apiKeyForRedaction);
      return;
    }

    if (pathname !== "/api/generate") {
      sendJson(res, 404, { error: "Not found." }, apiKeyForRedaction);
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
      sendJson(res, 405, { error: "Method not allowed." }, apiKeyForRedaction);
      return;
    }

    if (isGenerating) {
      sendJson(
        res,
        429,
        { error: "A generation is already in progress. Please try again later." },
        apiKeyForRedaction
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
      sendJson(res, status, { error: msg }, apiKeyForRedaction);
      return;
    }

    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      sendJson(res, 500, {
        error: "Server configuration error: GEMINI_API_KEY is missing.",
      });
      return;
    }

    if (isGenerating) {
      sendJson(
        res,
        429,
        { error: "A generation is already in progress. Please try again later." },
        apiKey
      );
      return;
    }

    isGenerating = true;
    const model = env.GEMINI_MODEL?.trim() || undefined;

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
      ? deps.clientFactory({ apiKey, model })
      : new GeminiModelClient({ apiKey, model });

    const guardedClient: ModelClient = {
      async *generateStream(prompt: string): AsyncIterable<string> {
        if (clientDisconnected) {
          throw abortError;
        }

        const innerStream = baseClient.generateStream(prompt);
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
            yield next.value;
          }
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
        onStep: (step: SceneStep | undefined, status: "valid" | "invalid") => {
          if (status === "valid" && step) {
            stepCount++;
            if (!clientDisconnected && !res.writableEnded) {
              res.write(formatSseEvent("step", step, apiKey));
            }
          }
        },
      });

      if (clientDisconnected || res.writableEnded) {
        return;
      }

      if (!result.success) {
        const errMsg = redactSecret(
          result.error ?? "Generation failed validation.",
          apiKey
        );
        res.write(
          formatSseEvent(
            "error",
            { message: errMsg, complete: false, stepCount },
            apiKey
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
            apiKey
          )
        );
        res.end();
        return;
      }

      res.write(
        formatSseEvent("done", { complete: true, stepCount }, apiKey)
      );
      res.end();
    } catch (err: unknown) {
      if (!clientDisconnected && !res.writableEnded) {
        const rawMsg =
          err instanceof GeminiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        const safeMsg = redactSecret(rawMsg, apiKey);
        res.write(
          formatSseEvent(
            "error",
            { message: safeMsg, complete: false, stepCount },
            apiKey
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
