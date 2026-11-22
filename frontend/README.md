# Builders Archive — Traditional Web Tech Stack

This directory contains the modernized **Builders Archive** frontend built with the traditional web design stack:
- **HTML5:** Semantic, accessible markup.
- **CSS3:** Custom styles adhering to Tailwind CSS conventions with smooth dark mode aesthetics.
- **TypeScript & JavaScript (ES6+):** Robust component design, type-checked with TypeScript and running cleanly in modern browsers.
- **Three.js:** Full 3D rendering stack ready for 3D build and parts visualization.
- **React & Lucide:** `AIChatInput` React component implementation with Lucide icons.

---

## Clean Dark Architecture

- **Black Background:** Pure minimalist `#000000` canvas with zero clutter (blueprint grids, rulers, sidebars, and title blocks removed).
- **Centered AIChatInput:** Center-aligned modern chat input widget with:
  - Multi-line textarea (`rows=2`, Enter to send, Shift+Enter for newlines).
  - Plus attachment button (Lucide `Plus` 20px).
  - Voice input button (Lucide `Mic` 19px).
  - Send action button (Lucide `ArrowUp` 19px, auto-disables on empty input, hover feedback).
  - Console logging on send: `console.log("Message sent:", message)`.

---

## Tech Stack Overview

1. **Standalone Traditional Web Stack (`frontend/`):**
   - `frontend/index.html`: Entry point running directly in any browser or HTTP server without requiring a build step.
   - `frontend/css/styles.css`: Pure CSS definitions for all styling classes.
   - `frontend/js/app.js`: Event handling, dynamic textarea resizing, and Three.js initialization.

2. **TypeScript & React Source (`src/`):**
   - `src/AIChatInput.tsx`: Component source code with Lucide icons and React hooks.
   - `src/App.tsx`: App wrapper centering the input on a black background.
   - `src/three-scene.ts`: Three.js scene manager class for 3D model visualization.
   - `src/main.tsx`: React DOM mount entry point.

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
