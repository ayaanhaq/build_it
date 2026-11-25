/**
 * Generation Service Entry Point
 *
 * Exposes:
 * - ENABLE_STREAMING_GENERATION (false in source; override via VITE_ENABLE_STREAMING_GENERATION=true)
 * - streamGenerateScene / pure SSE event parsers talking only to the local generation server (127.0.0.1:8787)
 * - generate (offline FakeModelClient pipeline used when streaming is disabled)
 */

import {
  generateScene,
  FakeModelClient,
  type GenerateSceneOptions,
  type GenerateSceneResult,
} from "./generatePipeline.ts";
import { getBuildScene } from "./builds.ts";
import type { Scene, SceneStep } from "./types.ts";

/**
 * Feature flag to enable streaming generation in the frontend.
 * Must stay false in source; enable for local dev via VITE_ENABLE_STREAMING_GENERATION=true.
 */
export const ENABLE_STREAMING_GENERATION = false;

export const LOCAL_GENERATE_SERVER_URL = "http://127.0.0.1:8787/api/generate";

/**
 * Resolves whether live local-server streaming generation is active.
 * Checks ENABLE_STREAMING_GENERATION or Vite's VITE_ENABLE_STREAMING_GENERATION=true env var.
 */
export function isStreamingGenerationEnabled(
  envOverride?: Record<string, string | undefined>
): boolean {
  if (ENABLE_STREAMING_GENERATION) {
    return true;
  }
  if (envOverride) {
    return envOverride.VITE_ENABLE_STREAMING_GENERATION === "true";
  }
  const viteFlag =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_ENABLE_STREAMING_GENERATION
      : undefined;
  return viteFlag === "true";
}

export type ServerSseEvent =
  | { type: "step"; step: SceneStep }
  | { type: "done"; complete: boolean; stepCount: number }
  | { type: "error"; message: string; complete: boolean; stepCount: number };

export interface StreamViewerLike {
  appendStep(step: SceneStep, animateTransition?: boolean): unknown;
  loadScene(scene: Scene): void;
  setStep?(step: number, animateTransition?: boolean): void;
}

export interface StreamGenerateOptions {
  url?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  viewer?: StreamViewerLike | null;
  resetSceneOnStart?: Scene;
  onOpen?: () => void;
  onStep?: (step: SceneStep, stepCount: number) => void;
  onDone?: (info: {
    complete: boolean;
    stepCount: number;
    steps: SceneStep[];
  }) => void;
  onError?: (info: {
    message: string;
    complete: boolean;
    stepCount: number;
    status?: number;
    steps: SceneStep[];
  }) => void;
  onCancel?: (info: { stepCount: number; steps: SceneStep[] }) => void;
}

export interface StreamGenerateResult {
  status: "complete" | "error" | "cancelled";
  steps: SceneStep[];
  stepCount: number;
  error?: string;
  httpStatus?: number;
}

/**
 * Pure parser for a single SSE event block.
 * Turns raw `event:` / `data:` text into a typed step, done, or error object.
 */
export function parseServerSseBlock(block: string): ServerSseEvent | null {
  const normalized = block.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      const value = line.startsWith("data: ")
        ? line.slice("data: ".length)
        : line.slice("data:".length);
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const payloadText = dataLines.join("\n").trim();
  if (!payloadText) {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return {
      type: "error",
      message: "Received invalid JSON event data from local server.",
      complete: false,
      stepCount: 0,
    };
  }

  if (eventName === "step") {
    return { type: "step", step: parsed as SceneStep };
  }

  if (eventName === "done") {
    return {
      type: "done",
      complete: Boolean(parsed?.complete ?? true),
      stepCount: typeof parsed?.stepCount === "number" ? parsed.stepCount : 0,
    };
  }

  if (eventName === "error") {
    return {
      type: "error",
      message:
        typeof parsed?.message === "string"
          ? parsed.message
          : "Generation failed.",
      complete: Boolean(parsed?.complete ?? false),
      stepCount: typeof parsed?.stepCount === "number" ? parsed.stepCount : 0,
    };
  }

  return null;
}

/**
 * Pure incremental SSE buffer parser.
 * Splits complete events on blank lines (`\n\n`) while safely holding back partial lines
 * or split CRLF sequences across chunk boundaries until flush=true.
 */
export function parseServerSseBuffer(
  buffer: string,
  flush: boolean = false
): { events: ServerSseEvent[]; remaining: string } {
  const holdBackCr = !flush && buffer.endsWith("\r");
  const stablePart = holdBackCr ? buffer.slice(0, -1) : buffer;
  const normalized = stablePart.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const events: ServerSseEvent[] = [];
  let cursor = 0;

  while (true) {
    const separatorIdx = normalized.indexOf("\n\n", cursor);
    if (separatorIdx === -1) {
      break;
    }
    const block = normalized.slice(cursor, separatorIdx);
    const evt = parseServerSseBlock(block);
    if (evt) {
      events.push(evt);
    }
    cursor = separatorIdx + 2;
  }

  let remaining = normalized.slice(cursor) + (holdBackCr ? "\r" : "");
  if (flush && remaining.trim()) {
    const evt = parseServerSseBlock(remaining);
    if (evt) {
      events.push(evt);
    }
    remaining = "";
  }

  return { events, remaining };
}

/**
 * Pure helper to parse a complete fixed SSE string into events.
 */
export function parseServerSseText(text: string): ServerSseEvent[] {
  return parseServerSseBuffer(text, true).events;
}

