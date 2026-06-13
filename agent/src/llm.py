"""Shared chat-model builder — one provider, two backends.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FROZEN.md hard-rule #4 keeps the provider on the native Google Gen AI SDK
(`ChatGoogleGenerativeAI`) — required because Gemini 3.x replays a
thought-signature across tool turns that only this SDK handles. We DON'T
change that. This helper just lets the SAME class target either backend:

  - Gemini Developer API (AI Studio) — default. Auth: GEMINI_API_KEY.
  - Vertex AI (Google Cloud) — opt-in via GOOGLE_GENAI_USE_VERTEXAI=true.
    Auth: Application Default Credentials (gcloud auth application-default
    login) against GOOGLE_CLOUD_PROJECT. This is the backend GCP credits
    bill against. Same SDK underneath, so tool-turn behavior is unchanged.

Both agents + the extractor build their model through here so the
backend choice is set in ONE place by env, never in code.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import os
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI


def use_vertex() -> bool:
    """True when the agents should route through Vertex AI (GCP credits)."""
    return os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def build_chat_model(**kwargs: Any) -> ChatGoogleGenerativeAI:
    """Construct the chat model for the active backend.

    `model` comes from MODEL (default gemini-3.5-flash on AI Studio; set a
    Vertex-available id like gemini-2.5-flash when GOOGLE_GENAI_USE_VERTEXAI
    is on). Extra kwargs (e.g. temperature=0) pass straight through.
    """
    model = os.getenv("MODEL", "gemini-3.5-flash").strip()
    if use_vertex():
        # Vertex AI backend — no API key; uses ADC against the Cloud project.
        # .strip() guards against trailing whitespace in .env values, which
        # the Vertex endpoint rejects as an invalid project/location.
        project = (os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip() or None
        location = (os.getenv("GOOGLE_CLOUD_LOCATION") or "us-central1").strip()
        return ChatGoogleGenerativeAI(
            model=model,
            vertexai=True,
            project=project,
            location=location,
            **kwargs,
        )
    # Gemini Developer API (AI Studio) backend — default.
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=os.getenv("GEMINI_API_KEY"),
        **kwargs,
    )
