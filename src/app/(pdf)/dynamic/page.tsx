"use client";

import { useEffect } from "react";
import { z } from "zod";
import {
  CopilotChat,
  useAgent,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/pdf-analyst/Brand";
import { SurfaceCanvas, CanvasEmptyState } from "@/components/pdf-analyst/SurfaceCanvas";
import { FilteredUserMessage } from "@/components/pdf-analyst/FilteredUserMessage";
import { FilteredAssistantMessage } from "@/components/pdf-analyst/FilteredAssistantMessage";
import { Split } from "@/components/pdf-analyst/Split";
import { seedSurface } from "@/a2ui/seed";

const AGENT_ID = "dynamic_agent";

export default function DynamicPage() {
  const { agent: _agent } = useAgent({ agentId: AGENT_ID });

  // Open with an example surface so the canvas isn't blank — asking a
  // question replaces it with the agent's freshly composed surface.
  useEffect(() => {
    seedSurface(AGENT_ID);
  }, []);

  // generate_a2ui (the Python tool) is the surface producer. Show a small
  // pill while it streams, hide on complete (the rendered surface appears in
  // the canvas; chat doesn't need a record of it).
  useRenderTool({
    name: "generate_a2ui",
    parameters: z.any(),
    render: ({ status }) => {
      if (status === "complete") return <></>;
      return (
        <div className="surface-soft px-3 py-2 my-1 flex items-center gap-3 text-[13px] text-[var(--ink-2)]">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--lilac)] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--lilac)]" />
          </span>
          <span>Composing a surface…</span>
        </div>
      );
    },
  });

  // query_asteroids: render nothing, ever. The "Composing a surface…" pill
  // from generate_a2ui is the only chat signal we want. We override the
  // default tool card here so its args/result (the dataset JSON) stay out of
  // the DOM.
  useRenderTool({
    name: "query_asteroids",
    parameters: z.any(),
    render: () => <></>,
  });

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav active="dynamic" />

      <div className="flex-1 min-h-0 flex">
      <Split
        persistKey="dynamic.split"
        initialLeftFraction={0.32}
        left={
          <div className="h-full flex flex-col copilot-chat-wrapper">
            <div className="flex-1 min-h-0">
              <CopilotChat
                agentId={AGENT_ID}
                chatView={{
                  messageView: {
                    userMessage: FilteredUserMessage,
                    assistantMessage: FilteredAssistantMessage,
                  },
                }}
                labels={{
                  chatInputPlaceholder:
                    "Ask anything about the asteroids…",
                  welcomeMessageText:
                    "Ask any question about the near-Earth-asteroid dataset — e.g. “Plot velocity vs miss distance” or “Which are the most hazardous?”",
                }}
              />
            </div>
          </div>
        }
        right={
          <SurfaceCanvas
            channel={AGENT_ID}
            emptyState={
              <CanvasEmptyState
                title="Canvas is empty"
                subtitle="Ask anything about the asteroid dataset. The agent composes a UI surface from the catalog — a chart, a table, or a written explainer — and renders it here."
                hint={
                  <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
                    try: “Show close approaches per year.”
                  </span>
                }
              />
            }
          />
        }
      />
      </div>
    </div>
  );
}
