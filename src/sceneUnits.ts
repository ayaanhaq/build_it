/**
 * Viewer Unit Normalization Utilities
 *
 * The Three.js viewer renders at centimeter-like world scale while models
 * typically output dimensions, positions, and camera distances in millimeters.
 * Dividing spatial coordinates by MM_PER_VIEWER_UNIT (10) normalizes mm to cm,
 * and cameraPreset.distance is clamped per step against the cumulative visible
 * model bounding box so tall builds fit cleanly inside the viewport.
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

export const MIN_CAMERA_DISTANCE_EXTENT_FACTOR = 1.6;
export const MIN_CAMERA_DISTANCE = MIN_CAMERA_DISTANCE_EXTENT_FACTOR * 1;
export const MAX_CAMERA_DISTANCE = 400;
export const DEFAULT_CAMERA_PHI = 1.0;
export const DEFAULT_CAMERA_THETA = 0.6;

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

function getLocalHalfExtents(part: ScenePart): [number, number, number] | null {
  const dims = part?.dimensions as Record<string, unknown> | undefined;
  if (!dims || typeof dims !== "object") {
    return null;
  }
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : undefined;

  switch (part.primitive) {
    case "box":
    case "bevel": {
      const w = num(dims.width);
      const h = num(dims.height);
      const d = num(dims.depth);
      if (w === undefined || h === undefined || d === undefined) return null;
      return [w / 2, h / 2, d / 2];
    }
    case "cylinder": {
      const h = num(dims.height);
      const r = Math.max(
        num(dims.radius) ?? 0,
        num(dims.radiusTop) ?? 0,
        num(dims.radiusBottom) ?? 0
      );
      if (h === undefined || r <= 0) return null;
      return [r, h / 2, r];
    }
    case "lathe": {
      const r = num(dims.radius);
      const h = num(dims.height);
      if (r === undefined || h === undefined) return null;
      return [r, h / 2, r];
    }
    case "spring": {
      const r = num(dims.radius);
      const h = num(dims.height);
      const wire = num(dims.wireRadius) ?? Math.min((r ?? 0) * 0.1, 1.0);
      if (r === undefined || h === undefined) return null;
      return [r + wire, h / 2 + wire, r + wire];
    }
    default:
      return null;
  }
}

interface AabbBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  empty: boolean;
}

function expandAabbByPart(bounds: AabbBounds, part: ScenePart): void {
  const half = getLocalHalfExtents(part);
  const pos = part?.position;
  if (
    !half ||
    !pos ||
    typeof pos.x !== "number" ||
    !Number.isFinite(pos.x) ||
    typeof pos.y !== "number" ||
    !Number.isFinite(pos.y) ||
    typeof pos.z !== "number" ||
    !Number.isFinite(pos.z)
  ) {
    return;
  }

  const degToRad = Math.PI / 180;
  const rot = part.rotation;
  const rx =
    rot && typeof rot.x === "number" && Number.isFinite(rot.x)
      ? rot.x * degToRad
      : 0;
  const ry =
    rot && typeof rot.y === "number" && Number.isFinite(rot.y)
      ? rot.y * degToRad
      : 0;
  const rz =
    rot && typeof rot.z === "number" && Number.isFinite(rot.z)
      ? rot.z * degToRad
      : 0;

  // Exact Three.js Euler XYZ rotation matrix extents for an oriented box
  const cx = Math.cos(rx),
    sx = Math.sin(rx);
  const cy = Math.cos(ry),
    sy = Math.sin(ry);
  const cz = Math.cos(rz),
    sz = Math.sin(rz);

  const m11 = cy * cz;
  const m12 = -cy * sz;
  const m13 = sy;
  const m21 = cx * sz + cz * sx * sy;
  const m22 = cx * cz - sx * sy * sz;
  const m23 = -cy * sx;
  const m31 = sx * sz - cx * cz * sy;
  const m32 = cz * sx + cx * sy * sz;
  const m33 = cx * cy;

  const hx =
    Math.abs(m11) * half[0] + Math.abs(m12) * half[1] + Math.abs(m13) * half[2];
  const hy =
    Math.abs(m21) * half[0] + Math.abs(m22) * half[1] + Math.abs(m23) * half[2];
  const hz =
    Math.abs(m31) * half[0] + Math.abs(m32) * half[1] + Math.abs(m33) * half[2];

  const minX = pos.x - hx;
  const maxX = pos.x + hx;
  const minY = pos.y - hy;
  const maxY = pos.y + hy;
  const minZ = pos.z - hz;
  const maxZ = pos.z + hz;

  if (bounds.empty) {
    bounds.minX = minX;
    bounds.maxX = maxX;
    bounds.minY = minY;
    bounds.maxY = maxY;
    bounds.minZ = minZ;
    bounds.maxZ = maxZ;
    bounds.empty = false;
  } else {
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxY = Math.max(bounds.maxY, maxY);
    bounds.minZ = Math.min(bounds.minZ, minZ);
    bounds.maxZ = Math.max(bounds.maxZ, maxZ);
  }
}

/**
 * Computes the largest bounding-box dimension (in viewer cm) across all parts
 * visible across the provided steps.
 */
