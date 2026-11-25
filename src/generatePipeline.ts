/**
 * 3D Build Generation Pipeline
 *
 * Implements streaming JSON step parsing, prompt construction, step validation,
 * error handling, and automated retry loops with a mock/fake model client.
 */

import type { SceneStep } from "./types.ts";
import {
  validateScene,
  validateStep,
  PRIMITIVE_BOUNDS,
  VALID_PRIMITIVES,
  type DimensionBound,
} from "./sceneValidator.ts";
import {
  convertPrimitiveBoundsToViewerUnits,
  normalizeStepToViewerUnits,
} from "./sceneUnits.ts";
import { REAL_TONES } from "./three-scene.ts";

export interface ModelStreamMetadata {
  finishReason?: string;
  streamError?: string;
  maxTokens?: number;
}

export interface ModelGenerateOptions {
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  onMetadata?: (meta: ModelStreamMetadata) => void;
}

/**
 * Streaming model client interface.
 * Returns an async or synchronous stream of raw text chunks given a prompt.
 */
export interface ModelClient {
  generateStream(
    prompt: string,
    options?: ModelGenerateOptions
  ): AsyncIterable<string> | Iterable<string>;
}

export type FakeChunkSource =
  | string[]
  | ((
      prompt: string,
      options?: ModelGenerateOptions
    ) => string[] | AsyncIterable<string> | Iterable<string>);

/**
 * FakeModelClient for unit and integration testing.
 * Replays pre-configured sequences of chunk responses or handles prompts dynamically.
 */
export class FakeModelClient implements ModelClient {
  private responses: FakeChunkSource[];
  public recordedPrompts: string[] = [];
  public recordedOptions: (ModelGenerateOptions | undefined)[] = [];

  constructor(responses: FakeChunkSource[] | FakeChunkSource) {
    if (Array.isArray(responses) && responses.length > 0 && (Array.isArray(responses[0]) || typeof responses[0] === "function")) {
      this.responses = [...(responses as FakeChunkSource[])];
    } else {
      this.responses = [responses as FakeChunkSource];
    }
  }

