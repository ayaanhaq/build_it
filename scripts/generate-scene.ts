/**
 * CLI runner for end-to-end streaming 3D scene generation via the configured LLM provider.
 *
 * Usage:
 *   GEMINI_API_KEY=... node --experimental-strip-types scripts/generate-scene.ts "build a 4-shelf bookcase"
 *   LLM_PROVIDER=groq GROQ_API_KEY=... node --experimental-strip-types scripts/generate-scene.ts --debug "build a 4-shelf bookcase"
 *   GEMINI_API_KEY=... node --experimental-strip-types scripts/generate-scene.ts --save out.json --debug "build a 4-shelf bookcase"
 *   node --experimental-strip-types scripts/generate-scene.ts --dry-run "build a 4-shelf bookcase"
 */

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPrompt,
  generateScene,
  ALLOWED_PALETTE_NAMES,
  type ModelClient,
  type ModelGenerateOptions,
} from "../src/generatePipeline.ts";
import { PRIMITIVE_BOUNDS } from "../src/sceneValidator.ts";
import type { SceneStep } from "../src/types.ts";
import {
  createProviderModelClient,
  getEnvSecretsForRedaction,
  getProviderEnvSpec,
  isProviderClientError,
  resolveLlmProvider,
  type LlmProvider,
} from "../src/model/provider.ts";

export interface ParsedCliArgs {
  dryRun: boolean;
  debug: boolean;
  savePath?: string;
  request: string;
  argError?: string;
}

export function parseArgs(argv: string[]): ParsedCliArgs {
  let dryRun = false;
  let debug = false;
  let savePath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--save") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        return {
          dryRun,
          debug,
          request: "",
          argError: "Error: --save requires a file path.",
        };
      }
      savePath = next;
      i++;
    } else if (arg.startsWith("--save=")) {
      const value = arg.slice("--save=".length).trim();
      if (!value) {
        return {
          dryRun,
          debug,
          request: "",
          argError: "Error: --save requires a non-empty file path.",
        };
      }
      savePath = value;
    } else {
      positional.push(arg);
    }
  }

  return {
    dryRun,
    debug,
    savePath,
    request: positional.join(" ").trim(),
  };
}

function loadSceneSchema(): unknown {
  const schemaUrl = new URL("../schemas/scene.schema.json", import.meta.url);
  return JSON.parse(readFileSync(schemaUrl, "utf8"));
}

function redactSecret(text: string, secret?: string | string[]): string {
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

function wrapDebugClient(
  inner: ModelClient,
  onChunk: (chunk: string) => void
): ModelClient {
  return {
    async *generateStream(
      prompt: string,
      options?: ModelGenerateOptions
    ): AsyncIterable<string> {
      for await (const chunk of inner.generateStream(prompt, options)) {
        onChunk(chunk);
        yield chunk;
      }
    },
  };
}

export interface SavedSceneOutput {
  schemaVersion: 1;
  request: string;
  complete: boolean;
  error?: string;
  steps: SceneStep[];
  rawOutput?: string;
}

function writeSaveFile(
  savePath: string,
  payload: SavedSceneOutput,
  apiKey?: string | string[]
): void {
  mkdirSync(dirname(savePath), { recursive: true });
  const serialized = redactSecret(JSON.stringify(payload, null, 2) + "\n", apiKey);
  writeFileSync(savePath, serialized, "utf8");
}

export interface CliRuntimeDeps {
  env?: Record<string, string | undefined>;
  stdout?: { write: (text: string) => void };
  stderr?: { write: (text: string) => void };
  clientFactory?: (
    apiKey: string,
    options?: { provider: LlmProvider; model?: string }
  ) => ModelClient;
}

export async function runCli(
  argv: string[],
  deps: CliRuntimeDeps = {}
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const parsed = parseArgs(argv);

  if (parsed.argError) {
    stderr.write(parsed.argError + "\n");
    return 1;
  }

  if (!parsed.request) {
    stderr.write(
      'Usage: node --experimental-strip-types scripts/generate-scene.ts [--dry-run] [--save <path>] [--debug] "<request>"\n'
    );
    return 1;
  }

  let provider: LlmProvider;
  try {
    provider = resolveLlmProvider(env);
  } catch (err: any) {
    stderr.write(`Error: ${err?.message ?? String(err)}\n`);
    return 1;
  }

  const schema = loadSceneSchema();

  if (parsed.dryRun) {
    const prompt = buildPrompt(
      parsed.request,
      schema,
      PRIMITIVE_BOUNDS,
      ALLOWED_PALETTE_NAMES
    );
    stdout.write(prompt + "\n");
    return 0;
  }

  const providerSpec = getProviderEnvSpec(provider);
  const apiKey = env[providerSpec.apiKeyEnvVar]?.trim();
  const secretsForRedaction = getEnvSecretsForRedaction(env);
  if (!apiKey) {
    stderr.write(
      `Error: Missing ${providerSpec.apiKeyEnvVar} environment variable. Set ${providerSpec.apiKeyEnvVar} or pass --dry-run.\n`
    );
    return 1;
  }

  const model = env[providerSpec.modelEnvVar]?.trim() || undefined;
  const baseClient = deps.clientFactory
    ? deps.clientFactory(apiKey, { provider, model })
    : createProviderModelClient({ provider, apiKey, model });

  const rawChunks: string[] = [];
  const client: ModelClient = parsed.debug
    ? wrapDebugClient(baseClient, (chunk) => {
        const sanitized = redactSecret(chunk, secretsForRedaction);
        rawChunks.push(sanitized);
        stderr.write(sanitized);
      })
    : baseClient;

  const collectedSteps: SceneStep[] = [];

  const saveResult = (complete: boolean, error?: string): void => {
    if (!parsed.savePath) {
      return;
    }
    const payload: SavedSceneOutput = {
      schemaVersion: 1,
      request: parsed.request,
      complete,
      steps: collectedSteps,
    };
    if (error) {
      payload.error = redactSecret(error, secretsForRedaction);
    }
    if (parsed.debug) {
      payload.rawOutput = redactSecret(rawChunks.join(""), secretsForRedaction);
    }
    writeSaveFile(parsed.savePath, payload, secretsForRedaction);
  };

  try {
    const result = await generateScene(parsed.request, client, {
      schema,
      onStep: (step, status) => {
        if (status === "valid" && step) {
          collectedSteps.push(step);
          stdout.write(
            redactSecret(JSON.stringify(step) + "\n", secretsForRedaction)
          );
        }
      },
    });

    if (!result.success) {
      const errMsg = redactSecret(
        result.error ?? "Unknown validation error",
        secretsForRedaction
      );
      saveResult(false, errMsg);
      stderr.write(`Generation failed: ${errMsg}\n`);
      return 1;
    }

    if (result.steps.length === 0) {
      const errMsg = "Model stream produced zero valid steps.";
      saveResult(false, errMsg);
      stderr.write(`Generation failed: ${errMsg}\n`);
      return 1;
    }

    saveResult(true);
    return 0;
  } catch (err: any) {
    const rawMsg = isProviderClientError(err)
      ? err.message
      : err?.message ?? String(err);
    const safeMsg = redactSecret(String(rawMsg), secretsForRedaction);
    saveResult(false, safeMsg);
    stderr.write(`Error: ${safeMsg}\n`);
    return 1;
  }
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
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
