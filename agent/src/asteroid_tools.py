"""Shared agent tools: the bundled asteroid dataset → structured data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZATION SEAM #3 — Swap demo data
See HACKATHON.md §3.

The demo data is the static NASA NEA snapshot loaded by asteroid_data.py.
`load_asteroids` hands the dashboard agent the whole payload to derive KPIs/
trend/share/rows from; `query_asteroids` answers a free-form question about
the dataset and returns shape-hinted structured data for the dynamic agent
to render. To retarget the demo, swap the snapshot (asteroid_data.py) and
reword the extraction prompts below.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import collections
import json
import re

from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI

from src.asteroid_data import get_asteroid_payload
from src.llm import build_chat_model

# Gemini 3.5 Flash via the native Google Gen AI SDK — same provider as the
# primary agents (see main.py / FROZEN.md "LLM provider"). Constructed lazily
# so `import main` succeeds with OFFLINE=1 and no key (the OFFLINE /fixed path
# never reaches these tools); the client is built the first time a tool runs.
_EXTRACTOR: ChatGoogleGenerativeAI | None = None


def _extractor() -> ChatGoogleGenerativeAI:
    global _EXTRACTOR
    if _EXTRACTOR is None:
        # Backend (AI Studio vs Vertex AI) is chosen by env in src/llm.py.
        _EXTRACTOR = build_chat_model(temperature=0)
    return _EXTRACTOR


def _strip_to_json(text: str) -> str:
    """LLM output may be wrapped in ```json fences. Strip them."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _compact_context() -> str:
    """A small, analysis-ready view of the dataset for the extractor LLM.

    Shipping the full ~84KB payload per question made the model call slow
    enough to terminate the AG-UI stream (INCOMPLETE_STREAM). Instead we
    precompute the aggregates most questions need (approaches per year, by
    orbit class) server-side and compact each record to the fields that
    matter (dropping the heavy Keplerian elements). Result is ~5x smaller and
    answers within the stream's lifetime. Records stay sorted closest-first.
    """
    payload = get_asteroid_payload()
    ca = payload["close_approaches"]

    per_year: collections.Counter[str] = collections.Counter()
    by_orbit: collections.Counter[str] = collections.Counter()
    for r in ca:
        year = str(r.get("approach_date") or "")[:4]
        if year.isdigit():
            per_year[year] += 1
        oc = r.get("orbit_class")
        if oc:
            by_orbit[oc] += 1

    def compact(r: dict) -> dict:
        return {
            "name": (r.get("name") or "").strip(),
            "date": r.get("approach_date"),
            "miss_ld": r.get("dist_lunar"),
            "vel_kms": r.get("velocity_km_s"),
            "diam_m": r.get("diameter_m"),
            "size": r.get("size_category"),
            "hazardous": r.get("hazardous"),
            "class": r.get("orbit_class"),
            # Keplerian elements — needed for the OrbitView 3D component.
            "ecc": r.get("eccentricity"),
            "a_au": r.get("semi_major_axis_au"),
            "incl_deg": r.get("inclination_deg"),
        }

    view = {
        "summary": payload["summary"],
        "approaches_per_year": dict(sorted(per_year.items())),
        "approaches_by_orbit_class": dict(by_orbit.most_common()),
        # Upcoming close approaches, sorted closest-first (miss distance in
        # lunar distances). Fields: miss_ld, vel_kms (km/s), diam_m (metres).
        "close_approaches": [compact(r) for r in ca],
    }
    return json.dumps(view)


@tool
def load_asteroids() -> str:
    """Load the near-Earth-asteroid mission dataset.

    Takes NO arguments. Returns the full JSON payload — `summary`
    (dataset-wide aggregates) plus `close_approaches` (the upcoming Earth
    close approaches with their orbital elements). Call this ONCE at the
    start of a turn that needs to (re)build the dashboard, read the numbers,
    then call `render_dashboard` with the values derived for the active
    scope. Never invent numbers that aren't in this payload.
    """
    return json.dumps(get_asteroid_payload())


@tool
def query_asteroids(question: str) -> str:
    """Answer a question about the near-Earth-asteroid dataset and return
    ONLY structured data that the dynamic agent can then render as a UI
    surface.

    You do NOT pass the dataset — this tool reads the bundled mission data
    itself. Pass only the user's question.

    Returns a JSON object: { "shape_hint": "stat|trend|share|table|text",
                             "title": "...", "summary": "...",
                             "data": <shape-appropriate payload> }
    The shape_hint is advice. The agent makes the final layout decision.
    """
    # Compact, pre-aggregated view (see _compact_context) — keeps the call
    # fast enough that the AG-UI stream doesn't terminate mid-answer.
    dataset = _compact_context()
    sys = (
        "You are an orbital-dynamics analyst answering a question about a "
        "near-Earth-asteroid dataset. Return ONLY a JSON object describing "
        "the answer as structured data. No prose, no markdown fences. Use "
        "ONLY numbers present in the dataset. Pick the most natural shape:\n"
        "- 'stat'  → { value, delta?, caption? }  for single-metric answers\n"
        "- 'trend' → [{label, value}, ...]        for time-series "
        "(e.g. approaches per year)\n"
        "- 'share' → [{label, value}, ...]        for breakdowns "
        "(e.g. by size class or orbit class)\n"
        "- 'table' → { columns:[{key,label}], rows:[{...}] }  for ranked "
        "lists (e.g. closest approaches)\n"
        "- 'orbit' → [{name, eccentricity, semiMajorAxisAu, inclinationDeg, "
        "hazardous}]  for 3D heliocentric orbit views (map ecc→eccentricity, "
        "a_au→semiMajorAxisAu, incl_deg→inclinationDeg; ~25 bodies max)\n"
        "- 'text'  → string                       for narrative answers\n"
    )
    user = f"""\
Question: {question}

Mission dataset (JSON):
\"\"\"
{dataset}
\"\"\"

Return JSON shaped like:
{{
  "shape_hint": "stat|trend|share|table|text",
  "title": "...",
  "summary": "...",
  "data": <payload above>
}}
"""
    out = _extractor().invoke([("system", sys), ("user", user)])
    raw = _strip_to_json(out.content if isinstance(out.content, str) else str(out.content))
    try:
        json.loads(raw)  # validate
        return raw
    except json.JSONDecodeError:
        return json.dumps(
            {
                "shape_hint": "text",
                "title": "Answer",
                "summary": "Could not produce structured output.",
                "data": "",
            }
        )
