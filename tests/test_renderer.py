import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from renderer import render  # noqa: E402


class RendererTests(unittest.TestCase):
    def test_renderer_groups_by_subsystem_and_preserves_power_steps(self):
        design = {
            "name": "test_build",
            "parts": {"pi": "raspberry_pi_4", "led1": "led", "r1": "resistor"},
            "values": {"r1": 330},
            "nets": {
                "SIGNAL": ["pi.GPIO17", "r1.a"],
                "LED_ANODE": ["r1.b", "led1.anode"],
                "GND": ["pi.GND", "led1.cathode"],
            },
        }
        output = render(design)

        # Warning exists
        self.assertIn("Power is off for all steps. Do not connect power until the final step.", output)

        # Subsystem headers exist in order: Power -> Signal -> Output
        power_idx = output.find("### Power")
        signal_idx = output.find("### Signal")
        output_idx = output.find("### Output")

        self.assertNotEqual(power_idx, -1)
        self.assertNotEqual(signal_idx, -1)
        self.assertNotEqual(output_idx, -1)
        self.assertTrue(power_idx < signal_idx < output_idx)

        # Final power on step exists
        self.assertIn("Power on. Confirm the LED lights, then power off to finish.", output)

        # Continuity check present
        self.assertIn("multimeter continuity between", output)


if __name__ == "__main__":
    unittest.main()
