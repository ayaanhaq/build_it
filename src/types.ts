export interface DeskPart {
  id: string;
  name: string;
  qty: string;
  dimensions: string;
  material: string;
  color: string;
  iconType: "leg" | "rail" | "slab" | "stretcher" | "drawer" | "hardware" | "accessory";
}

export interface BuildStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  description: string;
  proTip?: string;
  parts: DeskPart[];
  cameraPreset?: {
    distance: number;
    phi: number;
    theta: number;
  };
}

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
  hasBuildDemo?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  messages: ChatMessage[];
  has3DViewer?: boolean;
  currentStep?: number;
}

/**
 * Primitive geometry types supported by the 3D scene builder.
 */
export type ScenePrimitiveType = "box" | "cylinder" | "lathe" | "bevel" | "spring";

/**
 * 3D vector coordinate in millimeters or degrees.
 */
export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Authentic physical palette tones from REAL_TONES.
 */
export type RealToneColor =
  | "ink"
  | "white"
  | "grey"
  | "butter"
  | "sun"
  | "orange"
  | "peach"
  | "coral"
  | "red"
  | "pink"
  | "lilac"
  | "violet"
  | "sky"
  | "blue"
  | "mint"
  | "leaf"
  | "brown"
  | "tan"
  | "cream";

export interface BoxDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface CylinderDimensions {
  radiusTop?: number;
  radiusBottom?: number;
  radius?: number;
  height: number;
  radialSegments?: number;
}

export interface LatheDimensions {
  radius: number;
  height: number;
  segments?: number;
}

export interface BevelDimensions {
  width: number;
  height: number;
  depth: number;
  bevelSize?: number;
  bevelThickness?: number;
}

export interface SpringDimensions {
  radius: number;
  height: number;
  coils?: number;
  wireRadius?: number;
}

export type ScenePartDimensions =
  | BoxDimensions
  | CylinderDimensions
  | LatheDimensions
  | BevelDimensions
  | SpringDimensions
  | Record<string, number | undefined>;

/**
 * A discrete component part within a 3D scene step.
 */
export interface ScenePart {
  id: string;
  name?: string;
  primitive: ScenePrimitiveType;
  dimensions: ScenePartDimensions;
  position: Vector3D;
  rotation: Vector3D;
  color: RealToneColor;
  material: string;
  step: number;
  qty: number | string;
}

/**
 * An individual assembly step containing parts.
 */
export interface SceneStep {
  stepNumber: number;
  title: string;
  subtitle?: string;
  description?: string;
  proTip?: string;
  cameraPreset?: {
    distance: number;
    phi: number;
    theta: number;
  };
  parts: ScenePart[];
}

/**
 * Validated scene contract defining a multi-step 3D build.
 */
export interface Scene {
  schemaVersion: 1;
  name?: string;
  title?: string;
  description?: string;
  steps: SceneStep[];
}
