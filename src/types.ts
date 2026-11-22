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
