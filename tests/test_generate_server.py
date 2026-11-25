import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_TEST_PATH = REPO_ROOT / "tests" / "test_generate_server.mjs"


def run_server_tests() -> dict:
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(SERVER_TEST_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class GenerateServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_server_tests()

    def test_overall_server_suite_passed(self):
        self.assertTrue(self.data.get("passed"))

    def test_valid_request_streams_steps_then_done(self):
        res = self.data["validStreamsStepAndDone"]
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["eventNames"], ["step", "step", "done"])
        self.assertEqual(res["doneData"], {"complete": True, "stepCount": 2})
        self.assertTrue(res["valid"])

    def test_cors_allows_localhost_5173_and_rejects_others(self):
        res = self.data["corsAllowedAndRejected"]
        self.assertEqual(res["preflightStatus"], 204)
        self.assertEqual(res["evilStatus"], 403)
        self.assertEqual(res["wrongPortStatus"], 403)
        self.assertTrue(res["valid"])

    def test_invalid_bodies_return_400(self):
        res = self.data["invalidBodiesReturn400"]
        self.assertTrue(res["valid"])
        for label, status in res["statuses"].items():
            self.assertEqual(status, 400, f"Payload {label} returned {status}")

    def test_concurrent_request_returns_429(self):
        res = self.data["concurrentRequestReturns429"]
        self.assertEqual(res["secondStatus"], 429)
        self.assertEqual(res["firstStatus"], 200)
        self.assertEqual(res["thirdStatus"], 200)
        self.assertTrue(res["valid"])

    def test_key_never_appears_in_responses_or_errors(self):
        res = self.data["keyRedactedAcrossEventsAndErrors"]
        self.assertFalse(res["containsKey"])
        self.assertEqual(res["eventNames"], ["step", "error"])
        self.assertFalse(res["errorPayload"]["complete"])
        self.assertEqual(res["errorPayload"]["stepCount"], 1)
        self.assertTrue(res["valid"])

    def test_missing_api_key_returns_500(self):
        res = self.data["missingKeyReturns500"]
        self.assertEqual(res["status"], 500)
        self.assertTrue(res["valid"])

    def test_port_env_override_respected(self):
        res = self.data["portEnvOverrideRespected"]
        self.assertTrue(res["valid"])


if __name__ == "__main__":
    unittest.main()
