/**
 * Generation Service Entry Point
 *
 * Exposes the generate function backed by FakeModelClient,
 * and the ENABLE_STREAMING_GENERATION feature flag.
 */

import {
  generateScene,
  FakeModelClient,
  type GenerateSceneOptions,
  type GenerateSceneResult,
} from "./generatePipeline.ts";
import { getBuildScene } from "./builds.ts";

/**
 * Feature flag to enable streaming generation in the frontend.
 * Set to false by default per specification.
 */
export const ENABLE_STREAMING_GENERATION = false;

/**
 * Generates a validated 3D scene from a user request.
 * Takes the same interface as the generation pipeline from Step 4.
 * Uses FakeModelClient to stream validated scene steps offline.
 */
export async function generate(
  request: string,
  options: GenerateSceneOptions = {}
): Promise<GenerateSceneResult> {
  // Use resolved build scene steps as the streaming chunks for FakeModelClient
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
