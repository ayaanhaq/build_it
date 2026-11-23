import * as THREE from 'three';
import { DESK_SCENE } from '../src/fixtures/desk.scene.ts';
import { validateScene } from '../src/sceneValidator.ts';
import {
  buildSceneModel,
  buildHandBuiltDeskModel,
  PRIMITIVE_BUILDERS,
} from '../src/three-scene.ts';

try {
  // 1. Scene validation
  const validationErrors = validateScene(DESK_SCENE);

  // 2. Build both models
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

  // 5. Primitive builder completeness test
  const primitiveSmokeTest = {
    box: PRIMITIVE_BUILDERS.box({ width: 10, height: 10, depth: 10 }) instanceof THREE.BufferGeometry,
    cylinder: PRIMITIVE_BUILDERS.cylinder({ height: 20, radius: 5 }) instanceof THREE.BufferGeometry,
    lathe: PRIMITIVE_BUILDERS.lathe({ radius: 8, height: 16 }) instanceof THREE.BufferGeometry,
    bevel: PRIMITIVE_BUILDERS.bevel({ width: 20, height: 5, depth: 15, bevelSize: 1 }) instanceof THREE.BufferGeometry,
    spring: PRIMITIVE_BUILDERS.spring({ radius: 5, height: 30, coils: 4 }) instanceof THREE.BufferGeometry,
  };

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
    primitiveSmokeTest,
    passed:
      validationErrors.length === 0 &&
      handBuilt.allInteractiveMeshes.length === 24 &&
      sceneModel.allInteractiveMeshes.length === 24 &&
      maxDelta < 1e-4 &&
      partMismatches.length === 0,
  };

  process.stdout.write(JSON.stringify(result, null, 2));
} catch (err) {
  process.stderr.write(String(err));
  process.exit(1);
}
