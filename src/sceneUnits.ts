/**
 * Viewer Unit Normalization Utilities
 *
 * The Three.js viewer renders at centimeter-like world scale while models
 * typically output dimensions, positions, and camera distances in millimeters.
 * Dividing spatial coordinates by MM_PER_VIEWER_UNIT (10) normalizes mm to cm.
 */

import type {
  Scene,
  ScenePart,
  SceneStep,
  Vector3D,
} from "./types.ts";
import { PRIMITIVE_BOUNDS, type DimensionBound } from "./sceneValidator.ts";

type CameraPreset = SceneStep["cameraPreset"];

/**
 * Conversion factor from model millimeter output to viewer units (centimeters).
 */
export const MM_PER_VIEWER_UNIT = 10;

const NON_SPATIAL_DIMENSION_KEYS = new Set([
  "radialSegments",
  "segments",
  "coils",
]);

function scaleSpatialNumber(value: unknown, factor: number): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value / factor;
  }
  return value;
}

function normalizeDimensions(
  dims: Record<string, unknown>,
  factor: number
): Record<string, unknown> {
  if (!dims || typeof dims !== "object") {
    return dims;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(dims)) {
    normalized[key] = NON_SPATIAL_DIMENSION_KEYS.has(key)
      ? val
      : scaleSpatialNumber(val, factor);
  }
  return normalized;
}

function normalizeVector(vec: Vector3D, factor: number): Vector3D {
  if (!vec || typeof vec !== "object") {
    return vec;
  }
  return {
    ...vec,
    x: scaleSpatialNumber(vec.x, factor) as number,
    y: scaleSpatialNumber(vec.y, factor) as number,
    z: scaleSpatialNumber(vec.z, factor) as number,
  };
}

function cloneVector(vec: Vector3D): Vector3D {
  if (!vec || typeof vec !== "object") {
    return vec;
  }
  return { ...vec };
}

function normalizeCameraPreset(
  preset: CameraPreset | undefined,
  factor: number
): CameraPreset | undefined {
  if (!preset || typeof preset !== "object") {
    return preset;
  }
  return {
    ...preset,
    distance: scaleSpatialNumber(preset.distance, factor) as number,
  };
}

function normalizePart(part: ScenePart, factor: number): ScenePart {
  if (!part || typeof part !== "object") {
    return part;
  }
  return {
    ...part,
    dimensions: normalizeDimensions(
      part.dimensions as Record<string, unknown>,
      factor
    ) as ScenePart["dimensions"],
    position: normalizeVector(part.position, factor),
    rotation: cloneVector(part.rotation),
  };
}

function normalizeStep(step: SceneStep, factor: number): SceneStep {
  if (!step || typeof step !== "object") {
    return step;
  }
  return {
    ...step,
    ...(step.cameraPreset !== undefined
      ? { cameraPreset: normalizeCameraPreset(step.cameraPreset, factor) }
      : {}),
    parts: Array.isArray(step.parts)
      ? step.parts.map((part) => normalizePart(part, factor))
      : step.parts,
  };
}

/**
 * Purely converts millimeter scene coordinates into viewer units (centimeters)
 * by dividing every spatial dimension, position component, and cameraPreset.distance
 * by MM_PER_VIEWER_UNIT (10). Leaves phi, theta, rotation, qty, and segment/coil counts untouched.
 */
export function normalizeSceneToViewerUnits(scene: Scene): Scene {
  if (!scene || typeof scene !== "object") {
    return scene;
  }
  return {
    ...scene,
    steps: Array.isArray(scene.steps)
      ? scene.steps.map((step) => normalizeStep(step, MM_PER_VIEWER_UNIT))
      : scene.steps,
  };
}

/**
 * Converts a millimeter primitive bounds table into viewer units (centimeters),
 * leaving dimensionless count bounds (radialSegments, segments, coils) unchanged.
 */
export function convertPrimitiveBoundsToViewerUnits(
  boundsTable: Record<string, Record<string, DimensionBound>> = PRIMITIVE_BOUNDS
): Record<string, Record<string, DimensionBound>> {
  const converted: Record<string, Record<string, DimensionBound>> = {};
  for (const [primitive, dims] of Object.entries(boundsTable)) {
    const scaledDims: Record<string, DimensionBound> = {};
    for (const [dimKey, bound] of Object.entries(dims)) {
      if (NON_SPATIAL_DIMENSION_KEYS.has(dimKey)) {
        scaledDims[dimKey] = { min: bound.min, max: bound.max };
      } else {
        scaledDims[dimKey] = {
          min: bound.min / MM_PER_VIEWER_UNIT,
          max: bound.max / MM_PER_VIEWER_UNIT,
        };
      }
    }
    converted[primitive] = scaledDims;
  }
  return converted;
}

/**
 * Canonical primitive bounds expressed in viewer units (centimeters).
 */
export const VIEWER_PRIMITIVE_BOUNDS: Record<
  string,
  Record<string, DimensionBound>
> = convertPrimitiveBoundsToViewerUnits(PRIMITIVE_BOUNDS);
