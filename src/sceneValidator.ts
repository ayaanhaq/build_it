/**
 * 3D Scene and Step Validator
 *
 * Standalone, deterministic validation engine for 3D build scenes and individual steps.
 * Independent of DOM, Three.js, or browser APIs (Worker-compatible).
 */

import type {
  BoxDimensions,
  Scene,
  ScenePart,
  ScenePrimitiveType,
  SceneStep,
} from "./types.ts";

export interface DimensionBound {
  min: number;
  max: number;
}

/**
 * Millimeter boundary definitions for each primitive geometry type.
 */
export const PRIMITIVE_BOUNDS: Record<ScenePrimitiveType, Record<string, DimensionBound>> = {
  box: {
    width: { min: 0.1, max: 5000.0 },
    height: { min: 0.1, max: 5000.0 },
    depth: { min: 0.1, max: 5000.0 },
  },
  cylinder: {
    height: { min: 0.1, max: 5000.0 },
    radius: { min: 0.1, max: 2500.0 },
    radiusTop: { min: 0.1, max: 2500.0 },
    radiusBottom: { min: 0.1, max: 2500.0 },
    radialSegments: { min: 3, max: 128 },
  },
  lathe: {
    radius: { min: 0.1, max: 2500.0 },
    height: { min: 0.1, max: 5000.0 },
    segments: { min: 3, max: 128 },
  },
  bevel: {
    width: { min: 0.1, max: 5000.0 },
    height: { min: 0.1, max: 5000.0 },
    depth: { min: 0.1, max: 5000.0 },
    bevelSize: { min: 0.0, max: 100.0 },
    bevelThickness: { min: 0.0, max: 100.0 },
  },
  spring: {
    radius: { min: 0.5, max: 1000.0 },
    height: { min: 1.0, max: 3000.0 },
    coils: { min: 1, max: 100 },
    wireRadius: { min: 0.1, max: 100.0 },
  },
};

/**
 * Hard safety limits for scenes and individual steps.
 */
export const MAX_PARTS_PER_SCENE = 500;
export const MAX_VERTICES_PER_SCENE = 100000;
export const MAX_VERTICES_PER_STEP = 50000;

export const VALID_PRIMITIVES: readonly ScenePrimitiveType[] = [
  "box",
  "cylinder",
  "lathe",
  "bevel",
  "spring",
];

/**
 * Documented per-primitive vertex estimates.
 */
export function estimatePartVertices(primitive: ScenePrimitiveType, dimensions: Record<string, any>): number {
  switch (primitive) {
    case "box":
      return 24; // 6 faces * 4 vertices (unshared faceted normals)
    case "cylinder": {
      const seg = typeof dimensions.radialSegments === "number" && Number.isFinite(dimensions.radialSegments)
        ? dimensions.radialSegments
        : 24;
      return seg * 4 + 2; // Side quad vertices + top/bottom cap centers
    }
    case "lathe": {
      const seg = typeof dimensions.segments === "number" && Number.isFinite(dimensions.segments)
        ? dimensions.segments
        : 24;
      return seg * 12; // Profile sample points * radial segments
    }
    case "bevel":
      return 48; // Box base vertices + chamfer facets
    case "spring": {
      const coils = typeof dimensions.coils === "number" && Number.isFinite(dimensions.coils)
        ? dimensions.coils
        : 5;
      return coils * 32 * 8; // Coils * radial subdivisions * tube rings
    }
    default:
      return 0;
  }
}

/**
 * Check if a number is finite and non-NaN.
 */
export function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

/**
 * Validates dimensions of a single part against canonical PRIMITIVE_BOUNDS.
 * Appends diagnostic error strings into errors array.
 */
