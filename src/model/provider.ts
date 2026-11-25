/**
 * LLM Provider Selection & Factory Helpers
 *
 * Centralizes LLM_PROVIDER resolution, per-provider env variable mapping,
 * secret extraction for redaction, and client construction for server and CLI.
 */

import type { ModelClient } from "../generatePipeline.ts";
import { GeminiClientError, GeminiModelClient } from "./geminiClient.ts";
import { GroqClientError, GroqModelClient } from "./groqClient.ts";

export type LlmProvider = "gemini" | "groq";

export const DEFAULT_LLM_PROVIDER: LlmProvider = "gemini";

export interface ProviderEnvSpec {
  provider: LlmProvider;
  apiKeyEnvVar: "GEMINI_API_KEY" | "GROQ_API_KEY";
  modelEnvVar: "GEMINI_MODEL" | "GROQ_MODEL";
}

const PROVIDER_SPECS: Record<LlmProvider, ProviderEnvSpec> = {
  gemini: {
    provider: "gemini",
    apiKeyEnvVar: "GEMINI_API_KEY",
    modelEnvVar: "GEMINI_MODEL",
  },
  groq: {
    provider: "groq",
    apiKeyEnvVar: "GROQ_API_KEY",
    modelEnvVar: "GROQ_MODEL",
  },
};

/**
 * Resolves the configured LLM provider from LLM_PROVIDER (defaults to "gemini").
 * Throws a clear error if LLM_PROVIDER is set to an unknown value.
 */
export function resolveLlmProvider(
  env: Record<string, string | undefined> = {}
): LlmProvider {
  const raw = env.LLM_PROVIDER?.trim();
  if (!raw) {
    return DEFAULT_LLM_PROVIDER;
  }

  const normalized = raw.toLowerCase();
  if (normalized === "gemini" || normalized === "groq") {
    return normalized;
  }

  throw new Error(
    `Invalid LLM_PROVIDER "${raw}". Supported values are "gemini" or "groq".`
  );
}

/**
 * Returns the environment variable names for API key and model override.
 */
export function getProviderEnvSpec(provider: LlmProvider): ProviderEnvSpec {
  return PROVIDER_SPECS[provider];
}

/**
 * Collects any non-empty provider API keys from env so logs and events can redact all of them.
 */
export function getEnvSecretsForRedaction(
  env: Record<string, string | undefined>
): string[] {
  const secrets: string[] = [];
  for (const keyName of ["GEMINI_API_KEY", "GROQ_API_KEY"] as const) {
    const value = env[keyName]?.trim();
    if (value && !secrets.includes(value)) {
      secrets.push(value);
    }
  }
  return secrets;
}

/**
 * Instantiates the concrete ModelClient for the selected provider.
 */
export function createProviderModelClient(options: {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
}): ModelClient {
  if (options.provider === "groq") {
    return new GroqModelClient({
      apiKey: options.apiKey,
      model: options.model,
    });
  }
  return new GeminiModelClient({
    apiKey: options.apiKey,
    model: options.model,
  });
}

/**
 * Checks whether an error came from one of our provider clients.
 */
export function isProviderClientError(
  err: unknown
): err is GeminiClientError | GroqClientError {
  return err instanceof GeminiClientError || err instanceof GroqClientError;
}
