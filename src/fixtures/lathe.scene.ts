import type { Scene } from "../types.ts";

/**
 * Hand-written Scene fixture for a Lathe primitive.
 * Demonstrates radial symmetry turning within canonical bounds.
 */
export const LATHE_SCENE: Scene = {
  schemaVersion: 1,
  name: "lathe",
  title: "Turned Oak Baluster Post",
  description: "A lathe-turned decorative baluster post showcasing smooth radial symmetry and contouring.",
  steps: [
    {
      stepNumber: 1,
      title: "Turn the Baluster Spindle",
      subtitle: "Radial Lathe Geometry",
      description: "Mount the oak stock on the lathe spindle and turn to the baluster profile.",
      cameraPreset: {
        distance: 250,
        phi: 1.2,
        theta: 0.5,
      },
      parts: [
        {
          id: "baluster-spindle-1",
          name: "Turned Baluster Spindle",
          primitive: "lathe",
          dimensions: {
            radius: 25,
            height: 120,
            segments: 32,
          },
          position: { x: 0, y: 60, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: "tan",
          material: "oak",
          step: 1,
          qty: 1,
        },
      ],
    },
  ],
};
