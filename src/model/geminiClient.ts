/**
 * Gemini API Streaming Model Client
 *
 * Implements ModelClient over the Gemini REST :streamGenerateContent SSE endpoint
 * using Node's/browser's global fetch without external SDK dependencies.
 */

import type { ModelClient } from "../generatePipeline.ts";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const INITIAL_RETRY_DELAY_MS = 500;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Error thrown by GeminiModelClient containing a short safe message and optional HTTP status.
 * Never contains API keys or full request URLs.
 */
export class GeminiClientError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiClientError";
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
  clean = clean.replace(/(x-goog-api-key\s*[:=]\s*)\S+/gi, "$1[REDACTED]");
  clean = clean.replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");
  clean = clean.replace(/\s+/g, " ").trim();
  if (clean.length > 180) {
    clean = clean.slice(0, 177) + "...";
  }
  return clean;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractSseTexts(payload: string): string[] {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === "[DONE]") {
    return [];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new GeminiClientError("Invalid JSON in Gemini SSE response.");
  }

  if (parsed?.error) {
    const code = typeof parsed.error.code === "number" ? parsed.error.code : undefined;
    const msg =
      typeof parsed.error.message === "string"
        ? parsed.error.message
        : "Gemini API returned a stream error.";
    throw new GeminiClientError(sanitizeErrorDetail(msg, ""), code);
  }

  const parts = parsed?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  const texts: string[] = [];
  for (const part of parts) {
    if (part && typeof part.text === "string" && part.text.length > 0) {
      texts.push(part.text);
    }
  }
  return texts;
}

/**
 * Parses Server-Sent Events (SSE) chunks from Gemini :streamGenerateContent?alt=sse
 * and yields each candidate text piece in order.
 * Handles events and JSON payloads split arbitrarily across chunk boundaries.
 */
export async function* parseSseText(
  chunks: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const handleLine = (rawLine: string): string[] => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      if (dataLines.length === 0) {
        return [];
      }
      const payload = dataLines.join("\n");
      dataLines = [];
      return extractSseTexts(payload);
    }
    if (line.startsWith(":")) {
      return [];
    }
    if (line.startsWith("data:")) {
      const value = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      dataLines.push(value);
    }
    return [];
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
      for (const text of handleLine(line)) {
        yield text;
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  // Flush remaining bytes from TextDecoder and trailing buffered line
  const flushed = decoder.decode();
  if (flushed) {
    buffer += flushed;
  }

  if (buffer.length > 0) {
    for (const text of handleLine(buffer)) {
      yield text;
    }
    buffer = "";
  }

  if (dataLines.length > 0) {
    const payload = dataLines.join("\n");
    dataLines = [];
    for (const text of extractSseTexts(payload)) {
      yield text;
    }
  }
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
 * GeminiModelClient streams text from the Gemini API using fetch + SSE.
 */
export class GeminiModelClient implements ModelClient {
  private readonly apiKey: string;
  public readonly model: string;
  private readonly fetchFn: FetchLike;
  public readonly timeoutMs: number;
  public readonly maxRetries: number;

  constructor(options: GeminiClientOptions) {
    if (!options || typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
      throw new GeminiClientError("Gemini API key is required.");
    }

    this.apiKey = options.apiKey.trim();
    const explicitModel =
      typeof options.model === "string" && options.model.trim() !== ""
        ? options.model.trim()
        : undefined;
    this.model = explicitModel ?? readEnv("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private buildEndpointUrl(): string {
    return `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;
  }

  async *generateStream(prompt: string): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new GeminiClientError("Gemini API key is required.");
    }

    const url = this.buildEndpointUrl();
    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      let streamStarted = false;
      let completedCleanly = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: requestBody,
          signal: controller.signal,
        });

        if (!response.ok) {
          try {
            await response.body?.cancel();
          } catch {
            // Ignore body cancel errors on error responses
          }
          clearTimeout(timeoutId);

          if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
            const backoffMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
            await sleep(backoffMs);
            continue;
          }

          throw new GeminiClientError(
            `Gemini API request failed with HTTP ${response.status}.`,
            response.status
          );
        }

        if (!response.body) {
          throw new GeminiClientError(
            "Gemini API response contained no stream body.",
            response.status
          );
        }

        streamStarted = true;
        const chunks = readBodyChunks(response.body, () => {
          if (!completedCleanly && !controller.signal.aborted) {
            controller.abort();
          }
        });

        for await (const text of parseSseText(chunks)) {
          yield text;
        }

        completedCleanly = true;
        return;
      } catch (err: any) {
        if (err instanceof GeminiClientError) {
          throw err;
        }
        if (timedOut) {
          throw new GeminiClientError(
            `Gemini API request timed out after ${this.timeoutMs}ms.`
          );
        }
        const rawDetail =
          err && typeof err.message === "string"
            ? err.message
            : "Network request failed";
        const safeDetail = sanitizeErrorDetail(rawDetail, this.apiKey);
        const prefix = streamStarted
          ? "Gemini API stream error"
          : "Gemini API request failed";
        throw new GeminiClientError(
          safeDetail ? `${prefix}: ${safeDetail}` : `${prefix}.`
        );
      } finally {
        clearTimeout(timeoutId);
        if (!completedCleanly && !controller.signal.aborted) {
          controller.abort();
        }
      }
    }
  }
}
