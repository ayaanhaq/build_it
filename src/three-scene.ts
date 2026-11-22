import * as THREE from "three";
import { DESK_BUILD_STEPS } from "./deskData";

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
  onStepChange?: (step: number) => void;
  onPartHover?: (partName: string | null, screenX: number, screenY: number) => void;
  onPartClick?: (partName: string) => void;
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
    this.buildDeskModel();

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

  private buildDeskModel(): void {
    const oakWoodMat = this.createPbrMaterial(REAL_TONES.tan, 0.38, 0.04);
    const brassMat = this.createPbrMaterial(REAL_TONES.sun, 0.22, 0.88);
    const darkSteelMat = this.createPbrMaterial(REAL_TONES.ink, 0.42, 0.82);
    const walnutMat = this.createPbrMaterial(REAL_TONES.brown, 0.42, 0.05);

    const registerMesh = (mesh: THREE.Mesh, name: string, group: THREE.Group) => {
      mesh.name = name;
      mesh.userData = { partName: name };
      this.addInkOutlines(mesh);
      group.add(mesh);
      this.allInteractiveMeshes.push(mesh);
      this.partMeshes.set(name, mesh);
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
    this.currentStep = Math.max(1, Math.min(step, DESK_BUILD_STEPS.length));

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

    const stepConfig = DESK_BUILD_STEPS[this.currentStep - 1];
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
