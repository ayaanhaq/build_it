import * as THREE from "three";
import { DESK_BUILD_STEPS } from "./deskData";

export interface ThreeDeskViewerOptions {
  container: HTMLElement;
  initialStep?: number;
  onStepChange?: (step: number) => void;
}

export class ThreeDeskViewer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private animId: number | null = null;

  // Step state
  private currentStep: number = 1;
  private stepGroups: Map<number, THREE.Group> = new Map();
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

  // Spherical camera coordinates around target
  private target: THREE.Vector3 = new THREE.Vector3(0, 18, 0);
  private cameraDistance: number = 95;
  private cameraPhi: number = 1.05; // Elevation angle
  private cameraTheta: number = 0.75; // Azimuth angle

  // Camera lerp targets
  private targetDistance: number = 95;
  private targetPhi: number = 1.05;
  private targetTheta: number = 0.75;
  private autoRotate: boolean = false;

  constructor(options: ThreeDeskViewerOptions) {
    this.container = options.container;
    this.currentStep = options.initialStep || 1;

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

    // 4. Studio Lighting
    this.setupLighting();

    // 5. Ground Plane & Grid
    this.setupGround();

    // 6. Build 3D Desk Geometry for each step
    this.buildDeskModel();

    // 7. Event Listeners for Orbit, Zoom, Pan, Pinch
    this.setupInteraction();

    // 8. Start Render Loop
    this.setStep(this.currentStep, false);
    this.animate();
  }

  private setupLighting(): void {
    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);

    // Main Key light (casts soft shadows)
    const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.3);
    keyLight.position.set(40, 70, 50);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 180;
    keyLight.shadow.camera.left = -60;
    keyLight.shadow.camera.right = 60;
    keyLight.shadow.camera.top = 60;
    keyLight.shadow.camera.bottom = -60;
    keyLight.shadow.bias = -0.001;
    this.scene.add(keyLight);

    // Fill light (cool tone)
    const fillLight = new THREE.DirectionalLight(0xdde8ff, 0.6);
    fillLight.position.set(-50, 40, -40);
    this.scene.add(fillLight);

    // Rim light from rear-right
    const rimLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    rimLight.position.set(0, 30, -60);
    this.scene.add(rimLight);
  }

  private setupGround(): void {
    // Ground plane with shadow receiver
    const groundGeo = new THREE.PlaneGeometry(300, 300);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Subtle dark circular platform
    const platformGeo = new THREE.CylinderGeometry(60, 62, 0.4, 48);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x141416,
      roughness: 0.9,
      metalness: 0.1,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.2;
    platform.receiveShadow = true;
    this.scene.add(platform);

    // Subtle floor grid helper
    const grid = new THREE.GridHelper(100, 20, 0x2a2a30, 0x18181c);
    grid.position.y = 0.01;
    this.scene.add(grid);
  }

  private createWoodMaterial(colorHex: number, roughness: number = 0.4): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness,
      metalness: 0.05,
    });
  }

  private createMetalMaterial(colorHex: number, roughness: number = 0.25): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness,
      metalness: 0.85,
    });
  }

  private buildDeskModel(): void {
    const oakWoodMat = this.createWoodMaterial(0xc49662, 0.35);
    const brassMat = this.createMetalMaterial(0xd4af37, 0.2);
    const darkSteelMat = this.createMetalMaterial(0x242528, 0.4);
    const walnutMat = this.createWoodMaterial(0x6b4929, 0.4);

    // STEP 1: 4 Legs + Leveling Glides
    const group1 = new THREE.Group();
    const legX = 35;
    const legZ = 18;
    const legHeight = 32;
    const legThick = 2.4;

    const legGeo = new THREE.BoxGeometry(legThick, legHeight, legThick);
    const glideGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.8, 16);

    const legPositions = [
      [-legX, legZ],
      [legX, legZ],
      [-legX, -legZ],
      [legX, -legZ],
    ];

    legPositions.forEach(([x, z]) => {
      const legMesh = new THREE.Mesh(legGeo, oakWoodMat);
      legMesh.position.set(x, legHeight / 2 + 0.8, z);
      legMesh.castShadow = true;
      legMesh.receiveShadow = true;
      group1.add(legMesh);

      const glideMesh = new THREE.Mesh(glideGeo, brassMat);
      glideMesh.position.set(x, 0.4, z);
      glideMesh.castShadow = true;
      group1.add(glideMesh);
    });
    this.stepGroups.set(1, group1);
    this.scene.add(group1);

    // STEP 2: Side Aprons (Left & Right)
    const group2 = new THREE.Group();
    const sideApronLength = legZ * 2 - legThick;
    const apronHeight = 4.0;
    const apronThick = 1.6;

    const sideApronGeo = new THREE.BoxGeometry(apronThick, apronHeight, sideApronLength);

    const leftApron = new THREE.Mesh(sideApronGeo, oakWoodMat);
    leftApron.position.set(-legX, legHeight - apronHeight / 2 + 0.8, 0);
    leftApron.castShadow = true;
    leftApron.receiveShadow = true;
    group2.add(leftApron);

    const rightApron = new THREE.Mesh(sideApronGeo, oakWoodMat);
    rightApron.position.set(legX, legHeight - apronHeight / 2 + 0.8, 0);
    rightApron.castShadow = true;
    rightApron.receiveShadow = true;
    group2.add(rightApron);
    this.stepGroups.set(2, group2);
    this.scene.add(group2);

    // STEP 3: Main Spine Stretchers & Corner Gussets
    const group3 = new THREE.Group();
    const longStretcherLength = legX * 2 - legThick;
    const frontBackApronGeo = new THREE.BoxGeometry(longStretcherLength, apronHeight, apronThick);

    const rearStretcher = new THREE.Mesh(frontBackApronGeo, oakWoodMat);
    rearStretcher.position.set(0, legHeight - apronHeight / 2 + 0.8, -legZ);
    rearStretcher.castShadow = true;
    rearStretcher.receiveShadow = true;
    group3.add(rearStretcher);

    const frontStretcher = new THREE.Mesh(frontBackApronGeo, oakWoodMat);
    frontStretcher.position.set(0, legHeight - apronHeight / 2 + 0.8, legZ);
    frontStretcher.castShadow = true;
    frontStretcher.receiveShadow = true;
    group3.add(frontStretcher);

    // Corner brackets
    const bracketGeo = new THREE.BoxGeometry(2.5, 2.5, 0.4);
    const bracketPositions = [
      [-legX + 2.5, legHeight - 2, legZ - 1.2],
      [legX - 2.5, legHeight - 2, legZ - 1.2],
      [-legX + 2.5, legHeight - 2, -legZ + 1.2],
      [legX - 2.5, legHeight - 2, -legZ + 1.2],
    ];
    bracketPositions.forEach(([bx, by, bz]) => {
      const bMesh = new THREE.Mesh(bracketGeo, darkSteelMat);
      bMesh.position.set(bx, by, bz);
      group3.add(bMesh);
    });
    this.stepGroups.set(3, group3);
    this.scene.add(group3);

    // STEP 4: Solid Oak Desktop Slab
    const group4 = new THREE.Group();
    const topWidth = 84;
    const topDepth = 46;
    const topThick = 2.0;

    const desktopGeo = new THREE.BoxGeometry(topWidth, topThick, topDepth);
    const desktopMat = this.createWoodMaterial(0xd2a46c, 0.3);
    const desktopMesh = new THREE.Mesh(desktopGeo, desktopMat);
    desktopMesh.position.set(0, legHeight + topThick / 2 + 0.8, 0);
    desktopMesh.castShadow = true;
    desktopMesh.receiveShadow = true;
    group4.add(desktopMesh);

    // Subtle edge chamfer highlight trim
    const chamferGeo = new THREE.BoxGeometry(topWidth + 0.2, 0.2, topDepth + 0.2);
    const chamferMat = this.createWoodMaterial(0xdfba8a, 0.2);
    const chamferMesh = new THREE.Mesh(chamferGeo, chamferMat);
    chamferMesh.position.set(0, legHeight + topThick + 0.8, 0);
    group4.add(chamferMesh);

    this.stepGroups.set(4, group4);
    this.scene.add(group4);

    // STEP 5: Under-Desk Storage Drawer Module
    const group5 = new THREE.Group();
    const drawerCasingGeo = new THREE.BoxGeometry(16, 6, 26);
    const casingMat = this.createWoodMaterial(0x9e7343, 0.4);
    const casingMesh = new THREE.Mesh(drawerCasingGeo, casingMat);
    casingMesh.position.set(legX - 11, legHeight - 3 + 0.8, 2);
    casingMesh.castShadow = true;
    group5.add(casingMesh);

    // Drawer face
    const drawerFaceGeo = new THREE.BoxGeometry(14.8, 4.8, 1);
    const drawerFaceMesh = new THREE.Mesh(drawerFaceGeo, walnutMat);
    drawerFaceMesh.position.set(legX - 11, legHeight - 3 + 0.8, 15.2);
    drawerFaceMesh.castShadow = true;
    group5.add(drawerFaceMesh);

    // Matte black handle
    const handleGeo = new THREE.BoxGeometry(6, 0.6, 0.8);
    const handleMesh = new THREE.Mesh(handleGeo, darkSteelMat);
    handleMesh.position.set(legX - 11, legHeight - 3 + 0.8, 16.1);
    group5.add(handleMesh);

    this.stepGroups.set(5, group5);
    this.scene.add(group5);

    // STEP 6: Cable Management Tray, Leather Mat, and Final Polish
    const group6 = new THREE.Group();
    // Cable tray in rear
    const trayGeo = new THREE.BoxGeometry(42, 3, 5);
    const trayMat = this.createMetalMaterial(0x1a1b1d, 0.5);
    const trayMesh = new THREE.Mesh(trayGeo, trayMat);
    trayMesh.position.set(-6, legHeight - 4 + 0.8, -legZ + 4);
    trayMesh.castShadow = true;
    group6.add(trayMesh);

    // Desk Pad
    const padGeo = new THREE.BoxGeometry(44, 0.2, 24);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x1b1c1e,
      roughness: 0.85,
      metalness: 0.1,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(-4, legHeight + topThick + 0.9, 2);
    padMesh.receiveShadow = true;
    group6.add(padMesh);

    // Sleek notebook on pad
    const bookGeo = new THREE.BoxGeometry(9, 0.4, 13);
    const bookMat = this.createWoodMaterial(0x8a3324, 0.6);
    const bookMesh = new THREE.Mesh(bookGeo, bookMat);
    bookMesh.position.set(10, legHeight + topThick + 1.1, 2);
    bookMesh.rotation.y = -0.15;
    group6.add(bookMesh);

    this.stepGroups.set(6, group6);
    this.scene.add(group6);
  }

  public setStep(step: number, animateTransition: boolean = true): void {
    this.currentStep = Math.max(1, Math.min(step, DESK_BUILD_STEPS.length));

    // Update visibility and launch assembly animations
    this.stepGroups.forEach((group, stepNum) => {
      if (stepNum <= this.currentStep) {
        group.visible = true;

        if (stepNum === this.currentStep && animateTransition) {
          // Animate new step parts descending smoothly into place
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

    // Update camera angle to preset if specified
    const stepConfig = DESK_BUILD_STEPS[this.currentStep - 1];
    if (stepConfig && stepConfig.cameraPreset) {
      this.targetDistance = stepConfig.cameraPreset.distance;
      this.targetPhi = stepConfig.cameraPreset.phi;
      this.targetTheta = stepConfig.cameraPreset.theta;
    }
  }

  public nextStep(): void {
    if (this.currentStep < DESK_BUILD_STEPS.length) {
      this.setStep(this.currentStep + 1);
    }
  }

  public prevStep(): void {
    if (this.currentStep > 1) {
      this.setStep(this.currentStep - 1);
    }
  }

  public setPresetView(view: "isometric" | "front" | "top" | "side" | "reset"): void {
    switch (view) {
      case "isometric":
      case "reset":
        this.targetDistance = 95;
        this.targetPhi = 1.05;
        this.targetTheta = 0.75;
        this.target.set(0, 18, 0);
        break;
      case "front":
        this.targetDistance = 88;
        this.targetPhi = Math.PI / 2 - 0.1;
        this.targetTheta = 0;
        this.target.set(0, 18, 0);
        break;
      case "top":
        this.targetDistance = 110;
        this.targetPhi = 0.05;
        this.targetTheta = 0;
        this.target.set(0, 18, 0);
        break;
      case "side":
        this.targetDistance = 88;
        this.targetPhi = Math.PI / 2 - 0.1;
        this.targetTheta = Math.PI / 2;
        this.target.set(0, 18, 0);
        break;
    }
  }

  public toggleAutoRotate(): boolean {
    this.autoRotate = !this.autoRotate;
    return this.autoRotate;
  }

  private setupInteraction(): void {
    const el = this.renderer.domElement;

    // Pointer Down (Mouse or Touch)
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      this.isPointerDown = true;
      this.pointerMode = e.button === 2 ? "pan" : "rotate";
      this.previousPointerPos = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });

    // Pointer Move
    el.addEventListener("pointermove", (e: PointerEvent) => {
      if (!this.isPointerDown) return;

      const deltaX = e.clientX - this.previousPointerPos.x;
      const deltaY = e.clientY - this.previousPointerPos.y;
      this.previousPointerPos = { x: e.clientX, y: e.clientY };

      if (this.pointerMode === "rotate") {
        this.cameraTheta -= deltaX * 0.008;
        this.targetTheta = this.cameraTheta;

        this.cameraPhi -= deltaY * 0.008;
        // Clamp elevation angle to avoid gimbal flip
        this.cameraPhi = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, this.cameraPhi));
        this.targetPhi = this.cameraPhi;
      } else if (this.pointerMode === "pan") {
        const factor = this.cameraDistance * 0.0012;
        this.target.x -= (Math.cos(this.cameraTheta) * deltaX - Math.sin(this.cameraTheta) * deltaY) * factor;
        this.target.y += deltaY * factor;
      }
    });

    // Pointer Up
    const onPointerUp = (e: PointerEvent) => {
      this.isPointerDown = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if already released
      }
    };
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    // Context Menu prevent default for right-click pan
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    // Mouse Wheel Zoom
    el.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const zoomDelta = e.deltaY * 0.08;
        this.targetDistance = Math.max(30, Math.min(220, this.targetDistance + zoomDelta));
      },
      { passive: false }
    );

    // Touch Pinch-to-Zoom
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
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.hypot(dx, dy);
        const diff = this.initialPinchDist - currentDist;
        this.initialPinchDist = currentDist;
        this.targetDistance = Math.max(30, Math.min(220, this.targetDistance + diff * 0.3));
      }
    });

    // Window Resize
    window.addEventListener("resize", this.handleResize);
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

    // Smooth damping / interpolation for camera
    const lerpSpeed = 0.08;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lerpSpeed;
    this.cameraPhi += (this.targetPhi - this.cameraPhi) * lerpSpeed;

    if (this.autoRotate && !this.isPointerDown) {
      this.targetTheta += 0.004;
    }
    this.cameraTheta += (this.targetTheta - this.cameraTheta) * lerpSpeed;

    this.updateCameraPosition();

    // Assembly animations
    const now = performance.now();
    for (let i = this.animatedMeshes.length - 1; i >= 0; i--) {
      const item = this.animatedMeshes[i];
      const elapsed = now - item.startTime;
      const t = Math.min(1, elapsed / item.duration);
      // Ease out cubic
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
