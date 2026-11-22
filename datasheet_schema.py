import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "datasheet_extraction.schema.json"


def load_datasheet_schema(path: Optional[Path] = None) -> Dict[str, Any]:
    """Load the JSON schema for datasheet extractions."""
    target_path = path or SCHEMA_PATH
    with open(target_path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_datasheet_extraction(
    data: Any, schema: Optional[Dict[str, Any]] = None
) -> List[str]:
    """Validate extracted datasheet data against the extraction schema.

    Returns:
        List of error message strings. An empty list indicates valid data.
    """
    if not isinstance(data, dict):
        return ["Datasheet extraction data must be a JSON object (dictionary)"]

    if schema is None:
        schema = load_datasheet_schema()

    try:
        import jsonschema

        validator = jsonschema.Draft7Validator(schema)
        errors = []
        for err in sorted(validator.iter_errors(data), key=lambda e: str(e.path)):
            loc = ".".join(str(p) for p in err.path) if err.path else "root"
            errors.append(f"[{loc}] {err.message}")
        return errors
    except ImportError:
        # Fallback standard library validation if jsonschema is unavailable
        errors = []
        for req in ("part_number", "part_type", "pins", "provenance"):
            if req not in data:
                errors.append(f"[root] '{req}' is a required property")

        pins = data.get("pins")
        if isinstance(pins, dict):
            if not pins:
                errors.append("[pins] pins must contain at least one pin definition")
            for pin_name, pin_def in pins.items():
                if not isinstance(pin_def, dict):
                    errors.append(f"[pins.{pin_name}] pin definition must be an object")
                    continue
                if "role" not in pin_def:
                    errors.append(f"[pins.{pin_name}] 'role' is a required property")
                elif pin_def["role"] not in (
                    "gpio",
                    "power",
                    "ground",
                    "anode",
                    "cathode",
                    "passive",
                    "output",
                    "input",
                ):
                    errors.append(
                        f"[pins.{pin_name}.role] '{pin_def['role']}' is not a valid role"
                    )
        elif "pins" in data:
            errors.append("[pins] pins must be an object")

        prov = data.get("provenance")
        if isinstance(prov, dict):
            for req_prov in ("source", "extraction_method", "confidence"):
                if req_prov not in prov:
                    errors.append(f"[provenance] '{req_prov}' is a required property")
            source = prov.get("source")
            if isinstance(source, dict):
                for req_src in ("document_name", "document_sha256"):
                    if req_src not in source:
                        errors.append(f"[provenance.source] '{req_src}' is a required property")
                sha = source.get("document_sha256")
                if sha and (not isinstance(sha, str) or len(sha) != 64 or not all(c in "0123456789abcdefABCDEF" for c in sha)):
                    errors.append("[provenance.source.document_sha256] document_sha256 must be a 64-character hex string")
        elif "provenance" in data:
            errors.append("[provenance] provenance must be an object")

        return errors


def is_valid_datasheet_extraction(
    data: Any, schema: Optional[Dict[str, Any]] = None
) -> bool:
    """Return True if the data satisfies the datasheet extraction schema."""
    return len(validate_datasheet_extraction(data, schema)) == 0
