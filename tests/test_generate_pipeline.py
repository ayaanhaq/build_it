import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PIPELINE_RUNNER_PATH = REPO_ROOT / "tests" / "test_generate_pipeline.mjs"


def run_pipeline_runner() -> dict:
    """Execute test_generate_pipeline.mjs and return output dictionary."""
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(PIPELINE_RUNNER_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class GeneratePipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_pipeline_runner()

    def test_overall_pipeline_suite_passed(self):
        self.assertTrue(self.data.get("passed"), "Overall generation pipeline suite failed")

    def test_build_prompt_includes_required_sections(self):
        bp = self.data["buildPrompt"]
        self.assertTrue(bp["containsRequest"], "buildPrompt missing request text")
        self.assertTrue(bp["containsSchema"], "buildPrompt missing schema content")
        self.assertTrue(bp["containsPrimitives"], "buildPrompt missing supported primitive list")
        self.assertTrue(bp["containsBounds"], "buildPrompt missing dimension bounds table")
        self.assertTrue(bp["containsPalettes"], "buildPrompt missing allowed palette names")
        self.assertTrue(bp["valid"])

    def test_clean_three_step_stream_produces_three_valid_steps(self):
        res = self.data["cleanThreeSteps"]
        self.assertTrue(res["success"], "Clean 3-step stream failed")
        self.assertEqual(res["stepCount"], 3, "Expected 3 steps from clean stream")
        self.assertEqual(res["retriesCount"], 0, "Clean stream should have 0 retries")
        self.assertTrue(res["valid"])

    def test_bad_step_fixed_on_retry(self):
        res = self.data["badStepFixedOnRetry"]
        self.assertTrue(res["success"], "Bad step fixed on retry should succeed")
        self.assertEqual(res["stepCount"], 3, "Expected 3 valid steps after retry")
        self.assertEqual(res["retriesCount"], 1, "Expected exactly 1 logged retry")
        self.assertEqual(res["retryStepNumber"], 2, "Expected retry on step 2")
        self.assertTrue(res["retryContainsError"], "Logged retry should contain validation error")
        self.assertTrue(res["retryPromptRecorded"], "Retry prompt sent to client should contain validation error")
        self.assertTrue(res["valid"])

    def test_never_fixed_stops_at_retry_limit(self):
        res = self.data["neverFixedExceedsRetries"]
        self.assertFalse(res["success"], "Unfixable stream should report failure")
        self.assertEqual(res["stepCount"], 1, "Should return only passing step 1")
        self.assertEqual(res["retriesCount"], 3, "Should stop at default retry limit 3")
        self.assertIn("failed validation after 3 retries", res["errorMessage"])
        self.assertTrue(res["valid"])

    def test_partial_line_split_across_chunks(self):
        res = self.data["partialLineSplitAcrossChunks"]
        self.assertEqual(res["count"], 1)
        self.assertTrue(res["hasStep"])
        self.assertEqual(res["stepTitle"], "Split Step")
        self.assertTrue(res["valid"])

    def test_malformed_json_line_preserves_remaining_steps(self):
        res = self.data["malformedJsonLinePreservesRemaining"]
        self.assertEqual(res["totalItems"], 3)
        self.assertEqual(res["firstStepNum"], 1)
        self.assertTrue(res["secondItemIsError"])
        self.assertIn("THIS IS BROKEN", res["secondRawLine"])
        self.assertEqual(res["thirdStepNum"], 2)
        self.assertTrue(res["valid"])

    def test_fenced_single_line_output_parses(self):
        res = self.data["fencedSingleLineOutput"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 2)
        self.assertTrue(res["valid"])

    def test_fenced_split_across_chunks_parses(self):
        res = self.data["fencedSplitAcrossChunks"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 1)
        self.assertIn("```", res["preservedTitle"])
        self.assertTrue(res["valid"])

    def test_unclosed_fence_fails_with_clear_error(self):
        res = self.data["unclosedFenceFailsClearly"]
        self.assertFalse(res["success"])
        self.assertIn("closing", res["streamError"].lower())
        self.assertIn("closing", res["pipelineError"].lower())
        self.assertTrue(res["valid"])

    def test_plain_unfenced_stream_with_backticks_in_string_passes(self):
        res = self.data["plainUnfencedWithBackticksInJsonString"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 1)
        self.assertIn("```json", res["preservedDescription"])
        self.assertTrue(res["valid"])


if __name__ == "__main__":
    unittest.main()