export function validatePartDimensions(
  part: ScenePart,
  partRef: string,
  errors: string[],
  boundsTable: Record<string, Record<string, DimensionBound>> = PRIMITIVE_BOUNDS,
  unitLabel: string = "mm"
): void {
  const primitive = part.primitive;
  const dims = part.dimensions && typeof part.dimensions === "object" ? part.dimensions : null;

  if (!dims) {
    errors.push(`${partRef}: missing required dimensions object.`);
    return;
  }

  const bounds = boundsTable[primitive] ?? PRIMITIVE_BOUNDS[primitive];

  if (primitive === "box" || primitive === "bevel") {
    for (const requiredKey of ["width", "height", "depth"] as const) {
      const val = (dims as any)[requiredKey];
      if (val === undefined || val === null) {
        errors.push(`${partRef}: primitive '${primitive}' missing required dimension '${requiredKey}'.`);
      } else if (!isFiniteNumber(val)) {
        errors.push(`${partRef}: dimension '${requiredKey}' must be a finite number, received ${val}.`);
      } else {
        const bound = bounds[requiredKey];
        if (bound && (val < bound.min || val > bound.max)) {
          errors.push(
            `${partRef}: dimension '${requiredKey}' (${val} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive '${primitive}'.`
          );
        }
      }
    }

    if (primitive === "bevel") {
      for (const optionalKey of ["bevelSize", "bevelThickness"] as const) {
        const val = (dims as any)[optionalKey];
        if (val !== undefined && val !== null) {
          if (!isFiniteNumber(val)) {
            errors.push(`${partRef}: dimension '${optionalKey}' must be a finite number, received ${val}.`);
          } else {
            const bound = bounds[optionalKey];
            if (bound && (val < bound.min || val > bound.max)) {
              errors.push(
                `${partRef}: dimension '${optionalKey}' (${val} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive '${primitive}'.`
              );
            }
          }
        }
      }
    }
  } else if (primitive === "cylinder") {
    const height = (dims as any).height;
    if (height === undefined || height === null) {
      errors.push(`${partRef}: primitive 'cylinder' missing required dimension 'height'.`);
    } else if (!isFiniteNumber(height)) {
      errors.push(`${partRef}: dimension 'height' must be a finite number, received ${height}.`);
    } else {
      const bound = bounds.height;
      if (height < bound.min || height > bound.max) {
        errors.push(
          `${partRef}: dimension 'height' (${height} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive 'cylinder'.`
        );
      }
    }

    const hasRadius = (dims as any).radius !== undefined;
    const hasTopBottom = (dims as any).radiusTop !== undefined || (dims as any).radiusBottom !== undefined;

    if (!hasRadius && !hasTopBottom) {
      errors.push(
        `${partRef}: primitive 'cylinder' requires 'radius' or 'radiusTop'/'radiusBottom'.`
      );
    }

    for (const rKey of ["radius", "radiusTop", "radiusBottom"] as const) {
      const val = (dims as any)[rKey];
      if (val !== undefined && val !== null) {
        if (!isFiniteNumber(val)) {
          errors.push(`${partRef}: dimension '${rKey}' must be a finite number, received ${val}.`);
        } else {
          const bound = bounds[rKey];
          if (bound && (val < bound.min || val > bound.max)) {
            errors.push(
              `${partRef}: dimension '${rKey}' (${val} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive 'cylinder'.`
            );
          }
        }
      }
    }

    const segments = (dims as any).radialSegments;
    if (segments !== undefined && segments !== null) {
      if (!isFiniteNumber(segments)) {
        errors.push(`${partRef}: dimension 'radialSegments' must be a finite number, received ${segments}.`);
      } else {
        const bound = bounds.radialSegments;
        if (segments < bound.min || segments > bound.max) {
          errors.push(
            `${partRef}: dimension 'radialSegments' (${segments}) is outside bounds [${bound.min}, ${bound.max}] for primitive 'cylinder'.`
          );
        }
      }
    }
  } else if (primitive === "lathe") {
    for (const reqKey of ["radius", "height"] as const) {
      const val = (dims as any)[reqKey];
      if (val === undefined || val === null) {
        errors.push(`${partRef}: primitive 'lathe' missing required dimension '${reqKey}'.`);
      } else if (!isFiniteNumber(val)) {
        errors.push(`${partRef}: dimension '${reqKey}' must be a finite number, received ${val}.`);
      } else {
        const bound = bounds[reqKey];
        if (bound && (val < bound.min || val > bound.max)) {
          errors.push(
            `${partRef}: dimension '${reqKey}' (${val} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive 'lathe'.`
          );
        }
      }
    }
    const seg = (dims as any).segments;
    if (seg !== undefined && seg !== null) {
      if (!isFiniteNumber(seg)) {
        errors.push(`${partRef}: dimension 'segments' must be a finite number, received ${seg}.`);
      } else {
        const bound = bounds.segments;
        if (seg < bound.min || seg > bound.max) {
          errors.push(
            `${partRef}: dimension 'segments' (${seg}) is outside bounds [${bound.min}, ${bound.max}] for primitive 'lathe'.`
          );
        }
      }
    }
  } else if (primitive === "spring") {
    for (const reqKey of ["radius", "height"] as const) {
      const val = (dims as any)[reqKey];
      if (val === undefined || val === null) {
        errors.push(`${partRef}: primitive 'spring' missing required dimension '${reqKey}'.`);
      } else if (!isFiniteNumber(val)) {
        errors.push(`${partRef}: dimension '${reqKey}' must be a finite number, received ${val}.`);
      } else {
        const bound = bounds[reqKey];
        if (bound && (val < bound.min || val > bound.max)) {
          errors.push(
            `${partRef}: dimension '${reqKey}' (${val} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive 'spring'.`
          );
        }
      }
    }
    const coils = (dims as any).coils;
    if (coils !== undefined && coils !== null) {
      if (!isFiniteNumber(coils)) {
        errors.push(`${partRef}: dimension 'coils' must be a finite number, received ${coils}.`);
      } else {
        const bound = bounds.coils;
        if (coils < bound.min || coils > bound.max) {
          errors.push(
            `${partRef}: dimension 'coils' (${coils}) is outside bounds [${bound.min}, ${bound.max}] for primitive 'spring'.`
          );
        }
      }
    }
    const wire = (dims as any).wireRadius;
    if (wire !== undefined && wire !== null) {
      if (!isFiniteNumber(wire)) {
        errors.push(`${partRef}: dimension 'wireRadius' must be a finite number, received ${wire}.`);
      } else {
        const bound = bounds.wireRadius;
        if (wire < bound.min || wire > bound.max) {
          errors.push(
            `${partRef}: dimension 'wireRadius' (${wire} ${unitLabel}) is outside bounds [${bound.min}, ${bound.max}] ${unitLabel} for primitive 'spring'.`
          );
        }
      }
    }
  }
}

