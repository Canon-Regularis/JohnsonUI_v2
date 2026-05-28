#!/usr/bin/env node
/**
 * pnpm validate-widget <path> — A2UI v0.9 envelope/schema shape validator.
 *
 * Recognized shapes (chosen empirically to match every JSON shipped under
 * agent/src/widgets/ and other-examples/<id>/EXAMPLE.json):
 *
 *   (a) Bare catalog schema (array of components — like legal/contract_review.json
 *       or agent/src/a2ui/schemas/flight_schema.json):
 *
 *         [
 *           { "id": "root", "component": "Row", "children": {...} },
 *           { "id": "card", "component": "FlightCard", ... }
 *         ]
 *
 *   (b) Wrapper widget JSON — what `pnpm new-widget` scaffolds and what the
 *       canonical flight_card.json / product_card.json files use. The schema
 *       array is nested under "schema":
 *
 *         {
 *           "id": "flight-card",
 *           "name": "FlightCard",
 *           "description": "...",
 *           "catalogId": "copilotkit://...",
 *           "pythonTool": "agent/src/.../tool.py:fn",
 *           "schema": [ ...catalog-schema components... ]
 *         }
 *
 *   (c) Envelope-array fixture — the canonical *.fixture.json shipped for
 *       flight_card / product_card. A list of A2UI envelopes (createSurface,
 *       updateComponents, updateDataModel):
 *
 *         {
 *           "name": "...",
 *           "surfaceId": "...",
 *           "envelopes": [ { version, createSurface }, { version, updateComponents }, ... ]
 *         }
 *
 *   (d) Single-envelope fixture — the legacy fixture shape used by the legal
 *       example. createSurface fields are top-level, components are flat:
 *
 *         {
 *           "surfaceId": "...",
 *           "catalogId": "copilotkit://...",
 *           "components": [...],
 *           "data": {...}
 *         }
 *
 * The validator picks one shape per file by inspecting the top-level keys
 * (see pickShape() below). Error messages then teach against the chosen
 * shape, not the others — the failure mode "I added 'envelopes' and now it
 * yells about a missing 'components'" is the exact thing FRICTION #3 logged.
 *
 * EXAMPLE mode (`pnpm validate-widget --examples`):
 *   Validates every other-examples/<id>/EXAMPLE.json against the §3.2 catalog
 *   entry schema (id, name, route starting with `/other-examples/`, etc.).
 *
 * Error format follows the "validators that teach" pattern from PLAN.md.
 */
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const CANONICAL_WIDGET_JSON = "agent/src/widgets/flight_card.json";
const CANONICAL_FIXTURE_JSON = "agent/src/widgets/flight_card.fixture.json";
const CANONICAL_EXAMPLE_JSON = "other-examples/legal-contract-review/EXAMPLE.json";
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

function teach(filePath: string, errors: ValidationError[], canonical: string): void {
  for (const err of errors) {
    console.error(`${RED}✗${RESET} Widget JSON failed validation at ${BOLD}${filePath}${RESET}`);
    console.error(`  ${err.message}`);
    console.error(`  ${DIM}Canonical example:${RESET} ${canonical}`);
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
      message: "Expected an array of components.",
      fix: `Make it an array of catalog components, each shaped like { "id": "root", "component": "Row", ... }.`,
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
  data.forEach((c, i) => validateComponent(c, i, errors));

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
 * Soft-check that a catalogId looks like a URI (`scheme://...`). The starter
 * ships two valid catalogIds: `copilotkit://app-dashboard-catalog` and
 * `https://a2ui.org/specification/v0_9/basic_catalog.json`.
 */
function validateCatalogId(value: unknown, errors: ValidationError[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({
      message: "Missing or invalid 'catalogId'.",
      fix: `Add a catalogId string, e.g. "copilotkit://app-dashboard-catalog".`,
    });
    return;
  }
  if (!/^[a-z]+:\/\//.test(value)) {
    errors.push({
      message: `'catalogId' ("${value}") doesn't look like a URI (expected scheme://...).`,
      fix: `Use a URI-shaped catalogId. The starter uses "copilotkit://app-dashboard-catalog".`,
    });
  }
}

/**
 * Shape (b): Wrapper widget JSON (`flight_card.json`, `product_card.json`,
 * what `pnpm new-widget` scaffolds).
 *
 * Required: id (string), name (string), catalogId (URI-ish), schema (array).
 * Optional: description, pythonTool.
 */
function validateWrapperWidget(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({
      message: "Wrapper widget JSON missing 'id' (must be a non-empty kebab-case string).",
      fix: `Add an "id" field — convention is kebab-case, e.g. "flight-card".`,
    });
  }
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    errors.push({
      message: "Wrapper widget JSON missing 'name' (the catalog component name).",
      fix: `Add a "name" field — convention is PascalCase, e.g. "FlightCard".`,
    });
  }
  validateCatalogId(obj.catalogId, errors);
  if (!Array.isArray(obj.schema)) {
    errors.push({
      message: "Wrapper widget JSON missing 'schema' array (the v0.9 component tree).",
      fix: `Add a "schema" field whose value is the catalog-schema array. See ${CANONICAL_WIDGET_JSON}.`,
    });
  } else {
    validateCatalogSchema(obj.schema, errors);
  }
}

