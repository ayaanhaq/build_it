import type { Scene } from "../types.ts";

/**
 * Hand-written Scene fixture for a Bevel primitive.
 * Demonstrates beveled perimeter extrusion within canonical bounds.
 */
export const BEVEL_SCENE: Scene = {
  schemaVersion: 1,
  name: "bevel",
  title: "Beveled Steel Baseplate",
  description: "A precision-machined steel baseplate with chamfered and beveled perimeter edges.",
  steps: [
    {
      stepNumber: 1,
      title: "Position Beveled Baseplate",
      subtitle: "Chamfered Base Perimeter",
      description: "Place the heavy beveled baseplate flush against the reference surface.",
      cameraPreset: {
        distance: 200,
        phi: 1.1,
        theta: 0.7,
      },
      parts: [
        {
          id: "bevel-baseplate-1",
          name: "Chamfered Steel Baseplate",
          primitive: "bevel",
          dimensions: {
            width: 100,
            height: 20,
            depth: 60,
            bevelSize: 4,
            bevelThickness: 4,
          },
          position: { x: 0, y: 10, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: "ink",
          material: "steel",
          step: 1,
          qty: 1,
        },
      ],
    },
  ],
};
