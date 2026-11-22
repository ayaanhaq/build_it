# Builders Archive — Traditional Web Tech Stack

This directory contains the modernized **Builders Archive** frontend built with the traditional web design stack:
- **HTML5:** Semantic, accessible markup.
- **CSS3:** Custom styles adhering to Tailwind CSS conventions with smooth dark mode aesthetics.
- **TypeScript & JavaScript (ES6+):** Robust component design, type-checked with TypeScript and running cleanly in modern browsers.
- **Three.js:** Full 3D rendering stack with shadows, lighting, materials, and orbit controls.
- **React & Lucide:** `AIChatInput`, `DeskBuilderViewer`, and `LegoPartsCard` components with Lucide icons.

---

## Interactive 3D Desk Build Demo ("Lego Instruction Manual")

Ask the chatbot:
> **"Hey I want to build a desk"**

This triggers an interactive 3D assembly manual for a **Modern Solid Oak Desk (1200 × 700 × 750 mm)**:

1. **Step-by-Step Lego Manual Flipping:**
   - **Step 1:** Stand the 4 Heavy-Duty Legs (`720 × 55 × 55 mm`) and brass leveling feet glides.
   - **Step 2:** Assemble Side Apron Rails (`440 × 80 × 28 mm`) and hardwood dowels.
   - **Step 3:** Install Main Spine Longitudinal Stretchers (`840 × 75 × 28 mm`) & steel corner gussets.
   - **Step 4:** Mount the Solid Wood Desktop Slab (`1200 × 700 × 35 mm`) with slotted expansion clips.
   - **Step 5:** Slide in the modular Walnut Drawer Unit (`340 × 420 × 120 mm`) with anodized black handle.
   - **Step 6:** Attach the under-desk steel Cable Raceway Tray and leather desk pad.

2. **Lego-Style Parts Callout Card:**
   - Displays exact component quantities (`4×`, `2×`, `1×`), dimensions, materials, and color swatches for each active step.
   - Assembly pro-tips for each phase.

3. **3D Interactivity & Animations:**
   - **Assembly Animation:** Newly added parts smoothly descend into place from above when flipping to a step.
   - **Orbit Controls:** Click & drag (mouse or touch) to turn and spin the model 360°.
   - **Zoom:** Mouse wheel scroll or touch pinch to zoom in and out.
   - **Pan:** Right-click & drag or two-finger drag to pan the camera.
   - **Camera Presets:** Quick buttons for `Isometric`, `Front`, `Top Down`, and `Side` views.
   - **Auto-Spin:** Toggle auto-rotation to showcase the assembled desk.
   - **Keyboard Navigation:** Use `Left` / `Right` arrow keys to flip steps.

---

## Tech Stack Overview

1. **Standalone Traditional Web Stack (`frontend/`):**
   - `frontend/index.html`: Entry point running directly in any browser or HTTP server without requiring a build step.
   - `frontend/css/styles.css`: Pure CSS definitions for all styling classes.
   - `frontend/js/app.js`: Event handling, 3D desk geometry, assembly animations, and Three.js orbit controls.

2. **TypeScript & React Source (`src/`):**
   - `src/AIChatInput.tsx`: Chat input component with Lucide icons and Enter/Send logic.
   - `src/App.tsx`: App wrapper orchestrating conversation and the 3D Lego manual.
   - `src/DeskBuilderViewer.tsx`: 3D viewer container with step controls and view presets.
   - `src/LegoPartsCard.tsx`: Floating Lego-style parts callout card.
   - `src/three-scene.ts`: ThreeDeskViewer engine with Three.js rendering and camera controls.
   - `src/deskData.ts`: 6-step dataset with parts specifications and camera angles.
   - `src/types.ts`: TypeScript data models.

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
