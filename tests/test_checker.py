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


class CheckerTests(unittest.TestCase):
    def test_valid_led_passes(self):
        self.assertEqual(check(led_design(330), LIB), [])

    def test_missing_resistor_fails(self):
        errors = check(led_design(with_resistor=False), LIB)
        self.assertTrue(any("no current-limiting resistor" in e for e in errors))

    def test_overcurrent_fails(self):
        # (3.3 - 2.0) / 47 ohm is about 27.7 mA, over the 16 mA GPIO rating
        errors = check(led_design(47), LIB)
        self.assertTrue(any("GPIO rated" in e or "limit" in e for e in errors))

    def test_5v_on_gpio_net_fails(self):
        design = led_design(330)
        design["nets"]["SIGNAL"].append("pi.5V")
        errors = check(design, LIB)
        self.assertTrue(any("5.0V pin on a 3.3V GPIO" in e for e in errors))

    def test_pin_on_two_nets_fails(self):
        design = led_design(330)
        design["nets"]["GND"].append("pi.GPIO17")
        errors = check(design, LIB)
        self.assertTrue(any("both net" in e for e in errors))

    def test_unknown_pin_fails(self):
        design = led_design(330)
        design["nets"]["GND"].append("pi.GPIO99")
        errors = check(design, LIB)
        self.assertTrue(any("no pin 'GPIO99'" in e for e in errors))

    def test_cathode_not_on_ground_fails(self):
        design = led_design(330)
        design["nets"]["GND"] = ["pi.GND"]
        design["nets"]["LED_CATHODE"] = ["led1.cathode"]
        errors = check(design, LIB)
        self.assertTrue(any("not on a ground net" in e for e in errors))

    def test_5v_sensor_driving_gpio_fails(self):
        design = {
            "name": "pir_bad_gpio",
            "parts": {"pir": "pir_sensor_5v", "pi": "raspberry_pi_4"},
            "values": {},
            "nets": {
                "SENSOR_NET": ["pir.OUT", "pi.GPIO17"]
            }
        }
        errors = check(design, LIB)
        self.assertTrue(any("5.0V sensor output" in e or "cannot directly drive" in e for e in errors))

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
        errors = check(design, LIB)
        self.assertTrue(any("flyback diode" in e for e in errors))

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
        errors = check(design, LIB)
        self.assertTrue(any("transistor" in e for e in errors))

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
        errors = check(design, LIB)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("5.0V sensor output" in e or "3.3V GPIO" in e for e in errors))

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
        errors = check(design, custom_lib)
        self.assertTrue(any("5.0V sensor output" in e and "cannot directly drive" in e for e in errors))

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
        errors = check(design, custom_lib)
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
        errors = check(design, LIB)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("q1" in e and "GPIO17" in e for e in errors))

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
        self.assertEqual(check(design, LIB), [])

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
        errors = check(design, LIB)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("exceeds GPIO rated limit" in e or ("GPIO" in e and "limit" in e) for e in errors))
        self.assertTrue(any("26.0" in e for e in errors))

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
        errors = check(design, LIB)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("emitter" in e and "ground" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