/**
 * Streams 3D build steps from the local generation server (127.0.0.1:8787)
 * using fetch + ReadableStream reader, calling viewer.appendStep on each valid step.
 */
export async function streamGenerateScene(
  request: string,
  options: StreamGenerateOptions = {}
): Promise<StreamGenerateResult> {
  const url = options.url ?? LOCAL_GENERATE_SERVER_URL;
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const signal = options.signal;
  const steps: SceneStep[] = [];

  const cancelResult = (): StreamGenerateResult => {
    options.onCancel?.({ stepCount: steps.length, steps: [...steps] });
    return { status: "cancelled", steps, stepCount: steps.length };
  };

  if (signal?.aborted) {
    return cancelResult();
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ request }),
      signal,
    });
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      return cancelResult();
    }
    const message =
      "Could not reach the local generation server at http://127.0.0.1:8787. Start it with: npm run dev:server";
    options.onError?.({
      message,
      complete: false,
      stepCount: steps.length,
      steps: [...steps],
    });
    return { status: "error", steps, stepCount: steps.length, error: message };
  }

  if (!response.ok) {
    let serverMsg = "";
    try {
      const errJson = await response.json();
      if (errJson && typeof errJson.error === "string") {
        serverMsg = errJson.error;
      }
    } catch {
      // Ignore JSON parsing errors on non-200 error bodies
    }

    const message =
      response.status === 429
        ? "Another generation is currently running on the server. Please wait for it to finish or cancel it before trying again."
        : serverMsg || `Generation request failed with HTTP ${response.status}.`;

    options.onError?.({
      message,
      complete: false,
      stepCount: steps.length,
      status: response.status,
      steps: [...steps],
    });
    return {
      status: "error",
      steps,
      stepCount: steps.length,
      error: message,
      httpStatus: response.status,
    };
  }

  if (!response.body) {
    const message = "Local generation server response contained no stream body.";
    options.onError?.({
      message,
      complete: false,
      stepCount: 0,
      status: response.status,
      steps,
    });
    return {
      status: "error",
      steps,
      stepCount: 0,
      error: message,
      httpStatus: response.status,
    };
  }

  options.onOpen?.();
  if (options.resetSceneOnStart && options.viewer) {
    options.viewer.loadScene(options.resetSceneOnStart);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalEvent:
    | { type: "done" }
    | { type: "error"; message: string; stepCount: number }
    | null = null;

  const applyEvents = (events: ServerSseEvent[]): boolean => {
    for (const evt of events) {
      if (signal?.aborted) {
        return false;
      }
      if (evt.type === "step") {
        steps.push(evt.step);
        options.viewer?.appendStep(evt.step);
        options.onStep?.(evt.step, steps.length);
      } else if (evt.type === "done") {
        terminalEvent = { type: "done" };
      } else if (evt.type === "error") {
        terminalEvent = {
          type: "error",
          message: evt.message,
          stepCount: evt.stepCount,
        };
      }
    }
    return !signal?.aborted;
  };

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        return cancelResult();
      }

      const { value, done } = await reader.read();
      if (signal?.aborted) {
        return cancelResult();
      }

      if (done) {
        buffer += decoder.decode();
        const flushed = parseServerSseBuffer(buffer, true);
        buffer = flushed.remaining;
        if (!applyEvents(flushed.events)) {
          return cancelResult();
        }
        break;
      }

      if (value && value.byteLength > 0) {
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseServerSseBuffer(buffer, false);
        buffer = parsed.remaining;
        if (!applyEvents(parsed.events)) {
          return cancelResult();
        }
        if (terminalEvent) {
          break;
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      return cancelResult();
    }
    const message = err?.message ? String(err.message) : "Failed while reading SSE stream.";
    options.onError?.({
      message,
      complete: false,
      stepCount: steps.length,
      steps: [...steps],
    });
    return { status: "error", steps, stepCount: steps.length, error: message };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {
      // Ignore stream cancel errors during cleanup
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore reader release errors during cleanup
    }
  }

  if (terminalEvent) {
    const evt = terminalEvent as
      | { type: "done" }
      | { type: "error"; message: string; stepCount: number };
    if (evt.type === "error") {
      options.onError?.({
        message: evt.message,
        complete: false,
        stepCount: steps.length,
        steps: [...steps],
      });
      return {
        status: "error",
        steps,
        stepCount: steps.length,
        error: evt.message,
      };
    }

    options.onDone?.({
      complete: true,
      stepCount: steps.length,
      steps: [...steps],
    });
    return {
      status: "complete",
      steps,
      stepCount: steps.length,
    };
  }

  const unexpectedMsg =
    "Generation stream ended unexpectedly before completion.";
  options.onError?.({
    message: unexpectedMsg,
    complete: false,
    stepCount: steps.length,
    steps: [...steps],
  });
  return {
    status: "error",
    steps,
    stepCount: steps.length,
    error: unexpectedMsg,
  };
}

/**
 * Generates a validated 3D scene offline from a user request using FakeModelClient
 * (used when streaming generation is disabled).
 */
export async function generate(
  request: string,
  options: GenerateSceneOptions = {}
): Promise<GenerateSceneResult> {
  const scene = getBuildScene(request);
  const chunks = scene.steps.map((step) => JSON.stringify(step) + "\n");
  const client = new FakeModelClient([chunks]);

  return generateScene(request, client, options);
}

export {
  type GenerateSceneOptions,
  type GenerateSceneResult,
  FakeModelClient,
} from "./generatePipeline.ts";
