/**
 * 3D Build Generation Pipeline
 *
 * Implements streaming JSON step parsing, prompt construction, step validation,
 * error handling, and automated retry loops with a mock/fake model client.
 */

import type { SceneStep } from "./types.ts";
import {
  validateStep,
  PRIMITIVE_BOUNDS,
  VALID_PRIMITIVES,
  type DimensionBound,
} from "./sceneValidator.ts";
import { REAL_TONES } from "./three-scene.ts";

/**
 * Streaming model client interface.
 * Returns an async or synchronous stream of raw text chunks given a prompt.
 */
export interface ModelClient {
  generateStream(prompt: string): AsyncIterable<string> | Iterable<string>;
}

export type FakeChunkSource =
  | string[]
  | ((prompt: string) => string[] | AsyncIterable<string> | Iterable<string>);

/**
 * FakeModelClient for unit and integration testing.
 * Replays pre-configured sequences of chunk responses or handles prompts dynamically.
 */
export class FakeModelClient implements ModelClient {
  private responses: FakeChunkSource[];
  public recordedPrompts: string[] = [];

  constructor(responses: FakeChunkSource[] | FakeChunkSource) {
    if (Array.isArray(responses) && responses.length > 0 && (Array.isArray(responses[0]) || typeof responses[0] === "function")) {
      this.responses = [...(responses as FakeChunkSource[])];
    } else {
      this.responses = [responses as FakeChunkSource];
    }
  }

  async *generateStream(prompt: string): AsyncIterable<string> {
    this.recordedPrompts.push(prompt);
    const resp = this.responses.shift();
    if (!resp) {
      return;
    }
    if (typeof resp === "function") {
      const generated = resp(prompt);
      for await (const chunk of generated) {
        yield chunk;
      }
    } else {
      for (const chunk of resp) {
        yield chunk;
      }
    }
  }
}

/**
 * Canonical list of allowed color tone names from the physical palette.
 */
export const ALLOWED_PALETTE_NAMES: readonly string[] = Object.freeze(
  Object.keys(REAL_TONES)
);

/**
 * Builds the comprehensive generation prompt containing the request, schema,
 * supported primitive list, dimension bounds, and palette names.
 */
export function buildPrompt(
  request: string,
  schema: unknown,
  primitiveTable: Record<string, Record<string, DimensionBound>> = PRIMITIVE_BOUNDS,
  paletteNames: readonly string[] = ALLOWED_PALETTE_NAMES
): string {
  const schemaStr =
    typeof schema === "string" ? schema : JSON.stringify(schema, null, 2);
  const primitivesList = Object.keys(primitiveTable).join(", ");
  const boundsStr = JSON.stringify(primitiveTable, null, 2);
  const palettesStr = paletteNames.join(", ");

  return [
    "=== 3D ASSEMBLY GENERATION INSTRUCTIONS ===",
    `User Request: ${request}`,
    "",
    "=== TARGET SCHEMA ===",
    schemaStr,
    "",
    "=== ALLOWED PRIMITIVES ===",
    primitivesList,
    "",
    "=== DIMENSION BOUNDS (MILLIMETERS & CONSTRAINTS) ===",
    boundsStr,
    "",
    "=== ALLOWED PALETTE COLORS ===",
    palettesStr,
    "",
    "=== OUTPUT FORMAT ===",
    "Output each step as a single newline-delimited JSON line conforming to the SceneStep schema.",
    "Do not wrap lines in markdown code blocks.",
  ].join("\n");
}

/**
 * Result emitted for each parsed streamed line.
 */
export interface ParsedStreamItem {
  step?: SceneStep;
  error?: string;
  rawLine: string;
}

interface FencePreprocessItem {
  line?: string;
  error?: string;
  rawLine?: string;
}

/**
 * Removes leading and trailing Markdown code fences (including language tags
 * such as ```json) across chunk boundaries without altering content inside
 * JSON strings. Emits an error item at EOF if an opening fence was never closed.
 */
