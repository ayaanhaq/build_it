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
- [Recapitulation of Work & Evolution](#recapitulation-of-work--evolution)
  - [Task B: Explicit Sensor Model & Pin Roles](#task-b-explicit-sensor-model--pin-roles)
  - [Task A: UNVERIFIED Limits & Conservative Defaults](#task-a-unverified-limits--conservative-defaults)
  - [Task C: Transistor Base Resistor & Relay Protection](#task-c-transistor-base-resistor--relay-protection)
  - [Task D: Test Hardening & Error Substring Precision](#task-d-test-hardening--error-substring-precision)
  - [Phase 1: On-Demand Architecture & Fail-Closed Safety](#phase-1-on-demand-architecture--fail-closed-safety)
  - [Frontend: Builders Archive (Traditional Web Stack)](#frontend-builders-archive-traditional-web-stack)
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

### Frontend: Builders Archive (Traditional Web Stack)
- **Branch:** `frontend-traditional-stack`
- **Goal:** Replace raw proprietary design-canvas export files (`Main.dc.html`) with a production-grade web application built using the traditional web stack.
- **Changes:**
  - **`frontend/index.html`**: Clean HTML5 semantic layout with ARIA accessibility roles and Google Fonts (`Barlow Condensed`, `Architects Daughter`, `IBM Plex Mono`, `IBM Plex Sans`).
  - **`frontend/css/styles.css`**: CSS custom properties for live blueprint theme switching (`--paper`, `--panel`, `--pencil`, `--ink`), 3D CSS transforms (`perspective: 1400px; transform-style: preserve-3d;`), technical dual-grid drafting background, and responsive layouts.
  - **`frontend/js/app.js`**: Modular vanilla ES6+ JavaScript implementing:
    - **Interactive 3D Workbench Model**: Mouse drag 3D rotation (`rotateX`, `rotateY`), preset rotation controls (Turn Left/Right, Reset View), and 6 step-by-step assembly states with highlighted new parts vs. already built parts.
    - **7 Blueprint Sheets**: 01 Chat (prompt input, action buttons, quick chips), 02 Build (3D viewport, bill of materials, step drawer), 03 Projects, 04 Files (drag-and-drop zone), 05 History, 06 About, and 07 Settings (theme palette pickers, glow/crosshair toggles).
    - **Drafting Tooling**: Real-time cursor crosshair tracking (`X 0450  Y 0320`), radial cursor glow, technical rulers, and dynamically updating Title Block (`DWG A-001` through `A-007`).
  - **`frontend/README.md`**: Guide to running the app locally via `python3 -m http.server -d frontend 8000` or direct browser file opening.

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
