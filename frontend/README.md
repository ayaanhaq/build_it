# Builders Archive — Traditional Web Tech Stack

This directory contains the production-grade rebuild of **Builders Archive** using the traditional web tech stack (HTML5, CSS3, and vanilla ES6+ JavaScript).

## Tech Stack Overview

- **HTML5:** Clean, semantic structure (`<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`) with full ARIA accessibility and zero proprietary design-tool tags.
- **CSS3:**
  - CSS Custom Properties (`--paper`, `--panel`, `--pencil`, `--ink`) for live theme switching.
  - Hardware-accelerated 3D CSS transforms (`perspective: 1400px; transform-style: preserve-3d;`) for isometric 3D model rendering.
  - Dual-grid technical blueprint backgrounds (`120px` major grid, `24px` minor grid).
  - Responsive layout for desktop, tablet, and mobile.
- **JavaScript (ES6+):** Modular, vanilla JavaScript with zero runtime libraries, build tools, or bundler requirements.

---

## Features & Parity

1. **Sheet Navigation (01 - 07):**
   - **01 Chat:** Interactive prompt input, quick chips, conversation thread with action buttons, handwritten annotations.
   - **02 Build:** Interactive 3D CSS Workbench model:
     - Mouse drag to rotate the 3D model in 3D space (`rotateX`, `rotateY`).
     - Turn Left, Turn Right, and Reset View controls.
     - 6-step build sequence with highlighted new parts vs already built parts.
     - Bill of materials / parts list table for each step.
     - Clickable step drawer.
   - **03 Projects:** Project grid, "New project" inline creation form, deep link to describe project in chat, remove project.
   - **04 Files:** Drag-and-drop file upload zone, file picker, formatted sizes, file list with index badges (`F-01`).
   - **05 History:** Timestamped prompt activity log with reverse-chronological order.
   - **06 About:** System description, 3-step workflow grid, call to action.
   - **07 Settings:** Cursor glow toggle switch, crosshair guides toggle switch, 4 Paper palette colors, 4 Pencil highlight colors, clear data.
2. **Drafting Blueprint Visuals:**
   - Real-time mouse crosshair guides tracking cursor coordinates.
   - Radial cursor glow.
   - Live technical rulers (horizontal ruler with dimension markings, vertical ruler with ticks).
   - Live drafting coordinate readout (`X 0450  Y 0320`).
   - Engineering Title Block (DWG, SCALE, REV, DRAWN signature) updating dynamically with active sheet.

---

## How to View and Run

### Option 1: Using Python's Built-in HTTP Server
From the repository root:
```bash
python3 -m http.server -d frontend 8000
```
Then open `http://localhost:8000` in any browser.

### Option 2: Open Directly in Browser
You can also open `frontend/index.html` directly in any web browser (`Chrome`, `Firefox`, `Safari`, `Edge`). No local server is required.
