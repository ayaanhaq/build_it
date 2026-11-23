import type { Scene, SceneStep, BuildStep, DeskPart, ScenePart } from "./types";
import { DESK_SCENE } from "./fixtures/desk.scene";
import { REAL_TONES } from "./three-scene";

/**
 * Registry of validated 3D build scenes.
 * New scenes produced by generators or fixtures are registered here.
 */
export const BUILDS: Record<string, Scene> = {
  desk: DESK_SCENE,
  "modern solid oak desk": DESK_SCENE,
  "solid oak desk": DESK_SCENE,
  "oak desk": DESK_SCENE,
};

/**
 * Resolves a build Scene by build name.
 * If no matching scene is found, defaults to DESK_SCENE.
 */
export function getBuildScene(buildName?: string): Scene {
  if (!buildName) return DESK_SCENE;
  const normalized = buildName.trim().toLowerCase();

  // 1. Direct match in registry
  if (BUILDS[normalized]) {
    return BUILDS[normalized];
  }

  // 2. Substring match against registered build names
  for (const [key, scene] of Object.entries(BUILDS)) {
    if (normalized.includes(key)) {
      return scene;
    }
  }

  // 3. Fallback: keep the desk as default
  return DESK_SCENE;
}

/**
 * Helper to determine an icon type for a ScenePart for UI callouts.
 */
function getIconType(part: ScenePart): DeskPart["iconType"] {
  const name = (part.name || part.id).toLowerCase();
  if (name.includes("leg")) return "leg";
  if (name.includes("apron") || name.includes("rail")) return "rail";
  if (name.includes("stretcher")) return "stretcher";
  if (name.includes("top") || name.includes("slab") || name.includes("trim")) return "slab";
  if (name.includes("drawer") || name.includes("casing") || name.includes("handle")) return "drawer";
  if (name.includes("glide") || name.includes("gusset") || name.includes("bracket")) return "hardware";
  return "accessory";
}

/**
 * Formats dimensions of a ScenePart into a human-readable string.
 */
function formatDimensions(primitive: string, dim: Record<string, any>): string {
  if (primitive === "box" || primitive === "bevel") {
    return `${dim.width} × ${dim.height} × ${dim.depth} mm`;
  }
  if (primitive === "cylinder") {
    const r = dim.radiusTop ?? dim.radiusBottom ?? dim.radius ?? 0;
    return `Ø${r * 2} × ${dim.height} mm`;
  }
  if (primitive === "lathe") {
    return `Ø${dim.radius * 2} × ${dim.height} mm`;
  }
  if (primitive === "spring") {
    return `Ø${dim.radius * 2} × ${dim.height} mm`;
  }
  return "N/A";
}

/**
 * Converts a validated SceneStep into a BuildStep for 2D UI display components.
 */
export function sceneStepToBuildStep(sceneStep: SceneStep): BuildStep {
  return {
    stepNumber: sceneStep.stepNumber,
    title: sceneStep.title,
    subtitle: sceneStep.subtitle || `Step ${sceneStep.stepNumber}`,
    description: sceneStep.description || "",
    proTip: sceneStep.proTip,
    cameraPreset: sceneStep.cameraPreset,
    parts: sceneStep.parts.map((p) => {
      const hex = REAL_TONES[p.color] !== undefined
        ? `#${REAL_TONES[p.color].toString(16).padStart(6, "0")}`
        : "#b08552";
      return {
        id: p.id,
        name: p.name || p.id,
        qty: `${p.qty}×`,
        dimensions: formatDimensions(p.primitive, p.dimensions),
        material: p.material,
        color: hex,
        iconType: getIconType(p),
      };
    }),
  };
}
