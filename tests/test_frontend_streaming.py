import json
import re
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_TEST_PATH = REPO_ROOT / "tests" / "test_frontend_streaming.mjs"


def run_frontend_tests() -> dict:
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(FRONTEND_TEST_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class FrontendStreamingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_frontend_tests()

    def test_overall_frontend_streaming_suite_passed(self):
        self.assertTrue(self.data.get("passed"))

    def test_sse_parser_fixed_and_split_chunks(self):
        res = self.data["sseParserFixedAndSplit"]
        self.assertEqual(res["fixedTypes"], ["step", "step", "done", "error"])
        self.assertEqual(res["streamedTypes"], ["step", "error", "done"])
        self.assertTrue(res["valid"])

    def test_fake_viewer_append_per_step_and_max_one_load_scene(self):
        res = self.data["fakeViewerThreeStepStream"]
        self.assertEqual(res["status"], "complete")
        self.assertEqual(res["appendedSteps"], [1, 2, 3])
        self.assertEqual(res["loadSceneCallsDuringStream"], 0)
        self.assertLessEqual(res["loadSceneCallsWithReset"], 1)
        self.assertEqual(res["doneCount"], 3)
        self.assertTrue(res["valid"])

    def test_cancel_stops_further_append_step_calls(self):
        res = self.data["cancelStopsAppendStep"]
        self.assertEqual(res["status"], "cancelled")
        self.assertEqual(res["appendedSteps"], [1])
        self.assertEqual(res["cancelledStepCount"], 1)
        self.assertTrue(res["valid"])

    def test_429_produces_busy_message(self):
        res = self.data["busy429Message"]
        self.assertEqual(res["status"], "error")
        self.assertEqual(res["httpStatus"], 429)
        self.assertEqual(res["loadSceneCalls"], 0)
        self.assertEqual(res["appendCalls"], 0)
        self.assertTrue(res["valid"])

    def test_flag_default_false_and_keyword_routing_preserved(self):
        res = self.data["flagDefaultAndKeywordRouting"]
        self.assertFalse(res["ENABLE_STREAMING_GENERATION"])
        self.assertTrue(res["defaultFlagFalse"])
        self.assertTrue(res["envFlagTrue"])
        self.assertTrue(res["valid"])

    def test_frontend_source_has_no_gemini_client_or_key(self):
        src_dir = REPO_ROOT / "src"
        frontend_files = [
            p
            for p in src_dir.glob("*")
            if p.is_file() and p.suffix in {".ts", ".tsx"}
        ]
        self.assertGreater(len(frontend_files), 0)
        forbidden = re.compile(
            r"(geminiClient|GeminiModelClient|GEMINI_API_KEY|VITE_GEMINI|generativelanguage\.googleapis\.com)"
        )
        for path in frontend_files:
            content = path.read_text(encoding="utf-8")
            match = forbidden.search(content)
            self.assertIsNone(
                match,
                f"Forbidden server/key reference {match.group(0) if match else ''} found in {path.name}",
            )


if __name__ == "__main__":
    unittest.main()
