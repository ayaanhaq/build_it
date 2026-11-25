import * as THREE from 'three';
import { DESK_SCENE } from '../src/fixtures/desk.scene.ts';
import { LATHE_SCENE } from '../src/fixtures/lathe.scene.ts';
import { BEVEL_SCENE } from '../src/fixtures/bevel.scene.ts';
import { SPRING_SCENE } from '../src/fixtures/spring.scene.ts';
import { validateScene } from '../src/sceneValidator.ts';
import {
  buildSceneModel,
  buildHandBuiltDeskModel,
  appendStep,
  removeStep,
  createEmptySceneModel,
  PRIMITIVE_BUILDERS,
  computeCameraTargetForGroups,
  DEFAULT_DESK_CAMERA_TARGET_Y,
} from '../src/three-scene.ts';

try {
  // 1. Scene validation
  const validationErrors = validateScene(DESK_SCENE);

  // 2. Build hand-built model and full sceneModel (implemented on top of appendStep)
  const handBuilt = buildHandBuiltDeskModel();
  const sceneModel = buildSceneModel(DESK_SCENE);

  // 3. Overall bounding boxes
  const handBox = new THREE.Box3().setFromObject(handBuilt.rootGroup);
  const sceneBox = new THREE.Box3().setFromObject(sceneModel.rootGroup);

  const dxMin = Math.abs(handBox.min.x - sceneBox.min.x);
  const dyMin = Math.abs(handBox.min.y - sceneBox.min.y);
  const dzMin = Math.abs(handBox.min.z - sceneBox.min.z);
  const dxMax = Math.abs(handBox.max.x - sceneBox.max.x);
  const dyMax = Math.abs(handBox.max.y - sceneBox.max.y);
  const dzMax = Math.abs(handBox.max.z - sceneBox.max.z);
  const maxDelta = Math.max(dxMin, dyMin, dzMin, dxMax, dyMax, dzMax);

  // 4. Per-part bounding box comparisons
  const partMismatches = [];
  for (const [name, handMesh] of handBuilt.partMeshes.entries()) {
    const sceneMesh = sceneModel.partMeshes.get(name);
    if (!sceneMesh) {
      partMismatches.push({ name, error: 'Missing in scene model' });
      continue;
    }

    const hb = new THREE.Box3().setFromObject(handMesh);
    const sb = new THREE.Box3().setFromObject(sceneMesh);
    const partDelta = Math.max(
      Math.abs(hb.min.x - sb.min.x),
      Math.abs(hb.min.y - sb.min.y),
      Math.abs(hb.min.z - sb.min.z),
      Math.abs(hb.max.x - sb.max.x),
      Math.abs(hb.max.y - sb.max.y),
      Math.abs(hb.max.z - sb.max.z)
    );

    if (partDelta > 1e-4) {
      partMismatches.push({ name, delta: partDelta, hb, sb });
    }
  }

  // 5. Incremental appending test (steps 1 to N one at a time vs buildSceneModel)
  const incrementalModel = createEmptySceneModel();
  for (const step of DESK_SCENE.steps) {
    appendStep(step, incrementalModel);
  }
  const incBox = new THREE.Box3().setFromObject(incrementalModel.rootGroup);
  const incDelta = Math.max(
    Math.abs(sceneBox.min.x - incBox.min.x),
    Math.abs(sceneBox.min.y - incBox.min.y),
    Math.abs(sceneBox.min.z - incBox.min.z),
    Math.abs(sceneBox.max.x - incBox.max.x),
    Math.abs(sceneBox.max.y - incBox.max.y),
    Math.abs(sceneBox.max.z - incBox.max.z)
  );

  const incrementalMatchesFull =
    incrementalModel.allInteractiveMeshes.length === sceneModel.allInteractiveMeshes.length &&
    incrementalModel.stepGroups.size === sceneModel.stepGroups.size &&
    incDelta < 1e-4;

  // 6. Partial build test (steps 1 to 2 of a 5-step scene)
  const fiveStepScene = {
    schemaVersion: 1,
    steps: [1, 2, 3, 4, 5].map((num) => ({
      stepNumber: num,
      title: `Step ${num}`,
      parts: [
        {
          id: `step-${num}-box`,
          name: `Box Part ${num}`,
          primitive: 'box',
          dimensions: { width: 10 * num, height: 10, depth: 10 },
          position: { x: num * 20, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: num,
          qty: 1,
        },
      ],
    })),
  };

  const partialFiveStepModel = createEmptySceneModel();
  appendStep(fiveStepScene.steps[0], partialFiveStepModel);
  appendStep(fiveStepScene.steps[1], partialFiveStepModel);
  const partialFiveStepBox = new THREE.Box3().setFromObject(partialFiveStepModel.rootGroup);

  const partialFiveStepValid =
    partialFiveStepModel.stepGroups.size === 2 &&
    partialFiveStepModel.allInteractiveMeshes.length === 2 &&
    Number.isFinite(partialFiveStepBox.min.x) &&
    Number.isFinite(partialFiveStepBox.max.x);

  // 7. Undo / removeStep test on partial build
  const removedStep2 = removeStep(2, partialFiveStepModel);
  const undoValid =
    removedStep2 &&
    partialFiveStepModel.stepGroups.size === 1 &&
    partialFiveStepModel.allInteractiveMeshes.length === 1 &&
    partialFiveStepModel.partMeshes.has('Box Part 1') &&
    !partialFiveStepModel.partMeshes.has('Box Part 2');

  // 8. Primitive builder completeness test
  const primitiveSmokeTest = {
    box: PRIMITIVE_BUILDERS.box({ width: 10, height: 10, depth: 10 }) instanceof THREE.BufferGeometry,
    cylinder: PRIMITIVE_BUILDERS.cylinder({ height: 20, radius: 5 }) instanceof THREE.BufferGeometry,
    lathe: PRIMITIVE_BUILDERS.lathe({ radius: 8, height: 16 }) instanceof THREE.BufferGeometry,
    bevel: PRIMITIVE_BUILDERS.bevel({ width: 20, height: 5, depth: 15, bevelSize: 1 }) instanceof THREE.BufferGeometry,
    spring: PRIMITIVE_BUILDERS.spring({ radius: 5, height: 30, coils: 4 }) instanceof THREE.BufferGeometry,
  };

  // 9. Camera target height test: 180 cm tall model -> target y ≈ 90; desk fixture keeps y = 18
  const tallBookcaseScene = {
    schemaVersion: 1,
    name: 'bookcase',
    steps: [
      {
        stepNumber: 1,
        title: 'Upright Frame',
        parts: [
          {
            id: 'side-l',
            name: 'Left Panel',
            primitive: 'box',
            dimensions: { width: 2, height: 180, depth: 30 },
            position: { x: -39, y: 90, z: 0 },
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
  const tallBookcaseModel = buildSceneModel(tallBookcaseScene);
  const bookcaseTarget = computeCameraTargetForGroups(tallBookcaseModel.stepGroups, 1, tallBookcaseScene.name);
  const unnamedTarget = computeCameraTargetForGroups(tallBookcaseModel.stepGroups, 1, undefined);
  // Simulate mid-animation y=14 group offset: resting vertical center must still be 90
  const step1Group = tallBookcaseModel.stepGroups.get(1);
  if (step1Group) step1Group.position.y = 14;
  const midAnimTarget = computeCameraTargetForGroups(tallBookcaseModel.stepGroups, 1, tallBookcaseScene.name);

  const deskStep1Target = computeCameraTargetForGroups(sceneModel.stepGroups, 1, DESK_SCENE.name);
  const deskFullTarget = computeCameraTargetForGroups(sceneModel.stepGroups, 6, DESK_SCENE.name);

  const latheTarget = computeCameraTargetForGroups(buildSceneModel(LATHE_SCENE).stepGroups, 1, LATHE_SCENE.name);
  const bevelTarget = computeCameraTargetForGroups(buildSceneModel(BEVEL_SCENE).stepGroups, 1, BEVEL_SCENE.name);
  const springTarget = computeCameraTargetForGroups(buildSceneModel(SPRING_SCENE).stepGroups, 1, SPRING_SCENE.name);

  const cameraTargetValid =
    Math.abs(bookcaseTarget.y - 90) < 1e-4 &&
    Math.abs(unnamedTarget.y - 90) < 1e-4 &&
    Math.abs(midAnimTarget.y - 90) < 1e-4 &&
    deskStep1Target.y === DEFAULT_DESK_CAMERA_TARGET_Y &&
    deskFullTarget.y === DEFAULT_DESK_CAMERA_TARGET_Y &&
    DEFAULT_DESK_CAMERA_TARGET_Y === 18 &&
    Math.abs(latheTarget.y - 60) < 1e-4 &&
    Math.abs(bevelTarget.y - 10) < 1e-4 &&
    Math.abs(springTarget.y - 0) < 0.1;

  const result = {
    valid: validationErrors.length === 0,
    validationErrors,
    partCountHandBuilt: handBuilt.allInteractiveMeshes.length,
    partCountScene: sceneModel.allInteractiveMeshes.length,
    stepCountHandBuilt: handBuilt.stepGroups.size,
    stepCountScene: sceneModel.stepGroups.size,
    boundsHandBuilt: {
      min: { x: handBox.min.x, y: handBox.min.y, z: handBox.min.z },
      max: { x: handBox.max.x, y: handBox.max.y, z: handBox.max.z },
    },
    boundsScene: {
      min: { x: sceneBox.min.x, y: sceneBox.min.y, z: sceneBox.min.z },
      max: { x: sceneBox.max.x, y: sceneBox.max.y, z: sceneBox.max.z },
    },
    maxDelta,
    partMismatches,
    incrementalMatchesFull,
    incrementalPartCount: incrementalModel.allInteractiveMeshes.length,
    incrementalStepCount: incrementalModel.stepGroups.size,
    incrementalDelta: incDelta,
    partialFiveStepValid,
    partialFiveStepStepCount: 2,
    undoValid,
    primitiveSmokeTest,
    cameraTargetCheck: {
      bookcaseTargetY: bookcaseTarget.y,
      unnamedTargetY: unnamedTarget.y,
      midAnimTargetY: midAnimTarget.y,
      deskStep1TargetY: deskStep1Target.y,
      deskFullTargetY: deskFullTarget.y,
      latheTargetY: latheTarget.y,
      bevelTargetY: bevelTarget.y,
      springTargetY: springTarget.y,
      valid: cameraTargetValid,
    },
    passed:
      validationErrors.length === 0 &&
      handBuilt.allInteractiveMeshes.length === 24 &&
      sceneModel.allInteractiveMeshes.length === 24 &&
      maxDelta < 1e-4 &&
      partMismatches.length === 0 &&
      incrementalMatchesFull &&
      partialFiveStepValid &&
      undoValid &&
      cameraTargetValid,
  };

  process.stdout.write(JSON.stringify(result, null, 2));
} catch (err) {
  process.stderr.write(String(err));
  process.exit(1);
}
