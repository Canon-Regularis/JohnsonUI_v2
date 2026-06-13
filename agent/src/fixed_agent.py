"""Fixed-schema dashboard agent — Asteroid Mission Control.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZATION SEAM #5 — Swap the agent flow (fixed-schema dashboard)
See HACKATHON.md §5 for the full recipe. For a different fixed dashboard,
rewrite the layout JSON at agent/src/a2ui/schemas/dashboard.json and the
`render_dashboard` tool's typed inputs; reword the system prompt for your
domain. The dynamic Q&A flow lives in dynamic_agent.py.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The demo data is a static NASA near-Earth-asteroid snapshot (see
asteroid_data.py). The agent calls `load_asteroids` to pull the dataset,
then calls `render_dashboard` with the structured data derived in the same
model pass. The dashboard surface includes an interactive scope-chips strip
the agent populates (closest approaches, hazardous only, by size class, …).
Clicking a chip fires a user action back to the agent, which re-renders the
dashboard focused on the new scope.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver

from src.asteroid_data import get_data_dictionary
from src.asteroid_tools import load_asteroids
from src.catalog import CATALOG_ID, CATALOG_PROMPT
from src.llm import build_chat_model

SCHEMA_DIR = Path(__file__).parent / "a2ui" / "schemas"
DASHBOARD_SCHEMA = a2ui.load_schema(SCHEMA_DIR / "dashboard.json")
SURFACE = "asteroid-dashboard"


# NOTE (Gemini typed-array fix): every list parameter on render_dashboard
# below is typed as `list[<TypedDict>]`, NOT `list[dict]`. Gemini's
# function-declaration validator rejects untyped arrays with
# "parameters.properties[X].items: missing field". A TypedDict compiles to a
# concrete object schema, so these arrays carry the `items` Gemini requires.
# Keep them typed — do not loosen to `list[dict]`.
class Kpi(TypedDict):
    label: str
    value: str
    delta: str
    caption: str


class Point(TypedDict):
    label: str
    value: float


class Row(TypedDict):
    name: str
    category: str
    value: str
    delta: str


class ScopeOption(TypedDict):
    label: str
    value: str


@tool
def render_dashboard(
    eyebrow: str,
    title: str,
    subtitle: str,
    kpis: list[Kpi],
    trend: list[Point],
    share: list[Point],
    rows: list[Row],
    scope_options: list[ScopeOption],
    scope_selected: str,
) -> str:
    """Render the interactive Asteroid Mission Control dashboard.

    Pass data INLINE. Call ONCE per turn.

    Required shapes:
      - kpis: EXACTLY 4 cards. Each {label, value, delta, caption}.

        STRICT FIELD RULES (very important; the badge breaks if you ignore):
          * `value`   = the headline number, formatted ("41,281", "2,539",
                        "0.1 LD", "7.42 km/s"). 1–8 chars typically.
          * `delta`   = JUST a short magnitude tag, or "" (empty) when there
                        is no comparison — which is the COMMON case for this
                        dataset. MAX 8 chars. NEVER prose. The arrow/color
                        come from the renderer.
                        Examples: "", "+12%", "-3%", "6.1%"
                        Bad:      "↑ vs. last year", "closest on record"
          * `caption` = the context sentence ("of 41,281 known NEAs",
                        "closest: Apophis, Apr 2029", "1 LD = 384,400 km").
                        Up to ~80 chars. This is where the prose goes.

      - trend: 6–12 points. {label, value:number}. Good choice for asteroids:
        close approaches per year (label = year, value = count).
      - share: 3–5 slices. {label, value:number}. Good choice: count by size
        class, or by orbit class.
      - rows: 5–8 table rows {name, category, value, delta}. Good choice:
        the closest upcoming approaches (name = asteroid, category = orbit or
        size class, value = miss distance like "0.10 LD"). Keep row.delta
        SHORT or "" (e.g. the velocity "7.4 km/s" or "").
      - scope_options: 3–6 chips the user can click to re-scope. Each
        {label, value}. Example chip set for the asteroid dataset:
          [{label:"Closest approaches", value:"closest"},
           {label:"Hazardous only",     value:"hazardous"},
           {label:"By size class",      value:"by_size"},
           {label:"Fastest",            value:"fastest"},
           {label:"Largest",            value:"largest"}]
        Tailor the options to what the data actually supports.
      - scope_selected: the `value` of the currently active option.
    """
    payload = {
        "eyebrow": eyebrow,
        "title": title,
        "subtitle": subtitle,
        "kpis": kpis,
        "trend": trend,
        "share": share,
        "rows": rows,
        "scope": {"options": scope_options, "selected": scope_selected},
    }
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE, DASHBOARD_SCHEMA),
            a2ui.update_data_model(SURFACE, payload),
        ]
    )


SYSTEM_PROMPT = f"""\
You are the Asteroid Mission Control engine. You build and maintain a live
dashboard from a near-Earth-asteroid (NEA) dataset.

