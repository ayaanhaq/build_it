/**
 * Groq Chat Completions Streaming Model Client
 *
 * Implements ModelClient over Groq's OpenAI-compatible /openai/v1/chat/completions
 * SSE endpoint using Node's/browser's global fetch without external SDK dependencies.
 */

import type { ModelClient } from "../generatePipeline.ts";

export const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 2;
export const INITIAL_RETRY_DELAY_MS = 1_000;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface GroqClientOptions {
  apiKey: string;
  model?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Error thrown by GroqModelClient containing a short safe message and optional HTTP status.
 * Never contains API keys, Bearer tokens, or full request URLs.
 */
export class GroqClientError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GroqClientError";
    this.status = status;
  }
}

function readEnv(name: string): string | undefined {
  const maybeProcess = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  const val = maybeProcess?.env?.[name];
  return typeof val === "string" && val.trim() !== "" ? val.trim() : undefined;
}

function sanitizeErrorDetail(detail: string, apiKey: string): string {
  let clean = detail;
  if (apiKey) {
    clean = clean.split(apiKey).join("[REDACTED]");
  }
  clean = clean.replace(/https?:\/\/[^\s'"]+/gi, "[URL]");
  clean = clean.replace(/(authorization\s*[:=]\s*bearer\s+)\S+/gi, "$1[REDACTED]");
  clean = clean.replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]");
  clean = clean.replace(/\bgsk_[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
  clean = clean.replace(/\s+/g, " ").trim();
  if (clean.length > 180) {
    clean = clean.slice(0, 177) + "...";
  }
  return clean;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Parses an HTTP Retry-After header (delay-seconds or HTTP-date) into milliseconds.
 */
export function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (headerValue === null) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const numericSeconds = Number(trimmed);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.ceil(numericSeconds * 1000);
  }

  const timestampMs = Date.parse(trimmed);
  if (Number.isFinite(timestampMs)) {
    return Math.max(0, timestampMs - Date.now());
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractGroqSseTexts(
  payload: string,
  apiKey: string = ""
): { texts: string[]; done: boolean } {
  const trimmed = payload.trim();
  if (!trimmed) {
    return { texts: [], done: false };
  }
  if (trimmed === "[DONE]") {
    return { texts: [], done: true };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new GroqClientError("Invalid JSON in Groq SSE response.");
  }

  if (parsed?.error) {
    const code =
      typeof parsed.error.code === "number"
        ? parsed.error.code
        : typeof parsed.error.status === "number"
          ? parsed.error.status
          : undefined;
    const msg =
      typeof parsed.error.message === "string"
        ? parsed.error.message
        : "Groq API returned a stream error.";
    throw new GroqClientError(sanitizeErrorDetail(msg, apiKey), code);
  }

  const deltaContent = parsed?.choices?.[0]?.delta?.content;
  if (typeof deltaContent === "string" && deltaContent.length > 0) {
    return { texts: [deltaContent], done: false };
  }

  return { texts: [], done: false };
}

/**
 * Parses OpenAI/Groq-style Server-Sent Events (SSE) chunks and yields
 * each choices[0].delta.content piece in order until "data: [DONE]".
 */
export async function* parseGroqSseText(
  chunks: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>,
  apiKey: string = "",
  onDone?: () => void
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const handleLine = (
    rawLine: string
  ): { texts: string[]; done: boolean } => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      if (dataLines.length === 0) {
        return { texts: [], done: false };
      }
      const payload = dataLines.join("\n");
      dataLines = [];
      return extractGroqSseTexts(payload, apiKey);
    }
    if (line.startsWith(":")) {
      return { texts: [], done: false };
    }
    if (line.startsWith("data:")) {
      const value = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      if (dataLines.length === 0 && value.trim() === "[DONE]") {
        return { texts: [], done: true };
      }
      dataLines.push(value);
    }
    return { texts: [], done: false };
  };

  for await (const chunk of chunks) {
    const textChunk =
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    buffer += textChunk;

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const { texts, done } = handleLine(line);
      for (const text of texts) {
        yield text;
      }
      if (done) {
        onDone?.();
        return;
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const flushed = decoder.decode();
  if (flushed) {
    buffer += flushed;
  }

  if (buffer.length > 0) {
    const { texts, done } = handleLine(buffer);
    buffer = "";
    for (const text of texts) {
      yield text;
    }
    if (done) {
      onDone?.();
      return;
    }
  }

  if (dataLines.length > 0) {
    const payload = dataLines.join("\n");
    dataLines = [];
    const { texts } = extractGroqSseTexts(payload, apiKey);
    for (const text of texts) {
      yield text;
    }
  }

  onDone?.();
}

async function* readBodyChunks(
  body: ReadableStream<Uint8Array>,
  onCleanup?: () => void
): AsyncGenerator<Uint8Array, void, unknown> {
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.byteLength > 0) {
        yield value;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation errors during teardown
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore lock release errors
    }
    onCleanup?.();
  }
}

/**
 * GroqModelClient streams text from the Groq Chat Completions API using fetch + SSE.
 */
export class GroqModelClient implements ModelClient {
  private readonly apiKey: string;
  public readonly model: string;
  private readonly fetchFn: FetchLike;
  public readonly timeoutMs: number;
  public readonly maxRetries: number;

  constructor(options: GroqClientOptions) {
    if (
      !options ||
      typeof options.apiKey !== "string" ||
      options.apiKey.trim() === ""
    ) {
      throw new GroqClientError("Groq API key is required.");
    }

    this.apiKey = options.apiKey.trim();
    const explicitModel =
      typeof options.model === "string" && options.model.trim() !== ""
        ? options.model.trim()
        : undefined;
    this.model = explicitModel ?? readEnv("GROQ_MODEL") ?? DEFAULT_GROQ_MODEL;
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async *generateStream(prompt: string): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new GroqClientError("Groq API key is required.");
    }

    // Never pass response_format: { type: "json_object" }; the pipeline streams
    // multiple step objects in sequence rather than one top-level JSON object.
    const requestBody = JSON.stringify({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      let streamStarted = false;
      let streamFinished = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      try {
        const response = await this.fetchFn(GROQ_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: requestBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryAfterHeader = response.headers.get("retry-after");
          try {
            await response.body?.cancel();
          } catch {
            // Ignore body cancel errors on error responses
          }
          clearTimeout(timeoutId);

          if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
            const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
            const delayMs =
              retryAfterMs !== undefined
                ? retryAfterMs
                : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
            await sleep(delayMs);
            continue;
          }

          throw new GroqClientError(
            `Groq API request failed with HTTP ${response.status}.`,
            response.status
          );
        }

        if (!response.body) {
          throw new GroqClientError(
            "Groq API response contained no stream body.",
            response.status
          );
        }

        streamStarted = true;
        const chunks = readBodyChunks(response.body, () => {
          if (!streamFinished && !controller.signal.aborted) {
            controller.abort();
          }
        });

        for await (const text of parseGroqSseText(chunks, this.apiKey, () => {
          streamFinished = true;
        })) {
          yield text;
        }

        streamFinished = true;
        return;
      } catch (err: any) {
        if (err instanceof GroqClientError) {
          throw new GroqClientError(
            sanitizeErrorDetail(err.message, this.apiKey),
            err.status
          );
        }
        if (timedOut) {
          throw new GroqClientError(
            `Groq API request timed out after ${this.timeoutMs}ms.`
          );
        }
        const rawDetail =
          err && typeof err.message === "string"
            ? err.message
            : "Network request failed";
        const safeDetail = sanitizeErrorDetail(rawDetail, this.apiKey);
        const prefix = streamStarted
          ? "Groq API stream error"
          : "Groq API request failed";
        throw new GroqClientError(
          safeDetail ? `${prefix}: ${safeDetail}` : `${prefix}.`
        );
      } finally {
        clearTimeout(timeoutId);
        if (!streamFinished && !controller.signal.aborted) {
          controller.abort();
        }
      }
    }
  }
}