async function* preprocessMarkdownFences(
  chunks: AsyncIterable<string> | Iterable<string>
): AsyncGenerator<FencePreprocessItem, void, unknown> {
  let buffer = "";
  let fenceOpen = false;
  let openFenceMarker = "";

  const processCompletedLine = (rawLine: string): FencePreprocessItem[] => {
    const lineWithoutCr = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = lineWithoutCr.trim();
    if (!trimmed) {
      return [];
    }

    // Case 1: Line is purely a Markdown fence marker (e.g. "```", "```json")
    const pureFenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)$/);
    if (pureFenceMatch) {
      if (!fenceOpen) {
        fenceOpen = true;
        openFenceMarker = trimmed;
        return [];
      }
      if (pureFenceMatch[1] === "") {
        fenceOpen = false;
        openFenceMarker = "";
        return [];
      }
      // Nested opening marker inside an already-open fence; leave fenceOpen true
      return [];
    }

    let content = trimmed;

    // Case 2: Inline opening fence immediately preceding a JSON object (e.g. ```json{...})
    if (!fenceOpen) {
      const inlineOpenMatch = content.match(/^```(?:[a-zA-Z0-9_-]+)?\s*(\{[\s\S]*)$/);
      if (inlineOpenMatch) {
        fenceOpen = true;
        openFenceMarker = "```";
        content = inlineOpenMatch[1];
      }
    }

    // Case 3: Inline closing fence at the end of a JSON object line (e.g. {...}```)
    if (fenceOpen && /\}\s*```$/.test(content)) {
      content = content.replace(/\s*```$/, "");
      fenceOpen = false;
      openFenceMarker = "";
    }

    return [{ line: content }];
  };

  for await (const chunk of chunks) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      for (const item of processCompletedLine(line)) {
        yield item;
      }
    }
  }

  if (buffer.trim()) {
    for (const item of processCompletedLine(buffer)) {
      yield item;
    }
  }

  if (fenceOpen) {
    yield {
      error: "Unclosed Markdown code fence in model output: missing closing ```.",
      rawLine: openFenceMarker,
    };
  }
}

/**
 * Parses newline-delimited JSON chunks from a stream.
 * Strips surrounding Markdown code fences before line parsing.
 * Buffers partial lines across chunk boundaries.
 * Reports malformed JSON per line as an error without terminating the stream.
 */
export async function* parseStreamedSteps(
  chunks: AsyncIterable<string> | Iterable<string>
): AsyncGenerator<ParsedStreamItem, void, unknown> {
  for await (const item of preprocessMarkdownFences(chunks)) {
    if (item.error) {
      yield {
        error: item.error,
        rawLine: item.rawLine ?? "",
      };
      continue;
    }

    const trimmed = item.line?.trim();
    if (!trimmed) continue;

    try {
      const step = JSON.parse(trimmed) as SceneStep;
      yield { step, rawLine: trimmed };
    } catch (err: any) {
      yield {
        error: `Malformed JSON on line: ${err.message}`,
        rawLine: trimmed,
      };
    }
  }
}

/**
 * Default maximum retry attempts permitted per invalid step.
 */
export const DEFAULT_MAX_RETRIES_PER_STEP = 3;

export interface LoggedRetry {
  stepNumber: number;
  attempt: number;
  errors: string[];
  retryPrompt: string;
}

export interface RetryPromptInput {
  originalRequest: string;
  stepNumber: number;
  invalidStep?: unknown;
  errors: string[];
  previousSteps: SceneStep[];
}

/**
 * Builds a targeted retry prompt containing the exact validator error messages.
 */
export function buildRetryPrompt(input: RetryPromptInput): string {
  const errorsFormatted = input.errors.map((e) => `  - ${e}`).join("\n");
  const invalidJson = input.invalidStep
    ? JSON.stringify(input.invalidStep, null, 2)
    : "(Unparseable JSON)";

  return [
    `Step ${input.stepNumber} failed validation with the following errors:`,
    errorsFormatted,
    "",
    `Original Request: ${input.originalRequest}`,
    "",
    "Invalid step input received:",
    invalidJson,
    "",
    `Please correct the step to satisfy all schema and dimension rules.`,
    `Output ONLY the corrected Step ${input.stepNumber} as a single JSON line.`,
  ].join("\n");
}

