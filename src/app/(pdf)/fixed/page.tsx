"use client";

import { useEffect } from "react";
import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/pdf-analyst/Brand";
import { SurfaceCanvas, CanvasEmptyState } from "@/components/pdf-analyst/SurfaceCanvas";
import { FilteredUserMessage } from "@/components/pdf-analyst/FilteredUserMessage";
import { FilteredAssistantMessage } from "@/components/pdf-analyst/FilteredAssistantMessage";
import { Split } from "@/components/pdf-analyst/Split";
import { seedSurface } from "@/a2ui/seed";

const AGENT_ID = "fixed_agent";

export default function FixedPage() {
  const { agent: _agent } = useAgent({ agentId: AGENT_ID });

  // Open with a pre-rendered dashboard so the canvas isn't blank — the user
  // reworks it via chat / scope chips. No LLM call; the live agent takes over
  // on the first interaction and re-renders the same surface in place.
  useEffect(() => {
    seedSurface(AGENT_ID);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav active="fixed" />

      <div className="flex-1 min-h-0 flex">
      <Split
        persistKey="fixed.split"
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
                    "Ask mission control… e.g. “Build the dashboard.”",
                  welcomeMessageText:
                    "Ask me to “Build the mission control dashboard,” then tap a scope chip (Hazardous only, Fastest, Largest) to re-focus it.",
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
                subtitle="Ask the agent to build the asteroid mission-control dashboard. It loads the near-Earth-asteroid dataset and paints the fixed A2UI surface here."
                hint={
                  <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
                    try: “Build the dashboard.”
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
