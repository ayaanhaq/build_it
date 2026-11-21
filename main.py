import argparse
import json
import sys
from checker import check_with_warnings, load_parts
from renderer import get_step_list, render


def main():
    parser = argparse.ArgumentParser(
        description="Electronics build netlist checker and instruction generator"
    )
    parser.add_argument("netlist", help="Path to netlist JSON file")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print result as JSON {'ok': bool, 'errors': [...], 'warnings': [...], 'steps': [...]}",
    )
    args = parser.parse_args()

    try:
        with open(args.netlist, "r") as f:
            netlist = json.load(f)
    except Exception as e:
        if args.json:
            print(json.dumps({"ok": False, "errors": [str(e)], "warnings": [], "steps": []}))
        else:
            print(f"Error loading netlist file: {e}", file=sys.stderr)
        sys.exit(1)

    lib = load_parts()
    errors, warnings = check_with_warnings(netlist, lib)

    if args.json:
        result = {
            "ok": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "steps": get_step_list(netlist, lib) if len(errors) == 0 else [],
        }
        print(json.dumps(result, indent=2))
        sys.exit(0 if len(errors) == 0 else 1)

    if warnings:
        for warn in warnings:
            print(f"Warning: {warn}")

    if errors:
        for err in errors:
            print(f"Error: {err}")
        sys.exit(1)

    print(render(netlist, lib))


if __name__ == "__main__":
    main()
