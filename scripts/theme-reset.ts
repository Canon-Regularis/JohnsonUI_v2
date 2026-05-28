#!/usr/bin/env node
/**
 * pnpm theme:reset — Revert src/lib/a2ui-theme.css to base defaults.
 *
 * On first run, snapshots the current a2ui-theme.css into
 * src/lib/.a2ui-theme.original.css (a hidden backup committed to the repo so
 * the snapshot survives across clones). Subsequent runs restore from the
 * backup.
 *
 * If something is too broken to fix manually mid-build, `pnpm theme:reset` is
 * the panic button.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..");
const THEME_PATH = join(REPO_ROOT, "src", "lib", "a2ui-theme.css");
const BACKUP_PATH = join(REPO_ROOT, "src", "lib", ".a2ui-theme.original.css");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function main(): void {
  if (!existsSync(THEME_PATH)) {
    console.error(`${RED}✗${RESET} ${THEME_PATH} not found.`);
    console.error(`  ${DIM}Expected to find the A2UI theme CSS at this path.${RESET}`);
    process.exit(1);
  }

  if (!existsSync(BACKUP_PATH)) {
    // First run — take a snapshot.
    copyFileSync(THEME_PATH, BACKUP_PATH);
    console.log(`${YELLOW}!${RESET} First run: snapshotted current theme to`);
    console.log(`  ${DIM}${BACKUP_PATH}${RESET}`);
    console.log(`  ${DIM}Subsequent \`pnpm theme:reset\` invocations will restore from this snapshot.${RESET}`);
    console.log(
      `${GREEN}${BOLD}Theme is now the baseline.${RESET} ${DIM}(no change applied; backup created)${RESET}`,
    );
    process.exit(0);
  }

  // Backup exists — check if theme already matches.
  const current = readFileSync(THEME_PATH, "utf-8");
  const backup = readFileSync(BACKUP_PATH, "utf-8");

  if (current === backup) {
    console.log(`${GREEN}✓${RESET} Theme already matches the backup — nothing to revert.`);
    process.exit(0);
  }

  // Restore.
  writeFileSync(THEME_PATH, backup);
  console.log(`${GREEN}${BOLD}Theme reset.${RESET}`);
  console.log(`  ${DIM}Restored:${RESET} ${THEME_PATH}`);
  console.log(`  ${DIM}From:${RESET}     ${BACKUP_PATH}`);
  console.log();
  console.log(
    `${DIM}If the panic button didn't help, check src/components/BrandFrame.tsx${RESET}`,
  );
  console.log(`${DIM}(Seam #2 — re-brand the shell) and any custom Tailwind config.${RESET}`);
  process.exit(0);
}

main();
