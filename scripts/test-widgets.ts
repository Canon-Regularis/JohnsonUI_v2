#!/usr/bin/env node
/**
 * pnpm test:widgets — Run the validator (a proxy for the renderer at this
 * stage of the starter) against every *.fixture.json in agent/src/widgets/.
 *
 * If no fixtures exist (Workstream E hasn't landed yet), exit 0 with a
 * friendly message. CI calls this from `pnpm smoke`, so it must be
 * non-destructive in the no-fixtures-yet state.
 *
 * Note: a "real" renderer test would mount each fixture in the @copilotkit/
 * a2ui-renderer and assert no React errors. That requires a JSDOM/Playwright
 * harness that's bigger than the script-suite scope. We ship the validator
 * pass here and leave the harness as a follow-up.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..");
const WIDGETS_DIR = join(REPO_ROOT, "agent", "src", "widgets");
const VALIDATE_SCRIPT = join(__dirname, "validate-widget.ts");

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function findFixtures(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".fixture.json")) out.push(full);
    }
  }
  return out;
}

function main(): void {
  console.log(`${BOLD}pnpm test:widgets${RESET} — fixture validation pass\n`);

  if (!existsSync(WIDGETS_DIR)) {
    console.log(
      `${YELLOW}!${RESET} ${DIM}${WIDGETS_DIR} doesn't exist yet${RESET} — Workstream E hasn't landed.`,
    );
    console.log(`${DIM}Exiting 0; this is the expected pre-E state.${RESET}`);
    process.exit(0);
  }

  const fixtures = findFixtures(WIDGETS_DIR);
  if (fixtures.length === 0) {
    console.log(`${YELLOW}!${RESET} ${DIM}No *.fixture.json files in ${WIDGETS_DIR}${RESET}`);
    console.log(`${DIM}Run \`pnpm new-widget <name>\` to scaffold one, then re-run.${RESET}`);
    process.exit(0);
  }

  console.log(`${DIM}Found ${fixtures.length} fixture(s):${RESET}`);
  for (const f of fixtures) console.log(`  ${DIM}${f}${RESET}`);
  console.log();

  // Delegate to validate-widget — it's the closest thing to a renderer pass
  // we have until the full Playwright harness lands. We exec tsx via pnpm so
  // we pick up the locally-installed tsx (or the dlx cache if not yet linked).
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", VALIDATE_SCRIPT, ...fixtures],
    { stdio: "inherit", cwd: REPO_ROOT },
  );

  if (result.status === 0) {
    console.log(`\n${GREEN}${BOLD}All fixtures validated.${RESET}`);
    process.exit(0);
  } else {
    console.error(`\n${RED}${BOLD}One or more fixtures failed.${RESET}`);
    process.exit(result.status ?? 1);
  }
}

main();
