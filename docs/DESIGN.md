# On-Demand Hardware Build MVP: Architecture & Design Specification

## 1. Executive Summary & Core Principle

`buildmvp` is a deterministic rule checker and instruction generator for physical electronics and mechanical builds.

### The Core Principle
> **The model proposes, deterministic code decides.**
> Nothing the model produces reaches the user's hardware or assembly bench without passing strict, deterministic validation. Safety rules are hard physical constraints, never weakened to allow an unverified or risky design to pass.

This document describes the hybrid on-demand architecture: expanding `buildmvp` from a static hand-curated component library (`parts.json`) to on-demand electrical fact extraction and 3D visual generation, while maintaining rigorous physical safety guarantees.

---

## 2. Hybrid System Architecture

The architecture decouples generative proposals from safety decisions across two distinct domains: **Mechanical/Visuals** and **Electrical Facts**.

```mermaid
flowchart TD
    UserPrompt["User Prompt / Netlist Proposal"] --> Router{"Part & Shape Resolution"}

    subgraph Mechanical["1. Visual & Mechanical Domain (Future)"]
        Router -->|Mount / Enclosure Request| CADGen["LLM CAD Code Generator\n(OpenSCAD / CadQuery)"]
        CADGen --> CADSandbox["Sandboxed Subprocess\n(No network, strict timeout)"]
        CADSandbox --> MeshValidator["Deterministic Mesh Validator\n- Watertight 2-manifold\n- Bounding box limits\n- Clearance tolerances"]
        MeshValidator -->|Pass| STLCache["CAD / STL Cache"]
        MeshValidator -->|Fail (retry <= 3)| CADGen
        MeshValidator -->|Fail (retry > 3)| HardCADReject["Stop & Report Failure"]
    end

    subgraph Electrical["2. Electrical Fact Domain (Active & Runtime)"]
        Router -->|Uncached Part| DatasheetLookup["Datasheet Retrieval"]
        DatasheetLookup --> DatasheetIngest["Local PDF Ingestor\n(SHA-256 + Text Extraction)"]
        DatasheetIngest --> Extractor["Structured Extractor\n(Pins, Absolute Max, Limits)"]
        Extractor --> SchemaValidator["Datasheet Schema Validator\n(JSON Schema + Provenance)"]
        SchemaValidator -->|Valid| Cache["Component Cache\n(Key: Part# + SHA-256)"]
        SeedLib["Seed Library\n(parts.json)"] -.->|Permanent Entries| Cache
    end

    subgraph DeterministicEngine["3. Deterministic Safety Engine (checker.py)"]
        Cache --> Checker["Rule Checker"]
        Netlist["Netlist JSON"] --> Checker
        Checker --> FailClosed["Fail-Closed Safety Gate:\nReject UNVERIFIED GPIO / Power Maxima"]
        Checker --> TopologyChecks["Topology & Compatibility Checks:\n5V on GPIO, Flyback Diode, Transistor Base"]
        Checker --> OvercurrentChecks["Current Limits & Ohms Law Verification"]
    end

    subgraph InstructionEngine["4. Assembly & Verification (renderer.py)"]
        Checker -->|Pass| Renderer["Step Renderer"]
        Renderer --> Grouping["Subsystem Grouping:\nPower -> Signal -> Output"]
        Grouping --> BenchChecks["Multimeter Continuity & Voltage Checks\nAfter Every Step"]
        BenchChecks --> FinalOutput["Safe Build Instructions / CLI JSON"]
    end
```

---

## 3. Fail-Closed Electrical Safety Rules

### Why Fail-Closed?
Physical components can be permanently destroyed by overvoltage or overcurrent within microseconds. A 5V signal driving an unbuffered 3.3V Raspberry Pi GPIO pin will damage the SoC silicon. Driving an LED without a verified current limit or placing excessive base current into a switching transistor can cause thermal runaway or GPIO pin burnout.

