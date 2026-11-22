import json
from pathlib import Path


# Conservative placeholder limit (in mA) when a GPIO or output pin's max_source_ma is UNVERIFIED.
# Used until a verified datasheet value is confirmed.
DEFAULT_UNVERIFIED_MAX_SOURCE_MA = 8.0

# Conservative placeholder limit (in mA) when an input pin's max_sink_ma is UNVERIFIED.
# Used until a verified datasheet value is confirmed.
DEFAULT_UNVERIFIED_MAX_SINK_MA = 5.0


def load_parts(path=None):
    if path is None:
        path = Path(__file__).resolve().parent / "parts.json"
    with open(path, "r") as f:
        return json.load(f)


def _get_pin_info(pin_ref, parts, lib):
    if "." not in pin_ref:
        return None, None, None
    part_id, pin_name = pin_ref.split(".", 1)
    if part_id not in parts:
        return part_id, None, None
    ctype = parts[part_id]
    if ctype not in lib:
        return part_id, ctype, None
    pin_info = lib[ctype].get("pins", {}).get(pin_name)
    return part_id, ctype, pin_info


def check_with_warnings(netlist, lib):
    errors = []
    warnings = []
    parts = netlist.get("parts", {})
    values = netlist.get("values", {})
    nets = netlist.get("nets", {})

    # 1. Valid pin references
    for net_name, pin_list in nets.items():
        for pin_ref in pin_list:
            if "." not in pin_ref:
                errors.append(f"Invalid pin reference '{pin_ref}' in net '{net_name}'")
                continue
            part_id, pin_name = pin_ref.split(".", 1)
            if part_id not in parts:
                errors.append(f"Unknown part '{part_id}' referenced in net '{net_name}'")
                continue
            ctype = parts[part_id]
            if ctype not in lib:
                errors.append(f"Unknown part type '{ctype}' for part '{part_id}' in net '{net_name}'")
                continue
            pins = lib[ctype].get("pins", {})
            if pin_name not in pins:
                errors.append(f"Part '{part_id}' ({ctype}) has no pin '{pin_name}' in net '{net_name}'")

    # If there are basic reference errors, return them early to avoid crashing on later checks
    if errors:
        return errors, warnings

    # 2. Fail-closed on ambiguous electrical specs for safety-critical pins
    # If datasheet extraction leaves an absolute maximum unverified on a GPIO or power pin, REJECT the design.
    # Conservative defaults are reserved for operating estimates on general driver/output/sink pins, not limits.
    checked_pins = set()
    for net_name, pin_list in nets.items():
        for pin_ref in pin_list:
            if pin_ref in checked_pins:
                continue
            checked_pins.add(pin_ref)
            _, _, pinfo = _get_pin_info(pin_ref, parts, lib)
            if not pinfo:
                continue
            role = pinfo.get("role")
            if role == "gpio":
                for field in ("max_source_ma", "level"):
                    if pinfo.get(field) == "UNVERIFIED":
                        errors.append(
                            f"Fail-closed: GPIO pin '{pin_ref}' has unverified absolute maximum '{field}'; "
                            "hardware safety requires verified limit"
                        )
            elif role == "power":
                for field in ("v", "max_source_ma"):
                    if pinfo.get(field) == "UNVERIFIED":
                        errors.append(
                            f"Fail-closed: Power pin '{pin_ref}' has unverified absolute maximum '{field}'; "
                            "hardware safety requires verified limit"
                        )

    # 3. Pin on at most one net
    seen_pins = {}
    for net_name, pin_list in nets.items():
        for pin_ref in pin_list:
            if pin_ref in seen_pins:
                errors.append(f"Pin '{pin_ref}' is on both net '{seen_pins[pin_ref]}' and net '{net_name}'")
            else:
                seen_pins[pin_ref] = net_name

    # 3. No 5V on a GPIO net
    for net_name, pin_list in nets.items():
        has_gpio_3v3 = False
        has_5v_pin = False
        for pin_ref in pin_list:
            _, _, pinfo = _get_pin_info(pin_ref, parts, lib)
            if not pinfo:
                continue
            role = pinfo.get("role")
            v = pinfo.get("v")
            level = pinfo.get("level")
            if role == "gpio" and level == 3.3:
                has_gpio_3v3 = True
            if (role == "power" and v == 5.0) or pin_ref.endswith(".5V"):
                has_5v_pin = True
        if has_gpio_3v3 and has_5v_pin:
            errors.append(f"5.0V pin on a 3.3V GPIO net '{net_name}'")

    # 4. 5V sensor output must not drive a GPIO directly
    for net_name, pin_list in nets.items():
        sensor_5v_pins = []
        gpio_3v3_pins = []
        for pin_ref in pin_list:
            p_id, ctype, pinfo = _get_pin_info(pin_ref, parts, lib)
            if not pinfo:
                continue
            role = pinfo.get("role")
            level = pinfo.get("level")
            v = pinfo.get("v")

            # Check for 5V sensor output
            cinfo = lib.get(ctype, {})
            is_sensor = cinfo.get("is_sensor", False) is True
            is_5v_output = (level == 5.0 or v == 5.0) and role == "output"
            if is_sensor and is_5v_output:
                sensor_5v_pins.append(pin_ref)
            elif role == "gpio" and level == 3.3:
                gpio_3v3_pins.append(pin_ref)

        if sensor_5v_pins and gpio_3v3_pins:
            for s_pin in sensor_5v_pins:
                for g_pin in gpio_3v3_pins:
                    errors.append(
                        f"5.0V sensor output '{s_pin}' cannot directly drive 3.3V GPIO pin '{g_pin}' on net '{net_name}'"
                    )

    # 5. Relay rules: flyback diode and driver transistor for bare relay coils
    for part_id, ctype in parts.items():
        cinfo = lib.get(ctype, {})
        is_bare_relay = ctype == "relay" or (
            cinfo.get("has_flyback_diode") is False
            or cinfo.get("has_driver_transistor") is False
        )
        if not is_bare_relay:
            continue

        pos_pin_ref = f"{part_id}.coil_pos"
        neg_pin_ref = f"{part_id}.coil_neg"
        pos_net = seen_pins.get(pos_pin_ref)
        neg_net = seen_pins.get(neg_pin_ref)

        if not pos_net or not neg_net:
            errors.append(
                f"Relay coil '{part_id}' terminals ('{pos_pin_ref}', '{neg_pin_ref}') must be connected"
            )
            continue

        # Rule: A relay coil needs a flyback diode across its terminals (cathode to positive, anode to negative)
        has_flyback = False
        for d_id, d_type in parts.items():
            if d_type == "diode":
                cathode_net = seen_pins.get(f"{d_id}.cathode")
                anode_net = seen_pins.get(f"{d_id}.anode")
                if cathode_net == pos_net and anode_net == neg_net:
                    has_flyback = True
                    break
        if not has_flyback:
            errors.append(
                f"Relay coil '{part_id}' needs a flyback diode connected across its coil terminals ('{pos_pin_ref}' and '{neg_pin_ref}')"
            )

        # Rule: A relay driven from a GPIO needs a transistor
        for c_net_name in (pos_net, neg_net):
            for p_ref in nets.get(c_net_name, []):
                if p_ref in (pos_pin_ref, neg_pin_ref):
                    continue
                _, _, pinfo = _get_pin_info(p_ref, parts, lib)
                if pinfo and pinfo.get("role") == "gpio":
                    errors.append(
                        f"Relay coil '{part_id}' driven directly from GPIO pin '{p_ref}' on net '{c_net_name}' needs a driver transistor"
                    )

    # 6. Transistor rules: base resistor when driven by GPIO, emitter on ground, base current limits
    for part_id, ctype in parts.items():
        cinfo = lib.get(ctype, {})
        pins = cinfo.get("pins", {})
        if ctype != "transistor" and not ("base" in pins and "emitter" in pins):
            continue

        emitter_ref = f"{part_id}.emitter"
        emitter_net = seen_pins.get(emitter_ref)
        if not emitter_net:
            errors.append(f"Transistor '{part_id}' emitter is not connected")
        else:
            has_ground = False
            for p_ref in nets.get(emitter_net, []):
                _, _, pinfo = _get_pin_info(p_ref, parts, lib)
                if pinfo and pinfo.get("role") == "ground":
                    has_ground = True
                    break
            if not has_ground:
                errors.append(f"Transistor '{part_id}' emitter is not on a ground net '{emitter_net}'")

        base_ref = f"{part_id}.base"
        base_net = seen_pins.get(base_ref)
        if not base_net:
            errors.append(f"Transistor '{part_id}' base is not connected")
            continue

        # Check if base net directly contains a GPIO pin
        for p_ref in nets.get(base_net, []):
            if p_ref == base_ref:
                continue
            _, _, pinfo = _get_pin_info(p_ref, parts, lib)
            if pinfo and pinfo.get("role") == "gpio":
                errors.append(
                    f"Transistor '{part_id}' base on net '{base_net}' is directly connected to GPIO pin '{p_ref}' without a series base resistor"
                )

        # Check if base is driven through a resistor by a GPIO pin
        resistor_part_id = None
        resistor_pin_name = None
        for p_ref in nets.get(base_net, []):
            if p_ref == base_ref:
                continue
            p_id, p_type, _ = _get_pin_info(p_ref, parts, lib)
            if p_type == "resistor":
                resistor_part_id = p_id
                resistor_pin_name = p_ref.split(".")[1]
                break

        if resistor_part_id:
            other_r_pin = "a" if resistor_pin_name == "b" else "b"
            other_r_ref = f"{resistor_part_id}.{other_r_pin}"
            gpio_net = seen_pins.get(other_r_ref)
            if gpio_net:
                for p_ref in nets.get(gpio_net, []):
                    if p_ref == other_r_ref:
                        continue
                    _, _, ginfo = _get_pin_info(p_ref, parts, lib)
                    if ginfo and ginfo.get("role") == "gpio":
                        vbe = cinfo.get("vbe", 0.7)
                        v_gpio = ginfo.get("level", 3.3)
                        r_ohms = values.get(resistor_part_id, 0)
                        if isinstance(v_gpio, (int, float)) and r_ohms and r_ohms > 0:
                            base_current_ma = (v_gpio - vbe) / r_ohms * 1000.0
                            raw_max = ginfo.get("max_source_ma")
                            if raw_max == "UNVERIFIED":
                                warn_msg = (
                                    f"Limit 'max_source_ma' on '{p_ref}' is UNVERIFIED; "
                                    f"using conservative default of {DEFAULT_UNVERIFIED_MAX_SOURCE_MA} mA"
                                )
                                if warn_msg not in warnings:
                                    warnings.append(warn_msg)
                                max_source_ma = DEFAULT_UNVERIFIED_MAX_SOURCE_MA
                            elif isinstance(raw_max, (int, float)):
                                max_source_ma = raw_max
                            else:
                                max_source_ma = 16

                            if base_current_ma > max_source_ma:
                                errors.append(
                                    f"Base current {base_current_ma:.1f} mA exceeds GPIO rated limit of {max_source_ma} mA on '{p_ref}'"
                                )
                        else:
                            errors.append(
                                f"Transistor '{part_id}' base resistor '{resistor_part_id}' must have a positive resistance value"
                            )

    # 7. LED rules: cathode on ground, current-limiting resistor, current limits
    for part_id, ctype in parts.items():
        if ctype != "led":
            continue

        cathode_ref = f"{part_id}.cathode"
        anode_ref = f"{part_id}.anode"

        # Check cathode is on a ground net
        cathode_net = seen_pins.get(cathode_ref)
        if not cathode_net:
            errors.append(f"LED '{part_id}' cathode is not connected")
        else:
            has_ground = False
            for p_ref in nets.get(cathode_net, []):
                _, _, pinfo = _get_pin_info(p_ref, parts, lib)
                if pinfo and pinfo.get("role") == "ground":
                    has_ground = True
                    break
            if not has_ground:
                errors.append(f"LED '{part_id}' cathode is not on a ground net '{cathode_net}'")

        # Check current-limiting resistor on anode
        anode_net = seen_pins.get(anode_ref)
        if not anode_net:
            errors.append(f"LED '{part_id}' anode is not connected")
            continue

        resistor_part_id = None
        resistor_pin_name = None
        for p_ref in nets.get(anode_net, []):
            p_id, p_type, _ = _get_pin_info(p_ref, parts, lib)
            if p_type == "resistor":
                resistor_part_id = p_id
                resistor_pin_name = p_ref.split(".")[1]
                break

        if not resistor_part_id:
            errors.append(f"LED '{part_id}' has no current-limiting resistor on anode net '{anode_net}'")
            continue

        # Trace resistor to the other pin to find driver/voltage
        other_r_pin = "a" if resistor_pin_name == "b" else "b"
        other_r_ref = f"{resistor_part_id}.{other_r_pin}"
        other_net = seen_pins.get(other_r_ref)

        if other_net:
            for p_ref in nets.get(other_net, []):
                if p_ref == other_r_ref:
                    continue
                _, _, driver_info = _get_pin_info(p_ref, parts, lib)
                if not driver_info:
                    continue
                role = driver_info.get("role")
                level = driver_info.get("level")
                v = driver_info.get("v")

                v_source = level if level is not None else v
                if isinstance(v_source, (int, float)):
                    vf = lib.get("led", {}).get("vf", 2.0)
                    r_ohms = values.get(resistor_part_id, 0)
                    if r_ohms and r_ohms > 0:
                        current_ma = (v_source - vf) / r_ohms * 1000.0
                        if role in ("gpio", "output"):
                            raw_max = driver_info.get("max_source_ma")
                            if raw_max == "UNVERIFIED":
                                warn_msg = (
                                    f"Limit 'max_source_ma' on '{p_ref}' is UNVERIFIED; "
                                    f"using conservative default of {DEFAULT_UNVERIFIED_MAX_SOURCE_MA} mA"
                                )
                                if warn_msg not in warnings:
                                    warnings.append(warn_msg)
                                max_source_ma = DEFAULT_UNVERIFIED_MAX_SOURCE_MA
                            elif isinstance(raw_max, (int, float)):
                                max_source_ma = raw_max
                            else:
                                max_source_ma = 16 if role == "gpio" else None

                            if max_source_ma is not None and current_ma > max_source_ma:
                                pin_type = "GPIO" if role == "gpio" else "output"
                                errors.append(
                                    f"Current {current_ma:.1f} mA exceeds {pin_type} rated limit of {max_source_ma} mA on '{p_ref}'"
                                )

                        raw_led_max = lib.get("led", {}).get("max_ma", 20)
                        if raw_led_max == "UNVERIFIED":
                            warn_msg = (
                                f"Limit 'max_ma' on LED '{part_id}' is UNVERIFIED; "
                                f"using conservative default of 10.0 mA"
                            )
                            if warn_msg not in warnings:
                                warnings.append(warn_msg)
                            max_led_ma = 10.0
                        elif isinstance(raw_led_max, (int, float)):
                            max_led_ma = raw_led_max
                        else:
                            max_led_ma = 20

                        if current_ma > max_led_ma:
                            errors.append(
                                f"Current {current_ma:.1f} mA exceeds LED limit of {max_led_ma} mA on '{part_id}'"
                            )

    # 8. Check input sink current limits if driven by a source
    for net_name, pin_list in nets.items():
        sink_pins = []
        source_pins = []
        for pin_ref in pin_list:
            _, _, pinfo = _get_pin_info(pin_ref, parts, lib)
            if not pinfo:
                continue
            if "max_sink_ma" in pinfo:
                sink_pins.append((pin_ref, pinfo))
            elif pinfo.get("role") in ("gpio", "power", "output"):
                source_pins.append((pin_ref, pinfo))

        for s_ref, s_info in sink_pins:
            raw_sink = s_info.get("max_sink_ma")
            if raw_sink == "UNVERIFIED":
                warn_msg = (
                    f"Limit 'max_sink_ma' on '{s_ref}' is UNVERIFIED; "
                    f"using conservative default of {DEFAULT_UNVERIFIED_MAX_SINK_MA} mA"
                )
                if warn_msg not in warnings:
                    warnings.append(warn_msg)
                effective_sink = DEFAULT_UNVERIFIED_MAX_SINK_MA
            elif isinstance(raw_sink, (int, float)):
                effective_sink = raw_sink
            else:
                effective_sink = None

            if effective_sink is not None:
                for src_ref, src_info in source_pins:
                    src_max = src_info.get("max_source_ma")
                    if isinstance(src_max, (int, float)) and src_max < effective_sink:
                        errors.append(
                            f"Pin '{src_ref}' max source current {src_max} mA cannot support '{s_ref}' sink requirement of {effective_sink} mA on net '{net_name}'"
                        )

    return errors, warnings


def check(netlist, lib):
    errors, _ = check_with_warnings(netlist, lib)
    return errors
