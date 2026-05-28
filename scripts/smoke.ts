#!/usr/bin/env node
/**
 * pnpm smoke — Composite gate, the load-bearing CI check.
 *
 * Runs (in order, failing fast):
 *   1. `pnpm verify-pins`               — lockfile / package.json drift
 *   2. `pnpm validate-widget` over every *.json in agent/src/widgets/ (if exists)
 *   3. `pnpm test:widgets`              — fixture renderer pass (no-op pre-E)
 *   4. OFFLINE=1 envelope shape check   — assert public/offline-envelopes.json renders
 *   5. (TODO) Boot + canned prompt      — see note inline; reaches into the LangGraph
 *                                          dev server which is a bigger lift than the
 *                                          script-suite scope. Today we run a one-shot
 *                                          tool-call probe against the Gemini endpoint
 *                                          as a stand-in for "the agent can talk to the
 *                                          model and get a tool call back".
 *
 * Exit non-zero if any step fails. Machine-parsable summary at the end.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

type Step = {
  name: string;
  run: () => Promise<{ pass: boolean; detail: string }>;
};

const results: { name: string; pass: boolean; detail: string }[] = [];

function pnpmRun(scriptName: string, ...args: string[]): { pass: boolean; detail: string } {
  // Use the local pnpm exec form so we don't hit recursive `pnpm` lookup issues.
  const res = spawnSync("pnpm", ["run", scriptName, ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  return {
    pass: res.status === 0,
    detail: res.status === 0 ? "passed" : `failed (exit ${res.status})`,
  };
}

function shellRun(cmd: string, args: string[]): { pass: boolean; detail: string } {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  return {
    pass: res.status === 0,
    detail: res.status === 0 ? "passed" : `failed (exit ${res.status})`,
  };
}

function findWidgetJsons(): string[] {
  const widgetsDir = join(REPO_ROOT, "agent", "src", "widgets");
  if (!existsSync(widgetsDir)) return [];
  const out: string[] = [];
  const stack = [widgetsDir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
    }
  }
  return out;
}

const STEPS: Step[] = [
  {
    name: "verify-pins",
    run: async () =>
      shellRun(join(REPO_ROOT, "scripts", "verify-pins.sh"), []),
  },
  {
    name: "validate-widget over agent/src/widgets/",
    run: async () => {
      const widgets = findWidgetJsons();
      if (widgets.length === 0) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}No widget JSONs to validate yet (E in flight).${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no widgets)" };
      }
      const validateScript = join(REPO_ROOT, "scripts", "validate-widget.ts");
      const res = spawnSync(
        "pnpm",
        ["exec", "tsx", validateScript, ...widgets],
        { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } },
      );
      return {
        pass: res.status === 0,
        detail: res.status === 0 ? `${widgets.length} files validated` : `failed (exit ${res.status})`,
      };
    },
  },
  {
    name: "test:widgets",
    run: async () => pnpmRun("test:widgets"),
  },
  {
    name: "OFFLINE=1 envelope shape check",
    run: async () => {
      const offlinePath = join(REPO_ROOT, "public", "offline-envelopes.json");
      if (!existsSync(offlinePath)) {
        console.log(
          `${YELLOW}!${RESET} ${DIM}public/offline-envelopes.json not found yet (E in flight). Skipping.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no offline envelopes)" };
      }
      try {
        const raw = readFileSync(offlinePath, "utf-8");
        const parsed = JSON.parse(raw);
        // Accept either an array of envelopes/operations or an object keyed by prompt.
        // Just assert it parses and contains *something* that looks like A2UI:
        // either "createSurface" or "surfaceId" must appear in the JSON.
        if (!raw.includes("createSurface") && !raw.includes("surfaceId")) {
          console.error(
            `${RED}✗${RESET} public/offline-envelopes.json doesn't reference any A2UI envelope (no createSurface or surfaceId found).`,
          );
          return { pass: false, detail: "envelope check failed: no A2UI markers" };
        }
        console.log(
          `${GREEN}✓${RESET} ${DIM}offline-envelopes.json parses and contains A2UI envelope markers.${RESET}\n`,
        );
        return { pass: true, detail: `parsed and validated` };
      } catch (e) {
        console.error(`${RED}✗${RESET} offline-envelopes.json is invalid JSON: ${(e as Error).message}`);
        return { pass: false, detail: "invalid JSON" };
      }
    },
  },
  {
    name: "agent connectivity probe (one-shot tool call against Gemini)",
    run: async () => {
      // TODO(blitz-D): Replace this with a real "boot agent → POST canned
      // prompt → assert createSurface envelope" pipeline. The standalone
      // probe-gemini.sh script already exercises a tool call against the
      // configured model; we reuse it here as a stand-in. Once the LangGraph
      // dev server has a deterministic boot ritual we can call from CI, swap
      // this for the real composite check.
      const probeScript = join(REPO_ROOT, "scripts", "probe-gemini.sh");
      if (!existsSync(probeScript)) {
        console.log(`${YELLOW}!${RESET} ${DIM}probe-gemini.sh not found. Skipping.${RESET}\n`);
        return { pass: true, detail: "skipped (no probe script)" };
      }
      // Skip when no key — let CI decide whether that's OK via OFFLINE=1.
      if (!process.env.GEMINI_API_KEY && process.env.OFFLINE !== "1") {
        console.log(
          `${YELLOW}!${RESET} ${DIM}GEMINI_API_KEY not set and OFFLINE!=1. Skipping live probe.${RESET}\n`,
        );
        return { pass: true, detail: "skipped (no key)" };
      }
      if (process.env.OFFLINE === "1") {
        console.log(`${DIM}OFFLINE=1 — skipping live model probe.${RESET}\n`);
        return { pass: true, detail: "skipped (OFFLINE=1)" };
      }
      return shellRun("bash", [probeScript]);
    },
  },
];

async function main(): Promise<void> {
  console.log(`${BOLD}pnpm smoke${RESET} — composite gate\n`);

  let failed = 0;

  for (const step of STEPS) {
    console.log(`${BOLD}━━━ ${step.name} ━━━${RESET}`);
    const t0 = Date.now();
    const res = await step.run();
    const ms = Date.now() - t0;
    results.push({ name: step.name, ...res });
    if (!res.pass) {
      failed++;
      // Fail fast — first failure is usually informative enough.
      console.error(
        `\n${RED}${BOLD}Step "${step.name}" failed (${ms}ms).${RESET} Stopping early.\n`,
      );
      break;
    }
    console.log(`${DIM}  → step done in ${ms}ms${RESET}\n`);
  }

  // Summary
  console.log(`${BOLD}━━━ smoke summary ━━━${RESET}`);
  for (const r of results) {
    const icon = r.pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} ${r.name} ${DIM}— ${r.detail}${RESET}`);
  }
  // List steps that didn't run
  const ran = new Set(results.map((r) => r.name));
  for (const s of STEPS) {
    if (!ran.has(s.name)) console.log(`  ${YELLOW}-${RESET} ${s.name} ${DIM}(not run)${RESET}`);
  }
  console.log();

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}SMOKE PASS.${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}SMOKE FAIL.${RESET}`);
    process.exit(1);
  }
}

void main();
