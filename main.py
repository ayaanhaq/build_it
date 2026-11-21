import json
import sys
from checker import check, load_parts
from renderer import render


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 main.py <netlist.json>")
        sys.exit(1)

    path = sys.argv[1]
    with open(path, "r") as f:
        netlist = json.load(f)

    lib = load_parts()
    errors = check(netlist, lib)
    if errors:
        for err in errors:
            print(f"Error: {err}")
        sys.exit(1)

    print(render(netlist))


if __name__ == "__main__":
    main()