/**
 * Validate a single A2UI envelope (one item of the `envelopes` array in
 * shape (c)). v0.9 envelopes carry exactly one operation per envelope:
 * createSurface, updateComponents, or updateDataModel.
 */
function validateEnvelope(
  env: unknown,
  index: number,
  errors: ValidationError[],
): void {
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    errors.push({
      message: `Envelope at index ${index} is not an object.`,
      fix: `Wrap the envelope in an object: { "version": "v0.9", "createSurface": { ... } }`,
    });
    return;
  }
  const e = env as Record<string, unknown>;

  if (typeof e.version !== "string" || e.version.length === 0) {
    errors.push({
      message: `Envelope at index ${index} missing 'version'.`,
      fix: `Add "version": "v0.9".`,
    });
  }

  const opKeys = ["createSurface", "updateComponents", "updateDataModel"];
  const presentOps = opKeys.filter((k) => k in e);
  if (presentOps.length === 0) {
    errors.push({
      message: `Envelope at index ${index} carries no recognized operation (expected one of createSurface / updateComponents / updateDataModel).`,
      fix: `Add exactly one operation key. See ${CANONICAL_FIXTURE_JSON} for canonical examples.`,
    });
    return;
  }
  if (presentOps.length > 1) {
    errors.push({
      message: `Envelope at index ${index} carries ${presentOps.length} operations (${presentOps.join(", ")}). v0.9 envelopes carry exactly one operation.`,
      fix: `Split into ${presentOps.length} envelopes, each with one op.`,
    });
  }

  // Per-op shape checks
  if ("createSurface" in e) {
    const cs = e.createSurface as Record<string, unknown>;
    if (typeof cs?.surfaceId !== "string" || cs.surfaceId.length === 0) {
      errors.push({
        message: `Envelope at index ${index} (createSurface) missing 'surfaceId'.`,
        fix: `Add a unique surfaceId string, e.g. "flight-search-results".`,
      });
    }
    validateCatalogId(cs?.catalogId, errors);
  }
  if ("updateComponents" in e) {
    const uc = e.updateComponents as Record<string, unknown>;
    if (typeof uc?.surfaceId !== "string" || uc.surfaceId.length === 0) {
      errors.push({
        message: `Envelope at index ${index} (updateComponents) missing 'surfaceId'.`,
        fix: `Add a surfaceId matching the createSurface envelope above.`,
      });
    }
    if (!Array.isArray(uc?.components)) {
      // The agent sometimes ships a "root" object instead of "components" (see
      // src/hooks/use-envelope-stream.tsx demo envelopes). We accept either to
      // avoid false negatives on the demo path, but warn on neither.
      if (!("root" in (uc ?? {}))) {
        errors.push({
          message: `Envelope at index ${index} (updateComponents) has neither 'components' (array) nor 'root' (object).`,
          fix: `Add a "components" array of catalog components. See ${CANONICAL_FIXTURE_JSON}.`,
        });
      }
    } else {
      validateCatalogSchema(uc.components, errors);
    }
  }
  if ("updateDataModel" in e) {
    const ud = e.updateDataModel as Record<string, unknown>;
    if (typeof ud?.surfaceId !== "string" || ud.surfaceId.length === 0) {
      errors.push({
        message: `Envelope at index ${index} (updateDataModel) missing 'surfaceId'.`,
        fix: `Add a surfaceId matching the createSurface envelope above.`,
      });
    }
    // `path` and `value` are optional in some pre-v0.9 shapes; we don't enforce
    // them strictly here. v0.9 wants both, but we accept what the demo emits
    // (sometimes a flat `data` field).
  }
}