  async *generateStream(
    prompt: string,
    options?: ModelGenerateOptions
  ): AsyncIterable<string> {
    this.recordedPrompts.push(prompt);
    this.recordedOptions.push(options);
    const resp = this.responses.shift();
    if (!resp) {
      return;
    }
    if (typeof resp === "function") {
      const generated = resp(prompt, options);
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
 * Maximum size in UTF-8 bytes allowed for a single pending (unclosed) JSON object.
 */
export const MAX_PENDING_OBJECT_BYTES = 64 * 1024;

export interface ExtractedJsonItem {
  objectText?: string;
  error?: string;
  rawText: string;
}

function utf8CodePointBytes(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/**
 * Extracts brace-balanced JSON objects from a stream of text chunks.
 * Ignores braces inside JSON strings (including escaped quotes).
 * Caps a single pending object at MAX_PENDING_OBJECT_BYTES (64 KB).
 */
export async function* extractBraceBalancedObjects(
  chunks: AsyncIterable<string> | Iterable<string>,
  maxPendingBytes: number = MAX_PENDING_OBJECT_BYTES
): AsyncGenerator<ExtractedJsonItem, void, unknown> {
  let pending = "";
  let pendingBytes = 0;
  let stray = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for await (const chunk of chunks) {
    for (const ch of chunk) {
      if (depth === 0) {
        if (ch === "{") {
          if (stray.trim()) {
            const trimmedStray = stray.trim();
            yield { objectText: trimmedStray, rawText: trimmedStray };
          }
          stray = "";
          depth = 1;
          pending = "{";
          pendingBytes = 1;
          inString = false;
          escaped = false;
        } else if (ch === "\n") {
          if (stray.trim()) {
            const trimmedStray = stray.trim();
            yield { objectText: trimmedStray, rawText: trimmedStray };
          }
          stray = "";
        } else if (stray.length > 0 || !/\s/.test(ch)) {
          stray += ch;
        }
        continue;
      }

      pending += ch;
      pendingBytes += utf8CodePointBytes(ch);

      if (pendingBytes > maxPendingBytes) {
        yield {
          error: `Pending JSON object exceeded ${Math.round(maxPendingBytes / 1024)} KB cap (${maxPendingBytes} bytes): missing closing '}'.`,
          rawText: pending.slice(0, 200),
        };
        pending = "";
        pendingBytes = 0;
        depth = 0;
        inString = false;
        escaped = false;
        return;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const completed = pending;
            pending = "";
            pendingBytes = 0;
            inString = false;
            escaped = false;
            yield { objectText: completed, rawText: completed };
          }
        }
      }
    }
  }

  if (stray.trim()) {
    const trimmedStray = stray.trim();
    yield { objectText: trimmedStray, rawText: trimmedStray };
  }

  if (depth > 0 && pending.trim()) {
    yield {
      error: "Unexpected end of stream: unclosed JSON object missing closing '}'.",
      rawText: pending.trim(),
    };
  }
}

/**
 * Parses streamed JSON step objects from a stream.
 * Strips surrounding Markdown code fences first, then extracts brace-balanced
 * JSON objects across lines and chunk boundaries.
 * Reports malformed JSON or unclosed objects per item without stopping valid later items.
 */
export async function* parseStreamedSteps(
  chunks: AsyncIterable<string> | Iterable<string>
): AsyncGenerator<ParsedStreamItem, void, unknown> {
  const fenceErrors: FencePreprocessItem[] = [];

  async function* strippedTextStream(): AsyncGenerator<string, void, unknown> {
    for await (const item of preprocessMarkdownFences(chunks)) {
      if (item.error) {
        fenceErrors.push(item);
      } else if (item.line !== undefined) {
        yield item.line + "\n";
      }
    }
  }

  for await (const extracted of extractBraceBalancedObjects(strippedTextStream())) {
    if (extracted.error) {
      yield {
        error: extracted.error,
        rawLine: extracted.rawText,
      };
      continue;
    }

    const trimmed = extracted.objectText?.trim();
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

  for (const fenceErr of fenceErrors) {
    yield {
      error: fenceErr.error ?? "Markdown code fence error.",
      rawLine: fenceErr.rawLine ?? "",
    };
  }
}

/**
 * Default maximum retry attempts permitted per invalid step.
 */
export const DEFAULT_MAX_RETRIES_PER_STEP = 3;
export const DEFAULT_INITIAL_MAX_TOKENS = 8192;
export const MAX_COMPLETION_TOKENS_CAP = 65536;

export function isIncompleteOutputError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const candidate = err as { code?: unknown; name?: unknown; message?: unknown };
  if (
    candidate.code === "incomplete_output" ||
    candidate.name === "IncompleteOutputError"
  ) {
    return true;
  }
  if (
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes("incomplete_output")
  ) {
    return true;
  }
  return false;
}

function isUnclosedJsonErrorMessage(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("unclosed json object") || lower.includes("incomplete_output");
}

function validateRetryStepShape(step: unknown): string[] {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    return ["Retry response must be a complete SceneStep JSON object."];
  }
  const obj = step as Partial<SceneStep>;
  const errors: string[] = [];
  if (typeof obj.stepNumber !== "number" || !Number.isFinite(obj.stepNumber) || obj.stepNumber < 1) {
    errors.push(`Retry step missing required positive integer 'stepNumber'.`);
  }
  if (typeof obj.title !== "string" || obj.title.trim() === "") {
    errors.push(`Retry step missing required non-empty string 'title'.`);
  }
  if (!Array.isArray(obj.parts) || obj.parts.length === 0) {
    errors.push(`Retry step missing non-empty 'parts' array.`);
  } else {
    obj.parts.forEach((p, idx) => {
      if (!p || typeof p !== "object" || typeof (p as any).id !== "string" || (p as any).id.trim() === "") {
        errors.push(`Retry step parts[${idx}] missing required non-empty string 'id'.`);
      }
    });
  }
  return errors;
}

function buildStepResponseFormat(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object") {
    return undefined;
  }
  const rec = schema as { definitions?: { SceneStep?: Record<string, unknown> } };
  if (!rec.definitions?.SceneStep) {
    return undefined;
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "scene_step",
      strict: false,
      schema: {
        ...rec.definitions.SceneStep,
        definitions: rec.definitions,
      },
    },
  };
}

