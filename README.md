# buildmvp

A deterministic electrical safety checker and instruction generator for physical hardware builds.

`buildmvp` validates circuit designs represented as JSON netlists against strict physical electrical rules before generating step-by-step physical assembly instructions complete with multimeter continuity checks.

> **Core Principle:** *The model proposes, deterministic code decides.*
> Electrical safety rules are hard physical constraints protecting silicon and hardware. Rules are never weakened to make a test pass.

---

## Table of Contents

- [Quick Start](#quick-start)
  - [Requirements](#requirements)
  - [Running Tests](#running-tests)
  - [Running the CLI](#running-the-cli)
- [System Architecture](#system-architecture)
- [3D Assembly Manual & HeyClicky Rendering Pipeline](#3d-assembly-manual--heyclicky-rendering-pipeline)
  - [HeyClicky Multi-Pass Rendering Engine](#heyclicky-multi-pass-rendering-engine)
  - [How to Expand: Adding New 3D Builds](#how-to-expand-adding-new-3d-builds)
- [Recapitulation of Work & Evolution](#recapitulation-of-work--evolution)
  - [Task B: Explicit Sensor Model & Pin Roles](#task-b-explicit-sensor-model--pin-roles)
  - [Task A: UNVERIFIED Limits & Conservative Defaults](#task-a-unverified-limits--conservative-defaults)
  - [Task C: Transistor Base Resistor & Relay Protection](#task-c-transistor-base-resistor--relay-protection)
  - [Task D: Test Hardening & Error Substring Precision](#task-d-test-hardening--error-substring-precision)
  - [Phase 1: On-Demand Architecture & Fail-Closed Safety](#phase-1-on-demand-architecture--fail-closed-safety)
  - [Frontend: Modern 3D Traditional Web Stack](#frontend-modern-3d-traditional-web-stack)
- [Branch Sitemap](#branch-sitemap)
- [Electrical Safety Rules](#electrical-safety-rules)
- [Netlist & Component Library Specification](#netlist--component-library-specification)
- [Contributing & Testing Workflow](#contributing--testing-workflow)

---

## Quick Start

### Requirements
- **Python 3.8+** (standard library only for the core rule checker; zero required third-party dependencies).
- Optional datasheet ingestion and schema validation tools utilize `pypdf` and `jsonschema` when available.

### Running Tests
Execute the complete unittest suite (42 tests on `main`, 62 tests on `phase-1-on-demand-parts`):
```bash
python3 -m unittest discover -s tests -v
```

### Running the CLI
Render step-by-step human-readable Markdown instructions for a valid netlist:
```bash
python3 main.py examples/blink_led.json
python3 main.py examples/pir_light.json
```

Run in machine-readable JSON mode (designed for autonomous LLM agents and tooling pipelines):
```bash
python3 main.py --json examples/blink_led.json
```

When a circuit violates electrical rules, `main.py` outputs clear, actionable rejection reasons and exits with status code 1:
```bash
python3 main.py examples/pir_bad_5v.json
# Exits with 1; prints: 5.0V sensor output 'pir.OUT' cannot directly drive 3.3V GPIO pin 'pi.GPIO17'
```

---

## System Architecture

```
                    ┌───────────────────────────────┐
                    │      Input Netlist (JSON)     │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │       checker.py (Core)       │
                    │   Deterministic Safety Engine │
                    └───────┬───────────────┬───────┘
                            │               │
                 Rejection  │               │ Pass
                            ▼               ▼
          ┌────────────────────────┐  ┌─────────────────────────┐
          │  Errors / Warnings     │  │    renderer.py          │
          │  (Design Blocked)      │  │  Build Steps Generator  │
          └────────────────────────┘  └─────────────┬───────────┘
                                                    │
                                                    ▼
                                      ┌─────────────────────────┐
                                      │  Assembly Instructions  │
                                      │  - Subsystem Groups     │
                                      │  - Multimeter Checks    │
                                      └─────────────────────────┘
```

1. **`parts.json`**: Component library specifying pins, electrical roles (`gpio`, `power`, `ground`, `output`, `passive`), voltage levels, and absolute maximum ratings.
2. **`checker.py`**: Deterministic rule checker enforcing electrical constraints without external network calls or non-deterministic heuristics.
3. **`renderer.py`**: Instruction generator grouping connections by functional subsystem (`Power` $\rightarrow$ `Signal` $\rightarrow$ `Output`) with bench multimeter continuity tests.
4. **`main.py`**: CLI entry point supporting standard human-readable text and `--json` API output.
5. **3D Web Application (`frontend/` & `src/`)**: 3-column interactive assembly manual powered by Three.js and HeyClicky's procedural technical rendering pipeline.

---

## 3D Assembly Manual & HeyClicky Rendering Pipeline

The frontend features an interactive, step-by-step 3D assembly manual inspired by Lego instructions and HeyClicky's real-time procedural rendering engine.

```
   ┌───────────────────┐    ┌───────────────────────────────────┐    ┌──────────────────────────┐
   │   LEFT SIDEBAR    │    │           MAIN WORKSPACE          │    │   RIGHT PARTS WIDGET     │
   │  (Chat Sessions)  │    │      (3D Engine & Chat Stream)    │    │   (Bill of Materials)    │
   │                   │    │                                   │    │                          │
   │  • Session list   │    │  • AIChatInput (Prompt Bar)       │    │  • Active Step Progress  │
   │  • "+ New Chat"   │    │  • Three.js Interactive Viewport  │    │  • Required Components   │
   │  • Delete session │    │  • 2D Analytical Leader Callouts  │    │  • Dimensions & Swatches │
   │  • Collapsible    │    │  • Prev / Next Step Controller    │    │  • Assembly Pro-Tips     │
   │                   │    │  • Resting Sway (CANVAS_3D_SWAY)  │    │  • "Jump to Step" Grid   │
   └───────────────────┘    └───────────────────────────────────┘    └──────────────────────────┘
                                              ▲                                   ▲
                                              └────── Bidirectional Sync ─────────┘
```

### HeyClicky Multi-Pass Rendering Engine

The 3D rendering pipeline (implemented in `src/three-scene.ts` for React/TypeScript and `frontend/js/app.js` for standalone vanilla HTML/JS) ports HeyClicky's technical rendering architecture:

1. **Pass 1 — Object Picking & Interactive Raycasting:**
   - Real-time GPU raycasting on pointer move tracks mouse coordinates against all visible interactive component meshes.
   - Hovered parts exhibit an emissive highlight (`#221A00`), while selected parts glow warm amber (`#3A2800`).
2. **Pass 2 — Technical Ink Outlines & Seams:**
   - Procedural edge extraction via `THREE.EdgesGeometry` (`linewidth: 1.5`, color `REAL_TONES.ink`, 85% opacity) overlaid onto geometry surfaces, producing clean CAD and Lego instruction manual line art.
3. **`REAL_TONES` Physical Material Palette:**
   - Non-candy physical materials matching authentic architectural finishes:
     - `ink` (`#2C2E33`): Technical edge seams, steel fasteners, and raceways.
     - `tan` (`#B9946F`): Kiln-dried White Oak framing and legs.
     - `brown` (`#6D4A2F`): Walnut core drawer housing.
     - `sun` (`#D6A83C`): Rubberized brass leveling glides.
     - `cream` (`#EAD9BE`): Chamfered tabletop edge highlights.
     - `leather` (`#18191B`): Full-grain charcoal desk mat.
     - `coral` (`#B04838`): Accent components and hardware callouts.
4. **Pass 5 & 6 — Studio 3-Point Lighting & Contact Shadow Dais:**
   - Directional warm key light (`0xfff8f0`, intensity 1.35) at high elevation.
   - Cool ambient fill bounce (`0xdfebfa`, intensity 0.65).
   - High-contrast edge rim light (`0xffeedd`, intensity 0.85).
   - Circular dark presentation dais (`CylinderGeometry(58, 60, 0.4, 48)`) with a soft contact shadow disc (`CircleGeometry(42, 32)`).
5. **Pass 8 — Analytical 2D Leader Line Callouts:**
   - When hovering over or selecting any component in the 3D viewport, a screen-projected capsule badge with a pulsing indicator dot and directional pointer arrow tracks the cursor over the part in screen space.
6. **Resting Sway (`CANVAS_3D_CUT_SWAY`):**
   - Subtle sinusoidal yaw sway (`sin(now * 0.0008) * 0.035`) kicks in automatically after 1.2 seconds of idle time, preserving 3D depth perception and perspective without requiring user input.
7. **Bidirectional Part Selection:**
   - Clicking or hovering any row in the **Right-Side Parts Callout** widget instantly targets and highlights the part in the 3D viewport.
   - Clicking any 3D mesh in the viewport highlights the corresponding Bill of Materials entry in the right widget.

---

### How to Expand: Adding New 3D Builds

The rendering engine and step state machine are completely agnostic to what object is being built. To add a new build (e.g. a **Modular Bookcase**, **Ergonomic Chair**, or **Electronics Breadboard**), follow these 4 steps:

#### Step 1: Define the Build Step Dataset
Create a dataset conforming to the `BuildStep` schema (`src/types.ts`):

```typescript
export interface BuildStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  description: string;
  tip?: string;
  parts: Array<{
    id?: string;
    name: string;
    qty: string;
    dimensions: string; // or dim in vanilla JS
    color: string;
    material: string;
  }>;
  cam: { dist: number; phi: number; theta: number };
}
```

Example for a **Modular Bookcase**:
```typescript
export const BOOKCASE_STEPS: BuildStep[] = [
  {
    stepNumber: 1,
    title: "Assemble Upright Side Panels",
    subtitle: "Vertical Frame · Left & Right Uprights",
    description: "Lay the two vertical fluted upright panels parallel on your assembly mat.",
    tip: "Ensure pre-drilled shelf pin holes face inwards before attaching bases.",
    parts: [
      { name: "Fluted Oak Upright Panels", qty: "2×", dimensions: "1800 × 300 × 25 mm", color: "#B9946F", material: "White Oak" }
    ],
    cam: { dist: 110, phi: 1.1, theta: 0.6 }
  },
  // Additional steps (shelves, back brace, levelers)...
];
```

#### Step 2: Implement Procedural 3D Geometry
In `src/three-scene.ts` (and `frontend/js/app.js`), create a procedural build method:

```typescript
private buildBookcaseModel(): void {
  const oakMat = this.createPbrMaterial(REAL_TONES.tan, 0.38, 0.04);
  const pinMat = this.createPbrMaterial(REAL_TONES.sun, 0.22, 0.88);

  // STEP 1: Uprights Group
  const group1 = new THREE.Group();
  const uprightGeo = new THREE.BoxGeometry(2.5, 90, 20);

  [-20, 20].forEach((x, idx) => {
    const upright = new THREE.Mesh(uprightGeo, oakMat.clone());
    upright.position.set(x, 45, 0);
    upright.castShadow = true;
    upright.receiveShadow = true;
    
    // Register mesh for Pass 1 picking and Pass 2 ink outlines
    this.registerMesh(upright, idx === 0 ? "Left Upright Panel" : "Right Upright Panel", "Fluted Oak Upright Panels", group1);
  });

  this.stepGroups.set(1, group1);
  this.scene.add(group1);

  // STEP 2: Shelves Group...
}
```

#### Step 3: Register Meshes with Outlines & Picking Metadata
Always route created meshes through `registerMesh`:
```typescript
private registerMesh(mesh: THREE.Mesh, specificName: string, categoryName: string, group: THREE.Group): void {
  mesh.name = specificName;
  mesh.userData = { partName: specificName, category: categoryName };
  this.addInkOutlines(mesh, 24); // Adds HeyClicky Pass 2 ink lines
  group.add(mesh);
  this.allInteractiveMeshes.push(mesh);
  this.partMeshes.set(specificName, mesh);
}
```

#### Step 4: Wire Chat Intent to the Model Switcher
In `src/App.tsx` and `frontend/js/app.js`, inspect user query keywords to load the appropriate build data:

```typescript
if (query.toLowerCase().includes("bookcase") || query.toLowerCase().includes("shelf")) {
  setActiveBuildSteps(BOOKCASE_STEPS);
  viewerRef.current?.loadModel("bookcase");
} else {
  setActiveBuildSteps(DESK_BUILD_STEPS);
  viewerRef.current?.loadModel("desk");
}
```

---

## Recapitulation of Work & Evolution

### Task B: Explicit Sensor Model & Pin Roles
- **Branch:** `task-b-sensor-model`
- **Problem:** `checker.py` previously determined if a part was a sensor using brittle substring matching (`"sensor" in ctype or "pir" in ctype`). A sensor with an alternate name bypassed safety checks. Furthermore, sensor outputs were typed as `role: "gpio"`, conflating sensor outputs with MCU GPIO inputs.
- **Changes:**
  - Added explicit `"is_sensor": true` boolean in `parts.json`.
  - Re-typed sensor output pins to `"role": "output"`.
  - Added Parallax-style 5V sensor model (`pir_sensor_5v`).
  - Implemented Rule 4: Rejects 5.0V sensor outputs wired directly to 3.3V GPIO pins.
  - Added test netlists `examples/pir_light.json` (valid 3.3V sensor) and `examples/pir_bad_5v.json` (rejected 5V sensor).

### Task A: UNVERIFIED Limits & Conservative Defaults
- **Branch:** `task-a-unverified-limits`
- **Problem:** When an electrical limit was `"UNVERIFIED"`, the checker previously skipped the check silently using an `isinstance` guard, allowing potentially hazardous circuits to pass uninspected.
- **Changes:**
  - Added module-level conservative defaults:
    - `DEFAULT_UNVERIFIED_MAX_SOURCE_MA = 8.0` mA (conservative GPIO/output driver placeholder).
    - `DEFAULT_UNVERIFIED_MAX_SINK_MA = 5.0` mA (conservative sink placeholder).
  - Implemented `check_with_warnings(netlist, lib)` returning `(errors, warnings)`.
  - Emitted visible warnings when conservative defaults are applied to unverified limits.
  - Updated CLI (`main.py`) to print warnings to `sys.stderr` and include `"warnings": [...]` in `--json` output.

### Task C: Transistor Base Resistor & Relay Protection
- **Branch:** `task-c-transistor-base-resistor`
- **Problem:** Transistors wired directly from MCU GPIO pins without base current-limiting resistors were passing without inspection, risking GPIO overcurrent burnout. Additionally, bare relay coils lacked inductive flyback protection.
- **Changes:**
  - **Rule 6 (Transistors):** Enforced base series resistor when driven from a GPIO pin, verified emitter connection to ground, and enforced Ohm's law base current limit $(V_{GPIO} - V_{be}) / R_{base} \le I_{GPIO\_max}$.
  - **Rule 5 (Relays):** Required flyback diodes across bare relay coil terminals and transistor drivers when driven by MCU pins. Added pre-buffered `relay_module` component support.

### Task D: Test Hardening & Error Substring Precision
- **Branch:** `task-d-tighten-overcurrent-tests`
- **Problem:** Overcurrent tests in `tests/test_checker.py` previously asserted `"GPIO rated" in e or "limit" in e`, allowing GPIO check failures to be masked by LED check failures.
- **Changes:**
  - Split overcurrent tests into `test_gpio_overcurrent_fails` and `test_led_overcurrent_fails`.
  - Introduced `get_errors` helper supporting both `check(design, lib)` and `check(design)` signatures.
  - Asserted exact error message substrings across all 8 safety rules to ensure every check fires specifically for its intended reason.

### Phase 1: On-Demand Architecture & Fail-Closed Safety
- **Branch:** `phase-1-on-demand-parts`
- **Goal:** Lay the foundation for on-demand component generation from datasheets while upholding physical safety guarantees.
- **Changes:**
  - **`docs/DESIGN.md`**: Authored detailed architectural specification for the hybrid model:
    - CAD subprocess sandbox with mesh watertightness and bounding box clearance validation.
    - Runtime datasheet extraction with composite caching `(part_number, sha256)`.
    - Seed library role of `parts.json` as permanent, immutable offline cache entries.
    - Full provenance tracking (document SHA-256, page number, confidence, raw text snippet).
    - Architectural decisions and rationale matrix.
  - **Fail-Closed Safety Gate (`checker.py`)**:
    - Unverified absolute maximum ratings on GPIO (`max_source_ma`, `level`) or power pins (`v`, `max_source_ma`) strictly **block the design** with an error.
    - Conservative defaults remain reserved for non-critical operating estimates (peripheral output currents or sink draws).
  - **Datasheet Schema & Validator (`schemas/datasheet_extraction.schema.json`, `datasheet_schema.py`)**:
    - Defined JSON schema for extracted electrical facts and pinouts.
    - Implemented validator with unit tests in `tests/test_datasheet_schema.py`.
  - **PDF Datasheet Ingestor (`datasheet_ingest.py`)**:
    - Created local PDF ingestion stub extracting page text and computing SHA-256 checksums.
    - Added modular backend support: pure Python `pypdf` default with pluggable adapters for `PyMuPDF` (`fitz`) and `pdfplumber`.

### Frontend: Modern 3D Traditional Web Stack
- **Branch:** `frontend-traditional-stack`
- **Goal:** Transform the frontend into a modern, 3-column interactive build assistant powered by standard web technologies (HTML5, CSS3, TypeScript, JavaScript, Three.js).
- **Changes:**
  - **3-Column Architecture:**
    - **Left Sidebar:** Multi-session chat history tracking with "+ New Chat" session creation and quick management.
    - **Center Workspace:** Pure black background with centered `AIChatInput` component, interactive 3D Three.js assembly manual, single-line step counter, and Lego-style previous/next navigation.
    - **Right Parts Callout Widget:** Dedicated Bill of Materials widget that dynamically activates on message sent, featuring step progress, required components with dimensions and material swatches, assembly tips, and jump-to-step grid.
  - **HeyClicky Multi-Pass Rendering Pipeline:**
    - Pass 1 object picking and raycasting with hover and selection emissive glows.
    - Pass 2 technical ink outlines via `THREE.EdgesGeometry` (`color: REAL_TONES.ink`, `linewidth: 1.5`).
    - `REAL_TONES` authentic physical material palette (`ink`, `tan`, `brown`, `sun`, `steel`, `leather`, `cream`, `coral`).
    - Studio 3-point lighting (warm key, cool fill, rim) and dark dais with contact shadow disc.
    - Pass 8 analytical 2D leader callout capsule tracking parts with pulsating indicator and directional pointer.
    - Idle resting sway (`CANVAS_3D_CUT_SWAY`) maintaining 3D depth perception.
    - Bidirectional part selection between the 3D viewport and the right-side BOM list.
  - **Dual-Stack Parity:** 100% feature parity maintained between the Vite/React/TypeScript stack (`src/`) and the standalone vanilla HTML/CSS/JS stack (`frontend/`).

---

## Branch Sitemap

| Branch | Description | Status |
| :--- | :--- | :--- |
| **`main`** | Core deterministic rule checker, subsystem renderer, CLI, and test suite. | Active / Primary |
| **`phase-1-on-demand-parts`** | On-demand architecture (`docs/DESIGN.md`), fail-closed GPIO/power rules, datasheet schema, and ingestion stub. | Feature Complete |
| **`frontend-traditional-stack`** | Builders Archive UI built with standard HTML5, CSS3 3D transforms, and vanilla ES6+ JS. | Feature Complete |
| **`frontend`** | Raw design-canvas export reference branch. | Reference |
| **`task-a-unverified-limits`** | Warning reporting and conservative default limit handling. | Merged into `main` |
| **`task-b-sensor-model`** | Explicit sensor typing (`is_sensor`) and 5V-to-GPIO driver protection. | Merged into `main` |
| **`task-c-transistor-base-resistor`**| Transistor base resistor rules and bare relay coil flyback protection. | Merged into `main` |
| **`task-d-tighten-overcurrent-tests`**| Overcurrent test splitting and exact error string assertions. | Merged into `main` |

---

## Electrical Safety Rules

The deterministic checker in `checker.py` evaluates the following rules:

1. **Valid Pin References:** All pins referenced in nets must exist on declared parts in `parts.json`.
2. **Fail-Closed on Unverified Absolute Maxima:** Unverified limits on GPIO (`max_source_ma`, `level`) or power pins (`v`, `max_source_ma`) reject the design.
3. **Pin Exclusivity:** A physical pin can be connected to at most one electrical net.
4. **Voltage Rail Isolation:** 5.0V power rails must never connect to 3.3V GPIO nets.
5. **Sensor Output Voltage Safety:** 5.0V sensor output pins cannot directly drive 3.3V MCU GPIO pins.
6. **Relay Protection:** Bare relay coils require an inductive flyback diode across coil terminals and an external switching transistor if driven from an MCU.
7. **Transistor Drive Protection:** Transistor base terminals driven by GPIO pins require a series current-limiting resistor, emitter connected to ground, and base current within GPIO rated limits.
8. **LED Current Limiting & Overcurrent:** LEDs require a current-limiting resistor on the anode net, cathode connected to ground, and operating current within both LED and driver ratings.
9. **Input Current Compatibility:** Pin source current capabilities must satisfy downstream sink requirements.

---

## Netlist & Component Library Specification

### Netlist Structure
```json
{
  "name": "blink_led",
  "parts": {
    "pi": "raspberry_pi_4",
    "led1": "led",
    "r1": "resistor"
  },
  "values": {
    "r1": 330
  },
  "nets": {
    "SIGNAL": ["pi.GPIO17", "r1.a"],
    "LED_ANODE": ["r1.b", "led1.anode"],
    "GND": ["pi.GND", "led1.cathode"]
  }
}
```

### Component Definition (`parts.json`)
```json
"pir_sensor": {
  "_comment": "HC-SR501 PIR Motion Detector Module. Source: Datasheet Rev 1.0.",
  "is_sensor": true,
  "pins": {
    "VCC": { "role": "power", "v": 5.0 },
    "GND": { "role": "ground" },
    "OUT": { "role": "output", "level": 3.3, "max_source_ma": "UNVERIFIED" }
  }
}
```

---

## Contributing & Testing Workflow

1. Always add a failing test in `tests/test_checker.py` before adding or modifying a safety rule.
2. Ensure standard library Python 3.8+ compatibility for all core verification code.
3. Never weaken or bypass an electrical safety rule to make a test pass.
4. Run the full test suite before committing:
   ```bash
   python3 -m unittest discover -s tests -v
   ```
