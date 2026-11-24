import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CLI_TEST_PATH = REPO_ROOT / "tests" / "test_generate_scene_cli.mjs"


def run_cli_tests() -> dict:
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(CLI_TEST_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class GenerateSceneCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_cli_tests()

    def test_overall_cli_suite_passed(self):
        self.assertTrue(self.data.get("passed"))

    def test_save_writes_valid_json_without_raw_output(self):
        res = self.data["saveValidJsonWithoutRawOutput"]
        self.assertEqual(res["exitCode"], 0)
        self.assertTrue(res["complete"])
        self.assertEqual(res["stepCount"], 2)
        self.assertFalse(res["hasRawOutput"])
        self.assertFalse(res["containsKey"])
        self.assertTrue(res["valid"])

    def test_debug_writes_chunks_to_stderr_without_key(self):
        res = self.data["debugWritesStderrNeverKey"]
        self.assertEqual(res["exitCode"], 0)
        self.assertTrue(res["stderrHasRawChunk"])
        self.assertFalse(res["stderrContainsKey"])
        self.assertTrue(res["savedHasRawOutput"])
        self.assertFalse(res["savedContainsKey"])
        self.assertTrue(res["valid"])

    def test_failed_run_saves_partial_incomplete_file(self):
        res = self.data["failedRunSavesPartialIncomplete"]
        self.assertNotEqual(res["exitCode"], 0)
        self.assertIs(res["complete"], False)
        self.assertEqual(res["savedStepCount"], 1)
        self.assertTrue(res["hasError"])
        self.assertTrue(res["valid"])

    def test_save_without_path_fails(self):
        res = self.data["saveWithoutPathFails"]
        self.assertNotEqual(res["exitCode"], 0)
        self.assertTrue(res["valid"])


if __name__ == "__main__":
    unittest.main()
