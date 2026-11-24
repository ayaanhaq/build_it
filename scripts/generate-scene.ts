/**
 * CLI runner for end-to-end streaming 3D scene generation via GeminiModelClient.
 *
 * Usage:
 *   GEMINI_API_KEY=... node --experimental-strip-types scripts/generate-scene.ts "build a 4-shelf bookcase"
 *   node --experimental-strip-types scripts/generate-scene.ts --dry-run "build a 4-shelf bookcase"
 */

import { readFileSync } from "node:fs";
import {
  buildPrompt,
  generateScene,
  ALLOWED_PALETTE_NAMES,
} from "../src/generatePipeline.ts";
import { PRIMITIVE_BOUNDS } from "../src/sceneValidator.ts";
import { GeminiModelClient, GeminiClientError } from "../src/model/geminiClient.ts";

function parseArgs(argv: string[]): { dryRun: boolean; request: string } {
  let dryRun = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else {
      positional.push(arg);
    }
  }

  return {
    dryRun,
    request: positional.join(" ").trim(),
  };
}

function loadSceneSchema(): unknown {
  const schemaUrl = new URL("../schemas/scene.schema.json", import.meta.url);
  return JSON.parse(readFileSync(schemaUrl, "utf8"));
}

function redactSecret(text: string, secret?: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join("[REDACTED]");
}

async function main(): Promise<void> {
  const { dryRun, request } = parseArgs(process.argv.slice(2));

  if (!request) {
    process.stderr.write(
      'Usage: node --experimental-strip-types scripts/generate-scene.ts [--dry-run] "<request>"\n'
    );
    process.exit(1);
  }

  const schema = loadSceneSchema();

  if (dryRun) {
    const prompt = buildPrompt(request, schema, PRIMITIVE_BOUNDS, ALLOWED_PALETTE_NAMES);
    process.stdout.write(prompt + "\n");
    process.exit(0);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    process.stderr.write(
      "Error: Missing GEMINI_API_KEY environment variable. Set GEMINI_API_KEY or pass --dry-run.\n"
    );
    process.exit(1);
  }

  const client = new GeminiModelClient({ apiKey });

  try {
    const result = await generateScene(request, client, {
      schema,
      onStep: (step, status) => {
        if (status === "valid" && step) {
          process.stdout.write(JSON.stringify(step) + "\n");
        }
      },
    });

    if (!result.success) {
      process.stderr.write(
        `Generation failed: ${redactSecret(result.error ?? "Unknown validation error", apiKey)}\n`
      );
      process.exit(1);
    }

    if (result.steps.length === 0) {
      process.stderr.write("Generation failed: model stream produced zero valid steps.\n");
      process.exit(1);
    }
  } catch (err: any) {
    const message =
      err instanceof GeminiClientError
        ? err.message
        : err?.message ?? String(err);
    process.stderr.write(`Error: ${redactSecret(String(message), apiKey)}\n`);
    process.exit(1);
  }
}

main();
