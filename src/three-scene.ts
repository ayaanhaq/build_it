import * as THREE from "three";
import { DESK_BUILD_STEPS } from "./deskData.ts";
import type {
  Scene,
  SceneStep,
  ScenePart,
  ScenePrimitiveType,
  BoxDimensions,
  CylinderDimensions,
  LatheDimensions,
  BevelDimensions,
  SpringDimensions,
} from "./types";

/**
 * HeyClicky-Inspired REAL_TONES Palette
 * Matches authentic physical material tones from real-world objects.
 */
export const REAL_TONES = {
  ink: 0x2c2e33,
  white: 0xe8e6e1,
  grey: 0x8b8e93,
  butter: 0xe0c477,
  sun: 0xd6a83c,
  orange: 0xc9692e,
  peach: 0xd8a287,
  coral: 0xc1604f,
  red: 0xa8352d,
  pink: 0xc7848f,
  lilac: 0x9e92c0,
  violet: 0x5d4d90,
  sky: 0x8aafcc,
  blue: 0x2f5689,
  mint: 0x94bca2,
  leaf: 0x53794a,
  brown: 0x6d4a2f,
  tan: 0xb9946f,
  cream: 0xe4d9c2,
};

export interface ThreeDeskViewerOptions {
  container: HTMLElement;
  initialStep?: number;
  scene?: Scene;
  onStepChange?: (step: number) => void;
  onPartHover?: (partName: string | null, screenX: number, screenY: number) => void;
  onPartClick?: (partName: string) => void;
}

/**
 * Dedicated primitive builder functions mapping Scene schema geometries to Three.js BufferGeometry.
 */
export function buildBoxGeometry(dim: BoxDimensions): THREE.BufferGeometry {
  return new THREE.BoxGeometry(dim.width, dim.height, dim.depth);
}

export function buildCylinderGeometry(dim: CylinderDimensions): THREE.BufferGeometry {
  const rt = dim.radiusTop ?? dim.radius ?? 1;
  const rb = dim.radiusBottom ?? dim.radius ?? 1;
  const h = dim.height;
  const segs = dim.radialSegments ?? 24;
  return new THREE.CylinderGeometry(rt, rb, h, segs);
}

export function buildLatheGeometry(dim: LatheDimensions): THREE.BufferGeometry {
  const r = dim.radius;
  const h = dim.height;
  const segments = dim.segments ?? 24;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(0, -h / 2),
    new THREE.Vector2(r * 0.8, -h / 2),
    new THREE.Vector2(r, -h / 4),
    new THREE.Vector2(r, h / 4),
    new THREE.Vector2(r * 0.8, h / 2),
    new THREE.Vector2(0, h / 2),
  ];
  return new THREE.LatheGeometry(points, segments);
}

export function buildBevelGeometry(dim: BevelDimensions): THREE.BufferGeometry {
  const w = dim.width;
  const h = dim.height;
  const d = dim.depth;
  const bevelSize = dim.bevelSize ?? 0;
  const bevelThickness = dim.bevelThickness ?? bevelSize;

  if (bevelSize > 0 || bevelThickness > 0) {
    const shape = new THREE.Shape();
    const halfW = w / 2 - bevelSize;
    const halfD = d / 2 - bevelSize;
    shape.moveTo(-halfW, -halfD);
    shape.lineTo(halfW, -halfD);
    shape.lineTo(halfW, halfD);
    shape.lineTo(-halfW, halfD);
    shape.closePath();

    const extrudeHeight = Math.max(0.01, h - 2 * bevelThickness);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: extrudeHeight,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize,
      bevelThickness,
    });
    geo.center();
    geo.rotateX(Math.PI / 2);
    return geo;
  }
  return new THREE.BoxGeometry(w, h, d);
}

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  radius: number;
  height: number;
  coils: number;

  constructor(radius: number, height: number, coils: number) {
    super();
    this.radius = radius;
    this.height = height;
    this.coils = coils;
  }
  getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const angle = 2 * Math.PI * this.coils * t;
    const x = this.radius * Math.cos(angle);
    const y = (t - 0.5) * this.height;
    const z = this.radius * Math.sin(angle);
    return optionalTarget.set(x, y, z);
  }
}

export function buildSpringGeometry(dim: SpringDimensions): THREE.BufferGeometry {
  const r = dim.radius;
  const h = dim.height;
  const coils = dim.coils ?? 5;
  const wireRadius = dim.wireRadius ?? Math.min(r * 0.1, 1.0);
  const path = new HelixCurve(r, h, coils);
  const tubularSegments = Math.min(256, Math.max(32, coils * 32));
  return new THREE.TubeGeometry(path, tubularSegments, wireRadius, 8, false);
}

/**
 * Dispatch table mapping each primitive type to its geometry builder function.
 */
export const PRIMITIVE_BUILDERS: Record<ScenePrimitiveType, (dimensions: any) => THREE.BufferGeometry> = {
  box: (d) => buildBoxGeometry(d as BoxDimensions),
  cylinder: (d) => buildCylinderGeometry(d as CylinderDimensions),
  lathe: (d) => buildLatheGeometry(d as LatheDimensions),
  bevel: (d) => buildBevelGeometry(d as BevelDimensions),
  spring: (d) => buildSpringGeometry(d as SpringDimensions),
};

/**
 * Resolves standard physical material parameters from descriptive material names.
 */