export interface GenerateSceneOptions {
  maxRetriesPerStep?: number;
  schema?: unknown;
  primitiveTable?: Record<string, Record<string, DimensionBound>>;
  paletteNames?: readonly string[];
  onStep?: (
    step: SceneStep | undefined,
    status: "valid" | "invalid",
    errors?: string[]
  ) => void;
  onRetry?: (
    stepNumber: number,
    attempt: number,
    errors: string[],
    retryPrompt: string
  ) => void;
}

export interface GenerateSceneResult {
  success: boolean;
  steps: SceneStep[];
  error?: string;
  retriesLogged: LoggedRetry[];
}

/**
 * Coordinates generation of assembly steps from a model client.
 * Validates each step incrementally, emits valid/invalid events,
 * and triggers targeted retries with exact validation errors up to maxRetriesPerStep.
 */
export async function generateScene(
  request: string,
  client: ModelClient,
  options: GenerateSceneOptions = {}
): Promise<GenerateSceneResult> {
  const maxRetries = options.maxRetriesPerStep ?? DEFAULT_MAX_RETRIES_PER_STEP;
  const primitiveTable = options.primitiveTable ?? PRIMITIVE_BOUNDS;
  const paletteNames = options.paletteNames ?? ALLOWED_PALETTE_NAMES;
  const schema = options.schema ?? {};

  const validSteps: SceneStep[] = [];
  const retriesLogged: LoggedRetry[] = [];
  const seenPartIds = new Set<string>();

  const initialPrompt = buildPrompt(request, schema, primitiveTable, paletteNames);
  const stream = client.generateStream(initialPrompt);

  for await (const item of parseStreamedSteps(stream)) {
    let stepToValidate = item.step;
    let isValid = false;
    let validationErrors: string[] = [];

    if (item.error) {
      validationErrors = [item.error];
    } else if (stepToValidate) {
      validationErrors = validateStep(stepToValidate, { seenPartIds });
      if (validationErrors.length === 0) {
        isValid = true;
        validSteps.push(stepToValidate);
        options.onStep?.(stepToValidate, "valid");
      }
    }

    if (!isValid) {
      options.onStep?.(stepToValidate, "invalid", validationErrors);

      let attempt = 0;
      let resolved = false;

      while (attempt < maxRetries) {
        attempt++;
        const stepNum =
          (stepToValidate && typeof stepToValidate.stepNumber === "number")
            ? stepToValidate.stepNumber
            : validSteps.length + 1;

        const retryPrompt = buildRetryPrompt({
          originalRequest: request,
          stepNumber: stepNum,
          invalidStep: stepToValidate,
          errors: validationErrors,
          previousSteps: validSteps,
        });

        retriesLogged.push({
          stepNumber: stepNum,
          attempt,
          errors: [...validationErrors],
          retryPrompt,
        });

        options.onRetry?.(stepNum, attempt, validationErrors, retryPrompt);

        // Request retry generation from model client
        let retriedStep: SceneStep | undefined = undefined;
        let retryError: string | undefined = undefined;

        for await (const retryItem of parseStreamedSteps(client.generateStream(retryPrompt))) {
          if (retryItem.error) {
            retryError = retryItem.error;
          } else if (retryItem.step) {
            retriedStep = retryItem.step;
            break;
          }
        }

        if (retryError && !retriedStep) {
          validationErrors = [retryError];
          options.onStep?.(undefined, "invalid", validationErrors);
        } else if (retriedStep) {
          stepToValidate = retriedStep;
          validationErrors = validateStep(retriedStep, { seenPartIds });
          if (validationErrors.length === 0) {
            resolved = true;
            validSteps.push(retriedStep);
            options.onStep?.(retriedStep, "valid");
            break;
          } else {
            options.onStep?.(retriedStep, "invalid", validationErrors);
          }
        }
      }

      if (!resolved) {
        const stepNum =
          (stepToValidate && typeof stepToValidate.stepNumber === "number")
            ? stepToValidate.stepNumber
            : validSteps.length + 1;

        return {
          success: false,
          steps: validSteps,
          error: `Step ${stepNum} failed validation after ${maxRetries} retries: ${validationErrors.join("; ")}`,
          retriesLogged,
        };
      }
    }
  }

  return {
    success: true,
    steps: validSteps,
    retriesLogged,
  };
}
