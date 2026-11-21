def render(netlist):
    name = netlist.get("name", "build")
    parts = netlist.get("parts", {})
    values = netlist.get("values", {})
    nets = netlist.get("nets", {})

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

    step_num = 1
    for net_name, pin_list in nets.items():
        for i in range(len(pin_list) - 1):
            p1 = pin_list[i]
            p2 = pin_list[i + 1]
            lines.append(f"{step_num}. Connect {p1} to {p2}.")
            lines.append(f"   Check: multimeter continuity between {p1} and {p2} should beep.")
            lines.append("")
            step_num += 1

    lines.append(f"{step_num}. Power on. Confirm the LED lights, then power off to finish.")
    return "\n".join(lines)