export function computeLargestExtentForSteps(steps: readonly SceneStep[]): number {
  const bounds: AabbBounds = {
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 0,
    maxY: 0,
    maxZ: 0,
    empty: true,
  };
  for (const step of steps) {
    if (!step || !Array.isArray(step.parts)) continue;
    for (const part of step.parts) {
      expandAabbByPart(bounds, part);
    }
  }
  if (bounds.empty) {
    return 0;
  }
  return Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ
  );
}

/**
 * Normalizes a single parsed SceneStep from model mm to viewer cm, clamping
 * cameraPreset.distance against the cumulative bounding box of previousSteps + this step.
 */
export function normalizeStepToViewerUnits(
  rawStep: SceneStep,
  previousNormalizedSteps: readonly SceneStep[] = []
): SceneStep {
  if (!rawStep || typeof rawStep !== "object") {
    return rawStep;
  }

  const normalizedStep: SceneStep = {
    ...rawStep,
    ...(rawStep.cameraPreset !== undefined
      ? { cameraPreset: normalizeCameraPreset(rawStep.cameraPreset, MM_PER_VIEWER_UNIT) }
      : {}),
    parts: Array.isArray(rawStep.parts)
      ? rawStep.parts.map((part) => normalizePart(part, MM_PER_VIEWER_UNIT))
      : rawStep.parts,
  };

  const largestDim = computeLargestExtentForSteps([
    ...previousNormalizedSteps,
    normalizedStep,
  ]);
  const computedTargetDistance = Math.min(
    MAX_CAMERA_DISTANCE,
    Math.max(
      MIN_CAMERA_DISTANCE,
      MIN_CAMERA_DISTANCE_EXTENT_FACTOR * largestDim
    )
  );

  const rawPreset = normalizedStep.cameraPreset;
  const hasDistance =
    rawPreset !== undefined &&
    rawPreset !== null &&
    typeof rawPreset.distance === "number" &&
    Number.isFinite(rawPreset.distance);
  const hasPhi =
    rawPreset !== undefined &&
    rawPreset !== null &&
    typeof rawPreset.phi === "number" &&
    Number.isFinite(rawPreset.phi);
  const hasTheta =
    rawPreset !== undefined &&
    rawPreset !== null &&
    typeof rawPreset.theta === "number" &&
    Number.isFinite(rawPreset.theta);

  const clampedDistance = hasDistance
    ? Math.min(
        MAX_CAMERA_DISTANCE,
        Math.max(computedTargetDistance, rawPreset.distance)
      )
    : computedTargetDistance;

  normalizedStep.cameraPreset = {
    ...(rawPreset && typeof rawPreset === "object" ? rawPreset : {}),
    distance: clampedDistance,
    phi: hasPhi ? rawPreset.phi : DEFAULT_CAMERA_PHI,
    theta: hasTheta ? rawPreset.theta : DEFAULT_CAMERA_THETA,
  };

  return normalizedStep;
}

/**
 * Purely converts millimeter scene coordinates into viewer units (centimeters)
 * by dividing every spatial dimension, position component, and cameraPreset.distance
 * by MM_PER_VIEWER_UNIT (10), and clamping per-step cameraPreset.distance against
 * the cumulative visible bounding box. Leaves phi, theta, rotation, qty, and segment/coil counts untouched.
 */
export function normalizeSceneToViewerUnits(scene: Scene): Scene {
  if (!scene || typeof scene !== "object") {
    return scene;
  }
  if (!Array.isArray(scene.steps)) {
    return { ...scene };
  }
  const normalizedSteps: SceneStep[] = [];
  for (const step of scene.steps) {
    normalizedSteps.push(normalizeStepToViewerUnits(step, normalizedSteps));
  }
  return {
    ...scene,
    steps: normalizedSteps,
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
