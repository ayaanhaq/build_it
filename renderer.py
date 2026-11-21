import json
from pathlib import Path


def _load_parts(path=None):
    if path is None:
        path = Path(__file__).resolve().parent / "parts.json"
    if path.exists():
        with open(path, "r") as f:
            return json.load(f)
    return {}


def classify_net(net_name, pin_list, parts, lib):
    """
    Classifies a net into one of three subsystems: 'power', 'signal', 'output'.
    """
    upper_name = net_name.upper()

    # 1. Check for Power subsystem
    if upper_name in ("POWER", "VCC", "GND", "GROUND", "5V", "3V3"):
        return "power"

    for pin_ref in pin_list:
        if "." in pin_ref:
            part_id, pin_name = pin_ref.split(".", 1)
            ctype = parts.get(part_id)
            if ctype and ctype in lib:
                pinfo = lib[ctype].get("pins", {}).get(pin_name, {})
                role = pinfo.get("role")
                if role in ("power", "ground"):
                    return "power"
                if pin_name in ("5V", "3V3", "VCC", "GND"):
                    return "power"

    # 2. Check for Output subsystem (actuators, indicators, relay coils, loads)
    if any(k in upper_name for k in ("OUTPUT", "LED", "COIL", "LOAD", "ACTUATOR")):
        return "output"

    for pin_ref in pin_list:
        if "." in pin_ref:
            part_id, pin_name = pin_ref.split(".", 1)
            ctype = parts.get(part_id)
            if ctype and ctype in lib:
                pinfo = lib[ctype].get("pins", {}).get(pin_name, {})
                role = pinfo.get("role")
                if role in ("anode", "cathode"):
                    return "output"
                if ctype == "led":
                    return "output"
                if pin_name.startswith("coil_") or pin_name in ("NO", "NC", "COM"):
                    return "output"

    # 3. Everything else is Signal subsystem (control, inputs, sensors, base drive)
    return "signal"


def generate_steps(netlist, lib=None):
    """
    Generates structured steps grouped by subsystem: power, then signal, then output.
    Returns (grouped_steps_dict, final_step_str).
    """
    if lib is None:
        lib = _load_parts()

    parts = netlist.get("parts", {})
    nets = netlist.get("nets", {})

    subsystems = ["power", "signal", "output"]
    grouped = {"power": [], "signal": [], "output": []}

    for net_name, pin_list in nets.items():
        subsystem = classify_net(net_name, pin_list, parts, lib)
        for i in range(len(pin_list) - 1):
            p1 = pin_list[i]
            p2 = pin_list[i + 1]
            instruction = f"Connect {p1} to {p2}."
            check_text = f"Check: multimeter continuity between {p1} and {p2} should beep."
            grouped[subsystem].append((instruction, check_text))

    has_led = any(ctype == "led" for ctype in parts.values())
    if has_led:
        final_step = "Power on. Confirm the LED lights, then power off to finish."
    else:
        final_step = "Power on. Confirm the circuit operates, then power off to finish."

    return grouped, final_step


def render(netlist, lib=None):
    name = netlist.get("name", "build")
    parts = netlist.get("parts", {})
    values = netlist.get("values", {})

    lines = [f"# Build: {name}", "", "## Parts"]
    for part_id, ctype in parts.items():
        if part_id in values:
            val = values[part_id]
            lines.append(f"- {part_id}: {ctype} ({val} ohm)")
        else:
            lines.append(f"- {part_id}: {ctype}")

    lines.extend([
        "",
        "## Steps",
        "",
        "Power is off for all steps. Do not connect power until the final step.",
        "",
    ])

    grouped_steps, final_step = generate_steps(netlist, lib)

    step_num = 1
    subsystem_titles = [("power", "Power"), ("signal", "Signal"), ("output", "Output")]

    for key, title in subsystem_titles:
        steps = grouped_steps.get(key, [])
        if not steps:
            continue
        lines.append(f"### {title}")
        for instruction, check_text in steps:
            lines.append(f"{step_num}. {instruction}")
            lines.append(f"   {check_text}")
            lines.append("")
            step_num += 1

    lines.append(f"{step_num}. {final_step}")
    return "\n".join(lines)