/**
 * Validates position and rotation 3D vectors of a single part.
 * Appends diagnostic error strings into errors array.
 */
export function validatePartVectors(
  part: ScenePart,
  partRef: string,
  errors: string[]
): void {
  for (const vectorName of ["position", "rotation"] as const) {
    const vec = (part as any)[vectorName];
    if (!vec || typeof vec !== "object") {
      errors.push(`${partRef}: missing required ${vectorName} vector.`);
    } else {
      for (const axis of ["x", "y", "z"] as const) {
        const val = vec[axis];
        if (!isFiniteNumber(val)) {
          errors.push(
            `${partRef}: non-finite number in ${vectorName}.${axis} (${val}).`
          );
        }
      }
    }
  }
}

/**
 * Context provided when validating a single SceneStep.
 */
export interface StepValidationContext {
  /**
   * Set of part IDs already defined in earlier steps of the build.
   * Duplicate IDs will be flagged against this set, and valid parts from this step will be added.
   */
  seenPartIds?: Set<string>;
  /**
   * Valid step numbers known to exist across the full build or scene.
   * If omitted, part.step is checked against step.stepNumber.
   */
  validStepNumbers?: Set<number>;
  /**
   * Maximum estimated vertices allowed for this step alone.
   * Defaults to MAX_VERTICES_PER_STEP (50,000).
   */
  maxVerticesPerStep?: number;
  /**
   * Callback invoked with the estimated vertex count for this step.
   */
  onStepVertices?: (vertices: number) => void;
  /**
   * Optional primitive bounds table (defaults to PRIMITIVE_BOUNDS in mm).
   */
  primitiveTable?: Record<string, Record<string, DimensionBound>>;
  /**
   * Optional unit label shown in dimension bounds errors (defaults to "mm").
   */
  unitLabel?: string;
}

/**
 * Validates a single SceneStep against structural rules, primitive bounds,
 * duplicate part IDs across the build so far, and vertex estimates for this step alone.
 *
 * @param data Unknown candidate step input
 * @param context Validation context including seen part IDs and step caps
 * @returns Array of diagnostic error strings. An empty array indicates a valid step.
 */
