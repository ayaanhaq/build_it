# Builders Archive — Traditional Web Tech Stack

This directory contains the modernized **Builders Archive** frontend built with the traditional web design stack:
- **HTML5:** Semantic, accessible markup.
- **CSS3:** Custom styles adhering to Tailwind CSS conventions with smooth dark mode aesthetics.
- **TypeScript & JavaScript (ES6+):** Robust component design, type-checked with TypeScript and running cleanly in modern browsers.
- **Three.js:** Full 3D rendering stack with studio lighting, materials, and orbit controls.
- **React & Lucide:** `AIChatInput`, `DeskBuilderViewer`, `Sidebar`, and `RightPartsWidget` components with Lucide icons.

---

## 3-Column Layout Architecture

1. **Left Sidebar (Chat History):**
   - Keeps track of all chats created so far.
   - Includes **"+ New Chat"** button to start a fresh prompt session anytime.
   - Highlights active conversation and allows selecting past sessions or deleting them.
   - Collapsible with the top-left sidebar toggle button.

2. **Center Workspace (Main Canvas & Chat Stream):**
   - Clean, center-aligned `AIChatInput` component with Enter/Send and multi-line support on pure black background.
   - Full 3D assembly viewport powered by HeyClicky-style technical rendering:
     - **Pass 1:** Raycast picking and hover glow.
     - **Pass 2:** Technical ink outlines (`THREE.EdgesGeometry`).
     - **Pass 5 & 6:** Studio 3-point lighting and soft contact shadow dais.
     - **Pass 8:** Analytical 2D leader callout capsule tracking parts in real time.
     - **Resting Sway (`CANVAS_3D_CUT_SWAY`):** Subtle sinusoidal yaw sway during idle.
     - Click & drag to rotate 360°, scroll/pinch to zoom, right-click to pan.
   - Single-line step counter (`Step 1 of 6`) and Lego-style Previous/Next navigation controller.

3. **Right Parts Callout Widget (Bill of Materials):**
   - Automatically activates on the right side of the screen when a message is sent in chat.
   - Displays:
     - Active step progress bar and percentage.
     - Required components bill of materials (quantity pills, dimensions, materials, color swatches).
     - Practical assembly pro-tips for each phase.
     - Quick "Jump to Step" selector.
     - **Bidirectional Selection:** Clicking or hovering a component row in the widget highlights the matching 3D mesh in the viewport, and clicking a 3D part highlights its entry in the widget.

---

## HeyClicky Multi-Pass Rendering Engine

The 3D engine is architected around HeyClicky's technical illustration pipeline:
- **`REAL_TONES` Palette:** Non-candy physical tones (`ink`, `tan`, `brown`, `sun`, `steel`, `leather`, `cream`, `coral`).
- **Technical Ink Outlines (Pass 2):** High-precision edge contours overlaid on meshes via `THREE.EdgesGeometry` (`color: REAL_TONES.ink`, `linewidth: 1.5`).
- **Interactive Picking (Pass 1):** GPU-level raycasting against interactive component meshes with hover emissive highlights.
- **Analytical 2D Leader Callouts (Pass 8):** Screen-projected callout capsule badge with a pulsing indicator dot and directional pointer arrow.
- **Resting Sway:** Idle camera yaw sway to maintain 3D depth perception.

---

## How to Expand to New 3D Builds

To add new builds (e.g., Bookcase, Chair, Electronics Workbench):

1. **Define the Steps Dataset:**
   Add steps conforming to `BuildStep` (in `src/types.ts` or `frontend/js/app.js`):
   ```javascript
   {
     stepNumber: 1,
     title: "Step Title",
     subtitle: "Step Subtitle",
     description: "Instruction text...",
     tip: "Pro assembly tip...",
     parts: [{ name: "Part Name", qty: "2×", dim: "100x50mm", color: "#B9946F", mat: "Oak" }],
     cam: { dist: 95, phi: 1.05, theta: 0.75 }
   }
   ```
2. **Build Procedural Meshes:**
   Create geometry with Three.js primitives (`BoxGeometry`, `CylinderGeometry`).
3. **Register Meshes:**
   Call `registerMesh(mesh, specificName, categoryName, stepGroup)`:
   - Sets `mesh.name` and `mesh.userData.category`.
   - Attaches `addInkOutlines(mesh)`.
   - Adds mesh to `allInteractiveMeshes` for raycasting.
4. **Trigger Build in Chat:**
   In chat send handler, match prompt keywords (e.g. `"chair"`, `"shelf"`) to activate that model and step dataset.

---

## How to Run

### Option 1: Open Directly in Browser
Open `frontend/index.html` (or root `index.html`) directly in any web browser (`Chrome`, `Firefox`, `Safari`, `Edge`).

### Option 2: Using Python HTTP Server
```bash
python -m http.server -d frontend 8000
```
Then visit `http://localhost:8000`.

### Option 3: Using Vite / NPM
```bash
npm install
npm run dev
```
For production build:
```bash
npm run build
```
