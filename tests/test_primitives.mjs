import * as THREE from 'three';
import { validateScene, PRIMITIVE_BOUNDS } from '../src/sceneValidator.ts';
import {
  PRIMITIVE_PART_BUILDERS,
  buildSceneModel,
  createEmptySceneModel,
  appendStep,
} from '../src/three-scene.ts';
import { LATHE_SCENE } from '../src/fixtures/lathe.scene.ts';
import { BEVEL_SCENE } from '../src/fixtures/bevel.scene.ts';
import { SPRING_SCENE } from '../src/fixtures/spring.scene.ts';
import { DESK_SCENE } from '../src/fixtures/desk.scene.ts';

const results = {
  minMaxBuilds: {},
  outOfBoundsValidation: {},
  fixtures: {},
  passed: true,
};

function testRegisterMesh(mesh, name, group) {
  mesh.name = name;
  mesh.userData = { partName: name };
  group.add(mesh);
  return true;
}

try {
  // 1. Min / Max dimension builder tests for each primitive
  const primitivesToTest = [
    {
      type: 'box',
      minDim: { width: PRIMITIVE_BOUNDS.box.width.min, height: PRIMITIVE_BOUNDS.box.height.min, depth: PRIMITIVE_BOUNDS.box.depth.min },
      maxDim: { width: PRIMITIVE_BOUNDS.box.width.max, height: PRIMITIVE_BOUNDS.box.height.max, depth: PRIMITIVE_BOUNDS.box.depth.max },
      outLow: { width: 0.05, height: 10, depth: 10 },
      outHigh: { width: 6000.0, height: 10, depth: 10 },
    },
    {
      type: 'cylinder',
      minDim: {
        height: PRIMITIVE_BOUNDS.cylinder.height.min,
        radius: PRIMITIVE_BOUNDS.cylinder.radius.min,
        radiusTop: PRIMITIVE_BOUNDS.cylinder.radiusTop.min,
        radiusBottom: PRIMITIVE_BOUNDS.cylinder.radiusBottom.min,
        radialSegments: PRIMITIVE_BOUNDS.cylinder.radialSegments.min,
      },
      maxDim: {
        height: PRIMITIVE_BOUNDS.cylinder.height.max,
        radius: PRIMITIVE_BOUNDS.cylinder.radius.max,
        radiusTop: PRIMITIVE_BOUNDS.cylinder.radiusTop.max,
        radiusBottom: PRIMITIVE_BOUNDS.cylinder.radiusBottom.max,
        radialSegments: PRIMITIVE_BOUNDS.cylinder.radialSegments.max,
      },
      outLow: { height: 0.05, radius: 10 },
      outHigh: { height: 6000.0, radius: 10 },
    },
    {
      type: 'lathe',
      minDim: {
        radius: PRIMITIVE_BOUNDS.lathe.radius.min,
        height: PRIMITIVE_BOUNDS.lathe.height.min,
        segments: PRIMITIVE_BOUNDS.lathe.segments.min,
      },
      maxDim: {
        radius: PRIMITIVE_BOUNDS.lathe.radius.max,
        height: PRIMITIVE_BOUNDS.lathe.height.max,
        segments: PRIMITIVE_BOUNDS.lathe.segments.max,
      },
      outLow: { radius: 0.05, height: 20 },
      outHigh: { radius: 10, height: 6000.0 },
    },
    {
      type: 'bevel',
      minDim: {
        width: PRIMITIVE_BOUNDS.bevel.width.min,
        height: PRIMITIVE_BOUNDS.bevel.height.min,
        depth: PRIMITIVE_BOUNDS.bevel.depth.min,
        bevelSize: PRIMITIVE_BOUNDS.bevel.bevelSize.min,
        bevelThickness: PRIMITIVE_BOUNDS.bevel.bevelThickness.min,
      },
      maxDim: {
        width: PRIMITIVE_BOUNDS.bevel.width.max,
        height: PRIMITIVE_BOUNDS.bevel.height.max,
        depth: PRIMITIVE_BOUNDS.bevel.depth.max,
        bevelSize: PRIMITIVE_BOUNDS.bevel.bevelSize.max,
        bevelThickness: PRIMITIVE_BOUNDS.bevel.bevelThickness.max,
      },
      outLow: { width: 0.05, height: 10, depth: 10 },
      outHigh: { width: 10, height: 6000.0, depth: 10 },
    },
    {
      type: 'spring',
      minDim: {
        radius: PRIMITIVE_BOUNDS.spring.radius.min,
        height: PRIMITIVE_BOUNDS.spring.height.min,
        coils: PRIMITIVE_BOUNDS.spring.coils.min,
        wireRadius: PRIMITIVE_BOUNDS.spring.wireRadius.min,
      },
      maxDim: {
        radius: PRIMITIVE_BOUNDS.spring.radius.max,
        height: PRIMITIVE_BOUNDS.spring.height.max,
        coils: PRIMITIVE_BOUNDS.spring.coils.max,
        wireRadius: PRIMITIVE_BOUNDS.spring.wireRadius.max,
      },
      outLow: { radius: 0.2, height: 20 },
      outHigh: { radius: 20, height: 4000.0 },
    },
  ];

  for (const item of primitivesToTest) {
    const builder = PRIMITIVE_PART_BUILDERS[item.type];
    if (!builder) {
      throw new Error(`Missing builder for ${item.type}`);
    }

    // Min build test
    const groupMin = new THREE.Group();
    const meshMin = builder(item.minDim);
    const passesRegisterMin = testRegisterMesh(meshMin, `${item.type}-min`, groupMin);
    const boxMin = new THREE.Box3().setFromObject(meshMin);
    const minValid =
      meshMin instanceof THREE.Mesh &&
      passesRegisterMin &&
      Number.isFinite(boxMin.min.x) &&
      Number.isFinite(boxMin.max.x);

    // Max build test
    const groupMax = new THREE.Group();
    const meshMax = builder(item.maxDim);
    const passesRegisterMax = testRegisterMesh(meshMax, `${item.type}-max`, groupMax);
    const boxMax = new THREE.Box3().setFromObject(meshMax);
    const maxValid =
      meshMax instanceof THREE.Mesh &&
      passesRegisterMax &&
      Number.isFinite(boxMax.min.x) &&
      Number.isFinite(boxMax.max.x);

    results.minMaxBuilds[item.type] = {
      minValid,
      maxValid,
    };
    if (!minValid || !maxValid) {
      results.passed = false;
    }

    // Out-of-bounds validator test (rejected BEFORE reaching builder)
    const lowScene = {
      schemaVersion: 1,
      steps: [
        {
          stepNumber: 1,
          title: "Test Step Low",
          parts: [
            {
              id: `${item.type}-low`,
              name: `${item.type}-low`,
              primitive: item.type,
              dimensions: item.outLow,
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              color: 'tan',
              material: 'oak',
              step: 1,
              qty: 1,
            },
          ],
        },
      ],
    };
    const lowErrors = validateScene(lowScene);
    const rejectedLow = lowErrors.length > 0 && lowErrors.some((e) => e.includes('dimension') || e.includes('outside valid range') || e.includes('bounds'));

    const highScene = {
      schemaVersion: 1,
      steps: [
        {
          stepNumber: 1,
          title: "Test Step High",
          parts: [
            {
              id: `${item.type}-high`,
              name: `${item.type}-high`,
              primitive: item.type,
              dimensions: item.outHigh,
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              color: 'tan',
              material: 'oak',
              step: 1,
              qty: 1,
            },
          ],
        },
      ],
    };
    const highErrors = validateScene(highScene);
    const rejectedHigh = highErrors.length > 0 && highErrors.some((e) => e.includes('dimension') || e.includes('outside valid range') || e.includes('bounds'));

    results.outOfBoundsValidation[item.type] = {
      rejectedLow,
      lowErrors,
      rejectedHigh,
      highErrors,
    };
    if (!rejectedLow || !rejectedHigh) {
      results.passed = false;
    }
  }

  // 2. Validate and render the 3 new fixtures
  const fixturesToCheck = [
    { name: 'lathe', scene: LATHE_SCENE },
    { name: 'bevel', scene: BEVEL_SCENE },
    { name: 'spring', scene: SPRING_SCENE },
    { name: 'desk', scene: DESK_SCENE },
  ];

  for (const fix of fixturesToCheck) {
    const errs = validateScene(fix.scene);
    const model = buildSceneModel(fix.scene);
    const box = new THREE.Box3().setFromObject(model.rootGroup);
    const valid =
      errs.length === 0 &&
      model.allInteractiveMeshes.length > 0 &&
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.max.x);

    results.fixtures[fix.name] = {
      valid,
      errors: errs,
      partCount: model.allInteractiveMeshes.length,
      stepCount: model.stepGroups.size,
    };
    if (!valid) {
      results.passed = false;
    }
  }

  process.stdout.write(JSON.stringify(results, null, 2));
} catch (err) {
  process.stderr.write(String(err));
  process.exit(1);
}
