/**
 * Builders Archive — Traditional Web Tech Stack
 * Multi-Session Chat Sidebar · 3D Desk Assembly · Right-Side Parts Callout Widget
 */

(function () {
  'use strict';

  // 6-Step Desk Build Dataset
  const DESK_STEPS = [
    {
      stepNumber: 1,
      title: "Stand the 4 Heavy-Duty Legs",
      subtitle: "Base Foundation · 4× Legs + Leveling Feet",
      description: "Stand the four solid oak legs on your workspace. Screw the rubberized leveling glides into the pre-threaded inserts at the bottom of each leg.",
      tip: "Make sure all four leveling glides are turned in completely before building upward.",
      parts: [
        { name: "Solid Oak Leg Posts", qty: "4×", dim: "720 × 55 × 55 mm", color: "#b08552", mat: "Kiln-dried White Oak" },
        { name: "Brass Leveling Glides", qty: "4×", dim: "Ø30 × 20 mm", color: "#d4af37", mat: "Rubberized Brass" }
      ],
      cam: { dist: 90, phi: 1.1, theta: 0.6 }
    },
    {
      stepNumber: 2,
      title: "Assemble Side Apron Frames",
      subtitle: "Side Assembly · Left & Right Side Rails",
      description: "Bridge each pair of front and rear legs with the side apron rails. Insert the wooden dowels and tighten the internal steel cam fasteners.",
      tip: "Check for a 90° square angle against the floor before fully torquing the fasteners.",
      parts: [
        { name: "Side Apron Rails", qty: "2×", dim: "440 × 80 × 28 mm", color: "#c29660", mat: "Solid White Oak" },
        { name: "Fluted Hardwood Dowels", qty: "8×", dim: "Ø10 × 40 mm", color: "#dfba89", mat: "Compressed Beech" }
      ],
      cam: { dist: 85, phi: 1.0, theta: 1.2 }
    },
    {
      stepNumber: 3,
      title: "Install Main Spine & Stretchers",
      subtitle: "Chassis Rigidification · Front & Rear Beams",
      description: "Connect the left and right side frames using the front and rear longitudinal stretchers, reinforced with steel corner gusset brackets.",
      tip: "This sub-frame gives the desk immense rigidity and prevents lateral racking.",
      parts: [
        { name: "Longitudinal Stretchers", qty: "2×", dim: "840 × 75 × 28 mm", color: "#b98c56", mat: "Solid White Oak" },
        { name: "Steel Corner Gussets", qty: "4×", dim: "60 × 60 × 3 mm", color: "#2b2c30", mat: "Matte Black Carbon Steel" }
      ],
      cam: { dist: 95, phi: 0.9, theta: 0.8 }
    },
    {
      stepNumber: 4,
      title: "Mount the Solid Wood Desktop",
      subtitle: "Tabletop Installation · Seamless Surface",
      description: "Lower the solid oak desktop slab onto the assembled base. Fasten from beneath using the slotted expansion clips that allow natural wood movement.",
      tip: "Always tighten fasteners from underneath using figure-eight fasteners or slotted clips.",
      parts: [
        { name: "Solid Oak Desktop Surface", qty: "1×", dim: "1200 × 700 × 35 mm", color: "#d0a169", mat: "Edge-Glued White Oak" },
        { name: "Tabletop Expansion Clips", qty: "8×", dim: "35 × 18 mm", color: "#8a9199", mat: "Zinc Plated Steel" }
      ],
      cam: { dist: 105, phi: 0.8, theta: 0.5 }
    },
    {
      stepNumber: 5,
      title: "Attach Under-Desk Drawer Module",
      subtitle: "Storage Unit · Ball-Bearing Slides & Casing",
      description: "Fasten the suspended drawer chassis under the right side of the desk. Insert the dovetailed drawer box onto the smooth ball-bearing runners.",
      tip: "Test drawer extension and ensure smooth glide action before installing hardware.",
      parts: [
        { name: "Drawer Enclosure Housing", qty: "1×", dim: "340 × 420 × 120 mm", color: "#9c7241", mat: "Solid Oak & Veneer" },
        { name: "Dovetailed Drawer Box", qty: "1×", dim: "300 × 390 × 90 mm", color: "#6b4929", mat: "Walnut Core" },
        { name: "Anodized Pull Handle", qty: "1×", dim: "120 × 15 × 12 mm", color: "#1e1e1e", mat: "Matte Black Aluminum" }
      ],
      cam: { dist: 80, phi: 1.1, theta: 0.35 }
    },
    {
      stepNumber: 6,
      title: "Cable Tray & Final Polish",
      subtitle: "Complete Build · Cable Raceway & Desk Mat",
      description: "Snap the rear steel wire management raceway underneath the rear apron. Place the full-grain leather desk pad. Your desk is now fully assembled!",
      tip: "Use the rear wire tray to route monitor power and peripherals invisibly.",
      parts: [
        { name: "Under-Desk Cable Raceway", qty: "1×", dim: "700 × 100 × 60 mm", color: "#222326", mat: "Powder-Coated Steel" },
        { name: "Full-Grain Leather Desk Pad", qty: "1×", dim: "800 × 400 × 3 mm", color: "#1c1c1e", mat: "Charcoal Leatherette" }
      ],
      cam: { dist: 100, phi: 0.85, theta: 0.7 }
    }
  ];

  // 3D Desk Viewer Class
  class DeskViewer3D {
    constructor(canvasContainer) {
      this.container = canvasContainer;
      this.currentStep = 1;
      this.stepGroups = new Map();
      this.animatedItems = [];

      this.target = new THREE.Vector3(0, 18, 0);
      this.dist = 95;
      this.phi = 1.05;
      this.theta = 0.75;
      this.targetDist = 95;
      this.targetPhi = 1.05;
      this.targetTheta = 0.75;
      this.autoRotate = false;

      this.isPointerDown = false;
      this.pointerMode = 'rotate';
      this.prevPointer = { x: 0, y: 0 };
      this.pinchDist = 0;

      this.init();
    }

    init() {
      const w = this.container.clientWidth || 800;
      const h = this.container.clientHeight || 500;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0a0a0c);

      this.camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 1000);
      this.updateCam();

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.container.appendChild(this.renderer.domElement);

      const ambient = new THREE.AmbientLight(0xffffff, 0.65);
      this.scene.add(ambient);

      const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.3);
      keyLight.position.set(40, 70, 50);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.bias = -0.001;
      this.scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xdde8ff, 0.6);
      fillLight.position.set(-50, 40, -40);
      this.scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xffeedd, 0.8);
      rimLight.position.set(0, 30, -60);
      this.scene.add(rimLight);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(300, 300),
        new THREE.ShadowMaterial({ opacity: 0.35 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);

      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(60, 62, 0.4, 48),
        new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, metalness: 0.1 })
      );
      platform.position.y = -0.2;
      platform.receiveShadow = true;
      this.scene.add(platform);

      const grid = new THREE.GridHelper(100, 20, 0x2a2a30, 0x18181c);
      grid.position.y = 0.01;
      this.scene.add(grid);

      this.buildGeometry();
      this.bindControls();

      this.setStep(1, false);
      this.loop = this.loop.bind(this);
      this.loop();
    }

    buildGeometry() {
      const oak = new THREE.MeshStandardMaterial({ color: 0xc49662, roughness: 0.35, metalness: 0.05 });
      const brass = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.2, metalness: 0.85 });
      const steel = new THREE.MeshStandardMaterial({ color: 0x242528, roughness: 0.4, metalness: 0.85 });
      const walnut = new THREE.MeshStandardMaterial({ color: 0x6b4929, roughness: 0.4, metalness: 0.05 });

      // Step 1: Legs
      const g1 = new THREE.Group();
      const lx = 35, lz = 18, lh = 32, lt = 2.4;
      const legGeo = new THREE.BoxGeometry(lt, lh, lt);
      const glideGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.8, 16);

      [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(legGeo, oak);
        leg.position.set(x, lh / 2 + 0.8, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        g1.add(leg);

        const glide = new THREE.Mesh(glideGeo, brass);
        glide.position.set(x, 0.4, z);
        glide.castShadow = true;
        g1.add(glide);
      });
      this.stepGroups.set(1, g1);
      this.scene.add(g1);

      // Step 2: Side Aprons
      const g2 = new THREE.Group();
      const sideApronGeo = new THREE.BoxGeometry(1.6, 4.0, lz * 2 - lt);
      const leftApron = new THREE.Mesh(sideApronGeo, oak);
      leftApron.position.set(-lx, lh - 2 + 0.8, 0);
      leftApron.castShadow = true;
      g2.add(leftApron);

      const rightApron = new THREE.Mesh(sideApronGeo, oak);
      rightApron.position.set(lx, lh - 2 + 0.8, 0);
      rightApron.castShadow = true;
      g2.add(rightApron);
      this.stepGroups.set(2, g2);
      this.scene.add(g2);

      // Step 3: Main Stretchers & Brackets
      const g3 = new THREE.Group();
      const frontBackGeo = new THREE.BoxGeometry(lx * 2 - lt, 4.0, 1.6);
      const rear = new THREE.Mesh(frontBackGeo, oak);
      rear.position.set(0, lh - 2 + 0.8, -lz);
      rear.castShadow = true;
      g3.add(rear);

      const front = new THREE.Mesh(frontBackGeo, oak);
      front.position.set(0, lh - 2 + 0.8, lz);
      front.castShadow = true;
      g3.add(front);

      const brkGeo = new THREE.BoxGeometry(2.5, 2.5, 0.4);
      [[-lx + 2.5, lh - 2, lz - 1.2], [lx - 2.5, lh - 2, lz - 1.2], [-lx + 2.5, lh - 2, -lz + 1.2], [lx - 2.5, lh - 2, -lz + 1.2]].forEach(([bx, by, bz]) => {
        const b = new THREE.Mesh(brkGeo, steel);
        b.position.set(bx, by, bz);
        g3.add(b);
      });
      this.stepGroups.set(3, g3);
      this.scene.add(g3);

      // Step 4: Desktop Slab
      const g4 = new THREE.Group();
      const desktopGeo = new THREE.BoxGeometry(84, 2.0, 46);
      const deskTop = new THREE.Mesh(desktopGeo, new THREE.MeshStandardMaterial({ color: 0xd2a46c, roughness: 0.3, metalness: 0.05 }));
      deskTop.position.set(0, lh + 1.8, 0);
      deskTop.castShadow = true;
      deskTop.receiveShadow = true;
      g4.add(deskTop);
      this.stepGroups.set(4, g4);
      this.scene.add(g4);

      // Step 5: Drawer Unit
      const g5 = new THREE.Group();
      const casing = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 26), oak);
      casing.position.set(lx - 11, lh - 3 + 0.8, 2);
      casing.castShadow = true;
      g5.add(casing);

      const drawer = new THREE.Mesh(new THREE.BoxGeometry(14.8, 4.8, 1), walnut);
      drawer.position.set(lx - 11, lh - 3 + 0.8, 15.2);
      drawer.castShadow = true;
      g5.add(drawer);

      const handle = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 0.8), steel);
      handle.position.set(lx - 11, lh - 3 + 0.8, 16.1);
      g5.add(handle);
      this.stepGroups.set(5, g5);
      this.scene.add(g5);

      // Step 6: Tray & Accessories
      const g6 = new THREE.Group();
      const tray = new THREE.Mesh(new THREE.BoxGeometry(42, 3, 5), steel);
      tray.position.set(-6, lh - 4 + 0.8, -lz + 4);
      tray.castShadow = true;
      g6.add(tray);

      const pad = new THREE.Mesh(new THREE.BoxGeometry(44, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.85, metalness: 0.1 }));
      pad.position.set(-4, lh + 2.9, 2);
      g6.add(pad);

      const book = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 13), new THREE.MeshStandardMaterial({ color: 0x8a3324, roughness: 0.6 }));
      book.position.set(10, lh + 3.1, 2);
      book.rotation.y = -0.15;
      g6.add(book);
      this.stepGroups.set(6, g6);
      this.scene.add(g6);
    }

    setStep(step, animate = true) {
      this.currentStep = Math.max(1, Math.min(step, DESK_STEPS.length));

      this.stepGroups.forEach((g, num) => {
        if (num <= this.currentStep) {
          g.visible = true;
          if (num === this.currentStep && animate) {
            g.position.y = 14;
            this.animatedItems.push({
              mesh: g,
              targetY: 0,
              startY: 14,
              start: performance.now(),
              duration: 600
            });
          } else {
            g.position.y = 0;
          }
        } else {
          g.visible = false;
          g.position.y = 0;
        }
      });

      const conf = DESK_STEPS[this.currentStep - 1];
      if (conf && conf.cam) {
        this.targetDist = conf.cam.dist;
        this.targetPhi = conf.cam.phi;
        this.targetTheta = conf.cam.theta;
      }
    }

    setPreset(name) {
      if (name === 'iso') {
        this.targetDist = 95; this.targetPhi = 1.05; this.targetTheta = 0.75;
      } else if (name === 'front') {
        this.targetDist = 88; this.targetPhi = Math.PI / 2 - 0.1; this.targetTheta = 0;
      } else if (name === 'top') {
        this.targetDist = 110; this.targetPhi = 0.05; this.targetTheta = 0;
      } else if (name === 'side') {
        this.targetDist = 88; this.targetPhi = Math.PI / 2 - 0.1; this.targetTheta = Math.PI / 2;
      }
      this.target.set(0, 18, 0);
    }

    toggleAutoRotate() {
      this.autoRotate = !this.autoRotate;
      return this.autoRotate;
    }

    bindControls() {
      const el = this.renderer.domElement;

      el.addEventListener('pointerdown', (e) => {
        this.isPointerDown = true;
        this.pointerMode = e.button === 2 ? 'pan' : 'rotate';
        this.prevPointer = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', (e) => {
        if (!this.isPointerDown) return;
        const dx = e.clientX - this.prevPointer.x;
        const dy = e.clientY - this.prevPointer.y;
        this.prevPointer = { x: e.clientX, y: e.clientY };

        if (this.pointerMode === 'rotate') {
          this.theta -= dx * 0.008;
          this.targetTheta = this.theta;
          this.phi -= dy * 0.008;
          this.phi = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, this.phi));
          this.targetPhi = this.phi;
        } else {
          const factor = this.dist * 0.0012;
          this.target.x -= (Math.cos(this.theta) * dx - Math.sin(this.theta) * dy) * factor;
          this.target.y += dy * factor;
        }
      });

      const onUp = (e) => {
        this.isPointerDown = false;
        try { el.releasePointerCapture(e.pointerId); } catch(err) {}
      };
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('contextmenu', (e) => e.preventDefault());

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.targetDist = Math.max(30, Math.min(220, this.targetDist + e.deltaY * 0.08));
      }, { passive: false });

      // Pinch zoom
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          this.pinchDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
        }
      });

      el.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const d = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          const diff = this.pinchDist - d;
          this.pinchDist = d;
          this.targetDist = Math.max(30, Math.min(220, this.targetDist + diff * 0.3));
        }
      });

      window.addEventListener('resize', () => {
        if (!this.container || !this.renderer) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      });
    }

    updateCam() {
      const sPhi = Math.sin(this.phi);
      const cPhi = Math.cos(this.phi);
      const sThe = Math.sin(this.theta);
      const cThe = Math.cos(this.theta);

      this.camera.position.x = this.target.x + this.dist * sPhi * sThe;
      this.camera.position.y = this.target.y + this.dist * cPhi;
      this.camera.position.z = this.target.z + this.dist * sPhi * cThe;
      this.camera.lookAt(this.target);
    }

    loop() {
      requestAnimationFrame(this.loop);

      this.dist += (this.targetDist - this.dist) * 0.08;
      this.phi += (this.targetPhi - this.phi) * 0.08;
      if (this.autoRotate && !this.isPointerDown) {
        this.targetTheta += 0.004;
      }
      this.theta += (this.targetTheta - this.theta) * 0.08;
      this.updateCam();

      const now = performance.now();
      for (let i = this.animatedItems.length - 1; i >= 0; i--) {
        const item = this.animatedItems[i];
        const t = Math.min(1, (now - item.start) / item.duration);
        const ease = 1 - Math.pow(1 - t, 3);
        item.mesh.position.y = item.startY + (item.targetY - item.startY) * ease;
        if (t >= 1) {
          item.mesh.position.y = item.targetY;
          this.animatedItems.splice(i, 1);
        }
      }

      this.renderer.render(this.scene, this.camera);
    }
  }

  // --- Session & Sidebar State Management ---
  let chatSessions = [
    {
      id: "session-1",
      title: "Executive Oak Desk",
      preview: "Hey I want to build a desk",
      timestamp: "Today",
      has3D: true,
      currentStep: 1,
      messages: [
        { sender: "user", text: "Hey I want to build a desk" },
        { sender: "assistant", text: "Here is your step-by-step 3D assembly manual for the Modern Solid Oak Desk (1200 × 700 × 750 mm). The parts required for your current step are displayed in the Parts Callout widget on the right. You can click & drag to rotate 360°, scroll/pinch to zoom, and flip through each step like a Lego manual." }
      ]
    }
  ];

  let activeSessionId = "session-1";
  let deskViewerInstance = null;
  let currentStepIndex = 1;
  let sidebarOpen = true;
  let rightWidgetOpen = true;

  // Render Sidebar Chats
  function renderSidebarSessions() {
    const listEl = document.getElementById('chatSessionsList');
    const countEl = document.getElementById('chatCountDisplay');
    if (!listEl) return;

    if (countEl) countEl.textContent = chatSessions.length;

    if (chatSessions.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 24px 12px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 16px; color: #6b7280; font-size: 12px;">
          <p style="margin: 0;">No chat history yet.</p>
          <p style="margin: 4px 0 0 0; font-size: 10px; color: #4b5563;">Start by asking for a build!</p>
        </div>
      `;
      return;
    }

    let html = '';
    chatSessions.forEach((s) => {
      const isActive = s.id === activeSessionId;
      html += `
        <div class="chat-item ${isActive ? 'active' : ''}" data-id="${s.id}">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; overflow: hidden;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isActive ? '#f59e0b' : '#6b7280'}" stroke-width="2" style="flex-shrink: 0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${s.title}</div>
              <div style="font-size: 10px; color: #6b7280; font-family: monospace;">${s.timestamp}</div>
            </div>
          </div>
          <button type="button" class="delete-btn" data-delete-id="${s.id}" title="Delete Chat">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
    });
    listEl.innerHTML = html;
  }

  // Render Right Parts Callout Widget
  function renderRightPartsWidget(step) {
    const widgetEl = document.getElementById('rightPartsWidget');
    const partsListEl = document.getElementById('rightPartsList');
    const badgeEl = document.getElementById('rightStepBadge');
    const titleEl = document.getElementById('rightStepTitle');
    const descEl = document.getElementById('rightStepDesc');
    const tipEl = document.getElementById('rightTipDisplay');
    const progressEl = document.getElementById('rightProgressBar');
    const progressTextEl = document.getElementById('rightProgressText');

    if (!widgetEl) return;

    const percent = Math.round((step.stepNumber / DESK_STEPS.length) * 100);
    if (badgeEl) badgeEl.textContent = `STEP ${step.stepNumber}`;
    if (progressEl) progressEl.style.width = `${percent}%`;
    if (progressTextEl) progressTextEl.textContent = `${percent}% Complete`;
    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.description;

    if (tipEl) {
      if (step.tip) {
        tipEl.innerHTML = `
          <div style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 10px; font-size: 11px; color: #d1d5db; display: flex; gap: 8px; align-items: flex-start;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" style="flex-shrink: 0; margin-top: 1px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            <div>
              <strong style="color: #f59e0b; display: block; margin-bottom: 2px;">Assembly Tip</strong>
              ${step.tip}
            </div>
          </div>
        `;
      } else {
        tipEl.innerHTML = '';
      }
    }

    if (partsListEl) {
      let partsHtml = '';
      step.parts.forEach((p) => {
        partsHtml += `
          <div class="lego-part-item">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <span class="qty-badge">${p.qty}</span>
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <p style="font-size: 12px; font-weight: 600; color: #ffffff; margin: 0;">${p.name}</p>
                <p style="font-size: 10px; color: #9ca3af; font-family: monospace; margin: 0;">${p.dim}</p>
              </div>
            </div>
            <span style="width: 14px; height: 14px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.3); background-color: ${p.color}; flex-shrink: 0;" title="${p.mat}"></span>
          </div>
        `;
      });
      partsListEl.innerHTML = partsHtml;
    }
  }

  function updateStepUI(stepNum) {
    currentStepIndex = stepNum;
    if (deskViewerInstance) {
      deskViewerInstance.setStep(stepNum);
    }

    const stepData = DESK_STEPS[stepNum - 1];
    renderRightPartsWidget(stepData);

    // Update bottom controller
    const titleEl = document.getElementById('stepTitleDisplay');
    const descEl = document.getElementById('stepDescDisplay');
    const counterEl = document.getElementById('stepCounterDisplay');
    const prevBtn = document.getElementById('btnStepPrev');
    const nextBtn = document.getElementById('btnStepNext');

    if (titleEl) titleEl.textContent = stepData.title;
    if (descEl) descEl.textContent = stepData.description;
    if (counterEl) counterEl.textContent = `Step ${stepNum} of ${DESK_STEPS.length}`;

    if (prevBtn) prevBtn.disabled = (stepNum === 1);
    if (nextBtn) {
      if (stepNum < DESK_STEPS.length) {
        nextBtn.innerHTML = `Next Step <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>`;
      } else {
        nextBtn.innerHTML = `Replay Build <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
      }
    }

    // Step pills
    const pillsContainer = document.getElementById('stepPillsRow');
    if (pillsContainer) {
      const pills = pillsContainer.querySelectorAll('.step-pill-btn');
      pills.forEach((btn, idx) => {
        const num = idx + 1;
        btn.className = `step-pill-btn ${num === stepNum ? 'active' : (num < stepNum ? 'completed' : '')}`;
      });
    }

    // Jump step buttons on right widget
    const jumpGrid = document.getElementById('rightJumpGrid');
    if (jumpGrid) {
      const btns = jumpGrid.querySelectorAll('button');
      btns.forEach((b, idx) => {
        const n = idx + 1;
        b.style.backgroundColor = (n === stepNum) ? '#f59e0b' : (n < stepNum ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)');
        b.style.color = (n === stepNum) ? '#000000' : (n < stepNum ? '#ffffff' : '#6b7280');
      });
    }
  }

  function setupDeskViewer() {
    const canvasBox = document.getElementById('desk3DCanvas');
    if (!canvasBox || deskViewerInstance) return;

    deskViewerInstance = new DeskViewer3D(canvasBox);
    updateStepUI(1);

    // Preset buttons
    ['iso', 'front', 'top', 'side'].forEach((p) => {
      const btn = document.getElementById('preset-' + p);
      if (btn) btn.addEventListener('click', () => deskViewerInstance.setPreset(p));
    });

    const spinBtn = document.getElementById('btnToggleSpin');
    if (spinBtn) {
      spinBtn.addEventListener('click', () => {
        const active = deskViewerInstance.toggleAutoRotate();
        spinBtn.style.backgroundColor = active ? '#f59e0b' : 'transparent';
        spinBtn.style.color = active ? '#000000' : '#9ca3af';
      });
    }

    // Prev / Next
    const prevBtn = document.getElementById('btnStepPrev');
    const nextBtn = document.getElementById('btnStepNext');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentStepIndex > 1) updateStepUI(currentStepIndex - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentStepIndex < DESK_STEPS.length) {
          updateStepUI(currentStepIndex + 1);
        } else {
          updateStepUI(1);
        }
      });
    }

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      const chatSection = document.getElementById('chatViewSection');
      if (chatSection && chatSection.style.display !== 'none') {
        if (e.key === 'ArrowRight') {
          if (currentStepIndex < DESK_STEPS.length) updateStepUI(currentStepIndex + 1);
        } else if (e.key === 'ArrowLeft') {
          if (currentStepIndex > 1) updateStepUI(currentStepIndex - 1);
        }
      }
    });

    // Step Pills
    const pillsContainer = document.getElementById('stepPillsRow');
    if (pillsContainer) {
      let pillsHtml = '';
      for (let i = 1; i <= DESK_STEPS.length; i++) {
        pillsHtml += `<button type="button" class="step-pill-btn ${i === 1 ? 'active' : ''}" data-step="${i}">Step ${i}</button>`;
      }
      pillsContainer.innerHTML = pillsHtml;

      pillsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.step-pill-btn');
        if (btn) {
          const s = parseInt(btn.getAttribute('data-step'), 10);
          updateStepUI(s);
        }
      });
    }

    // Right jump grid
    const jumpGrid = document.getElementById('rightJumpGrid');
    if (jumpGrid) {
      let jumpHtml = '';
      for (let i = 1; i <= DESK_STEPS.length; i++) {
        jumpHtml += `
          <button type="button" data-jump="${i}" style="height: 28px; border-radius: 8px; font-family: monospace; font-size: 12px; font-weight: 700; border: none; cursor: pointer; transition: all 0.15s ease; background-color: ${i === 1 ? '#f59e0b' : 'rgba(255,255,255,0.05)'}; color: ${i === 1 ? '#000000' : '#6b7280'};">
            ${i}
          </button>
        `;
      }
      jumpGrid.innerHTML = jumpHtml;
      jumpGrid.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) {
          const stepNum = parseInt(b.getAttribute('data-jump'), 10);
          updateStepUI(stepNum);
        }
      });
    }
  }

  function launchActiveChatView(query) {
    const landing = document.getElementById('landingViewSection');
    const chatView = document.getElementById('chatViewSection');
    const rightPanel = document.getElementById('rightPartsWidget');
    const mainContent = document.getElementById('mainContentArea');
    const userMsgText = document.getElementById('userMsgTextDisplay');
    const chatTitleDisplay = document.getElementById('chatTitleHeaderDisplay');

    if (landing) landing.style.display = 'none';
    if (chatView) chatView.style.display = 'flex';
    if (userMsgText) userMsgText.textContent = query || "Hey I want to build a desk";
    if (chatTitleDisplay) chatTitleDisplay.textContent = query ? (query.length > 28 ? query.substring(0, 28) + "..." : query) : "Executive Oak Desk";

    // Show Right Parts Callout Widget when message has been sent
    if (rightPanel) {
      rightPanel.classList.remove('collapsed');
      rightPanel.style.display = 'flex';
    }
    if (mainContent) {
      mainContent.classList.add('right-widget-open');
    }

    setTimeout(() => {
      setupDeskViewer();
      updateStepUI(currentStepIndex);
    }, 50);
  }

  function switchToNewChat() {
    activeSessionId = null;
    const landing = document.getElementById('landingViewSection');
    const chatView = document.getElementById('chatViewSection');
    const rightPanel = document.getElementById('rightPartsWidget');
    const mainContent = document.getElementById('mainContentArea');

    if (chatView) chatView.style.display = 'none';
    if (rightPanel) {
      rightPanel.style.display = 'none';
    }
    if (mainContent) {
      mainContent.classList.remove('right-widget-open');
    }
    if (landing) landing.style.display = 'flex';

    renderSidebarSessions();
  }

  function initApp() {
    renderSidebarSessions();

    // Sidebar Toggling
    const sidebar = document.getElementById('appSidebar');
    const toggleSidebarBtn = document.getElementById('btnToggleSidebar');
    const closeSidebarBtn = document.getElementById('btnCloseSidebar');
    const mainContent = document.getElementById('mainContentArea');

    function toggleSidebar() {
      sidebarOpen = !sidebarOpen;
      if (sidebar) sidebar.classList.toggle('collapsed', !sidebarOpen);
      if (mainContent) mainContent.classList.toggle('sidebar-closed', !sidebarOpen);
    }

    if (toggleSidebarBtn) toggleSidebarBtn.addEventListener('click', toggleSidebar);
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleSidebar);

    // Right Widget Toggling
    const rightPanel = document.getElementById('rightPartsWidget');
    const closeRightBtn = document.getElementById('btnCloseRightWidget');
    const openRightBtn = document.getElementById('btnOpenRightWidget');

    function toggleRightWidget() {
      rightWidgetOpen = !rightWidgetOpen;
      if (rightPanel) rightPanel.classList.toggle('collapsed', !rightWidgetOpen);
      if (mainContent) mainContent.classList.toggle('right-widget-open', rightWidgetOpen);
      if (openRightBtn) openRightBtn.style.display = rightWidgetOpen ? 'none' : 'flex';
    }

    if (closeRightBtn) closeRightBtn.addEventListener('click', toggleRightWidget);
    if (openRightBtn) openRightBtn.addEventListener('click', toggleRightWidget);

    // New Chat Button
    const newChatBtn = document.getElementById('btnNewChat');
    const topNewChatBtn = document.getElementById('topNewChatBtn');
    if (newChatBtn) newChatBtn.addEventListener('click', switchToNewChat);
    if (topNewChatBtn) topNewChatBtn.addEventListener('click', switchToNewChat);

    // Sessions list click delegation
    const sessionsList = document.getElementById('chatSessionsList');
    if (sessionsList) {
      sessionsList.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.delete-btn');
        if (delBtn) {
          e.stopPropagation();
          const delId = delBtn.getAttribute('data-delete-id');
          chatSessions = chatSessions.filter(s => s.id !== delId);
          if (activeSessionId === delId) {
            switchToNewChat();
          } else {
            renderSidebarSessions();
          }
          return;
        }

        const item = e.target.closest('.chat-item');
        if (item) {
          const sid = item.getAttribute('data-id');
          activeSessionId = sid;
          renderSidebarSessions();
          const sess = chatSessions.find(s => s.id === sid);
          if (sess) {
            launchActiveChatView(sess.preview);
          }
        }
      });
    }

    // Landing input
    const landingTextarea = document.getElementById('chatInputTextarea');
    const landingSendBtn = document.getElementById('chatSendBtn');
    const demoChip = document.getElementById('demoPromptChip');

    function handleSend() {
      if (!landingTextarea) return;
      const t = landingTextarea.value.trim();
      if (!t) return;
      console.log("Message sent:", t);

      // Create new session
      const newId = "session-" + Date.now();
      const newTitle = t.length > 24 ? t.substring(0, 24) + "..." : t;
      chatSessions.unshift({
        id: newId,
        title: /desk|build/i.test(t) ? "Modern Solid Oak Desk" : newTitle,
        preview: t,
        timestamp: "Just now",
        has3D: true,
        currentStep: 1,
        messages: [
          { sender: "user", text: t },
          { sender: "assistant", text: "Here is your 3D assembly manual. The parts required for each step are displayed in the Parts Callout widget on the right." }
        ]
      });
      activeSessionId = newId;
      renderSidebarSessions();

      landingTextarea.value = '';
      landingSendBtn.disabled = true;

      launchActiveChatView(t);
    }

    if (landingTextarea && landingSendBtn) {
      landingTextarea.addEventListener('input', function () {
        landingSendBtn.disabled = !this.value.trim();
      });
      landingTextarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
      landingSendBtn.addEventListener('click', handleSend);
    }

    if (demoChip) {
      demoChip.addEventListener('click', function () {
        landingTextarea.value = "Hey I want to build a desk";
        handleSend();
      });
    }

    // Pinned chat input
    const pinnedTextarea = document.getElementById('pinnedChatInputTextarea');
    const pinnedSendBtn = document.getElementById('pinnedChatSendBtn');
    if (pinnedTextarea && pinnedSendBtn) {
      pinnedTextarea.addEventListener('input', function () {
        pinnedSendBtn.disabled = !this.value.trim();
      });
      pinnedTextarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const txt = pinnedTextarea.value.trim();
          if (!txt) return;
          console.log("Message sent:", txt);
          pinnedTextarea.value = '';
          pinnedSendBtn.disabled = true;

          // Check if user requested a specific step e.g. "show step 3"
          const m = txt.match(/step\s*(\d)/i);
          if (m) updateStepUI(parseInt(m[1], 10));
        }
      });
      pinnedSendBtn.addEventListener('click', function () {
        const txt = pinnedTextarea.value.trim();
        if (!txt) return;
        console.log("Message sent:", txt);
        pinnedTextarea.value = '';
        pinnedSendBtn.disabled = true;
      });
    }

    // Start with demo session active
    launchActiveChatView("Hey I want to build a desk");
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
