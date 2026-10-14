"""Score Gemma outputs for the fabricated three-screen Catch Up benchmark.

Save each /v1/import/extract response as output/import-benchmark-30/screen-N.json,
then run: python scripts/score-synthetic-import.py
"""

import json
from collections import defaultdict
from pathlib import Path


ROOT = Path("output/import-benchmark-30")
expected = json.loads((ROOT / "expected.json").read_text(encoding="utf-8"))
actual = []
for number in range(1, 4):
    path = ROOT / f"screen-{number}.json"
    rows = json.loads(path.read_text(encoding="utf-8"))["rows"]
    if not isinstance(rows, list):
        raise ValueError(f"{path} does not contain a rows array")
    actual.extend({**row, "file": f"screen-{number}.png"} for row in rows)


def key(row):
    return row["file"], row["date"], row["amount"], row["direction"]


remaining = defaultdict(list)
for row in actual:
    remaining[key(row)].append(row)
matched = []
missing = []
for row in expected:
    identity = key(row)
    if remaining[identity]:
        matched.append((row, remaining[identity].pop(0)))
    else:
        missing.append(row)

extras = [dict(file=file, date=date, amount=amount, direction=direction, count=count)
          for (file, date, amount, direction), rows in remaining.items() if (count := len(rows))]
wrong_activity = [
    {"file": expected_row["file"], "name": expected_row["name"], "expected": expected_row["activity"], "actual": actual_row.get("activity")}
    for expected_row, actual_row in matched if expected_row["activity"] != actual_row.get("activity")
]
print(json.dumps({
    "expected_rows": len(expected),
    "returned_rows": len(actual),
    "matched_date_amount_direction": len(matched),
    "missing": missing,
    "unexpected": extras,
    "wrong_activity": wrong_activity,
}, ensure_ascii=False, indent=2))
