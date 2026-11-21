import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class CLITests(unittest.TestCase):
    def test_json_flag_success(self):
        cmd = [sys.executable, str(ROOT / "main.py"), "--json", str(ROOT / "examples" / "blink_led.json")]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertTrue(data["ok"])
        self.assertEqual(data["errors"], [])
        self.assertIn("warnings", data)
        self.assertIsInstance(data["warnings"], list)
        self.assertTrue(len(data["steps"]) > 0)

    def test_json_flag_failure(self):
        cmd = [sys.executable, str(ROOT / "main.py"), "--json", str(ROOT / "examples" / "pir_bad_5v.json")]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertFalse(data["ok"])
        self.assertTrue(len(data["errors"]) > 0)
        self.assertIn("warnings", data)
        self.assertIsInstance(data["warnings"], list)
        self.assertEqual(data["steps"], [])

    def test_cli_standard_success(self):
        cmd = [sys.executable, str(ROOT / "main.py"), str(ROOT / "examples" / "pir_light.json")]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("# Build: pir_light", res.stdout)
        self.assertIn("### Power", res.stdout)
        self.assertIn("Warning: Limit 'max_source_ma' on 'pir.OUT' is UNVERIFIED", res.stdout)

    def test_pir_light_produces_warning_about_pir_out_in_cli(self):
        cmd = [sys.executable, str(ROOT / "main.py"), str(ROOT / "examples" / "pir_light.json")]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("Warning:", res.stdout)
        self.assertIn("pir.OUT", res.stdout)
        self.assertIn("UNVERIFIED", res.stdout)

    def test_cli_standard_failure(self):
        cmd = [sys.executable, str(ROOT / "main.py"), str(ROOT / "examples" / "pir_bad_5v.json")]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("Error:", res.stdout)


if __name__ == "__main__":
    unittest.main()
