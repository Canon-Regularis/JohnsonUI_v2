#!/usr/bin/env node
/**
 * pnpm validate-widget <path> — A2UI v0.9 envelope/schema shape validator.
 *
 * Accepts two shapes:
 *
 *   (a) Catalog schema (array of components — like flight_schema.json):
 *       [
 *         { "id": "root", "component": "Row", "children": {...}, ... },
 *         { "id": "...",  "component": "FlightCard", ... }
 *       ]
 *
 *   (b) Envelope fixture (object with surfaceId/catalogId/components/data):
 *       {
 *         "surfaceId": "flight-search-results",
 *         "catalogId": "copilotkit://app-dashboard-catalog",
 *         "components": [ ... ],
 *         "data": { ... }
 *       }
 *
 * Error format follows the "validators that teach" pattern from PLAN.md.
 */
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const CANONICAL_EXAMPLE = "agent/src/a2ui_fixed_schema.py:search_flights";
const SCHEMA_REF = "https://a2ui.org/specification/v0.9-a2ui/";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

type ValidationError = {
  message: string;
  fix: string;
};

function teach(filePath: string, errors: ValidationError[]): void {
  for (const err of errors) {
    console.error(`${RED}✗${RESET} Widget JSON failed validation at ${BOLD}${filePath}${RESET}`);
    console.error(`  ${err.message}`);
    console.error(`  ${DIM}Canonical example:${RESET} ${CANONICAL_EXAMPLE}`);
    console.error(`  ${DIM}Fix:${RESET} ${err.fix}`);
    console.error(`  ${DIM}Schema reference:${RESET} ${SCHEMA_REF}`);
    console.error();
  }
}

function passMsg(filePath: string, shape: string): void {
  console.log(`${GREEN}✓${RESET} ${filePath} ${DIM}(${shape})${RESET}`);
}

/**
 * Validate a single component object inside a catalog schema array.
 * v0.9 requires:
 *   - `id` string (root component must be "root")
 *   - `component` string (the catalog component name)
 *   - everything else is component-specific
 */
function validateComponent(
  comp: unknown,
  index: number,
  errors: ValidationError[],
): void {
  if (typeof comp !== "object" || comp === null || Array.isArray(comp)) {
    errors.push({
      message: `Component at index ${index} is not an object.`,
      fix: `Wrap the component in an object: { "id": "...", "component": "...", ... }`,
    });
    return;
  }
  const c = comp as Record<string, unknown>;

  if (typeof c.id !== "string" || c.id.length === 0) {
    errors.push({
      message: `Component at index ${index} is missing required field 'id' (must be a non-empty string).`,
      fix: `Add an "id" field. The root component must have id "root".`,
    });
  }
  if (typeof c.component !== "string" || c.component.length === 0) {
    errors.push({
      message: `Component at index ${index} (id="${c.id ?? "?"}") is missing required field 'component'.`,
      fix: `Add a "component" field naming the catalog component (e.g. "Row", "Card", "FlightCard").`,
    });
  }
}

/**
 * Validate a catalog-schema-shaped array of components.
 */
function validateCatalogSchema(
  data: unknown,
  errors: ValidationError[],
): void {
  if (!Array.isArray(data)) {
    errors.push({
      message: "Top-level value is neither a v0.9 components array nor an envelope fixture object.",
      fix: "Make it either an array of components (catalog schema) or a fixture object with surfaceId/catalogId/components.",
    });
    return;
  }
  if (data.length === 0) {
    errors.push({
      message: "Empty components array — v0.9 requires at least a root component.",
      fix: "Add a root component: { \"id\": \"root\", \"component\": \"Row\", ... }",
    });
    return;
  }
  // Each component
  data.forEach((c, i) => validateComponent(c, i, errors));

  // Must have a root
  const hasRoot = data.some(
    (c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).id === "root",
  );
  if (!hasRoot) {
    errors.push({
      message: "Missing required component with id 'root'. v0.9 schemas must have a root component.",
      fix: "Add a component with id \"root\" — typically a layout component like Row, Column, or Stack.",
    });
  }
}

/**
 * Validate an envelope-fixture-shaped object.
 *  - surfaceId: non-empty string
 *  - catalogId: non-empty string, conventionally URL-like (copilotkit://...)
 *  - components: array (validated via catalog-schema validator)
 *  - data: optional object (the data model the components bind to)
 */
