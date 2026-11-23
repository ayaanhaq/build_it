import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNNER_PATH = REPO_ROOT / "tests" / "validator_runner.mjs"


def run_validator(scene_dict: dict) -> list[str]:
    """Execute validateScene via node runner and return list of error strings."""
    proc = subprocess.run(
        ["node", str(RUNNER_PATH)],
        input=json.dumps(scene_dict),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(proc.stdout)


class SceneValidatorTests(unittest.TestCase):
    def setUp(self):
        self.valid_scene = {
            "schemaVersion": 1,
            "name": "valid_workbench",
            "title": "Valid Electronics Workbench",
            "steps": [
                {
                    "stepNumber": 1,
                    "title": "Base Legs",
                    "parts": [
                        {
                            "id": "leg_fl",
                            "name": "Front Left Oak Leg",
                            "primitive": "box",
                            "dimensions": {
                                "width": 55.0,
                                "height": 720.0,
                                "depth": 55.0,
                            },
                            "position": {"x": -350.0, "y": 360.0, "z": -180.0},
                            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                            "color": "tan",
                            "material": "oak",
                            "step": 1,
                            "qty": 1,
                        },
                        {
                            "id": "glide_fl",
                            "name": "Leveling Glide",
                            "primitive": "cylinder",
                            "dimensions": {
                                "radius": 15.0,
                                "height": 20.0,
                                "radialSegments": 24,
                            },
                            "position": {"x": -350.0, "y": 10.0, "z": -180.0},
                            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                            "color": "sun",
                            "material": "brass",
                            "step": 1,
                            "qty": 1,
                        },
                    ],
                }
            ],
        }

    def test_valid_scene_passes(self):
        errors = run_validator(self.valid_scene)
        self.assertEqual(errors, [])

    def test_unknown_primitive_fails(self):
        scene = json.loads(json.dumps(self.valid_scene))
        scene["steps"][0]["parts"].append(
            {
                "id": "part_pyramid",
                "primitive": "pyramid",
                "dimensions": {"width": 10.0, "height": 10.0, "depth": 10.0},
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                "color": "tan",
                "material": "oak",
                "step": 1,
                "qty": 1,
            }
        )
        errors = run_validator(scene)
        expected_error = (
            "Part 'part_pyramid': unknown primitive type 'pyramid'. "
            "Must be one of: box, cylinder, lathe, bevel, spring."
        )
        self.assertIn(expected_error, errors)

    def test_dimension_outside_bounds_fails(self):
        # 1. Box width too large (> 5000 mm)
        scene1 = json.loads(json.dumps(self.valid_scene))
        scene1["steps"][0]["parts"][0]["id"] = "box_oversized"
        scene1["steps"][0]["parts"][0]["dimensions"]["width"] = 6000.0
        errors1 = run_validator(scene1)
        expected1 = (
            "Part 'box_oversized': dimension 'width' (6000 mm) is outside bounds [0.1, 5000] mm for primitive 'box'."
        )
        self.assertIn(expected1, errors1)

        # 2. Cylinder radius too small (< 0.1 mm)
        scene2 = json.loads(json.dumps(self.valid_scene))
        scene2["steps"][0]["parts"][1]["id"] = "cylinder_undersized"
        scene2["steps"][0]["parts"][1]["dimensions"]["radius"] = 0.05
        errors2 = run_validator(scene2)
        expected2 = (
            "Part 'cylinder_undersized': dimension 'radius' (0.05 mm) is outside bounds [0.1, 2500] mm for primitive 'cylinder'."
        )
        self.assertIn(expected2, errors2)

    def test_part_count_over_cap_fails(self):
        scene = json.loads(json.dumps(self.valid_scene))
        parts = []
        for i in range(501):
            parts.append(
                {
                    "id": f"part_{i}",
                    "primitive": "box",
                    "dimensions": {"width": 10.0, "height": 10.0, "depth": 10.0},
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "color": "tan",
                    "material": "oak",
                    "step": 1,
                    "qty": 1,
                }
            )
        scene["steps"][0]["parts"] = parts
        errors = run_validator(scene)
        expected_error = "Scene part count (501) exceeds maximum limit of 500 parts."
        self.assertIn(expected_error, errors)

    def test_vertex_total_over_cap_fails(self):
        # Each spring with coils=100 estimates 100 * 32 * 8 = 25,600 vertices.
        # 4 springs = 102,400 vertices (> 100,000 cap).
        scene = json.loads(json.dumps(self.valid_scene))
        parts = []
        for i in range(4):
            parts.append(
                {
                    "id": f"spring_{i}",
                    "primitive": "spring",
                    "dimensions": {
                        "radius": 50.0,
                        "height": 200.0,
                        "coils": 100,
                        "wireRadius": 2.0,
                    },
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "color": "grey",
                    "material": "steel",
                    "step": 1,
                    "qty": 1,
                }
            )
        scene["steps"][0]["parts"] = parts
        errors = run_validator(scene)
        expected_error = (
            "Estimated scene vertex total (102400) exceeds maximum limit of 100000 vertices."
        )
        self.assertIn(expected_error, errors)

    def test_duplicate_part_ids_fails(self):
        scene = json.loads(json.dumps(self.valid_scene))
        # Add a part with duplicate ID 'leg_dup'
        scene["steps"][0]["parts"][0]["id"] = "leg_dup"
        scene["steps"][0]["parts"][1]["id"] = "leg_dup"
        errors = run_validator(scene)
        expected_error = (
            "Duplicate part ID 'leg_dup' found in scene (2 occurrences). Part IDs must be unique across the scene."
        )
        self.assertIn(expected_error, errors)

    def test_part_step_does_not_exist_fails(self):
        scene = json.loads(json.dumps(self.valid_scene))
        scene["steps"][0]["parts"][0]["id"] = "orphan_part"
        scene["steps"][0]["parts"][0]["step"] = 99
        errors = run_validator(scene)
        expected_error = (
            "Part 'orphan_part' references step 99, which does not exist in scene steps [1]."
        )
        self.assertIn(expected_error, errors)

    def test_non_finite_numbers_fail(self):
        # 1. NaN in position.x
        scene1 = json.loads(json.dumps(self.valid_scene))
        scene1["steps"][0]["parts"][0]["id"] = "part_nan"
        scene1["steps"][0]["parts"][0]["position"]["x"] = "__NAN__"
        errors1 = run_validator(scene1)
        self.assertIn("Part 'part_nan': non-finite number in position.x (NaN).", errors1)

        # 2. Infinity in rotation.y
        scene2 = json.loads(json.dumps(self.valid_scene))
        scene2["steps"][0]["parts"][0]["id"] = "part_inf"
        scene2["steps"][0]["parts"][0]["rotation"]["y"] = "__INFINITY__"
        errors2 = run_validator(scene2)
        self.assertIn("Part 'part_inf': non-finite number in rotation.y (Infinity).", errors2)

        # 3. NaN in dimension height
        scene3 = json.loads(json.dumps(self.valid_scene))
        scene3["steps"][0]["parts"][0]["id"] = "dim_nan"
        scene3["steps"][0]["parts"][0]["dimensions"]["height"] = "__NAN__"
        errors3 = run_validator(scene3)
        self.assertIn(
            "Part 'dim_nan': dimension 'height' must be a finite number, received NaN.",
            errors3,
        )


if __name__ == "__main__":
    unittest.main()
