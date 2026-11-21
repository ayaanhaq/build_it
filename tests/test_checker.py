import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from checker import DEFAULT_UNVERIFIED_MAX_SOURCE_MA, check, check_with_warnings, load_parts  # noqa: E402

LIB = load_parts()


def led_design(ohms=330, gpio="GPIO17", with_resistor=True):
    nets = {
        "SIGNAL": [f"pi.{gpio}"],
        "LED_ANODE": ["led1.anode"],
        "GND": ["pi.GND", "led1.cathode"],
    }
    values = {}
    parts = {"pi": "raspberry_pi_4", "led1": "led"}
    if with_resistor:
        parts["r1"] = "resistor"
        values["r1"] = ohms
        nets["SIGNAL"].append("r1.a")
        nets["LED_ANODE"].append("r1.b")
    return {"name": "t", "parts": parts, "values": values, "nets": nets}


def get_errors(netlist, lib=None):
    if lib is None:
        lib = LIB
    return check(netlist, lib)


class CheckerTests(unittest.TestCase):
    def get_errors(self, netlist, lib=None):
        return get_errors(netlist, lib)

    def test_valid_led_passes(self):
        self.assertEqual(self.get_errors(led_design(330)), [])

    def test_missing_resistor_fails(self):
        errors = self.get_errors(led_design(with_resistor=False))
        self.assertTrue(any("LED 'led1' has no current-limiting resistor on anode net 'LED_ANODE'" in e for e in errors))

    def test_overcurrent_fails(self):
        # Backward compatibility check; verifies both split overcurrent tests
        self.test_gpio_overcurrent_fails()
        self.test_led_overcurrent_fails()

    def test_gpio_overcurrent_fails(self):
        # (3.3V GPIO - 2.0V Vf) / 47 ohm = 27.7 mA
        # Exceeds the 16 mA GPIO rating on pi.GPIO17.
        # Use an LED with max_ma = 50 so that the LED limit is NOT exceeded,
        # proving that the GPIO rule specifically fires and the LED rule does not.
        custom_lib = dict(LIB)
        custom_lib["led"] = dict(LIB["led"], max_ma=50)
        errors = self.get_errors(led_design(47), custom_lib)
        self.assertEqual(len(errors), 1)
        self.assertIn("Current 27.7 mA exceeds GPIO rated limit of 16 mA on 'pi.GPIO17'", errors[0])
        self.assertNotIn("LED limit", errors[0])

        # Also verify with standard library that the exact GPIO rated limit string is present
        default_errors = self.get_errors(led_design(47), LIB)
        gpio_errors = [e for e in default_errors if "GPIO rated limit" in e]
        self.assertEqual(len(gpio_errors), 1)
        self.assertIn("Current 27.7 mA exceeds GPIO rated limit of 16 mA on 'pi.GPIO17'", gpio_errors[0])
        self.assertNotIn("LED limit", gpio_errors[0])

    def test_led_overcurrent_fails(self):
        # (3.3V GPIO - 2.0V Vf) / 330 ohm = 3.9 mA
        # Under the 16 mA GPIO limit, but exceeds a test-only LED with max_ma = 2 mA.
        # Proves that the LED limit rule specifically fires and the GPIO rule does not.
        custom_lib = dict(LIB)
        custom_lib["led"] = dict(LIB["led"], max_ma=2)
        errors = self.get_errors(led_design(330), custom_lib)
        self.assertEqual(len(errors), 1)
        self.assertIn("Current 3.9 mA exceeds LED limit of 2 mA on 'led1'", errors[0])
        self.assertNotIn("GPIO rated limit", errors[0])

    def test_5v_on_gpio_net_fails(self):
        design = led_design(330)
        design["nets"]["SIGNAL"].append("pi.5V")
        errors = self.get_errors(design)
        self.assertTrue(any("5.0V pin on a 3.3V GPIO net 'SIGNAL'" in e for e in errors))

    def test_pin_on_two_nets_fails(self):
        design = led_design(330)
        design["nets"]["GND"].append("pi.GPIO17")
        errors = self.get_errors(design)
        self.assertTrue(any("Pin 'pi.GPIO17' is on both net 'SIGNAL' and net 'GND'" in e for e in errors))

    def test_unknown_pin_fails(self):
        design = led_design(330)
        design["nets"]["GND"].append("pi.GPIO99")
        errors = self.get_errors(design)
        self.assertTrue(any("Part 'pi' (raspberry_pi_4) has no pin 'GPIO99' in net 'GND'" in e for e in errors))

    def test_cathode_not_on_ground_fails(self):
        design = led_design(330)
        design["nets"]["GND"] = ["pi.GND"]
        design["nets"]["LED_CATHODE"] = ["led1.cathode"]
        errors = self.get_errors(design)
        self.assertTrue(any("LED 'led1' cathode is not on a ground net 'LED_CATHODE'" in e for e in errors))

    def test_5v_sensor_driving_gpio_fails(self):
        design = {
            "name": "pir_bad_gpio",
            "parts": {"pir": "pir_sensor_5v", "pi": "raspberry_pi_4"},
            "values": {},
            "nets": {
                "SENSOR_NET": ["pir.OUT", "pi.GPIO17"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("5.0V sensor output 'pir.OUT' cannot directly drive 3.3V GPIO pin 'pi.GPIO17' on net 'SENSOR_NET'" in e for e in errors))

    def test_relay_coil_missing_flyback_diode_fails(self):
        design = {
            "name": "relay_no_diode",
            "parts": {
                "pi": "raspberry_pi_4",
                "k1": "relay",
                "q1": "transistor",
                "r1": "resistor"
            },
            "values": {"r1": 1000},
            "nets": {
                "VCC": ["pi.5V", "k1.coil_pos"],
                "COIL_DRIVE": ["k1.coil_neg", "q1.collector"],
                "BASE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "GND": ["pi.GND", "q1.emitter"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Relay coil 'k1' needs a flyback diode connected across its coil terminals ('k1.coil_pos' and 'k1.coil_neg')" in e for e in errors))

    def test_relay_driven_from_gpio_needs_transistor_fails(self):
        design = {
            "name": "relay_direct_gpio",
            "parts": {
                "pi": "raspberry_pi_4",
                "k1": "relay",
                "d1": "diode"
            },
            "values": {},
            "nets": {
                "GPIO_COIL": ["pi.GPIO17", "k1.coil_pos", "d1.cathode"],
                "GND": ["pi.GND", "k1.coil_neg", "d1.anode"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Relay coil 'k1' driven directly from GPIO pin 'pi.GPIO17' on net 'GPIO_COIL' needs a driver transistor" in e for e in errors))

    def test_valid_relay_with_transistor_and_diode_passes(self):
        design = {
            "name": "relay_valid",
            "parts": {
                "pi": "raspberry_pi_4",
                "k1": "relay",
                "d1": "diode",
                "q1": "transistor",
                "r1": "resistor"
            },
            "values": {"r1": 1000},
            "nets": {
                "VCC": ["pi.5V", "k1.coil_pos", "d1.cathode"],
                "COIL_DRIVE": ["k1.coil_neg", "d1.anode", "q1.collector"],
                "BASE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "GND": ["pi.GND", "q1.emitter"]
            }
        }
        self.assertEqual(check(design, LIB), [])

    def test_relay_module_passes(self):
        design = {
            "name": "relay_mod",
            "parts": {
                "pi": "raspberry_pi_4",
                "k1": "relay_module"
            },
            "values": {},
            "nets": {
                "VCC": ["pi.5V", "k1.VCC"],
                "GND": ["pi.GND", "k1.GND"],
                "CONTROL": ["pi.GPIO17", "k1.IN"]
            }
        }
        self.assertEqual(check(design, LIB), [])

    def test_pir_light_example_passes(self):
        example_path = Path(__file__).resolve().parent.parent / "examples" / "pir_light.json"
        with open(example_path, "r") as f:
            design = json.load(f)
        self.assertEqual(check(design, LIB), [])

    def test_pir_bad_5v_example_rejected(self):
        example_path = Path(__file__).resolve().parent.parent / "examples" / "pir_bad_5v.json"
        with open(example_path, "r") as f:
            design = json.load(f)
        errors = self.get_errors(design)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("5.0V sensor output 'pir.OUT' cannot directly drive 3.3V GPIO pin 'pi.GPIO17' on net 'SENSOR_SIGNAL'" in e for e in errors))

    def test_sensor_with_non_matching_name_rejected(self):
        custom_lib = dict(LIB)
        custom_lib["motion_det"] = {
            "is_sensor": True,
            "pins": {
                "VCC": {"role": "power", "v": 5.0},
                "GND": {"role": "ground"},
                "OUT": {"role": "output", "level": 5.0, "max_source_ma": 20}
            }
        }
        design = {
            "name": "custom_sensor_test",
            "parts": {"s1": "motion_det", "pi": "raspberry_pi_4"},
            "values": {},
            "nets": {
                "NET1": ["s1.OUT", "pi.GPIO17"]
            }
        }
        errors = self.get_errors(design, custom_lib)
        self.assertTrue(any("5.0V sensor output 's1.OUT' cannot directly drive 3.3V GPIO pin 'pi.GPIO17' on net 'NET1'" in e for e in errors))

    def test_part_with_pir_in_name_but_not_sensor_not_treated_as_sensor(self):
        custom_lib = dict(LIB)
        custom_lib["mock_pir"] = {
            "is_sensor": False,
            "pins": {
                "VCC": {"role": "power", "v": 5.0},
                "GND": {"role": "ground"},
                "OUT": {"role": "output", "level": 5.0}
            }
        }
        design = {
            "name": "not_a_sensor_test",
            "parts": {"chip1": "mock_pir", "pi": "raspberry_pi_4"},
            "values": {},
            "nets": {
                "NET1": ["chip1.OUT", "pi.GPIO17"]
            }
        }
        errors = self.get_errors(design, custom_lib)
        self.assertFalse(any("5.0V sensor output" in e for e in errors))

    def test_led_unverified_gpio_limit_under_8ma_warns_and_passes(self):
        custom_lib = dict(LIB)
        custom_lib["custom_mcu"] = {
            "pins": {
                "GPIO1": {"role": "gpio", "level": 3.3, "max_source_ma": "UNVERIFIED"},
                "GND": {"role": "ground"},
            }
        }
        # (3.3 - 2.0) / 330 ohm = ~3.94 mA < 8.0 mA
        design = {
            "name": "unverified_gpio_pass",
            "parts": {"mcu": "custom_mcu", "led1": "led", "r1": "resistor"},
            "values": {"r1": 330},
            "nets": {
                "SIGNAL": ["mcu.GPIO1", "r1.a"],
                "LED_ANODE": ["r1.b", "led1.anode"],
                "GND": ["mcu.GND", "led1.cathode"],
            },
        }
        errors, warnings = check_with_warnings(design, custom_lib)
        self.assertEqual(errors, [])
        self.assertTrue(any("max_source_ma" in w and "UNVERIFIED" in w for w in warnings))
        self.assertEqual(check(design, custom_lib), [])

    def test_led_unverified_sensor_limit_under_8ma_warns_and_passes(self):
        example_path = Path(__file__).resolve().parent.parent / "examples" / "pir_light.json"
        with open(example_path, "r") as f:
            design = json.load(f)
        errors, warnings = check_with_warnings(design, LIB)
        self.assertEqual(errors, [])
        self.assertTrue(any("pir.OUT" in w and "UNVERIFIED" in w for w in warnings))
        self.assertEqual(check(design, LIB), [])

    def test_led_unverified_gpio_limit_over_8ma_fails(self):
        # (3.3 - 2.0) / 100 ohm = 13.0 mA > 8.0 mA default
        custom_lib = dict(LIB)
        custom_lib["custom_mcu"] = {
            "pins": {
                "GPIO1": {"role": "gpio", "level": 3.3, "max_source_ma": "UNVERIFIED"},
                "GND": {"role": "ground"},
            }
        }
        design = {
            "name": "unverified_gpio_fail",
            "parts": {"mcu": "custom_mcu", "led1": "led", "r1": "resistor"},
            "values": {"r1": 100},
            "nets": {
                "SIGNAL": ["mcu.GPIO1", "r1.a"],
                "LED_ANODE": ["r1.b", "led1.anode"],
                "GND": ["mcu.GND", "led1.cathode"],
            },
        }
        errors, warnings = check_with_warnings(design, custom_lib)
        self.assertTrue(any("max_source_ma" in w and "UNVERIFIED" in w for w in warnings))
        self.assertTrue(any("exceeds" in e and "8.0" in e for e in errors))
        self.assertTrue(any("exceeds" in e and "8.0" in e for e in check(design, custom_lib)))

    def test_led_unverified_sensor_limit_over_8ma_fails(self):
        # pir_sensor with 100 ohm resistor: current is 13.0 mA > 8.0 mA default
        design = {
            "name": "pir_overcurrent",
            "parts": {"pi": "raspberry_pi_4", "pir": "pir_sensor", "led1": "led", "r1": "resistor"},
            "values": {"r1": 100},
            "nets": {
                "POWER": ["pi.5V", "pir.VCC"],
                "GND": ["pi.GND", "pir.GND", "led1.cathode"],
                "SIGNAL": ["pir.OUT", "r1.a"],
                "LED_ANODE": ["r1.b", "led1.anode"],
            },
        }
        errors, warnings = check_with_warnings(design, LIB)
        self.assertTrue(any("pir.OUT" in w and "UNVERIFIED" in w for w in warnings))
        self.assertTrue(any("exceeds" in e and "8.0" in e for e in errors))
        self.assertTrue(any("exceeds" in e and "8.0" in e for e in check(design, LIB)))

    def test_transistor_base_directly_to_gpio_fails(self):
        design = {
            "name": "transistor_direct_gpio",
            "parts": {"pi": "raspberry_pi_4", "q1": "transistor"},
            "values": {},
            "nets": {
                "BASE": ["pi.GPIO17", "q1.base"],
                "GND": ["pi.GND", "q1.emitter"],
            },
        }
        errors = self.get_errors(design)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("Transistor 'q1' base on net 'BASE' is directly connected to GPIO pin 'pi.GPIO17' without a series base resistor" in e for e in errors))

    def test_transistor_base_through_1k_resistor_passes(self):
        design = {
            "name": "transistor_1k_resistor",
            "parts": {
                "pi": "raspberry_pi_4",
                "q1": "transistor",
                "r1": "resistor",
            },
            "values": {"r1": 1000},
            "nets": {
                "BASE_DRIVE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "GND": ["pi.GND", "q1.emitter"],
            },
        }
        self.assertEqual(self.get_errors(design), [])

    def test_transistor_base_through_100ohm_resistor_fails_with_gpio_limit_error(self):
        # (3.3 - 0.7) / 100 = 26.0 mA > 16 mA GPIO limit
        design = {
            "name": "transistor_100ohm_resistor",
            "parts": {
                "pi": "raspberry_pi_4",
                "q1": "transistor",
                "r1": "resistor",
            },
            "values": {"r1": 100},
            "nets": {
                "BASE_DRIVE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "GND": ["pi.GND", "q1.emitter"],
            },
        }
        errors = self.get_errors(design)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("Base current 26.0 mA exceeds GPIO rated limit of 16 mA on 'pi.GPIO17'" in e for e in errors))

    def test_transistor_emitter_not_on_ground_fails(self):
        design = {
            "name": "transistor_no_ground_emitter",
            "parts": {
                "pi": "raspberry_pi_4",
                "q1": "transistor",
                "r1": "resistor",
            },
            "values": {"r1": 1000},
            "nets": {
                "BASE_DRIVE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "EMITTER": ["q1.emitter"],
                "GND": ["pi.GND"],
            },
        }
        errors = self.get_errors(design)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("Transistor 'q1' emitter is not on a ground net 'EMITTER'" in e for e in errors))

    def test_invalid_pin_reference_fails(self):
        design = {
            "name": "invalid_pin_ref",
            "parts": {"pi": "raspberry_pi_4"},
            "values": {},
            "nets": {"BAD_NET": ["pi"]}
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Invalid pin reference 'pi' in net 'BAD_NET'" in e for e in errors))

    def test_unknown_part_referenced_fails(self):
        design = {
            "name": "unknown_part",
            "parts": {"pi": "raspberry_pi_4"},
            "values": {},
            "nets": {"BAD_NET": ["nonexistent.pin"]}
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Unknown part 'nonexistent' referenced in net 'BAD_NET'" in e for e in errors))

    def test_unknown_part_type_fails(self):
        design = {
            "name": "unknown_type",
            "parts": {"p1": "flux_capacitor"},
            "values": {},
            "nets": {"BAD_NET": ["p1.pin1"]}
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Unknown part type 'flux_capacitor' for part 'p1' in net 'BAD_NET'" in e for e in errors))

    def test_relay_coil_terminals_must_be_connected_fails(self):
        design = {
            "name": "relay_disconnected_coils",
            "parts": {"pi": "raspberry_pi_4", "k1": "relay"},
            "values": {},
            "nets": {"GND": ["pi.GND"]}
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Relay coil 'k1' terminals ('k1.coil_pos', 'k1.coil_neg') must be connected" in e for e in errors))

    def test_transistor_emitter_not_connected_fails(self):
        design = {
            "name": "transistor_emitter_unconnected",
            "parts": {"pi": "raspberry_pi_4", "q1": "transistor", "r1": "resistor"},
            "values": {"r1": 1000},
            "nets": {
                "BASE_DRIVE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "GND": ["pi.GND"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Transistor 'q1' emitter is not connected" in e for e in errors))

    def test_transistor_base_not_connected_fails(self):
        design = {
            "name": "transistor_base_unconnected",
            "parts": {"pi": "raspberry_pi_4", "q1": "transistor"},
            "values": {},
            "nets": {
                "GND": ["pi.GND", "q1.emitter"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Transistor 'q1' base is not connected" in e for e in errors))

    def test_transistor_base_resistor_positive_resistance_fails(self):
        design = {
            "name": "transistor_zero_resistor",
            "parts": {"pi": "raspberry_pi_4", "q1": "transistor", "r1": "resistor"},
            "values": {"r1": 0},
            "nets": {
                "BASE_DRIVE": ["pi.GPIO17", "r1.a"],
                "BASE_IN": ["r1.b", "q1.base"],
                "GND": ["pi.GND", "q1.emitter"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("Transistor 'q1' base resistor 'r1' must have a positive resistance value" in e for e in errors))

    def test_led_cathode_not_connected_fails(self):
        design = {
            "name": "led_cathode_unconnected",
            "parts": {"pi": "raspberry_pi_4", "led1": "led", "r1": "resistor"},
            "values": {"r1": 330},
            "nets": {
                "SIGNAL": ["pi.GPIO17", "r1.a"],
                "LED_ANODE": ["r1.b", "led1.anode"],
                "GND": ["pi.GND"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("LED 'led1' cathode is not connected" in e for e in errors))

    def test_led_anode_not_connected_fails(self):
        design = {
            "name": "led_anode_unconnected",
            "parts": {"pi": "raspberry_pi_4", "led1": "led"},
            "values": {},
            "nets": {
                "GND": ["pi.GND", "led1.cathode"]
            }
        }
        errors = self.get_errors(design)
        self.assertTrue(any("LED 'led1' anode is not connected" in e for e in errors))

    def test_source_current_cannot_support_sink_requirement_fails(self):
        custom_lib = dict(LIB)
        custom_lib["weak_mcu"] = {
            "pins": {
                "GPIO1": {"role": "gpio", "level": 3.3, "max_source_ma": 2},
                "GND": {"role": "ground"}
            }
        }
        design = {
            "name": "weak_source_sink_fail",
            "parts": {"mcu": "weak_mcu", "k1": "relay_module"},
            "values": {},
            "nets": {
                "CONTROL": ["mcu.GPIO1", "k1.IN"],
                "GND": ["mcu.GND", "k1.GND"]
            }
        }
        errors = self.get_errors(design, custom_lib)
        self.assertTrue(any("Pin 'mcu.GPIO1' max source current 2 mA cannot support 'k1.IN' sink requirement of 5.0 mA on net 'CONTROL'" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
