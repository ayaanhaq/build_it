import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "scene.schema.json"
TYPES_PATH = REPO_ROOT / "src" / "types.ts"


def extract_ts_interface_required_fields(ts_content: str, interface_name: str) -> list[str]:
    """Parse TypeScript interface from types.ts and return list of required top-level property names."""
    match = re.search(rf"\binterface\s+{interface_name}\b", ts_content)
    if not match:
        raise ValueError(f"Interface {interface_name} not found in TypeScript content")
    idx = match.start()
    
    open_brace = ts_content.find("{", idx)
    depth = 1
    i = open_brace + 1
    while i < len(ts_content) and depth > 0:
        if ts_content[i] == "{":
            depth += 1
        elif ts_content[i] == "}":
            depth -= 1
        i += 1
    body = ts_content[open_brace + 1 : i - 1]

    # Extract top-level properties taking nested braces into account
    statements = []
    current = []
    nested_depth = 0
    for char in body:
        if char in ("{", "("):
            nested_depth += 1
        elif char in ("}", ")"):
            nested_depth -= 1
        elif (char == ";" or char == "\n") and nested_depth == 0:
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            continue
        current.append(char)
    if current:
        stmt = "".join(current).strip()
        if stmt:
            statements.append(stmt)

    required_fields = []
    for stmt in statements:
        if not stmt or stmt.startswith("//") or stmt.startswith("/*") or stmt.startswith("*"):
            continue
        prop_match = re.match(r"^([a-zA-Z0-9_]+)(\??)\s*:", stmt)
        if prop_match:
            name = prop_match.group(1)
            is_optional = prop_match.group(2) == "?"
            if not is_optional:
                required_fields.append(name)
    return sorted(required_fields)


def extract_ts_union_literals(ts_content: str, type_name: str) -> list[str]:
    """Parse string literal union type from TypeScript content."""
    pattern = rf"export\s+type\s+{type_name}\s*=\s*([^;]+);"
    match = re.search(pattern, ts_content, re.DOTALL)
    if not match:
        raise ValueError(f"Type {type_name} not found in TypeScript content")
    body = match.group(1)
    literals = re.findall(r'"([^"]+)"', body)
    return sorted(literals)


class SceneSchemaSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            cls.schema = json.load(f)
        with open(TYPES_PATH, "r", encoding="utf-8") as f:
            cls.ts_content = f.read()

    def test_schema_loads_with_valid_metadata(self):
        self.assertEqual(self.schema.get("$schema"), "http://json-schema.org/draft-07/schema#")
        self.assertEqual(self.schema.get("title"), "Scene")
        self.assertIn("properties", self.schema)
        self.assertIn("definitions", self.schema)

    def test_schema_version_is_1(self):
        # Schema requires schemaVersion == 1
        version_prop = self.schema["properties"]["schemaVersion"]
        self.assertEqual(version_prop.get("const"), 1)

    def test_scene_required_fields_sync(self):
        ts_required = extract_ts_interface_required_fields(self.ts_content, "Scene")
        schema_required = sorted(self.schema.get("required", []))
        self.assertEqual(schema_required, ts_required)
        self.assertIn("schemaVersion", schema_required)
        self.assertIn("steps", schema_required)

    def test_scene_step_required_fields_sync(self):
        ts_required = extract_ts_interface_required_fields(self.ts_content, "SceneStep")
        step_def = self.schema["definitions"]["SceneStep"]
        schema_required = sorted(step_def.get("required", []))
        self.assertEqual(schema_required, ts_required)
        self.assertIn("stepNumber", schema_required)
        self.assertIn("title", schema_required)
        self.assertIn("parts", schema_required)

    def test_scene_part_required_fields_sync(self):
        ts_required = extract_ts_interface_required_fields(self.ts_content, "ScenePart")
        part_def = self.schema["definitions"]["ScenePart"]
        schema_required = sorted(part_def.get("required", []))
        self.assertEqual(schema_required, ts_required)
        expected = [
            "color",
            "dimensions",
            "id",
            "material",
            "position",
            "primitive",
            "qty",
            "rotation",
            "step",
        ]
        self.assertEqual(schema_required, sorted(expected))

    def test_vector3d_required_fields_sync(self):
        ts_required = extract_ts_interface_required_fields(self.ts_content, "Vector3D")
        vec_def = self.schema["definitions"]["Vector3D"]
        schema_required = sorted(vec_def.get("required", []))
        self.assertEqual(schema_required, ts_required)
        self.assertEqual(schema_required, ["x", "y", "z"])

    def test_primitives_enum_sync(self):
        ts_primitives = extract_ts_union_literals(self.ts_content, "ScenePrimitiveType")
        schema_primitives = sorted(self.schema["definitions"]["ScenePrimitiveType"]["enum"])
        self.assertEqual(schema_primitives, ts_primitives)
        self.assertEqual(schema_primitives, ["bevel", "box", "cylinder", "lathe", "spring"])

    def test_real_tones_palette_sync(self):
        ts_tones = extract_ts_union_literals(self.ts_content, "RealToneColor")
        schema_tones = sorted(self.schema["definitions"]["RealToneColor"]["enum"])
        self.assertEqual(schema_tones, ts_tones)
        self.assertEqual(len(schema_tones), 19)

    def test_valid_scene_fixture_passes_schema(self):
        try:
            import jsonschema
            sample_scene = {
                "schemaVersion": 1,
                "name": "sample_desk",
                "title": "Sample 3D Desk Build",
                "steps": [
                    {
                        "stepNumber": 1,
                        "title": "Foundation Legs",
                        "parts": [
                            {
                                "id": "leg_front_left",
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
                            }
                        ],
                    }
                ],
            }
            validator = jsonschema.Draft7Validator(self.schema)
            errors = list(validator.iter_errors(sample_scene))
            self.assertEqual(errors, [])
        except ImportError:
            self.skipTest("jsonschema not installed")


if __name__ == "__main__":
    unittest.main()