export function validateStep(
  data: unknown,
  context: StepValidationContext = {}
): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return ["Step must be a valid JSON object."];
  }

  const step = data as Partial<SceneStep>;

  // 1. Step number validation
  if (!isFiniteNumber(step.stepNumber)) {
    errors.push(
      `Step number must be a finite positive integer, received ${step.stepNumber}.`
    );
  }

  // 2. Title validation
  if (!step.title || typeof step.title !== "string") {
    errors.push(
      `Step ${step.stepNumber || "?"}: missing required string 'title'.`
    );
  }

  // 3. Parts array validation
  if (!Array.isArray(step.parts)) {
    errors.push(
      `Step ${step.stepNumber || "?"}: 'parts' must be an array of parts.`
    );
    return errors;
  }

  const currentStepNumber = isFiniteNumber(step.stepNumber) ? step.stepNumber : undefined;
  const validStepNumbers = context.validStepNumbers || (currentStepNumber !== undefined ? new Set([currentStepNumber]) : new Set<number>());
  const seenPartIds = context.seenPartIds;
  const stepPartIds = new Set<string>();

  let stepVertices = 0;

  for (const part of step.parts) {
    if (!part || typeof part !== "object") {
      errors.push(`Step ${step.stepNumber}: part entry must be an object.`);
      continue;
    }

    const partRef = part.id ? `Part '${part.id}'` : "Unnamed part";

    // Part ID validation
    if (typeof part.id !== "string" || part.id.trim() === "") {
      errors.push(`Step ${step.stepNumber}: part is missing a valid string 'id'.`);
    } else {
      // Duplicate ID tracking across build so far and within step
      if (seenPartIds && seenPartIds.has(part.id)) {
        errors.push(
          `Duplicate part ID '${part.id}' already exists in an earlier step. Part IDs must be unique across the whole build.`
        );
      } else if (stepPartIds.has(part.id)) {
        errors.push(
          `Duplicate part ID '${part.id}' found in step ${step.stepNumber}. Part IDs must be unique across the whole build.`
        );
      }
      stepPartIds.add(part.id);
    }

    // Part step number validation
    if (!isFiniteNumber(part.step)) {
      errors.push(`${partRef}: 'step' must be a finite number, received ${part.step}.`);
    } else if (!validStepNumbers.has(part.step)) {
      const stepList = Array.from(validStepNumbers).sort((a, b) => a - b).join(", ");
      errors.push(
        `${partRef} references step ${part.step}, which does not exist in scene steps [${stepList}].`
      );
    }

    // Unknown primitive validation
    if (!part.primitive || !VALID_PRIMITIVES.includes(part.primitive)) {
      errors.push(
        `${partRef}: unknown primitive type '${part.primitive}'. Must be one of: ${VALID_PRIMITIVES.join(", ")}.`
      );
      continue;
    }

    // Dimensions validation
    if (!part.dimensions || typeof part.dimensions !== "object") {
      errors.push(`${partRef}: missing required dimensions object.`);
      continue;
    }

    // Accumulate vertex estimates for this step alone
    const partVerts = estimatePartVertices(part.primitive, part.dimensions as Record<string, any>);
    stepVertices += partVerts;

    // Validate bounds and non-finite dimensions
    validatePartDimensions(
      part as ScenePart,
      partRef,
      errors,
      context.primitiveTable ?? PRIMITIVE_BOUNDS,
      context.unitLabel ?? "mm"
    );

    // Validate position and rotation vectors
    validatePartVectors(part as ScenePart, partRef, errors);
  }

  // Check: Step-level vertex estimate cap
  const maxStepVertices = context.maxVerticesPerStep ?? MAX_VERTICES_PER_STEP;
  if (stepVertices > maxStepVertices) {
    errors.push(
      `Estimated step ${step.stepNumber} vertex total (${stepVertices}) exceeds maximum limit of ${maxStepVertices} vertices.`
    );
  }

  // Register newly observed part IDs into the build context only when this step passes validation
  if (seenPartIds && errors.length === 0) {
    for (const id of stepPartIds) {
      seenPartIds.add(id);
    }
  }

  if (context.onStepVertices) {
    context.onStepVertices(stepVertices);
  }

  return errors;
}

export interface ValidateSceneOptions {
  primitiveTable?: Record<string, Record<string, DimensionBound>>;
  unitLabel?: string;
}

/**
 * Validate a candidate 3D scene against all structural, topological, and safety rules.
 * Implemented on top of validateStep to eliminate rule duplication.
 *
 * @param data Unknown candidate scene input
 * @param options Optional bounds table and unit label overrides
 * @returns Array of diagnostic error strings. An empty array indicates a valid scene.
 */
