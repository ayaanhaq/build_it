import type { Scene } from "../types.ts";

/**
 * Hand-written Scene fixture for a Spring primitive.
 * Demonstrates a 3D helical coil tube within canonical bounds.
 */
export const SPRING_SCENE: Scene = {
  schemaVersion: 1,
  name: "spring",
  title: "Coil Suspension Spring",
  description: "A helical steel suspension spring with smooth tubular cross-section.",
  steps: [
    {
      stepNumber: 1,
      title: "Mount Suspension Spring",
      subtitle: "Helical Coil Damper",
      description: "Insert the helical compression spring onto the damping rod.",
      cameraPreset: {
        distance: 180,
        phi: 1.2,
        theta: 0.8,
      },
      parts: [
        {
          id: "coil-spring-1",
          name: "Helical Damper Spring",
          primitive: "spring",
          dimensions: {
            radius: 18,
            height: 75,
            coils: 6,
            wireRadius: 2.2,
          },
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: "sun",
          material: "steel",
          step: 1,
          qty: 1,
        },
      ],
    },
  ],
};
