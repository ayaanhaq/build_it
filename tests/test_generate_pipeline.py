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

    def test_retry_reuses_part_id_from_failed_step(self):
        res = self.data["retryReusesFailedStepPartId"]
        self.assertTrue(res["success"], f"Expected retry reusing 'shelf-1' to succeed, got error: {res.get('error')}")
        self.assertEqual(res["stepCount"], 2)
        self.assertEqual(res["retriesCount"], 1)
        self.assertTrue(res["valid"])

    def test_real_duplicate_across_valid_steps_rejected(self):
        res = self.data["realDuplicateAcrossValidStepsRejected"]
        self.assertFalse(res["success"])
        self.assertEqual(res["stepCount"], 1)
        self.assertIn(
            "Duplicate part ID 'shelf-1' already exists in an earlier step. Part IDs must be unique across the whole build.",
            res["error"],
        )
        self.assertTrue(res["valid"])

    def test_pretty_printed_20_line_step_parses(self):
        res = self.data["prettyPrinted20Lines"]
        self.assertTrue(res["success"])
        self.assertGreaterEqual(res["lineCount"], 18)
        self.assertEqual(res["stepCount"], 1)
        self.assertEqual(res["stepTitle"], "Step 1: Pretty Multi-Line")
        self.assertTrue(res["valid"])

    def test_braces_inside_string_do_not_end_object_early(self):
        res = self.data["bracesInsideStringValue"]
        self.assertEqual(res["itemCount"], 1)
        self.assertTrue(res["hasStep"])
        self.assertTrue(res["valid"])

    def test_escaped_quotes_inside_string_handled(self):
        res = self.data["escapedQuotesInString"]
        self.assertEqual(res["itemCount"], 1)
        self.assertTrue(res["valid"])

    def test_missing_closing_brace_errors_at_cap_and_eof(self):
        res = self.data["missingClosingBraceAtCapAndEof"]
        self.assertIn("unclosed", res["eofError"].lower())
        self.assertIn("64 kb", res["capError"].lower())
        self.assertTrue(res["valid"])

    def test_malformed_pretty_object_preserves_later_objects(self):
        res = self.data["malformedObjectPreservesLaterPrettyObjects"]
        self.assertEqual(res["itemCount"], 3)
        self.assertEqual(res["firstStepNum"], 1)
        self.assertTrue(res["secondIsError"])
        self.assertEqual(res["thirdStepNum"], 2)
        self.assertTrue(res["valid"])

    def test_fenced_pretty_printed_stream_parses(self):
        res = self.data["fencedPrettyPrintedStream"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 2)
        self.assertTrue(res["valid"])

    def test_normalize_back_panel_and_camera_distance(self):
        res = self.data["normalizeBackPanelAndDistance"]
        self.assertEqual(res["factor"], 10)
        self.assertEqual(res["dimensions"], {"width": 80, "height": 180, "depth": 0.5})
        self.assertEqual(res["distance"], 288)
        self.assertTrue(res["valid"])

    def test_position_and_dimensions_scale_together_preserving_angles_and_qty(self):
        self.assertTrue(self.data["scaleTogetherAndPreserveAnglesQty"]["valid"])

    def test_normalize_does_not_mutate_input(self):
        res = self.data["normalizeDoesNotMutateInput"]
        self.assertTrue(res["notSameRef"])
        self.assertTrue(res["inputUnchanged"])
        self.assertTrue(res["valid"])

    def test_end_to_end_mm_stream_normalizes_and_validates(self):
        res = self.data["endToEndMmNormalizesAndValidates"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 3)
        self.assertEqual(res["boxMaxCm"], 500)
        self.assertEqual(res["step3Dimensions"], {"width": 80, "height": 180, "depth": 0.5})
        self.assertEqual(res["step3CameraPreset"]["distance"], 288)
        self.assertTrue(res["valid"])

    def test_unit_labels_cm_for_generated_and_desk_kept(self):
        res = self.data["unitLabelsCmForGeneratedDeskUnchanged"]
        self.assertEqual(res["generatedDimText"], "80 × 180 × 0.5 cm")
        self.assertTrue(res["deskDimText"].endswith(" mm"))
        self.assertTrue(res["valid"])

    def test_back_panel_1800mm_normalizes_to_180_not_18(self):
        res = self.data["backPanel1800MmBecomes180Not18"]
        self.assertTrue(res["success"])
        self.assertEqual(res["height"], 180)
        self.assertNotEqual(res["height"], 18)
        self.assertEqual(res["width"], 80)
        self.assertEqual(res["depth"], 0.5)
        self.assertEqual(res["distance"], 288)
        self.assertTrue(res["valid"])

    def test_build_prompt_does_not_contain_centimeters_or_cm(self):
        res = self.data["promptDoesNotAskForCentimeters"]
        self.assertTrue(res["hasDimensionBoundsHeader"])
        self.assertFalse(res["hasCentimetersWord"])
        self.assertFalse(res["hasCmToken"])
        self.assertTrue(res["valid"])

    def test_clamp_distance_low_for_180cm_model(self):
        res = self.data["clampDistanceLowFor180CmModel"]
        self.assertEqual(res["step1Distance"], 288)
        self.assertEqual(res["step2Distance"], 288)
        self.assertTrue(res["phiPreserved"])
        self.assertTrue(res["thetaPreserved"])
        self.assertTrue(res["valid"])

    def test_distance_unchanged_within_bounds_and_capped_at_400(self):
        res = self.data["distanceUnchangedWhenWithinBounds"]
        self.assertEqual(res["dist180At300"], 300)
        self.assertEqual(res["dist100At200"], 200)
        self.assertEqual(res["distOverMaxClamped"], 400)
        self.assertTrue(res["valid"])

    def test_missing_camera_preset_sets_defaults_and_distance(self):
        res = self.data["missingCameraPresetSetsDefaults"]
        self.assertEqual(res["preset180"], {"distance": 288, "phi": 1.0, "theta": 0.6})
        self.assertEqual(res["preset100"], {"distance": 160, "phi": 1.0, "theta": 0.6})
        self.assertTrue(res["valid"])

    def test_desk_fixture_distances_untouched(self):
        res = self.data["deskFixtureDistancesUntouched"]
        self.assertEqual(res["deskDistances"], res["expectedDeskDistances"])
        self.assertTrue(res["valid"])

    def test_retry_prompt_has_step_2_and_used_part_ids(self):
        res = self.data["retryPromptHasStep2AndUsedPartIds"]
        self.assertTrue(res["hasStep2"])
        self.assertTrue(res["hasTitle"])
        self.assertTrue(res["hasUsedIds"])
        self.assertTrue(res["hasSchema"])
        self.assertTrue(res["hasReturnDirective"])
        self.assertTrue(res["valid"])

    def test_incomplete_output_retries_with_same_request_and_higher_tokens(self):
        res = self.data["incompleteOutputRetriesWithSameRequestAndHigherTokens"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 2)
        self.assertTrue(res["samePromptReused"])
        self.assertEqual(res["secondMaxTokens"], res["firstMaxTokens"] * 2)
        self.assertTrue(res["valid"])

    def test_retry_missing_shape_rejected_before_validator(self):
        res = self.data["retryMissingShapeRejectedBeforeValidator"]
        self.assertTrue(res["success"])
        self.assertEqual(res["stepCount"], 2)
        self.assertEqual(res["retriesCount"], 2)
        self.assertTrue(res["secondRetrySawShapeError"])
        self.assertTrue(res["retryUsedResponseFormat"])
        self.assertTrue(res["valid"])

    def test_completeness_check_suite(self):
        res = self.data["completenessCheckSuite"]
        self.assertGreater(res["incompleteDirectErrorCount"], 0)
        self.assertEqual(res["completeDirectErrorCount"], 0)
        self.assertEqual(res["deskDirectErrorCount"], 0)
        self.assertTrue(res["retriedSuccess"])
        self.assertEqual(res["retriedStepCount"], 3)
        self.assertEqual(res["retriedCount"], 1)
        self.assertFalse(res["unfixedSuccess"])
        self.assertIn("back panel", res["unfixedError"].lower())
        self.assertTrue(res["valid"])


if __name__ == "__main__":
    unittest.main()