export function validateScene(
  data: unknown,
  options: ValidateSceneOptions = {}
): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return ["Scene must be a valid JSON object."];
  }

  const scene = data as Partial<Scene>;

  // 1. Schema version check
  if (scene.schemaVersion !== 1) {
    errors.push(
      `Invalid scene: schemaVersion must be 1, received ${scene.schemaVersion}.`
    );
  }

  // 2. Steps presence check
  if (!Array.isArray(scene.steps) || scene.steps.length === 0) {
    errors.push("Scene must contain at least one step in 'steps'.");
    return errors;
  }

  const validStepNumbers = new Set<number>();
  for (const step of scene.steps) {
    if (step && typeof step === "object" && isFiniteNumber(step.stepNumber)) {
      validStepNumbers.add(step.stepNumber);
    }
  }

  // Scene-wide checks: duplicate part IDs and part count cap
  let totalPartsCount = 0;
  const partIdOccurrences = new Map<string, number>();

  for (const step of scene.steps) {
    if (step && typeof step === "object" && Array.isArray(step.parts)) {
      totalPartsCount += step.parts.length;
      for (const part of step.parts) {
        if (part && typeof part.id === "string" && part.id.trim() !== "") {
          partIdOccurrences.set(part.id, (partIdOccurrences.get(part.id) || 0) + 1);
        }
      }
    }
  }

  // Check: Duplicate part IDs across scene
  for (const [id, count] of partIdOccurrences.entries()) {
    if (count > 1) {
      errors.push(
        `Duplicate part ID '${id}' found in scene (${count} occurrences). Part IDs must be unique across the scene.`
      );
    }
  }

  // Check: Part count over cap
  if (totalPartsCount > MAX_PARTS_PER_SCENE) {
    errors.push(
      `Scene part count (${totalPartsCount}) exceeds maximum limit of ${MAX_PARTS_PER_SCENE} parts.`
    );
  }

  // Validate each step using validateStep
  let estimatedTotalVertices = 0;
  const seenPartIds = new Set<string>();

  for (const step of scene.steps) {
    const stepErrors = validateStep(step, {
      seenPartIds,
      validStepNumbers,
      primitiveTable: options.primitiveTable,
      unitLabel: options.unitLabel,
      onStepVertices: (stepVerts) => {
        estimatedTotalVertices += stepVerts;
      },
    });

    for (const err of stepErrors) {
      // Step-level duplicate ID messages are suppressed in validateScene since scene-wide
      // duplicate checks already produce the canonical scene-level diagnostic format.
      if (!err.startsWith("Duplicate part ID '")) {
        errors.push(err);
      }
    }
  }

  // Check: Estimated vertex total over cap across scene
  if (estimatedTotalVertices > MAX_VERTICES_PER_SCENE) {
    errors.push(
      `Estimated scene vertex total (${estimatedTotalVertices}) exceeds maximum limit of ${MAX_VERTICES_PER_SCENE} vertices.`
    );
  }

  // Check: Assembly completeness (Step-1 planned part groups and enclosure closures)
  errors.push(...checkSceneCompleteness({ steps: scene.steps as SceneStep[] }));

  return errors;
}

const TOKEN_SINGULAR_MAP: Record<string, string> = {
  panels: "panel",
  boards: "board",
  plates: "plate",
  rails: "rail",
  bars: "bar",
  beams: "beam",
  frames: "frame",
  shelves: "shelf",
  drawers: "drawer",
  doors: "door",
  lids: "lid",
  caps: "cap",
  aprons: "apron",
  stretchers: "stretcher",
  braces: "brace",
  posts: "post",
  legs: "leg",
  supports: "support",
  walls: "wall",
  slats: "slat",
  trays: "tray",
  glides: "glide",
  handles: "handle",
  spindles: "spindle",
  springs: "spring",
  baseplates: "baseplate",
  cushions: "cushion",
  armrests: "armrest",
  backrests: "backrest",
  sides: "side",
  tops: "top",
  tiers: "tier",
  uprights: "upright",
};

const MODIFIER_SYNONYMS: Record<string, string[]> = {
  back: ["back", "rear"],
  rear: ["back", "rear"],
  top: ["top", "upper", "roof", "crown", "cap", "lid"],
  upper: ["top", "upper", "roof", "crown", "cap", "lid"],
  bottom: ["bottom", "lower", "base", "floor"],
  lower: ["bottom", "lower", "base", "floor"],
  side: ["side", "upright", "lateral"],
  left: ["left"],
  right: ["right"],
  front: ["front", "face"],
};