export function getMaterialParams(materialName: string = ""): { roughness: number; metalness: number } {
  const lower = materialName.toLowerCase();
  if (lower.includes("brass") || lower.includes("gold")) {
    return { roughness: 0.22, metalness: 0.88 };
  }
  if (lower.includes("steel") || lower.includes("metal") || lower.includes("iron")) {
    return { roughness: 0.42, metalness: 0.82 };
  }
  if (lower.includes("leather")) {
    return { roughness: 0.85, metalness: 0.1 };
  }
  if (lower.includes("paper") || lower.includes("notebook")) {
    return { roughness: 0.6, metalness: 0.05 };
  }
  if (lower.includes("walnut")) {
    return { roughness: 0.42, metalness: 0.05 };
  }
  if (lower.includes("trim")) {
    return { roughness: 0.2, metalness: 0.02 };
  }
  if (lower.includes("oak") || lower.includes("wood")) {
    return { roughness: 0.38, metalness: 0.04 };
  }
  return { roughness: 0.35, metalness: 0.05 };
}

export interface SceneModelResult {
  stepGroups: Map<number, THREE.Group>;
  partMeshes: Map<string, THREE.Mesh>;
  allInteractiveMeshes: THREE.Mesh[];
  rootGroup: THREE.Group;
}

export function createEmptySceneModel(): SceneModelResult {
  return {
    stepGroups: new Map<number, THREE.Group>(),
    partMeshes: new Map<string, THREE.Mesh>(),
    allInteractiveMeshes: [],
    rootGroup: new THREE.Group(),
  };
}

/**
 * Builds meshes for a single SceneStep into a THREE.Group.
 * Routes every mesh through registerMesh.
 */
