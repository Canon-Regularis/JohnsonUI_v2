"""Asteroid dataset loader: the bundled NASA NEA snapshot is the demo data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZATION SEAM #3 — Swap demo data
See HACKATHON.md §3.

This demo's data is a STATIC snapshot of NASA's Near-Earth-Asteroid +
close-approach dataset (Kaggle: darkmatternet/nasa-near-earth-asteroids-
and-close-approaches), pre-baked into `asteroid_snapshot.json` so the agent
needs no pandas / kagglehub / Kaggle credentials at runtime. To point the
demo at a different dataset, regenerate the snapshot (see
`regenerate_snapshot()` below) or hand-author a new asteroid_snapshot.json
with the same `{summary, close_approaches}` shape.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import functools
import json
from pathlib import Path

SNAPSHOT = Path(__file__).parent / "asteroid_snapshot.json"

# How many close-approach records the snapshot ships with. Used by the
# regenerator below; the bundled snapshot already obeys it.
MAX_APPROACHES = 150


@functools.lru_cache(maxsize=1)
def get_asteroid_payload() -> dict:
    """Return the bundled asteroid payload: `{summary, close_approaches}`.

    `summary` carries dataset-wide aggregates (total known NEAs, potentially
    hazardous count, future close approaches, size-category counts).
    `close_approaches` is an array of upcoming Earth close approaches (sorted
    by miss distance, closest first), each joined with the asteroid's
    Keplerian orbital elements.
    """
    with SNAPSHOT.open(encoding="utf-8") as f:
        return json.load(f)


def get_data_dictionary() -> str:
    """One-block schema description embedded in the agents' system prompts."""
    payload = get_asteroid_payload()
    sample = json.dumps(payload["close_approaches"][0], indent=2)
    summary = json.dumps(payload["summary"], indent=2)
    return f"""\
The dataset is NASA's near-Earth-asteroid + close-approach catalog. It has
two keys:
- `summary`: dataset-wide stats: {summary}
- `close_approaches`: array of {len(payload["close_approaches"])} upcoming \
Earth close approaches (2025-2035, sorted by miss distance, closest first). \
Each record looks like:
{sample}
Field notes: `dist_lunar` is the miss distance in lunar distances \
(1 LD = 384,400 km). `hazardous` is NASA's "potentially hazardous asteroid" \
flag. `size_category` bins the estimated diameter. Orbital elements \
(`eccentricity`, `semi_major_axis_au`, `inclination_deg`, `perihelion_au`, \
`aphelion_au`, `period_years`) describe the heliocentric Keplerian orbit and \
may be null for a few records — always guard against null before using them."""


def regenerate_snapshot() -> dict:
    """Rebuild asteroid_snapshot.json from the live Kaggle dataset.

    NOT called at request time — this is the offline maintenance path for
    refreshing the bundled snapshot. Requires `pandas` + `kagglehub` (not in
    the agent's runtime deps) and Kaggle access. Import them lazily so the
    runtime never pays for them.
    """
    import glob

    import kagglehub  # type: ignore[import-not-found]
    import pandas as pd  # type: ignore[import-not-found]

    dataset = "darkmatternet/nasa-near-earth-asteroids-and-close-approaches"
    directory = kagglehub.dataset_download(dataset)

    def find_csv(keyword: str) -> str:
        matches = [
            p
            for p in glob.glob(str(Path(directory) / "*.csv"))
            if keyword in Path(p).name
        ]
        if not matches:
            raise FileNotFoundError(f"No CSV matching '{keyword}' in {directory}")
        return matches[0]

    approaches = pd.read_csv(find_csv("close_approaches"))
    asteroids = pd.read_csv(find_csv("near_earth_asteroids"), low_memory=False)

    ast = asteroids[
        ["pdes", "pha", "H", "diameter_m", "size_category", "class",
         "e", "a", "i", "q", "ad", "per_y", "moid_lunar_distances"]
    ].copy()
    ast["pdes"] = ast["pdes"].astype(str).str.strip()

    appr = approaches.copy()
    appr["designation"] = appr["designation"].astype(str).str.strip()
    appr = appr[appr["is_future"]].sort_values("dist_lunar").head(MAX_APPROACHES)

    merged = appr.merge(ast, left_on="designation", right_on="pdes", how="left")

    records = []
    for _, row in merged.iterrows():
        def num(v, ndigits=4):
            return None if pd.isna(v) else round(float(v), ndigits)

        records.append({
            "designation": row["designation"],
            "name": row["full_name"],
            "approach_date": row["close_approach_date"],
            "dist_lunar": num(row["dist_lunar"], 2),
            "dist_km": num(row["dist_km"], 0),
            "velocity_km_s": num(row["velocity_km_s"], 2),
            "abs_magnitude": num(row["absolute_magnitude"], 2),
            "diameter_m": num(row["diameter_m"], 1),
            "size_category": None if pd.isna(row["size_category"]) else row["size_category"],
            "hazardous": bool(row["pha"]) if pd.notna(row["pha"]) else False,
            "orbit_class": None if pd.isna(row["class"]) else row["class"],
            "eccentricity": num(row["e"]),
            "semi_major_axis_au": num(row["a"]),
            "inclination_deg": num(row["i"], 2),
            "perihelion_au": num(row["q"]),
            "aphelion_au": num(row["ad"]),
            "period_years": num(row["per_y"], 3),
        })

    pha_total = int(asteroids["pha"].fillna(False).astype(bool).sum())
    sizes = asteroids["size_category"].value_counts().to_dict()
    summary = {
        "total_known_neas": int(len(asteroids)),
        "total_potentially_hazardous": pha_total,
        "future_close_approaches_to_2035": int(approaches["is_future"].sum()),
        "approaches_in_payload": len(records),
        "closest_upcoming_lunar_distances": records[0]["dist_lunar"] if records else None,
        "size_category_counts": {str(k): int(v) for k, v in sizes.items()},
    }
    payload = {"summary": summary, "close_approaches": records}
    SNAPSHOT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    get_asteroid_payload.cache_clear()
    return payload


if __name__ == "__main__":
    regenerate_snapshot()
    print(f"Regenerated {SNAPSHOT}")