const NOUN_SYNONYMS: Record<string, string[]> = {
  panel: ["panel", "board", "plate", "slab", "wall", "piece", "upright"],
  board: ["board", "panel", "slab", "plate"],
  plate: ["plate", "panel", "board", "baseplate"],
  shelf: ["shelf", "tier"],
  tray: ["tray", "drawer", "raceway"],
  drawer: ["drawer", "tray"],
  rail: ["rail", "bar", "apron", "stretcher"],
  support: ["support", "brace", "stretcher", "post", "leg"],
  top: ["top", "desktop", "tabletop", "slab", "cap", "lid"],
};

function tokenizeNormalized(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return rawTokens.map((tok) => TOKEN_SINGULAR_MAP[tok] ?? tok);
}

/**
 * Extracts generic structural part groups planned or listed in step 1
 * (`plan`, `title`, `subtitle`, `description`).
 */
export function extractPlannedPartGroups(step1: unknown): string[] {
  if (!step1 || typeof step1 !== "object") {
    return [];
  }

  const record = step1 as {
    title?: unknown;
    subtitle?: unknown;
    description?: unknown;
    plan?: unknown;
  };

  const groups = new Set<string>();

  if (Array.isArray(record.plan)) {
    for (const entry of record.plan) {
      const text =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? String(
                (entry as { name?: unknown; title?: unknown; part?: unknown })
                  .name ??
                  (entry as { title?: unknown }).title ??
                  (entry as { part?: unknown }).part ??
                  ""
              )
            : "";
      const norm = tokenizeNormalized(text).join(" ");
      if (norm) {
        groups.add(norm);
      }
    }
  } else if (typeof record.plan === "string" && record.plan.trim() !== "") {
    for (const segment of record.plan.split(/[,;]|\band\b/i)) {
      const norm = tokenizeNormalized(segment).join(" ");
      if (norm) {
        groups.add(norm);
      }
    }
  }

  const textSources = [record.subtitle, record.description]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" . ");

  if (textSources) {
    const qualifiedPattern =
      /\b(left|right|side|top|bottom|back|rear|front|upper|lower)\s+(panel|panels|board|boards|plate|plates|rail|rails|bar|bars|beam|beams|frame|frames|shelf|shelves|drawer|drawers|door|doors|lid|lids|cap|caps|trim|apron|aprons|stretcher|stretchers|brace|braces|post|posts|leg|legs|support|supports|wall|walls|slat|slats|tray|trays|top)\b/gi;
    for (const match of textSources.matchAll(qualifiedPattern)) {
      const norm = tokenizeNormalized(`${match[1]} ${match[2]}`).join(" ");
      if (norm) {
        groups.add(norm);
      }
    }

    const nounPattern =
      /\b(shelves|shelf|drawers|drawer|doors|door|legs|leg|glides|glide|aprons|apron|stretchers|stretcher|spindle|baseplate|spring|desktop|tabletop|backrest|armrest|cushion|cushions|seat|headboard|footboard)\b/gi;
    for (const match of textSources.matchAll(nounPattern)) {
      const norm = tokenizeNormalized(match[1]).join(" ");
      if (norm) {
        groups.add(norm);
      }
    }
  }

  return Array.from(groups);
}

function partMatchesGroup(partTokens: string[], groupPhrase: string): boolean {
  const groupTokens = tokenizeNormalized(groupPhrase);
  if (groupTokens.length === 0) {
    return true;
  }

  return groupTokens.every((reqTok, idx) => {
    const synonyms =
      idx === groupTokens.length - 1
        ? NOUN_SYNONYMS[reqTok] ?? MODIFIER_SYNONYMS[reqTok] ?? [reqTok]
        : MODIFIER_SYNONYMS[reqTok] ?? NOUN_SYNONYMS[reqTok] ?? [reqTok];
    return partTokens.some((pt) => synonyms.includes(pt));
  });
}

/**
 * Checks scene completeness across all validated steps:
 * 1. Every structural part group referenced in Step 1's plan or description appears in at least one step.
 * 2. Multi-panel opposing-side enclosures with multiple horizontal tiers include both a top closure and a rear/back panel.
 */
