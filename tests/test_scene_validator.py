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


def run_step_validator(step_dict: dict, context_dict: dict = None) -> list[str]:
    """Execute validateStep via node runner and return list of error strings."""
    payload = {
        "_mode": "step",
        "step": step_dict,
        "context": context_dict or {},
    }
    proc = subprocess.run(
        ["node", str(RUNNER_PATH)],
        input=json.dumps(payload),
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


class SceneStepValidatorTests(unittest.TestCase):
    def setUp(self):
        self.valid_step = {
            "stepNumber": 1,
            "title": "Assemble Main Frame Legs",
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

    def test_valid_step_passes(self):
        errors = run_step_validator(self.valid_step)
        self.assertEqual(errors, [])

    def test_unknown_primitive_fails(self):
        step = json.loads(json.dumps(self.valid_step))
        step["parts"].append(
            {
                "id": "part_cone",
                "primitive": "cone",
                "dimensions": {"radius": 10.0, "height": 20.0},
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                "color": "tan",
                "material": "oak",
                "step": 1,
                "qty": 1,
            }
        )
        errors = run_step_validator(step)
        expected = (
            "Part 'part_cone': unknown primitive type 'cone'. "
            "Must be one of: box, cylinder, lathe, bevel, spring."
        )
        self.assertIn(expected, errors)

    def test_dimension_outside_bounds_fails(self):
        # 1. Box width > 5000 mm
        step1 = json.loads(json.dumps(self.valid_step))
        step1["parts"][0]["id"] = "box_oversized"
        step1["parts"][0]["dimensions"]["width"] = 6000.0
        errors1 = run_step_validator(step1)
        expected1 = (
            "Part 'box_oversized': dimension 'width' (6000 mm) is outside bounds [0.1, 5000] mm for primitive 'box'."
        )
        self.assertIn(expected1, errors1)

        # 2. Cylinder radius < 0.1 mm
        step2 = json.loads(json.dumps(self.valid_step))
        step2["parts"][1]["id"] = "cylinder_undersized"
        step2["parts"][1]["dimensions"]["radius"] = 0.05
        errors2 = run_step_validator(step2)
        expected2 = (
            "Part 'cylinder_undersized': dimension 'radius' (0.05 mm) is outside bounds [0.1, 2500] mm for primitive 'cylinder'."
        )
        self.assertIn(expected2, errors2)

        # 3. Lathe radius < 0.1 mm
        step3 = {
            "stepNumber": 1,
            "title": "Lathe Step",
            "parts": [
                {
                    "id": "lathe_undersized",
                    "primitive": "lathe",
                    "dimensions": {"radius": 0.05, "height": 100.0, "segments": 32},
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "color": "tan",
                    "material": "oak",
                    "step": 1,
                    "qty": 1,
                }
            ],
        }
        errors3 = run_step_validator(step3)
        expected3 = (
            "Part 'lathe_undersized': dimension 'radius' (0.05 mm) is outside bounds [0.1, 2500] mm for primitive 'lathe'."
        )
        self.assertIn(expected3, errors3)

        # 4. Bevel width < 0.1 mm
        step4 = {
            "stepNumber": 1,
            "title": "Bevel Step",
            "parts": [
                {
                    "id": "bevel_undersized",
                    "primitive": "bevel",
                    "dimensions": {"width": 0.05, "height": 10.0, "depth": 10.0},
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "color": "ink",
                    "material": "steel",
                    "step": 1,
                    "qty": 1,
                }
            ],
        }
        errors4 = run_step_validator(step4)
        expected4 = (
            "Part 'bevel_undersized': dimension 'width' (0.05 mm) is outside bounds [0.1, 5000] mm for primitive 'bevel'."
        )
        self.assertIn(expected4, errors4)

        # 5. Spring height > 3000 mm
        step5 = {
            "stepNumber": 1,
            "title": "Spring Step",
            "parts": [
                {
                    "id": "spring_oversized",
                    "primitive": "spring",
                    "dimensions": {"radius": 20.0, "height": 4000.0, "coils": 5, "wireRadius": 2.0},
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "color": "sun",
                    "material": "steel",
                    "step": 1,
                    "qty": 1,
                }
            ],
        }
        errors5 = run_step_validator(step5)
        expected5 = (
            "Part 'spring_oversized': dimension 'height' (4000 mm) is outside bounds [1, 3000] mm for primitive 'spring'."
        )
        self.assertIn(expected5, errors5)

    def test_duplicate_part_id_from_earlier_step_fails(self):
        context = {"seenPartIds": ["leg_fl", "glide_fl"]}
        step2 = {
            "stepNumber": 2,
            "title": "Duplicate Part Step",
            "parts": [
                {
                    "id": "leg_fl",
                    "name": "Another Leg Attempt",
                    "primitive": "box",
                    "dimensions": {"width": 55.0, "height": 720.0, "depth": 55.0},
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "color": "tan",
                    "material": "oak",
                    "step": 2,
                    "qty": 1,
                }
            ],
        }
        errors = run_step_validator(step2, context)
        expected = (
            "Duplicate part ID 'leg_fl' already exists in an earlier step. "
            "Part IDs must be unique across the whole build."
        )
        self.assertIn(expected, errors)

    def test_duplicate_part_id_within_step_fails(self):
        step = json.loads(json.dumps(self.valid_step))
        step["parts"][0]["id"] = "bracket_1"
        step["parts"][1]["id"] = "bracket_1"
        errors = run_step_validator(step)
        expected = (
            "Duplicate part ID 'bracket_1' found in step 1. "
            "Part IDs must be unique across the whole build."
        )
        self.assertIn(expected, errors)

    def test_part_step_does_not_exist_fails(self):
        step = json.loads(json.dumps(self.valid_step))
        step["parts"][0]["id"] = "orphan_part"
        step["parts"][0]["step"] = 99
        errors = run_step_validator(step, {"validStepNumbers": [1, 2]})
        expected = "Part 'orphan_part' references step 99, which does not exist in scene steps [1, 2]."
        self.assertIn(expected, errors)

    def test_non_finite_numbers_fail(self):
        # 1. NaN in position.x
        step1 = json.loads(json.dumps(self.valid_step))
        step1["parts"][0]["id"] = "part_nan"
        step1["parts"][0]["position"]["x"] = "__NAN__"
        errors1 = run_step_validator(step1)
        self.assertIn("Part 'part_nan': non-finite number in position.x (NaN).", errors1)

        # 2. Infinity in rotation.y
        step2 = json.loads(json.dumps(self.valid_step))
        step2["parts"][0]["id"] = "part_inf"
        step2["parts"][0]["rotation"]["y"] = "__INFINITY__"
        errors2 = run_step_validator(step2)
        self.assertIn("Part 'part_inf': non-finite number in rotation.y (Infinity).", errors2)

        # 3. NaN in dimension height
        step3 = json.loads(json.dumps(self.valid_step))
        step3["parts"][0]["id"] = "dim_nan"
        step3["parts"][0]["dimensions"]["height"] = "__NAN__"
        errors3 = run_step_validator(step3)
        self.assertIn(
            "Part 'dim_nan': dimension 'height' must be a finite number, received NaN.",
            errors3,
        )

    def test_vertex_total_for_step_over_cap_fails(self):
        # 2 springs with 100 coils = 2 * 25,600 = 51,200 vertices (> 50,000 cap)
        step = {
            "stepNumber": 1,
            "title": "Heavy Springs Step",
            "parts": [
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
                for i in range(2)
            ],
        }
        errors = run_step_validator(step)
        expected = "Estimated step 1 vertex total (51200) exceeds maximum limit of 50000 vertices."
        self.assertIn(expected, errors)


class SceneCompletenessTests(unittest.TestCase):
    def _base_bookcase_steps(self, include_back: bool) -> list[dict]:
        steps = [
            {
                "stepNumber": 1,
                "title": "Side Panels",
                "description": "Stand the side panels, top panel, bottom panel, shelves, and back panel frame.",
                "parts": [
                    {
                        "id": "side_left",
                        "name": "Left Side Panel",
                        "primitive": "box",
                        "dimensions": {"width": 1.8, "height": 180.0, "depth": 30.0},
                        "position": {"x": 0.9, "y": 90.0, "z": 15.0},
                        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                        "color": "brown",
                        "material": "oak",
                        "step": 1,
                        "qty": 1,
                    },
                    {
                        "id": "side_right",
                        "name": "Right Side Panel",
                        "primitive": "box",
                        "dimensions": {"width": 1.8, "height": 180.0, "depth": 30.0},
                        "position": {"x": 79.1, "y": 90.0, "z": 15.0},
                        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                        "color": "brown",
                        "material": "oak",
                        "step": 1,
                        "qty": 1,
                    },
                ],
            },
            {
                "stepNumber": 2,
                "title": "Top, Bottom, and Shelves",
                "parts": [
                    {
                        "id": "bottom_panel",
                        "name": "Bottom Panel",
                        "primitive": "box",
                        "dimensions": {"width": 76.4, "height": 1.8, "depth": 30.0},
                        "position": {"x": 40.0, "y": 0.9, "z": 15.0},
                        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                        "color": "brown",
                        "material": "oak",
                        "step": 2,
                        "qty": 1,
                    },
                    {
                        "id": "top_panel",
                        "name": "Top Panel",
                        "primitive": "box",
                        "dimensions": {"width": 76.4, "height": 1.8, "depth": 30.0},
                        "position": {"x": 40.0, "y": 179.1, "z": 15.0},
                        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                        "color": "brown",
                        "material": "oak",
                        "step": 2,
                        "qty": 1,
                    },
                    {
                        "id": "shelf_1",
                        "name": "Shelf 1",
                        "primitive": "box",
                        "dimensions": {"width": 76.4, "height": 1.8, "depth": 30.0},
                        "position": {"x": 40.0, "y": 60.0, "z": 15.0},
                        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                        "color": "brown",
                        "material": "oak",
                        "step": 2,
                        "qty": 1,
                    },
                    {
                        "id": "shelf_2",
                        "name": "Shelf 2",
                        "primitive": "box",
                        "dimensions": {"width": 76.4, "height": 1.8, "depth": 30.0},
                        "position": {"x": 40.0, "y": 120.0, "z": 15.0},
                        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                        "color": "brown",
                        "material": "oak",
                        "step": 2,
                        "qty": 1,
                    },
                ],
            },
        ]
        if include_back:
            steps.append(
                {
                    "stepNumber": 3,
                    "title": "Attach Back Panel",
                    "parts": [
                        {
                            "id": "back_panel",
                            "name": "Back Panel",
                            "primitive": "box",
                            "dimensions": {"width": 76.4, "height": 176.4, "depth": 0.5},
                            "position": {"x": 40.0, "y": 90.0, "z": 29.75},
                            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                            "color": "brown",
                            "material": "oak",
                            "step": 3,
                            "qty": 1,
                        }
                    ],
                }
            )
        return steps

    def test_scene_missing_back_panel_rejected(self):
        scene = {"schemaVersion": 1, "steps": self._base_bookcase_steps(include_back=False)}
        errors = run_validator(scene)
        self.assertTrue(
            any("back panel" in err.lower() for err in errors),
            f"Expected missing back panel completeness error, got: {errors}",
        )

    def test_complete_scene_passes(self):
        scene = {"schemaVersion": 1, "steps": self._base_bookcase_steps(include_back=True)}
        errors = run_validator(scene)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()

