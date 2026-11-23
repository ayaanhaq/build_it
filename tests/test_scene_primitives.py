import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PRIMITIVES_RUNNER_PATH = REPO_ROOT / "tests" / "test_primitives.mjs"


def run_primitives_runner() -> dict:
    """Execute test_primitives.mjs and return output dictionary."""
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(PRIMITIVES_RUNNER_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


class ScenePrimitivesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = run_primitives_runner()

    def test_overall_primitives_suite_passed(self):
        self.assertTrue(self.data.get("passed"), "Overall primitives test suite failed")

    def test_box_builds_min_and_max_bounds(self):
        box_data = self.data["minMaxBuilds"]["box"]
        self.assertTrue(box_data["minValid"], "Box minimum valid dimensions failed to build")
        self.assertTrue(box_data["maxValid"], "Box maximum valid dimensions failed to build")

    def test_cylinder_builds_min_and_max_bounds(self):
        cyl_data = self.data["minMaxBuilds"]["cylinder"]
        self.assertTrue(cyl_data["minValid"], "Cylinder minimum valid dimensions failed to build")
        self.assertTrue(cyl_data["maxValid"], "Cylinder maximum valid dimensions failed to build")

    def test_lathe_builds_min_and_max_bounds(self):
        lathe_data = self.data["minMaxBuilds"]["lathe"]
        self.assertTrue(lathe_data["minValid"], "Lathe minimum valid dimensions failed to build")
        self.assertTrue(lathe_data["maxValid"], "Lathe maximum valid dimensions failed to build")

    def test_bevel_builds_min_and_max_bounds(self):
        bevel_data = self.data["minMaxBuilds"]["bevel"]
        self.assertTrue(bevel_data["minValid"], "Bevel minimum valid dimensions failed to build")
        self.assertTrue(bevel_data["maxValid"], "Bevel maximum valid dimensions failed to build")

    def test_spring_builds_min_and_max_bounds(self):
        spring_data = self.data["minMaxBuilds"]["spring"]
        self.assertTrue(spring_data["minValid"], "Spring minimum valid dimensions failed to build")
        self.assertTrue(spring_data["maxValid"], "Spring maximum valid dimensions failed to build")

    def test_out_of_bounds_dimensions_rejected_before_builder(self):
        for prim_name, validation in self.data["outOfBoundsValidation"].items():
            self.assertTrue(
                validation["rejectedLow"],
                f"Out-of-bounds low dimension for '{prim_name}' was not rejected by validator",
            )
            self.assertTrue(
                validation["rejectedHigh"],
                f"Out-of-bounds high dimension for '{prim_name}' was not rejected by validator",
            )
            # Ensure exact error message references bounds
            all_errors = validation["lowErrors"] + validation["highErrors"]
            self.assertTrue(
                any("outside bounds" in err for err in all_errors),
                f"Validation error for '{prim_name}' did not mention 'outside bounds': {all_errors}",
            )

    def test_lathe_fixture_validates_and_builds(self):
        fix = self.data["fixtures"]["lathe"]
        self.assertTrue(fix["valid"])
        self.assertEqual(fix["errors"], [])
        self.assertEqual(fix["partCount"], 1)
        self.assertEqual(fix["stepCount"], 1)

    def test_bevel_fixture_validates_and_builds(self):
        fix = self.data["fixtures"]["bevel"]
        self.assertTrue(fix["valid"])
        self.assertEqual(fix["errors"], [])
        self.assertEqual(fix["partCount"], 1)
        self.assertEqual(fix["stepCount"], 1)

    def test_spring_fixture_validates_and_builds(self):
        fix = self.data["fixtures"]["spring"]
        self.assertTrue(fix["valid"])
        self.assertEqual(fix["errors"], [])
        self.assertEqual(fix["partCount"], 1)
        self.assertEqual(fix["stepCount"], 1)


if __name__ == "__main__":
    unittest.main()
