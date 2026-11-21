import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from checker import check, load_parts  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()