export interface LoggedRetry {
  stepNumber: number;
  attempt: number;
  errors: string[];
  retryPrompt: string;
}

export interface RetryPromptInput {
  originalRequest: string;
  stepNumber: number;
  stepTitle?: string;
  invalidStep?: unknown;
  errors: string[];
  previousSteps: SceneStep[];
  schema?: unknown;
}

const CONCRETE_STEP_EXAMPLE = {
  stepNumber: 2,
  title: "Attach Bottom Panel",
  description: "Fasten the bottom panel between the left and right side panels.",
  cameraPreset: { distance: 2000, phi: 1.0, theta: 0.6 },
  parts: [
    {
      id: "bottom_panel",
      name: "Bottom Panel",
      primitive: "box",
      dimensions: { width: 800, height: 20, depth: 300 },
      position: { x: 0, y: 10, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: "tan",
      material: "oak",
      step: 2,
      qty: 1,
    },
  ],
};

/**
 * Builds a targeted retry prompt restating exact step number, title, already-used part IDs,
 * schema definition, concrete example, and exact validator error messages.
 */
export function buildRetryPrompt(input: RetryPromptInput): string {
  const errorsFormatted = input.errors.map((e) => `  - ${e}`).join("\n");
  const invalidJson = input.invalidStep
    ? JSON.stringify(input.invalidStep, null, 2)
    : "(Unparseable JSON)";

  const titleFromInvalid =
    input.invalidStep &&
    typeof input.invalidStep === "object" &&
    typeof (input.invalidStep as { title?: unknown }).title === "string" &&
    (input.invalidStep as { title: string }).title.trim() !== ""
      ? (input.invalidStep as { title: string }).title.trim()
      : undefined;
  const resolvedTitle = input.stepTitle ?? titleFromInvalid ?? `Step ${input.stepNumber}`;

  const usedIds: string[] = [];
  for (const prev of input.previousSteps) {
    if (Array.isArray(prev.parts)) {
      for (const p of prev.parts) {
        if (p && typeof p.id === "string" && !usedIds.includes(p.id)) {
          usedIds.push(p.id);
        }
      }
    }
  }
  const usedIdsText = usedIds.length > 0 ? usedIds.join(", ") : "(none)";

  const lines = [
    `step ${input.stepNumber} failed validation with the following errors:`,
    errorsFormatted,
    "",
    `Original Request: ${input.originalRequest}`,
    `Required stepNumber: ${input.stepNumber}`,
    `Required step title: ${resolvedTitle}`,
    `Part IDs already used in earlier steps (do NOT reuse these): ${usedIdsText}`,
    "",
    "Invalid step input received:",
    invalidJson,
  ];

  if (input.schema && Object.keys(input.schema as object).length > 0) {
    lines.push("", "=== TARGET SCHEMA ===", JSON.stringify(input.schema, null, 2));
  }

  lines.push(
    "",
    "=== EXAMPLE VALID STEP OBJECT ===",
    JSON.stringify(CONCRETE_STEP_EXAMPLE, null, 2),
    "",
    "Ensure the object includes stepNumber, title, and a non-empty parts array where every part includes id, primitive, dimensions, position, rotation, color, material, step, and qty.",
    `Return one complete JSON step object for step ${input.stepNumber}, nothing else.`
  );

  return lines.join("\n");
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
  const validationBounds = convertPrimitiveBoundsToViewerUnits(primitiveTable);
  const paletteNames = options.paletteNames ?? ALLOWED_PALETTE_NAMES;
  const schema = options.schema ?? {};
  const retryResponseFormat = buildStepResponseFormat(schema);

  const validSteps: SceneStep[] = [];
  const retriesLogged: LoggedRetry[] = [];
  const seenPartIds = new Set<string>();
  const completedStepNumbers = new Set<number>();

  // Model input is in millimeters (matching the schema and prompt);
  // divide once by MM_PER_VIEWER_UNIT (10) and clamp cameraPreset.distance using cumulative visible steps.
  const normalizeParsedStep = (rawStep: SceneStep): SceneStep =>
    normalizeStepToViewerUnits(rawStep, validSteps);

  const initialPrompt = buildPrompt(request, schema, primitiveTable, paletteNames);
  let initialMaxTokens = DEFAULT_INITIAL_MAX_TOKENS;

  for (let streamAttempt = 0; streamAttempt <= maxRetries; streamAttempt++) {
    let hitIncompleteStream = false;
    let incompleteReason = "incomplete_output: Model stream ended mid-object.";

    try {
      const stream = client.generateStream(initialPrompt, {
        maxTokens: initialMaxTokens,
      });

      for await (const item of parseStreamedSteps(stream)) {
        if (
          item.step &&
          typeof item.step.stepNumber === "number" &&
          completedStepNumbers.has(item.step.stepNumber)
        ) {
          continue;
        }

        if (item.error && isUnclosedJsonErrorMessage(item.error)) {
          hitIncompleteStream = true;
          incompleteReason = item.error;
          break;
        }

        let stepToValidate = item.step
          ? normalizeParsedStep(item.step)
          : undefined;
        let isValid = false;
        let validationErrors: string[] = [];

        if (item.error) {
          validationErrors = [item.error];
        } else if (stepToValidate) {
          validationErrors = validateStep(stepToValidate, {
            seenPartIds,
            primitiveTable: validationBounds,
            unitLabel: "cm",
          });
          if (validationErrors.length === 0) {
            isValid = true;
            validSteps.push(stepToValidate);
            completedStepNumbers.add(stepToValidate.stepNumber);
            options.onStep?.(stepToValidate, "valid");
          }
        }

        if (!isValid) {
          options.onStep?.(stepToValidate, "invalid", validationErrors);

          let attempt = 0;
          let resolved = false;
          let stepRetryMaxTokens = initialMaxTokens;
          const targetStepNum =
            stepToValidate && typeof stepToValidate.stepNumber === "number"
              ? stepToValidate.stepNumber
              : validSteps.length + 1;
          const targetStepTitle =
            stepToValidate &&
            typeof stepToValidate.title === "string" &&
            stepToValidate.title.trim() !== ""
              ? stepToValidate.title
              : undefined;

          let useSameRetryPrompt = false;
          let lastRetryPrompt = "";

          while (attempt < maxRetries) {
            attempt++;

            const retryPrompt =
              useSameRetryPrompt && lastRetryPrompt
                ? lastRetryPrompt
                : buildRetryPrompt({
                    originalRequest: request,
                    stepNumber: targetStepNum,
                    stepTitle: targetStepTitle,
                    invalidStep: stepToValidate,
                    errors: validationErrors,
                    previousSteps: validSteps,
                    schema,
                  });
            lastRetryPrompt = retryPrompt;
            useSameRetryPrompt = false;

            retriesLogged.push({
              stepNumber: targetStepNum,
              attempt,
              errors: [...validationErrors],
              retryPrompt,
            });

            options.onRetry?.(targetStepNum, attempt, validationErrors, retryPrompt);

            let retriedStep: SceneStep | undefined = undefined;
            let retryError: string | undefined = undefined;
            let retryIncomplete = false;

            try {
              for await (const retryItem of parseStreamedSteps(
                client.generateStream(retryPrompt, {
                  maxTokens: stepRetryMaxTokens,
                  responseFormat: retryResponseFormat,
                })
              )) {
                if (retryItem.error) {
                  retryError = retryItem.error;
                  if (isUnclosedJsonErrorMessage(retryItem.error)) {
                    retryIncomplete = true;
                  }
                } else if (retryItem.step) {
                  retriedStep = normalizeParsedStep(retryItem.step);
                  break;
                }
              }
            } catch (retryStreamErr: unknown) {
              if (isIncompleteOutputError(retryStreamErr)) {
                retryIncomplete = true;
                retryError =
                  retryStreamErr instanceof Error
                    ? retryStreamErr.message
                    : "incomplete_output";
              } else {
                throw retryStreamErr;
              }
            }

            if (retryIncomplete && !retriedStep) {
              validationErrors = [retryError ?? "incomplete_output"];
              options.onStep?.(undefined, "invalid", validationErrors);
              stepRetryMaxTokens = Math.min(
                MAX_COMPLETION_TOKENS_CAP,
                stepRetryMaxTokens * 2
              );
              useSameRetryPrompt = true;
              continue;
            }

            if (retryError && !retriedStep) {
              validationErrors = [retryError];
              options.onStep?.(undefined, "invalid", validationErrors);
            } else if (retriedStep) {
              stepToValidate = retriedStep;
              const shapeErrors = validateRetryStepShape(retriedStep);
              if (shapeErrors.length > 0) {
                validationErrors = shapeErrors;
                options.onStep?.(retriedStep, "invalid", validationErrors);
                continue;
              }
              validationErrors = validateStep(retriedStep, {
                seenPartIds,
                primitiveTable: validationBounds,
                unitLabel: "cm",
              });
              if (validationErrors.length === 0) {
                resolved = true;
                validSteps.push(retriedStep);
                completedStepNumbers.add(retriedStep.stepNumber);
                options.onStep?.(retriedStep, "valid");
                break;
              } else {
                options.onStep?.(retriedStep, "invalid", validationErrors);
              }
            } else {
              validationErrors = ["Retry produced an empty response."];
              options.onStep?.(undefined, "invalid", validationErrors);
            }
          }

          if (!resolved) {
            return {
              success: false,
              steps: validSteps,
              error: `Step ${targetStepNum} failed validation after ${maxRetries} retries: ${validationErrors.join("; ")}`,
              retriesLogged,
            };
          }
        }
      }
    } catch (streamErr: unknown) {
      if (isIncompleteOutputError(streamErr)) {
        hitIncompleteStream = true;
        incompleteReason =
          streamErr instanceof Error ? streamErr.message : "incomplete_output";
      } else {
        throw streamErr;
      }
    }

    if (!hitIncompleteStream) {
      break;
    }

    const nextStepNum = validSteps.length + 1;
    options.onStep?.(undefined, "invalid", [incompleteReason]);

    if (streamAttempt >= maxRetries) {
      return {
        success: false,
        steps: validSteps,
        error: `Step ${nextStepNum} failed with incomplete_output after ${maxRetries} retries: ${incompleteReason}`,
        retriesLogged,
      };
    }

    initialMaxTokens = Math.min(MAX_COMPLETION_TOKENS_CAP, initialMaxTokens * 2);
    retriesLogged.push({
      stepNumber: nextStepNum,
      attempt: streamAttempt + 1,
      errors: [incompleteReason],
      retryPrompt: initialPrompt,
    });
    options.onRetry?.(nextStepNum, streamAttempt + 1, [incompleteReason], initialPrompt);
  }

  if (validSteps.length > 0) {
    const sceneErrors = validateScene(
      { schemaVersion: 1, steps: validSteps },
      { primitiveTable: validationBounds, unitLabel: "cm" }
    );
    if (sceneErrors.length > 0) {
      return {
        success: false,
        steps: validSteps,
        error: sceneErrors.join("; "),
        retriesLogged,
      };
    }
  }

  return {
    success: true,
    steps: validSteps,
    retriesLogged,
  };
}
