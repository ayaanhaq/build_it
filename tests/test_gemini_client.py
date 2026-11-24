import json
import os
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CLIENT_TEST_PATH = REPO_ROOT / "tests" / "test_gemini_client.mjs"
CLI_SCRIPT_PATH = REPO_ROOT / "scripts" / "generate-scene.ts"


def run_client_tests() -> dict:
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(CLIENT_TEST_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class GeminiClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_client_tests()

    def test_overall_gemini_client_suite_passed(self):
        self.assertTrue(self.data.get("passed"))

    def test_multi_event_stream_yields_in_order(self):
        self.assertTrue(self.data["multiEventOrder"]["valid"])

    def test_split_event_across_network_chunks(self):
        self.assertTrue(self.data["splitAcrossChunks"]["valid"])

    def test_retries_once_on_429_and_succeeds(self):
        res = self.data["retry429Then200"]
        self.assertEqual(res["callCount"], 2)
        self.assertTrue(res["valid"])

    def test_does_not_retry_on_400_and_throws_client_error(self):
        res = self.data["noRetryOn400"]
        self.assertEqual(res["callCount"], 1)
        self.assertTrue(res["isGeminiClientError"])
        self.assertEqual(res["status"], 400)
        self.assertTrue(res["valid"])

    def test_missing_api_key_throws_before_request(self):
        res = self.data["missingApiKey"]
        self.assertEqual(res["callCount"], 0)
        self.assertTrue(res["isGeminiClientError"])
        self.assertTrue(res["valid"])

    def test_error_never_contains_api_key_or_url(self):
        res = self.data["sanitizedError"]
        self.assertTrue(res["isGeminiClientError"])
        self.assertFalse(res["containsKey"])
        self.assertFalse(res["containsUrl"])
        self.assertTrue(res["valid"])

    def test_pure_parse_sse_text(self):
        self.assertTrue(self.data["parseSsePure"]["valid"])

    def test_consumer_early_stop_aborts_cleanly(self):
        self.assertTrue(self.data["abortOnEarlyStop"]["valid"])

    def test_timeout_aborts_cleanly(self):
        self.assertTrue(self.data["timeoutAbort"]["valid"])

    def test_cli_dry_run_prints_prompt_without_api_key(self):
        env = os.environ.copy()
        env.pop("GEMINI_API_KEY", None)
        proc = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                str(CLI_SCRIPT_PATH),
                "--dry-run",
                "build a 4-shelf bookcase",
            ],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, f"stderr: {proc.stderr}")
        self.assertIn("build a 4-shelf bookcase", proc.stdout)
        self.assertIn("=== TARGET SCHEMA ===", proc.stdout)
        self.assertIn("=== ALLOWED PRIMITIVES ===", proc.stdout)
        self.assertIn("=== DIMENSION BOUNDS", proc.stdout)
        self.assertIn("=== ALLOWED PALETTE COLORS ===", proc.stdout)

    def test_cli_without_key_exits_nonzero_with_clear_message(self):
        env = os.environ.copy()
        env.pop("GEMINI_API_KEY", None)
        proc = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                str(CLI_SCRIPT_PATH),
                "build a 4-shelf bookcase",
            ],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("GEMINI_API_KEY", proc.stderr)


if __name__ == "__main__":
    unittest.main()
