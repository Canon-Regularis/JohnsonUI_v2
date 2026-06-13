/**
 * Seed surfaces — the UI each demo shows BEFORE the user types anything.
 *
 * Like the prototype's persisted dashboard, the canvas opens populated so the
 * user has something to rework instead of a blank slate. These are static,
 * pre-rendered A2UI op batches (createSurface + updateComponents [+
 * updateDataModel]) pushed onto the surface bus on mount — no LLM call, so the
 * page paints instantly. Once the user chats or clicks a chip, the live agent
 * re-renders the SAME surfaceId in place (the canvas dedupes the repeat
 * createSurface), so the seed is just the starting point.
 *
 * Regenerate:
 *   - fixed-dashboard.json: offline /fixed path (see agent/src/offline_sample.py)
 *   - dynamic-surface.json:  authored via copilotkit a2ui helpers
 */
import fixedDashboard from "./fixed-dashboard.json";
import dynamicSurface from "./dynamic-surface.json";
import type { A2UIOp } from "@/a2ui/surface-bus";
import { surfaceBus } from "@/a2ui/surface-bus";

const SEEDS: Record<string, A2UIOp[]> = {
  fixed_agent: fixedDashboard as A2UIOp[],
  dynamic_agent: dynamicSurface as A2UIOp[],
};

/** Push the seed surface for `channel` onto the bus, but only if nothing has
 *  rendered there yet — so a live re-render (or a returning user mid-session)
 *  is never clobbered by the seed. */
export function seedSurface(channel: string): void {
  const ops = SEEDS[channel];
  if (!ops?.length) return;
  if (surfaceBus.snapshot(channel).ops.length > 0) return;
  surfaceBus.push(channel, ops);
}
