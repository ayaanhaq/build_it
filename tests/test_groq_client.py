import json
import os
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GROQ_TEST_PATH = REPO_ROOT / "tests" / "test_groq_client.mjs"
CLI_SCRIPT_PATH = REPO_ROOT / "scripts" / "generate-scene.ts"


def run_groq_tests() -> dict:
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(GROQ_TEST_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class GroqClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_groq_tests()

    def test_overall_groq_suite_passed(self):
        self.assertTrue(self.data.get("passed"))

    def test_fixed_sse_body_yields_text_chunks_in_order(self):
        res = self.data["fixedSseOrderAndRequestShape"]
        self.assertTrue(res["valid"])
        self.assertEqual(res["model"], "openai/gpt-oss-120b")
        self.assertFalse(res["hasResponseFormat"])

    def test_split_event_across_network_chunks(self):
        self.assertTrue(self.data["splitAcrossChunks"]["valid"])

    def test_done_sentinel_ends_stream(self):
        res = self.data["doneTerminatesStream"]
        self.assertEqual(res["out"], ["before-done"])
        self.assertTrue(res["cancelCalled"])
        self.assertTrue(res["valid"])

    def test_429_with_retry_after_retries_once_and_succeeds(self):
        res = self.data["retry429WithRetryAfterThen200"]
        self.assertEqual(res["callCount"], 2)
        self.assertTrue(res["valid"])

    def test_400_does_not_retry_and_throws_groq_client_error(self):
        res = self.data["noRetryOn400"]
        self.assertEqual(res["callCount"], 1)
        self.assertTrue(res["isGroqClientError"])
        self.assertEqual(res["status"], 400)
        self.assertTrue(res["valid"])

    def test_missing_api_key_throws_before_request(self):
        res = self.data["missingApiKey"]
        self.assertEqual(res["callCount"], 0)
        self.assertTrue(res["isGroqClientError"])
        self.assertTrue(res["valid"])

    def test_error_never_contains_api_key_or_url(self):
        res = self.data["sanitizedErrorNeverLeaksKey"]
        self.assertTrue(res["isGroqClientError"])
        self.assertFalse(res["containsKey"])
        self.assertFalse(res["containsUrl"])
        self.assertTrue(res["valid"])

    def test_abort_on_early_stop_and_timeout(self):
        self.assertTrue(self.data["abortOnEarlyStopAndTimeout"]["valid"])

    def test_provider_selection_unit(self):
        res = self.data["providerSelectionUnit"]
        self.assertEqual(res["defaultProvider"], "gemini")
        self.assertEqual(res["groqClientClass"], "GroqModelClient")
        self.assertEqual(res["geminiClientClass"], "GeminiModelClient")
        self.assertTrue(res["valid"])

    def test_server_and_cli_provider_selection(self):
        self.assertTrue(self.data["serverAndCliProviderSelection"]["valid"])

    def test_cli_unknown_provider_subprocess_fails(self):
        env = os.environ.copy()
        env["LLM_PROVIDER"] = "bad_provider"
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
        self.assertIn("LLM_PROVIDER", proc.stderr)


if __name__ == "__main__":
    unittest.main()
