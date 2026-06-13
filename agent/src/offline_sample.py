"""Canned dashboard inputs for OFFLINE=1 mode.

When OFFLINE=1 is set, the /fixed agent serves a deterministic sample
dashboard with NO Gemini call and no API key (see fixed_agent.py). These
args are passed verbatim to `render_dashboard(**OFFLINE_DASHBOARD_ARGS)`,
so they MUST satisfy that tool's typed inputs:

  - eyebrow / title / subtitle: str
  - kpis: EXACTLY 4 × {label, value, delta, caption}     (Kpi)
  - trend: 6-12 × {label, value: float}                  (Point)
  - share: 3-5 × {label, value: float}                   (Point)
  - rows: 5-8 × {name, category, value, delta}           (Row)
  - scope_options: 3-6 × {label, value}                  (ScopeOption)
  - scope_selected: str (one of scope_options' values)

Dataset: the bundled NASA near-Earth-asteroid snapshot (see
asteroid_data.py). These numbers are taken verbatim from
asteroid_snapshot.json — dataset-wide summary stats for the KPIs, close
approaches per year for the trend, size-class counts for the share donut,
and the closest upcoming approaches for the table. The scope chips mirror
the canonical set in fixed_agent.py's system prompt.
"""
from __future__ import annotations

from typing import Any

# Keep this a plain dict of JSON-ish primitives so it round-trips cleanly as
# tool-call args and through a2ui.render(...). Field names match the
# TypedDicts in fixed_agent.py (Kpi / Point / Row / ScopeOption) exactly.
OFFLINE_DASHBOARD_ARGS: dict[str, Any] = {
    "eyebrow": "NEAR-EARTH ASTEROIDS · CLOSE APPROACHES 2026-2035",
    "title": "Asteroid Mission Control",
    "subtitle": "Known near-Earth asteroids, the potentially hazardous subset, and the closest upcoming Earth approaches.",
    "kpis": [
        {
            "label": "Known NEAs",
            "value": "41,281",
            "delta": "",
            "caption": "Total cataloged near-Earth asteroids",
        },
        {
            "label": "Potentially hazardous",
            "value": "2,539",
            "delta": "",
            "caption": "PHAs — 6.2% of known NEAs",
        },
        {
            "label": "Future close approaches",
            "value": "3,888",
            "delta": "",
            "caption": "Upcoming Earth approaches through 2035",
        },
        {
            "label": "Closest upcoming",
            "value": "0.10 LD",
            "delta": "",
            "caption": "Apophis, Apr 2029 · 1 LD = 384,400 km",
        },
    ],
    # Close approaches per year (count). 10 points (within the 6-12 range).
    "trend": [
        {"label": "2026", "value": 17},
        {"label": "2027", "value": 18},
        {"label": "2028", "value": 22},
        {"label": "2029", "value": 20},
        {"label": "2030", "value": 11},
        {"label": "2031", "value": 15},
        {"label": "2032", "value": 13},
        {"label": "2033", "value": 12},
        {"label": "2034", "value": 14},
        {"label": "2035", "value": 8},
    ],
    # Known NEAs by size class (count). 4 slices (within the 3-5 range).
    "share": [
        {"label": "Small (25-140m)", "value": 19154},
        {"label": "Medium (140m-1km)", "value": 10726},
        {"label": "Tiny (<25m)", "value": 10460},
        {"label": "Large (>1km)", "value": 941},
    ],
    # Closest upcoming approaches. 6 rows (within the 5-8 range).
    "rows": [
        {
            "name": "99942 Apophis",
            "category": "Aten",
            "value": "0.10 LD",
            "delta": "7.4 km/s",
        },
        {
            "name": "2008 DB",
            "category": "Apollo",
            "value": "0.33 LD",
            "delta": "7.4 km/s",
        },
        {
            "name": "2024 QP2",
            "category": "Apollo",
            "value": "0.57 LD",
            "delta": "9.7 km/s",
        },
        {
            "name": "153814 (2001 WN5)",
            "category": "Apollo",
            "value": "0.65 LD",
            "delta": "10.2 km/s",
        },
        {
            "name": "2013 GM3",
            "category": "Aten",
            "value": "0.68 LD",
            "delta": "7.4 km/s",
        },
        {
            "name": "2024 YR4",
            "category": "Apollo",
            "value": "0.72 LD",
            "delta": "13.3 km/s",
        },
    ],
    # Scope chips matching fixed_agent.py's canonical set (3-6 chips).
    "scope_options": [
        {"label": "Closest approaches", "value": "closest"},
        {"label": "Hazardous only", "value": "hazardous"},
        {"label": "By size class", "value": "by_size"},
        {"label": "Fastest", "value": "fastest"},
        {"label": "Largest", "value": "largest"},
    ],
    "scope_selected": "closest",
}