export function checkSceneCompleteness(scene: { steps: SceneStep[] }): string[] {
  const errors: string[] = [];
  if (!scene || !Array.isArray(scene.steps) || scene.steps.length === 0) {
    return errors;
  }

  const allParts: ScenePart[] = [];
  for (const step of scene.steps) {
    if (step && Array.isArray(step.parts)) {
      for (const part of step.parts) {
        if (part && typeof part === "object") {
          allParts.push(part);
        }
      }
    }
  }
  if (allParts.length === 0) {
    return errors;
  }

  const partTokenLists = allParts.map((part) =>
    tokenizeNormalized(`${part.name ?? ""} ${part.id ?? ""}`)
  );

  // 1. Verify every part group listed in Step 1 appears in at least one step
  const plannedGroups = extractPlannedPartGroups(scene.steps[0]);
  for (const group of plannedGroups) {
    const found = partTokenLists.some((tokens) => partMatchesGroup(tokens, group));
    if (!found) {
      errors.push(
        `Incomplete build: step 1 plan references '${group}', but no matching part appears in any step.`
      );
    }
  }

  // 2. Generic geometric check for vertical opposing-side enclosures with horizontal tiers
  const verticalSidePanels: Array<{
    x: number;
    topY: number;
    bottomY: number;
    height: number;
  }> = [];
  const horizontalTiers: Array<{ topY: number; width: number }> = [];
  let hasNamedTopClosure = false;
  let hasNamedRearClosure = false;
  let hasRearPlanePanel = false;

  for (let i = 0; i < allParts.length; i++) {
    const part = allParts[i];
    const tokens = partTokenLists[i];
    if (
      tokens.some((t) =>
        ["top", "upper", "roof", "crown", "cap", "lid", "desktop", "tabletop"].includes(t)
      )
    ) {
      hasNamedTopClosure = true;
    }
    if (tokens.some((t) => ["back", "rear", "backrest", "backplate"].includes(t))) {
      hasNamedRearClosure = true;
    }

    if (part.primitive !== "box" || !part.dimensions || !part.position) {
      continue;
    }
    const dims = part.dimensions as BoxDimensions;
    const pos = part.position;
    if (
      !isFiniteNumber(dims.width) ||
      !isFiniteNumber(dims.height) ||
      !isFiniteNumber(dims.depth) ||
      !isFiniteNumber(pos.x) ||
      !isFiniteNumber(pos.y)
    ) {
      continue;
    }

    // Thin tall vertical lateral panel (e.g., left/right upright or side wall)
    const isLateralVerticalPanel =
      dims.height >= dims.width * 3 &&
      dims.depth >= dims.width * 3 &&
      dims.height > dims.depth * 0.5;
    if (isLateralVerticalPanel) {
      verticalSidePanels.push({
        x: pos.x,
        topY: pos.y + dims.height / 2,
        bottomY: pos.y - dims.height / 2,
        height: dims.height,
      });
    }

    // Thin wide horizontal board (e.g., shelf / bottom / top panel)
    const isHorizontalBoard =
      dims.width >= dims.height * 3 && dims.depth >= dims.height * 2;
    if (isHorizontalBoard) {
      horizontalTiers.push({
        topY: pos.y + dims.height / 2,
        width: dims.width,
      });
    }

    // Thin vertical front/rear panel (small depth compared to width & height)
    const isRearFacingPanel =
      dims.width >= dims.depth * 3 && dims.height >= dims.depth * 3;
    if (isRearFacingPanel) {
      hasRearPlanePanel = true;
    }
  }

  if (verticalSidePanels.length >= 2) {
    const xs = verticalSidePanels.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const maxSideHeight = Math.max(...verticalSidePanels.map((p) => p.height));
    const maxSideTopY = Math.max(...verticalSidePanels.map((p) => p.topY));
    const shelfLikeTiers = allParts.filter((p, idx) =>
      partTokenLists[idx].some((t) => t === "shelf" || t === "tier")
    );

    if (maxX - minX > 0 && (shelfLikeTiers.length >= 2 || horizontalTiers.length >= 3)) {
      const hasGeometricTop = horizontalTiers.some(
        (t) => t.topY >= maxSideTopY - maxSideHeight * 0.12
      );
      if (!hasNamedTopClosure && !hasGeometricTop) {
        errors.push(
          "Incomplete enclosure build: opposing vertical side panels and tiers are missing a top closure panel."
        );
      }
      if (!hasNamedRearClosure && !hasRearPlanePanel) {
        errors.push(
          "Incomplete enclosure build: opposing vertical side panels and tiers are missing a back panel."
        );
      }
    }
  }

  return errors;
}
