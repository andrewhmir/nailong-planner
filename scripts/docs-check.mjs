/**
 * docs:check — keeps docs/COMPONENTS/ in sync with the source tree.
 *
 * Rule: every source file under app/, components/, lib/ and scripts/ must have
 * exactly one `### <repo-relative path>` section in one of the
 * docs/COMPONENTS/*.md area docs, and every documented path must still exist.
 *
 * Exits non-zero (and CI fails) when a file is added, moved or deleted without
 * updating the docs. Run `npm run docs:check` after touching those directories;
 * the output names the exact doc file to edit.
 *
 * Deliberately plain ESM with no dependencies and no TypeScript runner: this
 * check must work in CI, in a bare Node environment, and under agent sandboxes
 * where a transpiler's child-process spawn can be denied.
 *
 * tests/ is intentionally not gated: it is documented as lookup tables in
 * docs/COMPONENTS/tests.md rather than one section per file.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "docs", "COMPONENTS");
const DEBUGGING_DOC = "docs/DEBUGGING.md";

/** Directories whose code files must each have a documentation section. */
const GATED_DIRS = ["app", "components", "lib", "scripts"];
/** Documentable file extensions. */
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".css"]);
/** Never walked. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-e2e",
  ".git",
  "test-results",
  ".playwright",
  "data",
  "coverage",
  ".worktrees",
]);
/** Files that exist but are not worth a section (binary assets). */
const SKIP_PREFIXES = ["app/fonts/"];
/** Not scanned: explains the convention and contains the template. */
const SKIPPED_DOCS = new Set(["readme.md"]);

/** Where a missing file's section belongs, longest prefix first. */
const AREA_DOCS = [
  ["app/", "docs/COMPONENTS/app-routes.md"],
  ["components/calendar/", "docs/COMPONENTS/components-calendar.md"],
  ["components/shell/", "docs/COMPONENTS/components-shell-and-sidebar.md"],
  ["components/sidebar/", "docs/COMPONENTS/components-shell-and-sidebar.md"],
  ["components/settings/", "docs/COMPONENTS/components-settings-ui.md"],
  ["components/ui/", "docs/COMPONENTS/components-settings-ui.md"],
  ["lib/api/", "docs/COMPONENTS/api-layer.md"],
  ["lib/services/", "docs/COMPONENTS/lib-services.md"],
  ["lib/ui/", "docs/COMPONENTS/lib-ui.md"],
  ["lib/db/", "docs/COMPONENTS/lib-data.md"],
  ["lib/query/", "docs/COMPONENTS/lib-data.md"],
  ["lib/auth/", "docs/COMPONENTS/lib-data.md"],
  ["lib/validation/", "docs/COMPONENTS/lib-data.md"],
  ["scripts/", "docs/COMPONENTS/scripts-and-ops.md"],
  ["lib/", "docs/COMPONENTS/lib-domain.md"],
];

const toPosix = (path) => path.split(sep).join("/");

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = toPosix(relative(ROOT, full));
    if (SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    const dot = rel.lastIndexOf(".");
    const ext = dot === -1 ? "" : rel.slice(dot);
    if (EXTENSIONS.has(ext)) out.push(rel);
  }
}

/** Existing files that must be documented. */
function gatedFiles() {
  const files = [];
  for (const dir of GATED_DIRS) walk(join(ROOT, dir), files);
  return files.sort();
}

/** A heading counts as a documented path when it is one path-like token with a slash. */
function asDocumentedPath(heading) {
  if (!heading.includes("/")) return null;
  if (!/^[A-Za-z0-9_.@\-[\]()/]+$/.test(heading)) return null;
  return heading;
}

/** Parse `### <path>` headings out of the area docs, ignoring fenced code. */
function documentedSections() {
  const docs = readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith(".md") && !SKIPPED_DOCS.has(name.toLowerCase()))
    .sort();
  const sections = [];
  for (const name of docs) {
    const doc = `docs/COMPONENTS/${name}`;
    const lines = readFileSync(join(DOCS_DIR, name), "utf8").split(/\r?\n/);
    let inFence = false;
    lines.forEach((line, index) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const match = /^###\s+(\S+)\s*$/.exec(line);
      if (!match) return;
      const documented = asDocumentedPath(match[1]);
      if (documented === null) return;
      sections.push({ path: documented, doc, line: index + 1 });
    });
  }
  return { sections, docs };
}

function suggestDoc(path) {
  for (const [prefix, doc] of AREA_DOCS) {
    if (path.startsWith(prefix)) return doc;
  }
  return "docs/COMPONENTS/README.md";
}

const problems = [];
if (!existsSync(DOCS_DIR)) problems.push(`missing directory ${toPosix(relative(ROOT, DOCS_DIR))}`);
if (!existsSync(join(ROOT, DEBUGGING_DOC))) {
  problems.push(`missing ${DEBUGGING_DOC} — the debugging playbook agents are routed through`);
}

const { sections, docs } = documentedSections();
const files = gatedFiles();
const documented = new Map();
const duplicates = [];
for (const section of sections) {
  const previous = documented.get(section.path);
  if (previous) {
    duplicates.push(
      `${section.path} — ${previous.doc}:${previous.line} and ${section.doc}:${section.line}`,
    );
    continue;
  }
  documented.set(section.path, section);
}

const missing = files.filter((file) => !documented.has(file));
const stale = [...documented.values()].filter((section) => {
  const absolute = join(ROOT, section.path);
  return !existsSync(absolute) || !statSync(absolute).isFile();
});

const report = [];
report.push("docs:check — component documentation drift gate");
report.push(
  `  ${docs.length} area docs · ${documented.size} documented files · ${files.length} source files gated`,
);

if (missing.length > 0) {
  report.push("");
  report.push(`MISSING SECTION — source file has no \`### <path>\` section (${missing.length})`);
  for (const file of missing) {
    report.push(`  ${file}`);
    report.push(`    add  ### ${file}  →  ${suggestDoc(file)}`);
  }
}
if (stale.length > 0) {
  report.push("");
  report.push(`STALE SECTION — documented path no longer exists (${stale.length})`);
  for (const section of stale) report.push(`  ${section.path}  (${section.doc}:${section.line})`);
}
if (duplicates.length > 0) {
  report.push("");
  report.push(`DUPLICATE SECTION — each file may be documented once (${duplicates.length})`);
  for (const duplicate of duplicates) report.push(`  ${duplicate}`);
}
if (problems.length > 0) {
  report.push("");
  report.push("LAYOUT");
  for (const problem of problems) report.push(`  ${problem}`);
}

const failures = missing.length + stale.length + duplicates.length + problems.length;

if (failures === 0) {
  report.push("  ✓ every gated file is documented, no stale or duplicate sections");
  console.log(report.join("\n"));
  process.exit(0);
}

report.push("");
report.push(
  `docs:check FAILED — ${failures} problem(s). Update the docs (see docs/COMPONENTS/README.md), then re-run.`,
);
console.error(report.join("\n"));
process.exit(1);
