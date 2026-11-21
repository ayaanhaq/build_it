# buildmvp

A deterministic rule checker and instruction generator for physical electronics builds.

`buildmvp` validates circuit designs represented as JSON netlists against electrical safety rules before generating step-by-step physical assembly instructions with multimeter continuity checks.

> **Principle:** The model proposes, deterministic code decides. Electrical safety rules are strict guardrails and must never be weakened to make a test pass.

---

## Requirements & Setup

- **Python 3.8+** (standard library only; no external dependencies required).
- No network access or third-party packages are needed.

### Running Tests
Run the full test suite with:
```bash
python3 -m unittest discover -s tests -v
```

### Running the CLI
Render build instructions for a valid netlist:
```bash
python3 main.py examples/blink_led.json
python3 main.py examples/pir_light.json
```

Run in machine-readable JSON mode (for LLMs and automation tools):
```bash
python3 main.py --json examples/blink_led.json
```

When a netlist violates electrical rules, `main.py` prints the specific rejection reasons and exits with a non-zero status code:
```bash
python3 main.py examples/pir_bad_5v.json
# Exit code 1; prints rejection reason
```

---

## Netlist Format

Netlists are JSON documents with the following structure:

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

- **`name`** *(string)*: Name of the circuit build.
- **`parts`** *(dict)*: Maps component instance IDs to component types defined in `parts.json`.
- **`values`** *(dict)*: Parameter values for components, such as resistance in Ohms for resistors (`"r1": 330`).
- **`nets`** *(dict)*: Electrical nets mapping net names to lists of connected pins in `<part_id>.<pin>` notation.

---

## How to Add a Part

Components are defined in `parts.json`.

### Schema
Each part entry contains:
- **`is_sensor`** *(bool, optional)*: Explicit boolean indicating if the part is a sensor module.
- **`pins`** *(dict)*: Map of pin names to pin definitions.
  - **`role`** *(string)*: One of `gpio`, `power`, `ground`, `anode`, `cathode`, `output`, or `passive`.
  - **`level`** *(float, optional)*: Logic voltage level in Volts (e.g., `3.3` or `5.0`).
  - **`v`** *(float, optional)*: Supply rail voltage in Volts (e.g., `5.0`).
  - **`max_source_ma`** *(float or "UNVERIFIED")*: Maximum current the pin can source in mA.
  - **`max_sink_ma`** *(float or "UNVERIFIED")*: Maximum current the pin can sink in mA.
- **Component-level attributes**:
  - `vf`: Forward voltage drop in Volts (for LEDs/diodes).
  - `vbe`: Base-emitter saturation voltage drop in Volts (for transistors, e.g. 0.7).
  - `max_ma`: Maximum rated continuous forward current in mA.
  - `has_driver_transistor`: Boolean indicating onboard driver transistor.
  - `has_flyback_diode`: Boolean indicating onboard inductive flyback diode.
- **Documentation & Citations**:
  - Always include a `_comment` citing the datasheet source and value for each limit.
  - If a value cannot be verified from a reliable datasheet, set it to `"UNVERIFIED"` rather than guessing.
  - When a limit like `max_source_ma` is `"UNVERIFIED"`, `checker.py` applies a conservative default placeholder (`DEFAULT_UNVERIFIED_MAX_SOURCE_MA = 8.0` mA) and issues a warning. Warnings do not fail the design unless the calculated current exceeds this conservative limit.

### Example: Adding a Sensor
```json
"my_sensor": {
  "_comment": "Example 3.3V Sensor. Source: Manufacturer Datasheet Rev 1.0.",
  "is_sensor": true,
  "pins": {
    "VCC": {
      "role": "power",
      "v": 3.3,
      "_comment": "Supply voltage 3.3V (Source: Datasheet Section 2.1)"
    },
    "GND": {
      "role": "ground"
    },
    "OUT": {
      "role": "output",
      "level": 3.3,
      "max_source_ma": "UNVERIFIED",
      "_comment": "3.3V digital output. Source drive capability unrated in datasheet, marked UNVERIFIED."
    }
  }
}
```

---

## How to Add a Rule

Rules are implemented in `checker.py` inside `check(netlist, lib)`.

### Rule Design Guidelines
1. **Deterministic & Self-Contained:** Rules must only depend on `netlist` and `lib`. No network calls, filesystem queries, or non-deterministic behavior.
2. **Specific Error Messages:** Name the exact part ID, pin, net name, and numbers that failed (e.g. `"Current 27.7 mA exceeds GPIO rated limit of 16 mA on 'pi.GPIO17'"`).
3. **Small Functions:** Keep validation checks modular.

### Workflow: Test-Driven Rule Implementation
1. **Write a failing test first** in `tests/test_checker.py`:
   ```python
   def test_unsupported_voltage_fails(self):
       design = {
           "name": "bad_voltage",
           "parts": {"pi": "raspberry_pi_4", "s1": "some_part"},
           "values": {},
           "nets": {"NET1": ["pi.GPIO17", "s1.pin1"]}
       }
       errors = check(design, LIB)
       self.assertTrue(any("unsupported voltage" in e for e in errors))
   ```
2. **Run the test suite** to ensure it fails before the rule is added:
   ```bash
   python3 -m unittest discover -s tests -v
   ```
3. **Add the rule logic** in `checker.py`:
   ```python
   # Inside check(netlist, lib):
   for net_name, pin_list in nets.items():
       # Validate condition...
       if condition_violated:
           errors.append(f"Specific failure description for net '{net_name}'")
   ```
4. **Re-run the test suite** to ensure the test now passes without regressing existing tests.

---

## Subsystem Rendering and JSON Mode

### Instruction Rendering (`renderer.py`)
Instructions group wiring connections by subsystem in the following order:
1. **`### Power`**: Connections carrying power supply rails and ground return paths.
2. **`### Signal`**: Control, input, and sensor signals.
3. **`### Output`**: Loads, indicators (LEDs), and relay coil/contact connections.

Each connection step specifies a multimeter continuity check (`"Check: multimeter continuity between X and Y should beep"`). Power-off safety warnings precede the steps, and a final power-on confirmation step concludes the build.

### JSON API Output (`--json`)
Running `python3 main.py --json <netlist>` produces structured output suitable for automated pipelines and LLM agents:

**Passing Build:**
```json
{
  "ok": true,
  "errors": [],
  "warnings": [
    "Limit 'max_source_ma' on 'pir.OUT' is UNVERIFIED; using conservative default of 8.0 mA"
  ],
  "steps": [
    "Connect pi.GND to led1.cathode. Check: multimeter continuity between pi.GND and led1.cathode should beep.",
    "Connect pi.GPIO17 to r1.a. Check: multimeter continuity between pi.GPIO17 and r1.a should beep.",
    "Connect r1.b to led1.anode. Check: multimeter continuity between r1.b and led1.anode should beep.",
    "Power on. Confirm the LED lights, then power off to finish."
  ]
}
```

**Rejected Build:**
```json
{
  "ok": false,
  "errors": [
    "5.0V sensor output 'pir.OUT' cannot directly drive 3.3V GPIO pin 'pi.GPIO17' on net 'SENSOR_SIGNAL'"
  ],
  "warnings": [],
  "steps": []
}
```