/**
 * Shape (c): Envelopes-array fixture (`flight_card.fixture.json`,
 * `product_card.fixture.json`).
 *
 * Required: surfaceId, envelopes (non-empty array). Optional: name, description.
 */
function validateEnvelopesFixture(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (typeof obj.surfaceId !== "string" || obj.surfaceId.length === 0) {
    errors.push({
      message: "Envelopes-array fixture missing 'surfaceId'.",
      fix: `Add a unique surfaceId string at the top level, e.g. "flight-search-results".`,
    });
  }
  if (!Array.isArray(obj.envelopes)) {
    errors.push({
      message: "Envelopes-array fixture missing 'envelopes' array.",
      fix: `Add an "envelopes" field — an array of A2UI envelopes. See ${CANONICAL_FIXTURE_JSON}.`,
    });
    return;
  }
  if (obj.envelopes.length === 0) {
    errors.push({
      message: "Empty 'envelopes' array.",
      fix: `Add at least one createSurface envelope. See ${CANONICAL_FIXTURE_JSON}.`,
    });
    return;
  }
  obj.envelopes.forEach((env, i) => validateEnvelope(env, i, errors));
}

/**
 * Shape (d): Single-envelope fixture (`legal/contract_review.fixture.json`).
 *
 * Required: surfaceId, catalogId, components.
 * Optional: data, name, description.
 */
function validateSingleEnvelopeFixture(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (typeof obj.surfaceId !== "string" || obj.surfaceId.length === 0) {
    errors.push({
      message: "Single-envelope fixture missing 'surfaceId'.",
      fix: `Add a unique surfaceId string, e.g. "contract-review".`,
    });
  }
  validateCatalogId(obj.catalogId, errors);
  if (!("components" in obj)) {
    errors.push({
      message: "Single-envelope fixture missing 'components' array.",
      fix: `Add a components array, or switch to the envelopes-array shape and put it under envelopes[].updateComponents.components.`,
    });
  } else {
    validateCatalogSchema(obj.components, errors);
  }

  if ("data" in obj && (typeof obj.data !== "object" || obj.data === null || Array.isArray(obj.data))) {
    errors.push({
      message: "'data' must be an object (the data model components bind to via 'path').",
      fix: `Make 'data' an object whose keys match the paths your components reference, e.g. { "flights": [...] }.`,
    });
  }
}

/**
 * Decide which of the four supported shapes a parsed JSON is. Inspects the
 * top-level keys — no validation here, just routing.
 */