Therefore:
1. **Ambiguous or Unverified Limits on Safety-Critical Pins Block the Build:**
   If a datasheet extraction leaves an absolute maximum unverified on a GPIO pin (`max_source_ma`, `level`) or a power pin (`v`, `max_source_ma`), `checker.py` rejects the design with an explicit error:
   ```
   Fail-closed: GPIO pin 'pi.GPIO17' has unverified absolute maximum 'max_source_ma'; hardware safety requires verified limit
   ```
2. **Conservative Defaults are for Operating Estimates, Not Absolute Limits:**
   A conservative default (such as `DEFAULT_UNVERIFIED_MAX_SOURCE_MA = 8.0` mA or `DEFAULT_UNVERIFIED_MAX_SINK_MA = 5.0` mA) is only permissible for non-critical operating estimates—such as estimating load drive from an auxiliary sensor output (`role: "output"`) or estimating input draw on a sink pin. In those non-critical cases, the checker emits a warning and tests against the conservative default. If calculated current exceeds that default, it rejects the build; if it is within the default, it passes with a warning.
   Absolute maximum ratings on GPIO and power rails never use fallbacks: they must be verified or the design fails closed.

---

## 4. Datasheet Extraction & Ingestion Pipeline

### 4.1 Ingestion Stub (`datasheet_ingest.py`)
- Reads local PDF datasheets.
- Computes SHA-256 content digest across 64KB binary blocks to prevent tampering and guarantee exact reproducibility.
- Extracts per-page text and document metadata.
- Modular backend interface:
  - `pypdf` (installed, pure Python, zero system dependencies).
  - Adapter stubs for `PyMuPDF` (`fitz`) and `pdfplumber` prepared for higher table fidelity once approved.

### 4.2 Schema Validator (`datasheet_schema.py`)
Component extractions must conform to `schemas/datasheet_extraction.schema.json`.
Required fields:
- `part_number`: String (e.g., `"HC-SR501"`).
- `part_type`: String (e.g., `"sensor"`, `"mcu"`, `"transistor"`, `"relay"`).
- `pins`: Map of pin names to pin definitions containing valid roles (`gpio`, `power`, `ground`, `anode`, `cathode`, `passive`, `output`, `input`).
- `provenance`: Traceability object linking every extracted fact back to the source document.

---

## 5. Cache Architecture & Seed Library

To ensure builds are fast, offline-capable, and deterministic:
1. **Cache Keying:**
   Every cached part is keyed by the composite pair:
   $$\text{CacheKey} = (\text{part\_number},\, \text{sha256}(\text{datasheet}))$$
   This prevents drift: if a datasheet changes or is re-extracted, a distinct entry is generated.
2. **Seed Library (`parts.json`):**
   The existing hand-curated `parts.json` serves as permanent, immutable seed cache entries. They require no network access and form the ground-truth baseline for core components (Raspberry Pi 4, basic LEDs, standard resistors, vetted PIR sensors, and relay modules).

---

## 6. Provenance Schema & Traceability

Every extracted electrical parameter records complete audit provenance:
```json
{
  "provenance": {
    "source": {
      "document_name": "HC-SR501.pdf",
      "document_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "url": "https://example.com/datasheets/HC-SR501.pdf"
    },
    "extracted_at": "2026-11-22T14:00:00Z",
    "extraction_method": "regex-table-extractor-v1",
    "confidence": 0.95,
    "pages": [1, 2],
    "field_provenance": {
      "pins.OUT.level": {
        "page": 2,
        "raw_text": "Output: 3.3V TTL High level via onboard regulator",
        "confidence": 0.98
      }
    }
  }
}
```
If an extracted value is disputed or fails safety checks, the engine can cite the exact page and source text that produced the value.

---

## 7. Bench Checks in Assembly Steps

Assembly instructions produced by `renderer.py` enforce physical verification before powering up:
1. **Step-by-Step Continuity Checks:**
   Every electrical net connection includes an explicit multimeter beep test:
   `"Connect pi.GPIO17 to r1.a. Check: multimeter continuity between pi.GPIO17 and r1.a should beep."`