## The dataset

{get_data_dictionary()}

Call `load_asteroids()` (no arguments) to pull the full payload whenever you
need the per-asteroid records (for the trend, share, and table). It returns
`summary` + `close_approaches`. Use ONLY numbers that appear in that payload.

## How a turn works

The user may do three things on any turn:
  A) Open the demo / ask to build the dashboard (initial render).
  B) Send a chat message ("how fast is Apophis?", "re-render focused on
     hazardous asteroids", "which is the largest?").
  C) Click a scope chip on the dashboard. The runtime delivers this as a
     tool result `log_a2ui_event` with content like:
        User performed action "select_chip" on surface "asteroid-dashboard".
        Context: {{"value": "hazardous", "label": "Scope"}}

In every case, decide whether to re-render the dashboard, answer in chat,
or both.

## The render contract

To render: call `load_asteroids()` once, read the data, then call
`render_dashboard(...)` ONCE with structured data:
  - 4 KPIs (e.g. known NEAs, potentially hazardous, future close approaches,
    closest upcoming miss distance).
  - 6–12 trend points (e.g. close approaches per year).
  - 3–5 share slices (e.g. count by size class, or by orbit class).
  - 5–8 rows (e.g. the closest upcoming approaches).
  - `scope_options`: 3–6 chips, e.g. [Closest approaches, Hazardous only,
    By size class, Fastest, Largest].
  - `scope_selected`: which chip is active. Default to "closest" on the
    first render. After a chip click, set this to the clicked value.

When the user (or a chip click) changes scope:
  - Re-derive the trend / share / rows for the new scope from the payload
    (e.g. for "hazardous" filter close_approaches to hazardous==true; for
    "fastest" sort by velocity_km_s; for "largest" sort by diameter_m).
  - Re-call render_dashboard with the SAME surfaceId so the canvas updates
    in place. scope_selected reflects the new active chip.

## Hard rules

- Render the dashboard on the first turn, whenever the user asks to
  re-render in any way, or when they click a chip.
- Call `render_dashboard` AT MOST ONCE per turn. Never twice.
- Use ONLY numbers that actually appear in the dataset payload.
- If the user asks an analytical question that does NOT require a layout
  change (e.g. "how fast is Apophis going?"), answer in chat without
  re-rendering. 1–3 sentences max. Cite the number.
- If the user wants a brand-new visualization not covered by the fixed
  schema (e.g. "plot velocity vs miss distance"), tell them to use the
  Dynamic tab.

## Chat tone

Be helpful, brief, conversational. After the first render, you can suggest
one or two follow-ups the user might click ("Tap *Hazardous only* to focus
the threat board" or "Want the fastest approachers?"). Don't list more than
two suggestions.

{CATALOG_PROMPT}
"""


# Gemini 3.5 Flash via the native Google Gen AI SDK — same provider as the
# dynamic agent and the asteroid extractor (see FROZEN.md "LLM provider"). The
# native SDK replays Gemini's thought_signature across tool turns, which the
# OpenAI-compat path does not.
#
# Constructed lazily (not at import time): ChatGoogleGenerativeAI validates
# the API key in its constructor and raises with no key. Building it lazily
# lets `import main` succeed with OFFLINE=1 and no key (the offline branch of
# build_fixed_agent never touches the live model). Online behavior is
# unchanged — the client is built on the first build_fixed_agent() call.
def _build_model() -> ChatGoogleGenerativeAI:
    # Backend (AI Studio vs Vertex AI) is chosen by env in src/llm.py.
    return build_chat_model()


def build_fixed_agent():
    if os.getenv("OFFLINE") == "1":
        # CUSTOMIZATION SEAM (offline): no Gemini call, no API key. A
        # deterministic stub chat model drives the REAL create_agent ReAct
        # loop + the REAL render_dashboard tool, so the emitted A2UI envelope
        # is byte-for-byte the production shape (createSurface +
        # updateComponents + updateDataModel wrapped in a2ui_operations).
        from src.offline_fixed import build_offline_fixed_agent

        return build_offline_fixed_agent(render_dashboard, SYSTEM_PROMPT)

    return create_agent(
        model=_build_model(),
        tools=[load_asteroids, render_dashboard],
        # CopilotKitMiddleware forwards frontend tools + agent context (e.g.
        # useAgentContext payloads) to the LLM.
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=MemorySaver(),
    )


graph = build_fixed_agent()
