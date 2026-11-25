import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPARE_RUNNER_PATH = REPO_ROOT / "tests" / "compare_desk_models.mjs"


def run_model_comparison() -> dict:
    """Execute compare_desk_models.mjs and return output dictionary."""
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(COMPARE_RUNNER_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class SceneRendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.comparison = run_model_comparison()

    def test_overall_comparison_passed(self):
        self.assertTrue(self.comparison.get("passed"), "Overall model comparison failed")

    def test_desk_fixture_validates_without_errors(self):
        self.assertTrue(self.comparison.get("valid"))
        self.assertEqual(self.comparison.get("validationErrors"), [])

    def test_part_count_matches_hand_built_desk(self):
        hand_count = self.comparison.get("partCountHandBuilt")
        scene_count = self.comparison.get("partCountScene")
        self.assertEqual(hand_count, 24, "Hand-built desk must contain 24 parts")
        self.assertEqual(scene_count, 24, "Scene fixture desk must contain 24 parts")
        self.assertEqual(hand_count, scene_count)

    def test_step_count_matches_hand_built_desk(self):
        hand_steps = self.comparison.get("stepCountHandBuilt")
        scene_steps = self.comparison.get("stepCountScene")
        self.assertEqual(hand_steps, 6)
        self.assertEqual(scene_steps, 6)

    def test_bounding_box_matches_within_tolerance(self):
        max_delta = self.comparison.get("maxDelta")
        self.assertIsNotNone(max_delta)
        self.assertLessEqual(
            max_delta,
            1e-4,
            f"Bounding box difference {max_delta} exceeds tolerance 1e-4",
        )

        hand_bounds = self.comparison.get("boundsHandBuilt")
        scene_bounds = self.comparison.get("boundsScene")

        for axis in ("x", "y", "z"):
            self.assertAlmostEqual(
                hand_bounds["min"][axis],
                scene_bounds["min"][axis],
                places=4,
                msg=f"Min {axis} does not match",
            )
            self.assertAlmostEqual(
                hand_bounds["max"][axis],
                scene_bounds["max"][axis],
                places=4,
                msg=f"Max {axis} does not match",
            )

    def test_all_parts_match_hand_built_desk(self):
        mismatches = self.comparison.get("partMismatches", [])
        self.assertEqual(mismatches, [], f"Found part mismatches: {mismatches}")

    def test_all_primitives_build_valid_buffer_geometries(self):
        smoke = self.comparison.get("primitiveSmokeTest", {})
        for primitive in ("box", "cylinder", "lathe", "bevel", "spring"):
            self.assertTrue(
                smoke.get(primitive),
                f"Primitive builder for {primitive} did not produce a BufferGeometry",
            )

    def test_incremental_step_appending_matches_full_scene(self):
        self.assertTrue(
            self.comparison.get("incrementalMatchesFull"),
            "Incremental step-by-step build does not match full buildSceneModel",
        )
        self.assertEqual(self.comparison.get("incrementalPartCount"), 24)
        self.assertEqual(self.comparison.get("incrementalStepCount"), 6)
        self.assertLessEqual(
            self.comparison.get("incrementalDelta", 1.0),
            1e-4,
            "Bounding box delta between incremental and full build exceeds tolerance",
        )

    def test_partial_build_renders_without_errors_and_reports_correct_steps(self):
        self.assertTrue(
            self.comparison.get("partialFiveStepValid"),
            "Partial build (steps 1 to 2 of 5) failed to render cleanly",
        )
        self.assertEqual(
            self.comparison.get("partialFiveStepStepCount"),
            2,
            "Partial build must report exactly 2 steps",
        )

    def test_undo_remove_step(self):
        self.assertTrue(
            self.comparison.get("undoValid"),
            "removeStep failed to cleanly undo and remove step meshes",
        )

    def test_camera_target_raises_for_tall_model_and_preserves_desk(self):
        ct = self.comparison.get("cameraTargetCheck", {})
        self.assertTrue(ct.get("valid"), f"Camera target check failed: {ct}")
        self.assertAlmostEqual(ct.get("bookcaseTargetY"), 90.0, places=4)
        self.assertAlmostEqual(ct.get("unnamedTargetY"), 90.0, places=4)
        self.assertEqual(ct.get("deskStep1TargetY"), 18)
        self.assertEqual(ct.get("deskFullTargetY"), 18)


if __name__ == "__main__":
    unittest.main()
