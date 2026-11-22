import unittest
from datasheet_schema import (
    is_valid_datasheet_extraction,
    load_datasheet_schema,
    validate_datasheet_extraction,
)


class DatasheetSchemaTests(unittest.TestCase):
    def setUp(self):
        self.valid_data = {
            "part_number": "HC-SR501",
            "part_type": "sensor",
            "description": "PIR Motion Detector Module",
            "is_sensor": True,
            "pins": {
                "VCC": {"role": "power", "v": 5.0},
                "GND": {"role": "ground"},
                "OUT": {
                    "role": "output",
                    "level": 3.3,
                    "max_source_ma": "UNVERIFIED",
                },
            },
            "provenance": {
                "source": {
                    "document_name": "HC-SR501.pdf",
                    "document_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    "url": "https://example.com/datasheets/HC-SR501.pdf",
                },
                "extracted_at": "2026-11-22T12:00:00Z",
                "extraction_method": "regex-table-extractor-v1",
                "confidence": 0.95,
                "pages": [1, 2],
                "field_provenance": {
                    "pins.OUT.level": {
                        "page": 2,
                        "raw_text": "Output: 3.3V TTL High level",
                        "confidence": 0.98,
                    }
                },
            },
        }

    def test_schema_loads_successfully(self):
        schema = load_datasheet_schema()
        self.assertIn("properties", schema)
        self.assertEqual(schema.get("title"), "DatasheetExtraction")

    def test_valid_datasheet_extraction_passes(self):
        errors = validate_datasheet_extraction(self.valid_data)
        self.assertEqual(errors, [])
        self.assertTrue(is_valid_datasheet_extraction(self.valid_data))

    def test_missing_required_fields_fails(self):
        for field in ("part_number", "part_type", "pins", "provenance"):
            data = dict(self.valid_data)
            del data[field]
            errors = validate_datasheet_extraction(data)
            self.assertTrue(len(errors) > 0)
            self.assertFalse(is_valid_datasheet_extraction(data))

    def test_empty_pins_fails(self):
        data = dict(self.valid_data)
        data["pins"] = {}
        errors = validate_datasheet_extraction(data)
        self.assertTrue(len(errors) > 0)

    def test_invalid_pin_role_fails(self):
        data = dict(self.valid_data)
        data["pins"] = {
            "P1": {"role": "invalid_magic_role"}
        }
        errors = validate_datasheet_extraction(data)
        self.assertTrue(len(errors) > 0)

    def test_unverified_values_allowed_by_schema(self):
        data = dict(self.valid_data)
        data["pins"] = {
            "GPIO1": {"role": "gpio", "level": "UNVERIFIED", "max_source_ma": "UNVERIFIED"}
        }
        errors = validate_datasheet_extraction(data)
        self.assertEqual(errors, [])

    def test_invalid_sha256_format_fails(self):
        data = dict(self.valid_data)
        data["provenance"] = dict(data["provenance"])
        data["provenance"]["source"] = dict(data["provenance"]["source"])
        data["provenance"]["source"]["document_sha256"] = "short_sha"
        errors = validate_datasheet_extraction(data)
        self.assertTrue(len(errors) > 0)

    def test_invalid_confidence_range_fails(self):
        data = dict(self.valid_data)
        data["provenance"] = dict(data["provenance"])
        data["provenance"]["confidence"] = 1.5
        errors = validate_datasheet_extraction(data)
        self.assertTrue(len(errors) > 0)

    def test_field_provenance_validation(self):
        data = dict(self.valid_data)
        data["provenance"] = dict(data["provenance"])
        data["provenance"]["field_provenance"] = {
            "pins.OUT.level": {
                # missing required raw_text
                "page": 2,
            }
        }
        errors = validate_datasheet_extraction(data)
        self.assertTrue(len(errors) > 0)

    def test_non_dict_input_fails(self):
        errors = validate_datasheet_extraction("not a dict")
        self.assertTrue(len(errors) > 0)
        self.assertFalse(is_valid_datasheet_extraction(None))


if __name__ == "__main__":
    unittest.main()