2. **Subsystem Isolation:**
   Steps are grouped deterministically:
   - `### Power`: Verifies ground and power rails before active signals are connected.
   - `### Signal`: Verifies logic connections between MCU and sensors/drivers.
   - `### Output`: Verifies high-current loads, LEDs, and actuators.
3. **Power-Off Isolation:**
   All physical wiring occurs with power disconnected; power-on is an explicit final verification step.

---

## 8. Architectural Decisions & Rationale Matrix

| Decision | Alternative Considered | Rationale |
| :--- | :--- | :--- |
| **Fail-closed on unverified GPIO/power absolute maxima** | Fallback to conservative default limit for all pins | GPIO and power pins directly damage silicon if assumptions are wrong. Conservative defaults are appropriate for operating estimates on peripheral outputs, but safety limits must be verified. |
| **Cache keyed by `(part_number, sha256)`** | Keyed by part number alone | Datasheet revisions, different manufacturers, or parsing errors could corrupt cached models. SHA-256 guarantees exact reproducibility. |
| **Seed library as permanent cache** | Replace `parts.json` entirely with dynamic lookup | Retaining vetted baseline parts enables zero-dependency offline operation and continuous backward compatibility for all existing tests. |
| **Strict JSON schema for datasheet extractions** | Free-form Python dictionaries | Schema validation catches hallucinations, invalid pin roles, and missing electrical bounds before the checker touches the data. |
| **Modular PDF backend with `pypdf` default** | Immediately bundle `PyMuPDF` or `pdfplumber` | `pypdf` is already present without adding new pip dependencies. Adding C-extension dependencies requires explicit user consultation. |
| **Subsystem grouping (`Power` $\rightarrow$ `Signal` $\rightarrow$ `Output`)** | Grouping by net order or component order | Assembling power rails first allows multimeter ground/rail continuity tests before sensitive signal pins are wired. |

---

## 9. Open Tasks (Future Phases)

1. **CAD Sandbox Execution Engine:**
   - Execute OpenSCAD or CadQuery scripts in an isolated subprocess (`sandbox-exec` / Docker container with `--net=none`, strict CPU/memory limits, 10s timeout).
   - Deterministic mesh validation: Verify STL is watertight (2-manifold, no self-intersections), compute axis-aligned bounding box (AABB), and verify clearance against neighboring component dimensions.
   - Fixed-retry loop: If validation fails, feed the error back to the generator with a hard cap (max 3 retries) before stopping and reporting failure.
2. **Runtime Datasheet Lookup & Ingestion Loop:**
   - On encountering an unknown part in a netlist prompt, invoke datasheet search, download to local cache, run ingestion, extract facts via LLM or heuristics, validate against schema, and cache.

---

## 10. Open Decisions for User Review

1. **Datasheet PDF Extraction Library:**
   - **`pypdf`** (Pure Python, currently installed, fast text stream extraction, no C-extension build issues).
   - **`PyMuPDF` / `fitz`** (Very fast, extracts text with bounding boxes and layout coordinates, excellent for complex multi-column datasheets, requires binary dependency).
   - **`pdfplumber`** (Built on `pdfminer.six`, best-in-class table extraction, slower on large documents).
   - *Recommendation:* Approve `PyMuPDF` for production multi-column datasheet parsing, while keeping `pypdf` as the zero-dependency fallback.
2. **Code-Based CAD Engine:**
   - **OpenSCAD**: Highly declarative, text-only CSG, fast headless execution via CLI (`openscad -o out.stl in.scad`), easy LLM generation, lightweight.
   - **CadQuery**: Python-native, BREP kernel (OpenCASCADE), produces STEP files with fillets and chamfers, heavier environment setup.
   - *Recommendation:* Start with OpenSCAD for enclosure and bracket generation due to its simple sandboxing and robust CLI interface.
3. **Cache Storage Mechanism:**
   - Directory of individual JSON files under `.cache/parts/<part_id>_<sha256[:8]>.json` vs a single SQLite database (`.cache/parts.db`).
   - *Recommendation:* Individual JSON files for transparent git-friendly inspection and manual auditing.