function pickShape(
  parsed: unknown,
): {
  kind: "catalog-schema" | "wrapper-widget" | "envelopes-fixture" | "single-envelope-fixture" | "unknown";
  canonical: string;
} {
  if (Array.isArray(parsed)) {
    return { kind: "catalog-schema", canonical: CANONICAL_WIDGET_JSON };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "unknown", canonical: CANONICAL_WIDGET_JSON };
  }
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.envelopes)) {
    return { kind: "envelopes-fixture", canonical: CANONICAL_FIXTURE_JSON };
  }
  if (Array.isArray(obj.schema)) {
    return { kind: "wrapper-widget", canonical: CANONICAL_WIDGET_JSON };
  }
  if (Array.isArray(obj.components) || "surfaceId" in obj) {
    return { kind: "single-envelope-fixture", canonical: CANONICAL_FIXTURE_JSON };
  }
  return { kind: "unknown", canonical: CANONICAL_WIDGET_JSON };
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
    teach(
      filePath,
      [
        {
          message: `Invalid JSON: ${msg}`,
          fix: "Fix the JSON syntax. `python3 -m json.tool < file` will point at the bad character.",
        },
      ],
      CANONICAL_WIDGET_JSON,
    );
    return false;
  }

  const { kind, canonical } = pickShape(parsed);
  const errors: ValidationError[] = [];
  let shapeLabel: string;

  switch (kind) {
    case "catalog-schema":
      shapeLabel = "catalog schema (bare array)";
      validateCatalogSchema(parsed, errors);
      break;
    case "wrapper-widget":
      shapeLabel = "wrapper widget (schema-under-key)";
      validateWrapperWidget(parsed as Record<string, unknown>, errors);
      break;
    case "envelopes-fixture":
      shapeLabel = "envelopes-array fixture";
      validateEnvelopesFixture(parsed as Record<string, unknown>, errors);
      break;
    case "single-envelope-fixture":
      shapeLabel = "single-envelope fixture";
      validateSingleEnvelopeFixture(parsed as Record<string, unknown>, errors);
      break;
    default:
      teach(
        filePath,
        [
          {
            message:
              "Top-level value isn't one of the four supported shapes (bare array, wrapper widget, envelopes-array fixture, single-envelope fixture).",
            fix: `Pick a shape and restructure. See ${CANONICAL_WIDGET_JSON} (wrapper) or ${CANONICAL_FIXTURE_JSON} (fixture).`,
          },
        ],
        canonical,
      );
      return false;
  }

  if (errors.length > 0) {
    teach(filePath, errors, canonical);
    return false;
  }
  passMsg(filePath, shapeLabel);
  return true;
}

/**
 * EXAMPLE.json validator (--examples mode). Validates every
 * other-examples/<id>/EXAMPLE.json against plan §3.2:
 *   - id: required non-empty string (kebab-case convention)
 *   - name: required non-empty string (human-readable)
 *   - description: required non-empty string
 *   - route: required string starting with "/other-examples/"
 *   - catalogId: required URI-ish string starting with "copilotkit://"
 *   - tags: required string array (may be empty)
 *   - status: required string (free-form, conventional values: "wip", "ready")
 *   - graphId: optional string (set when the example ships a LangGraph)
 *   - agentName: optional string
 *   - screenshot: optional string (relative path)
 */
function validateExampleEntry(
  filePath: string,
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({
      message: "EXAMPLE.json missing 'id' (kebab-case string, must match directory name).",
      fix: `Add an "id" field matching the directory name, e.g. "legal-contract-review".`,
    });
  }
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    errors.push({
      message: "EXAMPLE.json missing 'name' (human-readable string).",
      fix: `Add a "name" field, e.g. "Contract Review Copilot".`,
    });
  }
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    errors.push({
      message: "EXAMPLE.json missing 'description'.",
      fix: `Add a one-sentence "description" field.`,
    });
  }
  if (typeof obj.route !== "string" || obj.route.length === 0) {
    errors.push({
      message: "EXAMPLE.json missing 'route'.",
      fix: `Add a "route" field starting with "/other-examples/", e.g. "/other-examples/${typeof obj.id === "string" ? obj.id : "<id>"}".`,
    });
  } else if (!obj.route.startsWith("/other-examples/")) {
    errors.push({
      message: `'route' ("${obj.route}") must start with "/other-examples/".`,
      fix: `Change the route prefix to "/other-examples/${typeof obj.id === "string" ? obj.id : "<id>"}".`,
    });
  }
  if (typeof obj.catalogId !== "string" || obj.catalogId.length === 0) {
    errors.push({
      message: "EXAMPLE.json missing 'catalogId'.",
      fix: `Add a "catalogId" field starting with "copilotkit://", e.g. "copilotkit://legal-paper-catalog".`,
    });
  } else if (!obj.catalogId.startsWith("copilotkit://")) {
    errors.push({
      message: `'catalogId' ("${obj.catalogId}") must start with "copilotkit://" for in-repo examples.`,
      fix: `Use a "copilotkit://" scheme so the renderer routes to the in-repo catalog.`,
    });
  }
  if (!Array.isArray(obj.tags)) {
    errors.push({
      message: "EXAMPLE.json missing 'tags' (array of strings).",
      fix: `Add a "tags" array, e.g. ["legal", "document-review"]. May be empty.`,
    });
  } else {
    for (const [i, t] of obj.tags.entries()) {
      if (typeof t !== "string") {
        errors.push({
          message: `'tags[${i}]' is not a string.`,
          fix: `Make every tag a string.`,
        });
        break;
      }
    }
  }
  if (typeof obj.status !== "string" || obj.status.length === 0) {
    errors.push({
      message: "EXAMPLE.json missing 'status'.",
      fix: `Add a "status" field — conventional values: "wip", "ready".`,
    });
  }
  // Optional fields — only type-check when present.
  if ("graphId" in obj && typeof obj.graphId !== "string") {
    errors.push({
      message: "'graphId' must be a string when present.",
      fix: `Either remove the field or set it to a string matching the langgraph.json key.`,
    });
  }
  if ("agentName" in obj && typeof obj.agentName !== "string") {
    errors.push({
      message: "'agentName' must be a string when present.",
      fix: `Either remove the field or set it to a string.`,
    });
  }
  if ("screenshot" in obj && typeof obj.screenshot !== "string") {
    errors.push({
      message: "'screenshot' must be a string when present.",
      fix: `Either remove the field or set it to a relative path string.`,
    });
  }
}

function validateExampleFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    console.error(`${RED}✗${RESET} EXAMPLE.json not found: ${filePath}`);
    return false;
  }
  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    teach(
      filePath,
      [
        {
          message: `Invalid JSON: ${(e as Error).message}`,
          fix: "Fix the JSON syntax.",
        },
      ],
      CANONICAL_EXAMPLE_JSON,
    );
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    teach(
      filePath,
      [
        {
          message: "Top-level value must be an object.",
          fix: `Restructure as a single object. See ${CANONICAL_EXAMPLE_JSON}.`,
        },
      ],
      CANONICAL_EXAMPLE_JSON,
    );
    return false;
  }
  const errors: ValidationError[] = [];
  validateExampleEntry(filePath, parsed as Record<string, unknown>, errors);
  if (errors.length > 0) {
    teach(filePath, errors, CANONICAL_EXAMPLE_JSON);
    return false;
  }
  passMsg(filePath, "EXAMPLE.json (catalog entry)");
  return true;
}

function findExampleFiles(repoRoot: string): string[] {
  const examplesDir = join(repoRoot, "other-examples");
  if (!existsSync(examplesDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(examplesDir, entry.name, "EXAMPLE.json");
    if (existsSync(candidate)) out.push(candidate);
  }
  return out;
}

function runExamplesMode(): never {
  // Locate repo root from this script's __dirname.
  const repoRoot = resolve(__dirname, "..");
  const examples = findExampleFiles(repoRoot);
  if (examples.length === 0) {
    console.log(`${YELLOW}!${RESET} ${DIM}No other-examples/*/EXAMPLE.json files found.${RESET}`);
    process.exit(0);
  }
  console.log(`${BOLD}validate-widget --examples${RESET} — found ${examples.length} EXAMPLE.json file${examples.length === 1 ? "" : "s"}\n`);
  let failed = 0;
  for (const f of examples) {
    if (!validateExampleFile(f)) failed++;
  }
  console.log();
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}All ${examples.length} EXAMPLE.json file${examples.length === 1 ? "" : "s"} validated.${RESET}`);
    process.exit(0);
  } else {
    console.error(`${RED}${BOLD}${failed} of ${examples.length} EXAMPLE.json file${examples.length === 1 ? "" : "s"} failed validation.${RESET}`);
    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm validate-widget <path> [<path> ...]");
    console.error("       pnpm validate-widget <directory>");
    console.error("       pnpm validate-widget --examples");
    process.exit(2);
  }

  // --examples mode (validates other-examples/*/EXAMPLE.json catalog entries).
  if (args.includes("--examples")) {
    runExamplesMode();
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