export function buildStepMeshes(
  step: SceneStep,
  registerMesh: (mesh: THREE.Mesh, name: string, group: THREE.Group) => void
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Step-${step.stepNumber}-Group`;

  for (const part of step.parts) {
    const builder = PRIMITIVE_BUILDERS[part.primitive];
    if (!builder) {
      console.warn(`Unknown primitive builder for: ${part.primitive}`);
      continue;
    }

    const geometry = builder(part.dimensions);
    const hexColor = REAL_TONES[part.color] ?? REAL_TONES.tan;
    const { roughness, metalness } = getMaterialParams(part.material);
    const material = new THREE.MeshStandardMaterial({
      color: hexColor,
      roughness,
      metalness,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(part.position.x, part.position.y, part.position.z);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(part.rotation.x),
      THREE.MathUtils.degToRad(part.rotation.y),
      THREE.MathUtils.degToRad(part.rotation.z)
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    registerMesh(mesh, part.name || part.id, group);
  }

  return group;
}

/**
 * Appends a single SceneStep incrementally into a SceneModelResult.
 * If model is provided, registers the group and meshes into the model.
 * Routes every mesh through registerMesh.
 */
export function appendStep(
  step: SceneStep,
  model?: SceneModelResult,
  registerMesh?: (mesh: THREE.Mesh, name: string, group: THREE.Group) => void
): THREE.Group {
  const handleRegister = registerMesh || ((mesh: THREE.Mesh, name: string, group: THREE.Group) => {
    mesh.name = name;
    mesh.userData = { partName: name };
    group.add(mesh);
    if (model) {
      model.allInteractiveMeshes.push(mesh);
      model.partMeshes.set(name, mesh);
    }
  });

  const group = buildStepMeshes(step, handleRegister);

  if (model) {
    if (model.stepGroups.has(step.stepNumber)) {
      removeStep(step.stepNumber, model);
    }
    model.stepGroups.set(step.stepNumber, group);
    model.rootGroup.add(group);
  }

  return group;
}

/**
 * Removes a step from a SceneModelResult for undo support.
 */
export function removeStep(
  stepNumber: number,
  model: SceneModelResult
): boolean {
  const group = model.stepGroups.get(stepNumber);
  if (!group) return false;

  model.rootGroup.remove(group);
  model.stepGroups.delete(stepNumber);

  const meshesToRemove = new Set<THREE.Mesh>();
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      meshesToRemove.add(obj as THREE.Mesh);
    }
  });

  model.allInteractiveMeshes = model.allInteractiveMeshes.filter((m) => !meshesToRemove.has(m));
  for (const [name, mesh] of model.partMeshes.entries()) {
    if (meshesToRemove.has(mesh)) {
      model.partMeshes.delete(name);
    }
  }

  return true;
}

/**
 * Builds Three.js meshes from a validated Scene contract.
 * Implemented on top of appendStep.
 */
export function buildSceneModel(
  scene: Scene,
  registerMesh?: (mesh: THREE.Mesh, name: string, group: THREE.Group) => void
): SceneModelResult {
  const model = createEmptySceneModel();
  for (const step of scene.steps) {
    appendStep(step, model, registerMesh);
  }
  return model;
}

/**
 * Legacy builder for the hand-built desk model.
 * Maintained intact for geometric verification and regression comparisons.
 */
export function buildHandBuiltDeskModel(
  registerMesh?: (mesh: THREE.Mesh, name: string, group: THREE.Group) => void
): {
  stepGroups: Map<number, THREE.Group>;
  partMeshes: Map<string, THREE.Mesh>;
  allInteractiveMeshes: THREE.Mesh[];
  rootGroup: THREE.Group;
} {
  const stepGroups = new Map<number, THREE.Group>();
  const partMeshes = new Map<string, THREE.Mesh>();
  const allInteractiveMeshes: THREE.Mesh[] = [];
  const rootGroup = new THREE.Group();

  const handleRegister = registerMesh || ((mesh: THREE.Mesh, name: string, group: THREE.Group) => {
    mesh.name = name;
    mesh.userData = { partName: name };
    group.add(mesh);
    allInteractiveMeshes.push(mesh);
    partMeshes.set(name, mesh);
  });

  const oakWoodMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.tan, roughness: 0.38, metalness: 0.04 });
  const brassMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.sun, roughness: 0.22, metalness: 0.88 });
  const darkSteelMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.ink, roughness: 0.42, metalness: 0.82 });
  const walnutMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.brown, roughness: 0.42, metalness: 0.05 });

  // STEP 1: 4 Legs + Brass Leveling Glides
  const group1 = new THREE.Group();
  rootGroup.add(group1);
  const lx = 35, lz = 18, lh = 32, lt = 2.4;
  const legGeo = new THREE.BoxGeometry(lt, lh, lt);
  const glideGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.8, 24);

  const legCoords = [
    [-lx, lz, "Front-Left Leg Post"],
    [lx, lz, "Front-Right Leg Post"],
    [-lx, -lz, "Rear-Left Leg Post"],
    [lx, -lz, "Rear-Right Leg Post"],
  ] as const;

  legCoords.forEach(([x, z, name]) => {
    const legMesh = new THREE.Mesh(legGeo, oakWoodMat.clone());
    legMesh.position.set(x, lh / 2 + 0.8, z);
    legMesh.castShadow = true;
    legMesh.receiveShadow = true;
    handleRegister(legMesh, name, group1);

    const glideMesh = new THREE.Mesh(glideGeo, brassMat.clone());
    glideMesh.position.set(x, 0.4, z);
    glideMesh.castShadow = true;
    handleRegister(glideMesh, `${name} Brass Glide`, group1);
  });
  stepGroups.set(1, group1);

  // STEP 2: Side Apron Rails & Dowels
  const group2 = new THREE.Group();
  rootGroup.add(group2);
  const sideApronGeo = new THREE.BoxGeometry(1.6, 4.0, lz * 2 - lt);

  const leftApron = new THREE.Mesh(sideApronGeo, oakWoodMat.clone());
  leftApron.position.set(-lx, lh - 2 + 0.8, 0);
  leftApron.castShadow = true;
  leftApron.receiveShadow = true;
  handleRegister(leftApron, "Left Side Apron Rail", group2);

  const rightApron = new THREE.Mesh(sideApronGeo, oakWoodMat.clone());
  rightApron.position.set(lx, lh - 2 + 0.8, 0);
  rightApron.castShadow = true;
  rightApron.receiveShadow = true;
  handleRegister(rightApron, "Right Side Apron Rail", group2);
  stepGroups.set(2, group2);

  // STEP 3: Main Spine Longitudinal Stretchers & Gussets
  const group3 = new THREE.Group();
  rootGroup.add(group3);
  const frontBackGeo = new THREE.BoxGeometry(lx * 2 - lt, 4.0, 1.6);

  const rearStretcher = new THREE.Mesh(frontBackGeo, oakWoodMat.clone());
  rearStretcher.position.set(0, lh - 2 + 0.8, -lz);
  rearStretcher.castShadow = true;
  rearStretcher.receiveShadow = true;
  handleRegister(rearStretcher, "Rear Longitudinal Stretcher", group3);

  const frontStretcher = new THREE.Mesh(frontBackGeo, oakWoodMat.clone());
  frontStretcher.position.set(0, lh - 2 + 0.8, lz);
  frontStretcher.castShadow = true;
  frontStretcher.receiveShadow = true;
  handleRegister(frontStretcher, "Front Longitudinal Stretcher", group3);

  const brkGeo = new THREE.BoxGeometry(2.5, 2.5, 0.4);
  const gussetCoords = [
    [-lx + 2.5, lh - 2, lz - 1.2, "Front-Left Corner Gusset"],
    [lx - 2.5, lh - 2, lz - 1.2, "Front-Right Corner Gusset"],
    [-lx + 2.5, lh - 2, -lz + 1.2, "Rear-Left Corner Gusset"],
    [lx - 2.5, lh - 2, -lz + 1.2, "Rear-Right Corner Gusset"],
  ] as const;

  gussetCoords.forEach(([bx, by, bz, name]) => {
    const b = new THREE.Mesh(brkGeo, darkSteelMat.clone());
    b.position.set(bx, by, bz);
    handleRegister(b, name, group3);
  });
  stepGroups.set(3, group3);

  // STEP 4: Solid Oak Desktop Slab with Beveled Trim
  const group4 = new THREE.Group();
  rootGroup.add(group4);
  const topWidth = 84, topDepth = 46, topThick = 2.0;

  const desktopGeo = new THREE.BoxGeometry(topWidth, topThick, topDepth);
  const desktopMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.tan, roughness: 0.3, metalness: 0.04 });
  const deskTop = new THREE.Mesh(desktopGeo, desktopMat);
  deskTop.position.set(0, lh + 1.8, 0);
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  handleRegister(deskTop, "Solid Oak Desktop Slab (1200x700mm)", group4);

  const trimGeo = new THREE.BoxGeometry(topWidth + 0.2, 0.15, topDepth + 0.2);
  const trimMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.cream, roughness: 0.2, metalness: 0.02 });
  const trim = new THREE.Mesh(trimGeo, trimMat);
  trim.position.set(0, lh + topThick + 0.8, 0);
  handleRegister(trim, "Chamfered Tabletop Bevel", group4);
  stepGroups.set(4, group4);

  // STEP 5: Under-Desk Drawer Unit Module
  const group5 = new THREE.Group();
  rootGroup.add(group5);
  const casingGeo = new THREE.BoxGeometry(16, 6, 26);
  const casing = new THREE.Mesh(casingGeo, oakWoodMat.clone());
  casing.position.set(lx - 11, lh - 3 + 0.8, 2);
  casing.castShadow = true;
  handleRegister(casing, "Suspended Drawer Housing Casing", group5);

  const drawerFaceGeo = new THREE.BoxGeometry(14.8, 4.8, 1);
  const drawerFace = new THREE.Mesh(drawerFaceGeo, walnutMat.clone());
  drawerFace.position.set(lx - 11, lh - 3 + 0.8, 15.2);
  drawerFace.castShadow = true;
  handleRegister(drawerFace, "Walnut Dovetail Drawer Face", group5);

  const handleGeo = new THREE.BoxGeometry(6, 0.6, 0.8);
  const handle = new THREE.Mesh(handleGeo, darkSteelMat.clone());
  handle.position.set(lx - 11, lh - 3 + 0.8, 16.1);
  handleRegister(handle, "Anodized Black Pull Handle", group5);
  stepGroups.set(5, group5);

  // STEP 6: Cable Management Raceway & Full-Grain Leather Pad
  const group6 = new THREE.Group();
  rootGroup.add(group6);
  const trayGeo = new THREE.BoxGeometry(42, 3, 5);
  const tray = new THREE.Mesh(trayGeo, darkSteelMat.clone());
  tray.position.set(-6, lh - 4 + 0.8, -lz + 4);
  tray.castShadow = true;
  handleRegister(tray, "Under-Desk Steel Cable Raceway", group6);

  const padGeo = new THREE.BoxGeometry(44, 0.2, 24);
  const padMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.ink, roughness: 0.85, metalness: 0.1 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.set(-4, lh + 2.9, 2);
  pad.receiveShadow = true;
  handleRegister(pad, "Full-Grain Leather Desk Pad", group6);

  const bookGeo = new THREE.BoxGeometry(9, 0.4, 13);
  const bookMat = new THREE.MeshStandardMaterial({ color: REAL_TONES.coral, roughness: 0.6, metalness: 0.05 });
  const book = new THREE.Mesh(bookGeo, bookMat);
  book.position.set(10, lh + 3.1, 2);
  book.rotation.y = -0.15;
  handleRegister(book, "Hardbound Designer Notebook", group6);
  stepGroups.set(6, group6);

  return { stepGroups, partMeshes, allInteractiveMeshes, rootGroup };
}

export class ThreeDeskViewer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouseVec: THREE.Vector2 = new THREE.Vector2();
  private animId: number | null = null;

  // Step state
  private currentStep: number = 1;
  private currentScene: Scene | null = null;
  private stepGroups: Map<number, THREE.Group> = new Map();
  private partMeshes: Map<string, THREE.Mesh> = new Map();
  private allInteractiveMeshes: THREE.Mesh[] = [];
  private hoveredMesh: THREE.Mesh | null = null;
  private selectedMesh: THREE.Mesh | null = null;

  private animatedMeshes: {
    mesh: THREE.Object3D;
    targetY: number;
    startY: number;
    startTime: number;
    duration: number;
  }[] = [];

  // Orbit navigation state
  private isPointerDown: boolean = false;
  private pointerMode: "rotate" | "pan" = "rotate";
  private previousPointerPos: { x: number; y: number } = { x: 0, y: 0 };
  private initialPinchDist: number = 0;
  private lastUserInteractTime: number = 0;

  // Spherical camera coordinates around target
  private target: THREE.Vector3 = new THREE.Vector3(0, 18, 0);
  private cameraDistance: number = 95;
  private cameraPhi: number = 1.05;
  private cameraTheta: number = 0.75;
  private targetDistance: number = 95;
  private targetPhi: number = 1.05;
  private targetTheta: number = 0.75;

  // Callbacks
  private onPartHoverCallback?: (partName: string | null, screenX: number, screenY: number) => void;
  private onPartClickCallback?: (partName: string) => void;

  constructor(options: ThreeDeskViewerOptions) {
    this.container = options.container;
    this.currentStep = options.initialStep || 1;
    this.onPartHoverCallback = options.onPartHover;
    this.onPartClickCallback = options.onPartClick;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0c);

    // 2. Camera setup
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 1000);
    this.updateCameraPosition();

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 4. Studio Multi-Pass Lighting (Pass 5)
    this.setupLighting();

    // 5. Ground Contact Shadow & Platform (Pass 6)
    this.setupGround();

    // 6. Build Beveled Geometry Kernel & Ink Outlines (Pass 2)
    if (options.scene) {
      this.currentScene = options.scene;
      this.buildSceneModel(options.scene);
    } else {
      this.buildDeskModel();
    }

    // 7. Event Listeners for Orbit, Zoom, Pan, Picking
    this.setupInteraction();

    // 8. Start Loop
    this.setStep(this.currentStep, false);
    this.animate();
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);

    // Key Light (Warm Sunlight Angle)
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.35);
    keyLight.position.set(45, 75, 55);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.001;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 200;
    keyLight.shadow.camera.left = -60;
    keyLight.shadow.camera.right = 60;
    keyLight.shadow.camera.top = 60;
    keyLight.shadow.camera.bottom = -60;
    this.scene.add(keyLight);

    // Fill Light (Cool Sky Light)
    const fillLight = new THREE.DirectionalLight(0xdbe6fd, 0.55);
    fillLight.position.set(-50, 40, -45);
    this.scene.add(fillLight);

    // Rim Light (Sharp Edge Specular Highlights)
    const rimLight = new THREE.DirectionalLight(0xfff0d8, 0.75);
    rimLight.position.set(0, 35, -65);
    this.scene.add(rimLight);
  }

  private setupGround(): void {
    // Shadow Receiver Plane
    const groundGeo = new THREE.PlaneGeometry(300, 300);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.38 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Circular Presentation Dais
    const daisGeo = new THREE.CylinderGeometry(58, 60, 0.4, 48);
    const daisMat = new THREE.MeshStandardMaterial({
      color: 0x141417,
      roughness: 0.9,
      metalness: 0.1,
    });
    const dais = new THREE.Mesh(daisGeo, daisMat);
    dais.position.y = -0.2;
    dais.receiveShadow = true;
    this.scene.add(dais);

    // Contact shadow center gradient disc
    const contactDiscGeo = new THREE.CircleGeometry(42, 32);
    const contactDiscMat = new THREE.MeshBasicMaterial({
      color: 0x050507,
      transparent: true,
      opacity: 0.5,
    });
    const contactDisc = new THREE.Mesh(contactDiscGeo, contactDiscMat);
    contactDisc.rotation.x = -Math.PI / 2;
    contactDisc.position.y = 0.01;
    this.scene.add(contactDisc);

    // Subtle grid guide
    const grid = new THREE.GridHelper(90, 18, 0x25262c, 0x16171a);
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  /**
   * Adds HeyClicky-style technical ink outlines to geometry (Pass 2)
   */
  private addInkOutlines(mesh: THREE.Mesh, thresholdAngle: number = 24): void {
    const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdAngle);
    const lineMat = new THREE.LineBasicMaterial({
      color: REAL_TONES.ink,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.85,
    });
    const lines = new THREE.LineSegments(edges, lineMat);
    mesh.add(lines);
  }

  private createPbrMaterial(
    color: number,
    roughness: number = 0.35,
    metalness: number = 0.05
  ): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
  }

  public registerMesh(mesh: THREE.Mesh, name: string, group: THREE.Group): void {
    mesh.name = name;
    mesh.userData = { partName: name };
    this.addInkOutlines(mesh);
    group.add(mesh);
    this.allInteractiveMeshes.push(mesh);
    this.partMeshes.set(name, mesh);
  }

  /**
   * Appends a single SceneStep incrementally into the Three.js scene.
   * Builds only that step's meshes and routes every mesh through registerMesh.
   */
  public appendStep(step: SceneStep, animateTransition: boolean = true): THREE.Group {
    // If step already exists, replace it cleanly
    if (this.stepGroups.has(step.stepNumber)) {
      this.removeStep(step.stepNumber);
    }

    // Track step within currentScene
    if (this.currentScene) {
      const idx = this.currentScene.steps.findIndex((s) => s.stepNumber === step.stepNumber);
      if (idx >= 0) {
        this.currentScene.steps[idx] = step;
      } else {
        this.currentScene.steps.push(step);
      }
    } else {
      this.currentScene = {
        schemaVersion: 1,
        steps: [step],
      };
    }

    const group = buildStepMeshes(step, (mesh, name, grp) => {
      this.registerMesh(mesh, name, grp);
    });

    this.stepGroups.set(step.stepNumber, group);
    this.scene.add(group);

    if (step.cameraPreset) {
      this.targetDistance = step.cameraPreset.distance;
      this.targetPhi = step.cameraPreset.phi;
      this.targetTheta = step.cameraPreset.theta;
    }

    this.setStep(step.stepNumber, animateTransition);
    return group;
  }

  /**
   * Removes a step from the Three.js scene for undo support.
   */
  public removeStep(stepNumber: number): boolean {
    const group = this.stepGroups.get(stepNumber);
    if (!group) return false;

    this.scene.remove(group);
    this.stepGroups.delete(stepNumber);

    const meshesToRemove = new Set<THREE.Mesh>();
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        meshesToRemove.add(obj as THREE.Mesh);
      }
    });

    this.allInteractiveMeshes = this.allInteractiveMeshes.filter((m) => !meshesToRemove.has(m));
    for (const [name, mesh] of this.partMeshes.entries()) {
      if (meshesToRemove.has(mesh)) {
        this.partMeshes.delete(name);
      }
    }

    if (this.selectedMesh && meshesToRemove.has(this.selectedMesh)) {
      this.selectedMesh = null;
    }
    if (this.hoveredMesh && meshesToRemove.has(this.hoveredMesh)) {
      this.hoveredMesh = null;
    }

    if (this.currentScene) {
      this.currentScene.steps = this.currentScene.steps.filter((s) => s.stepNumber !== stepNumber);
    }

    if (this.currentStep === stepNumber) {
      const remainingSteps = Array.from(this.stepGroups.keys()).sort((a, b) => a - b);
      const newStep = remainingSteps.length > 0 ? remainingSteps[remainingSteps.length - 1] : 1;
      this.setStep(newStep, false);
    }

    return true;
  }

  /**
   * Builds the complete scene model.
   * Implemented on top of appendStep.
   */
  public buildSceneModel(scene: Scene): void {
    // Clear any previous step groups from Three.js scene
    this.stepGroups.forEach((group) => {
      this.scene.remove(group);
    });
    this.stepGroups.clear();
    this.partMeshes.clear();
    this.allInteractiveMeshes = [];
    this.animatedMeshes = [];
    this.selectedMesh = null;
    this.hoveredMesh = null;

    this.currentScene = { ...scene, steps: [] };
    for (const step of scene.steps) {
      this.appendStep(step, false);
    }
    this.currentScene = scene;
    this.setStep(this.currentStep, false);
  }

  public loadScene(scene: Scene): void {
    this.buildSceneModel(scene);
    this.setStep(1, false);
  }

  public buildDeskModel(): void {
    const oakWoodMat = this.createPbrMaterial(REAL_TONES.tan, 0.38, 0.04);
    const brassMat = this.createPbrMaterial(REAL_TONES.sun, 0.22, 0.88);
    const darkSteelMat = this.createPbrMaterial(REAL_TONES.ink, 0.42, 0.82);
    const walnutMat = this.createPbrMaterial(REAL_TONES.brown, 0.42, 0.05);

    const registerMesh = (mesh: THREE.Mesh, name: string, group: THREE.Group) => {
      this.registerMesh(mesh, name, group);
    };

    // STEP 1: 4 Legs + Brass Leveling Glides
    const group1 = new THREE.Group();
    const lx = 35, lz = 18, lh = 32, lt = 2.4;
    const legGeo = new THREE.BoxGeometry(lt, lh, lt);
    const glideGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.8, 24);

    const legCoords = [
      [-lx, lz, "Front-Left Leg Post"],
      [lx, lz, "Front-Right Leg Post"],
      [-lx, -lz, "Rear-Left Leg Post"],
      [lx, -lz, "Rear-Right Leg Post"],
    ] as const;

    legCoords.forEach(([x, z, name]) => {
      const legMesh = new THREE.Mesh(legGeo, oakWoodMat.clone());
      legMesh.position.set(x, lh / 2 + 0.8, z);
      legMesh.castShadow = true;
      legMesh.receiveShadow = true;
      registerMesh(legMesh, name, group1);

      const glideMesh = new THREE.Mesh(glideGeo, brassMat.clone());
      glideMesh.position.set(x, 0.4, z);
      glideMesh.castShadow = true;
      registerMesh(glideMesh, `${name} Brass Glide`, group1);
    });
    this.stepGroups.set(1, group1);
    this.scene.add(group1);

    // STEP 2: Side Apron Rails & Dowels
    const group2 = new THREE.Group();
    const sideApronGeo = new THREE.BoxGeometry(1.6, 4.0, lz * 2 - lt);

    const leftApron = new THREE.Mesh(sideApronGeo, oakWoodMat.clone());
    leftApron.position.set(-lx, lh - 2 + 0.8, 0);
    leftApron.castShadow = true;
    leftApron.receiveShadow = true;
    registerMesh(leftApron, "Left Side Apron Rail", group2);

    const rightApron = new THREE.Mesh(sideApronGeo, oakWoodMat.clone());
    rightApron.position.set(lx, lh - 2 + 0.8, 0);
    rightApron.castShadow = true;
    rightApron.receiveShadow = true;
    registerMesh(rightApron, "Right Side Apron Rail", group2);

    this.stepGroups.set(2, group2);
    this.scene.add(group2);

    // STEP 3: Main Spine Longitudinal Stretchers & Gussets
    const group3 = new THREE.Group();
    const frontBackGeo = new THREE.BoxGeometry(lx * 2 - lt, 4.0, 1.6);

    const rearStretcher = new THREE.Mesh(frontBackGeo, oakWoodMat.clone());
    rearStretcher.position.set(0, lh - 2 + 0.8, -lz);
    rearStretcher.castShadow = true;
    rearStretcher.receiveShadow = true;
    registerMesh(rearStretcher, "Rear Longitudinal Stretcher", group3);

    const frontStretcher = new THREE.Mesh(frontBackGeo, oakWoodMat.clone());
    frontStretcher.position.set(0, lh - 2 + 0.8, lz);
    frontStretcher.castShadow = true;
    frontStretcher.receiveShadow = true;
    registerMesh(frontStretcher, "Front Longitudinal Stretcher", group3);

    // Steel Corner Gusset Brackets
    const brkGeo = new THREE.BoxGeometry(2.5, 2.5, 0.4);
    const gussetCoords = [
      [-lx + 2.5, lh - 2, lz - 1.2, "Front-Left Corner Gusset"],
      [lx - 2.5, lh - 2, lz - 1.2, "Front-Right Corner Gusset"],
      [-lx + 2.5, lh - 2, -lz + 1.2, "Rear-Left Corner Gusset"],
      [lx - 2.5, lh - 2, -lz + 1.2, "Rear-Right Corner Gusset"],
    ] as const;

    gussetCoords.forEach(([bx, by, bz, name]) => {
      const b = new THREE.Mesh(brkGeo, darkSteelMat.clone());
      b.position.set(bx, by, bz);
      registerMesh(b, name, group3);
    });
    this.stepGroups.set(3, group3);
    this.scene.add(group3);

    // STEP 4: Solid Oak Desktop Slab with Beveled Trim
    const group4 = new THREE.Group();
    const topWidth = 84, topDepth = 46, topThick = 2.0;

    const desktopGeo = new THREE.BoxGeometry(topWidth, topThick, topDepth);
    const desktopMat = this.createPbrMaterial(REAL_TONES.tan, 0.3, 0.04);
    const deskTop = new THREE.Mesh(desktopGeo, desktopMat);
    deskTop.position.set(0, lh + 1.8, 0);
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    registerMesh(deskTop, "Solid Oak Desktop Slab (1200x700mm)", group4);

    // Beveled perimeter trim highlight
    const trimGeo = new THREE.BoxGeometry(topWidth + 0.2, 0.15, topDepth + 0.2);
    const trimMat = this.createPbrMaterial(REAL_TONES.cream, 0.2, 0.02);
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.set(0, lh + topThick + 0.8, 0);
    registerMesh(trim, "Chamfered Tabletop Bevel", group4);

    this.stepGroups.set(4, group4);
    this.scene.add(group4);

    // STEP 5: Under-Desk Drawer Unit Module
    const group5 = new THREE.Group();
    const casingGeo = new THREE.BoxGeometry(16, 6, 26);
    const casing = new THREE.Mesh(casingGeo, oakWoodMat.clone());
    casing.position.set(lx - 11, lh - 3 + 0.8, 2);
    casing.castShadow = true;
    registerMesh(casing, "Suspended Drawer Housing Casing", group5);

    const drawerFaceGeo = new THREE.BoxGeometry(14.8, 4.8, 1);
    const drawerFace = new THREE.Mesh(drawerFaceGeo, walnutMat.clone());
    drawerFace.position.set(lx - 11, lh - 3 + 0.8, 15.2);
    drawerFace.castShadow = true;
    registerMesh(drawerFace, "Walnut Dovetail Drawer Face", group5);

    const handleGeo = new THREE.BoxGeometry(6, 0.6, 0.8);
    const handle = new THREE.Mesh(handleGeo, darkSteelMat.clone());
    handle.position.set(lx - 11, lh - 3 + 0.8, 16.1);
    registerMesh(handle, "Anodized Black Pull Handle", group5);

    this.stepGroups.set(5, group5);
    this.scene.add(group5);

    // STEP 6: Cable Management Raceway & Full-Grain Leather Pad
    const group6 = new THREE.Group();
    const trayGeo = new THREE.BoxGeometry(42, 3, 5);
    const tray = new THREE.Mesh(trayGeo, darkSteelMat.clone());
    tray.position.set(-6, lh - 4 + 0.8, -lz + 4);
    tray.castShadow = true;
    registerMesh(tray, "Under-Desk Steel Cable Raceway", group6);

    const padGeo = new THREE.BoxGeometry(44, 0.2, 24);
    const padMat = this.createPbrMaterial(REAL_TONES.ink, 0.85, 0.1);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(-4, lh + 2.9, 2);
    pad.receiveShadow = true;
    registerMesh(pad, "Full-Grain Leather Desk Pad", group6);

    const bookGeo = new THREE.BoxGeometry(9, 0.4, 13);
    const bookMat = this.createPbrMaterial(REAL_TONES.coral, 0.6, 0.05);
    const book = new THREE.Mesh(bookGeo, bookMat);
    book.position.set(10, lh + 3.1, 2);
    book.rotation.y = -0.15;
    registerMesh(book, "Hardbound Designer Notebook", group6);

    this.stepGroups.set(6, group6);
    this.scene.add(group6);
  }

  public setStep(step: number, animateTransition: boolean = true): void {
    const totalSteps = this.currentScene
      ? this.currentScene.steps.length
      : DESK_BUILD_STEPS.length;
    this.currentStep = Math.max(1, Math.min(step, totalSteps));

    this.stepGroups.forEach((group, stepNum) => {
      if (stepNum <= this.currentStep) {
        group.visible = true;

        if (stepNum === this.currentStep && animateTransition) {
          group.position.y = 14;
          this.animatedMeshes.push({
            mesh: group,
            targetY: 0,
            startY: 14,
            startTime: performance.now(),
            duration: 650,
          });
        } else {
          group.position.y = 0;
        }
      } else {
        group.visible = false;
        group.position.y = 0;
      }
    });

    const stepConfig = this.currentScene
      ? this.currentScene.steps[this.currentStep - 1]
      : DESK_BUILD_STEPS[this.currentStep - 1];
    if (stepConfig && stepConfig.cameraPreset) {
      this.targetDistance = stepConfig.cameraPreset.distance;
      this.targetPhi = stepConfig.cameraPreset.phi;
      this.targetTheta = stepConfig.cameraPreset.theta;
    }
  }

  public highlightPartByName(name: string | null): void {
    if (this.selectedMesh) {
      const mat = this.selectedMesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) mat.emissive.setHex(0x000000);
      this.selectedMesh = null;
    }

    if (name) {
      const match = this.allInteractiveMeshes.find((m) =>
        m.name.toLowerCase().includes(name.toLowerCase())
      );
      if (match) {
        this.selectedMesh = match;
        const mat = match.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissive.setHex(0x443300);
      }
    }
  }

  private setupInteraction(): void {
    const el = this.renderer.domElement;

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      this.isPointerDown = true;
      this.lastUserInteractTime = performance.now();
      this.pointerMode = e.button === 2 ? "pan" : "rotate";
      this.previousPointerPos = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e: PointerEvent) => {
      this.lastUserInteractTime = performance.now();

      // Update Mouse coordinates for Raycasting Picking (Pass 1)
      const rect = el.getBoundingClientRect();
      this.mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Handle Orbit navigation if dragging
      if (this.isPointerDown) {
        const deltaX = e.clientX - this.previousPointerPos.x;
        const deltaY = e.clientY - this.previousPointerPos.y;
        this.previousPointerPos = { x: e.clientX, y: e.clientY };

        if (this.pointerMode === "rotate") {
          this.cameraTheta -= deltaX * 0.008;
          this.targetTheta = this.cameraTheta;

          this.cameraPhi -= deltaY * 0.008;
          this.cameraPhi = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, this.cameraPhi));
          this.targetPhi = this.cameraPhi;
        } else if (this.pointerMode === "pan") {
          const factor = this.cameraDistance * 0.0012;
          this.target.x -= (Math.cos(this.cameraTheta) * deltaX - Math.sin(this.cameraTheta) * deltaY) * factor;
          this.target.y += deltaY * factor;
        }
        return;
      }

      // Raycast part picking on hover
      this.performPicking(e.clientX, e.clientY);
    });

    const onPointerUp = (e: PointerEvent) => {
      this.isPointerDown = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    // Click handler
    el.addEventListener("click", () => {
      if (this.hoveredMesh) {
        const name = this.hoveredMesh.name;
        this.highlightPartByName(name);
        if (this.onPartClickCallback) this.onPartClickCallback(name);
      }
    });

    // Zoom
    el.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.lastUserInteractTime = performance.now();
        const zoomDelta = e.deltaY * 0.08;
        this.targetDistance = Math.max(30, Math.min(220, this.targetDistance + zoomDelta));
      },
      { passive: false }
    );

    // Touch Pinch
    el.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.initialPinchDist = Math.hypot(dx, dy);
      }
    });

    el.addEventListener("touchmove", (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        this.lastUserInteractTime = performance.now();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.hypot(dx, dy);
        const diff = this.initialPinchDist - currentDist;
        this.initialPinchDist = currentDist;
        this.targetDistance = Math.max(30, Math.min(220, this.targetDistance + diff * 0.3));
      }
    });

    window.addEventListener("resize", this.handleResize);
  }

  private performPicking(clientX: number, clientY: number): void {
    this.raycaster.setFromCamera(this.mouseVec, this.camera);
    const visibleMeshes = this.allInteractiveMeshes.filter((m) => m.parent && m.parent.visible);
    const intersects = this.raycaster.intersectObjects(visibleMeshes, false);

    if (intersects.length > 0) {
      const topHit = intersects[0].object as THREE.Mesh;
      if (this.hoveredMesh !== topHit) {
        if (this.hoveredMesh && this.hoveredMesh !== this.selectedMesh) {
          const m = this.hoveredMesh.material as THREE.MeshStandardMaterial;
          if (m.emissive) m.emissive.setHex(0x000000);
        }
        this.hoveredMesh = topHit;
        if (this.hoveredMesh !== this.selectedMesh) {
          const m = this.hoveredMesh.material as THREE.MeshStandardMaterial;
          if (m.emissive) m.emissive.setHex(0x221a00);
        }
      }
      this.renderer.domElement.style.cursor = "pointer";
      if (this.onPartHoverCallback) {
        this.onPartHoverCallback(topHit.name, clientX, clientY);
      }
    } else {
      if (this.hoveredMesh) {
        if (this.hoveredMesh !== this.selectedMesh) {
          const m = this.hoveredMesh.material as THREE.MeshStandardMaterial;
          if (m.emissive) m.emissive.setHex(0x000000);
        }
        this.hoveredMesh = null;
      }
      this.renderer.domElement.style.cursor = "grab";
      if (this.onPartHoverCallback) {
        this.onPartHoverCallback(null, 0, 0);
      }
    }
  }

  private handleResize = (): void => {
    if (!this.container || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private updateCameraPosition(): void {
    const sinPhi = Math.sin(this.cameraPhi);
    const cosPhi = Math.cos(this.cameraPhi);
    const sinTheta = Math.sin(this.cameraTheta);
    const cosTheta = Math.cos(this.cameraTheta);

    this.camera.position.x = this.target.x + this.cameraDistance * sinPhi * sinTheta;
    this.camera.position.y = this.target.y + this.cameraDistance * cosPhi;
    this.camera.position.z = this.target.z + this.cameraDistance * sinPhi * cosTheta;

    this.camera.lookAt(this.target);
  }

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const isIdle = !this.isPointerDown && now - this.lastUserInteractTime > 1200;

    // HeyClicky-style Resting Sway (CANVAS_3D_CUT_SWAY)
    // Sinusoidal yaw sway maintains 3D depth perception even when resting
    let currentTargetTheta = this.targetTheta;
    if (isIdle) {
      currentTargetTheta += Math.sin(now * 0.0008) * 0.035;
    }

    const lerpSpeed = 0.08;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lerpSpeed;
    this.cameraPhi += (this.targetPhi - this.cameraPhi) * lerpSpeed;
    this.cameraTheta += (currentTargetTheta - this.cameraTheta) * lerpSpeed;

    this.updateCameraPosition();

    // Assembly animations
    for (let i = this.animatedMeshes.length - 1; i >= 0; i--) {
      const item = this.animatedMeshes[i];
      const elapsed = now - item.startTime;
      const t = Math.min(1, elapsed / item.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      item.mesh.position.y = item.startY + (item.targetY - item.startY) * ease;

      if (t >= 1) {
        item.mesh.position.y = item.targetY;
        this.animatedMeshes.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  public destroy(): void {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
    }
    window.removeEventListener("resize", this.handleResize);
    if (this.renderer && this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      this.renderer.dispose();
    }
  }
}