function validateEnvelopeFixture(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (typeof obj.surfaceId !== "string" || obj.surfaceId.length === 0) {
    errors.push({
      message: "Missing or invalid 'surfaceId' (createSurface envelope requires a non-empty surfaceId).",
      fix: "Add a unique surfaceId string, e.g. \"flight-search-results\".",
    });
  }
  if (typeof obj.catalogId !== "string" || obj.catalogId.length === 0) {
    errors.push({
      message: "Missing or invalid 'catalogId'.",
      fix: "Add a catalogId string, e.g. \"copilotkit://app-dashboard-catalog\".",
    });
  } else if (!/^[a-z]+:\/\//.test(obj.catalogId)) {
    // Soft warning — we accept any non-empty string but flag non-URI-like as suspicious.
    errors.push({
      message: `'catalogId' ("${obj.catalogId}") doesn't look like a URI (expected scheme://...).`,
      fix: "Use a URI-shaped catalogId. The starter uses \"copilotkit://app-dashboard-catalog\".",
    });
  }

  if (!("components" in obj)) {
    errors.push({
      message: "Missing 'components' array (the v0.9 component schema).",
      fix: "Add a components array. See the canonical example.",
    });
  } else {
    validateCatalogSchema(obj.components, errors);
  }

  if ("data" in obj && (typeof obj.data !== "object" || obj.data === null || Array.isArray(obj.data))) {
    errors.push({
      message: "'data' must be an object (the data model components bind to via 'path').",
      fix: "Make 'data' an object whose keys match the paths your components reference, e.g. { \"flights\": [...] }.",
    });
  }
}

function validateFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    console.error(`${RED}✗${RESET} File not found: ${filePath}`);
    return false;
  }
  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = (e as Error).message;
    teach(filePath, [
      {
        message: `Invalid JSON: ${msg}`,
        fix: "Fix the JSON syntax. Use a linter or `python3 -m json.tool < file` to find the bad character.",
      },
    ]);
    return false;
  }

  const errors: ValidationError[] = [];
  let shape: string;

  if (Array.isArray(parsed)) {
    shape = "catalog schema";
    validateCatalogSchema(parsed, errors);
  } else if (typeof parsed === "object" && parsed !== null) {
    shape = "envelope fixture";
    validateEnvelopeFixture(parsed as Record<string, unknown>, errors);
  } else {
    teach(filePath, [
      {
        message: "Top-level JSON value must be an array (catalog schema) or object (envelope fixture).",
        fix: "Restructure as one of the two supported shapes — see CANONICAL example.",
      },
    ]);
    return false;
  }

  if (errors.length > 0) {
    teach(filePath, errors);
    return false;
  }
  passMsg(filePath, shape);
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm validate-widget <path> [<path> ...]");
    console.error("       pnpm validate-widget <directory>");
    process.exit(2);
  }

  // Expand directories to all *.json under them.
  const filesToCheck: string[] = [];
  for (const arg of args) {
    const abs = resolve(arg);
    if (!existsSync(abs)) {
      console.error(`${YELLOW}!${RESET} Skipping missing path: ${arg}`);
      continue;
    }
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      // Recursively gather *.json
      const stack = [abs];
      while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile() && entry.name.endsWith(".json")) filesToCheck.push(full);
        }
      }
    } else if (abs.endsWith(".json")) {
      filesToCheck.push(abs);
    } else {
      console.error(`${YELLOW}!${RESET} Skipping non-JSON file: ${basename(arg)}`);
    }
  }

  if (filesToCheck.length === 0) {
    console.error(`${YELLOW}!${RESET} No JSON files to validate.`);
    process.exit(0);
  }

  let failed = 0;
  for (const f of filesToCheck) {
    if (!validateFile(f)) failed++;
  }

  console.log();
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}All ${filesToCheck.length} widget file${filesToCheck.length === 1 ? "" : "s"} validated.${RESET}`);
    process.exit(0);
  } else {
    console.error(
      `${RED}${BOLD}${failed} of ${filesToCheck.length} file${filesToCheck.length === 1 ? "" : "s"} failed validation.${RESET}`,
    );
    process.exit(1);
  }
}

main();
