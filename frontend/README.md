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
   - Collapsible with the sidebar toggle button.

2. **Center Workspace (Main Canvas & Chat Stream):**
   - Clean, center-aligned `AIChatInput` component with Enter/Send and multi-line support.
   - Full 3D assembly viewport with Three.js orbit controls:
     - Click & drag to rotate 360°.
     - Mouse wheel / touch pinch to zoom.
     - Right-click or two-finger drag to pan.
     - Camera presets: `Iso`, `Front`, `Top`, `Side`.
     - Auto-spin showcase toggle.
   - Lego-style step flipper controller at the bottom with previous/next buttons and step progress pills.

3. **Right Parts Callout Widget:**
   - Automatically activates on the right side of the screen when a message is sent in chat.
   - Displays:
     - Active step progress bar and percentage.
     - Required components bill of materials (quantity pills, dimensions, materials, color swatches).
     - Practical assembly pro-tips for each phase.
     - Quick "Jump to Step" selector.
   - Moving the parts callout to this dedicated right-side widget frees up the 3D viewport for an unobstructed viewing experience.

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
