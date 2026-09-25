/**
 * Minimal template engine: `{{ path.to.value }}` and nothing else.
 * - no logic, no helpers, no code execution, no triple-brace raw output;
 * - paths are walked with Object.hasOwn only, so `__proto__`, `constructor`, `prototype` and inherited members never resolve;
 * - non-string values go through String(); missing values render as an empty string.
 */

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const PATH = /^[A-Za-z][A-Za-z0-9_]{0,39}(?:\.[A-Za-z][A-Za-z0-9_]{0,39}){0,4}$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lookup(data: Record<string, unknown>, path: string): string {
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return "";
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) return "";
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined || current === null) return "";
  if (typeof current === "object") return ""; // never dump objects/arrays into a mail
  return String(current);
}

export interface RenderOptions {
  /** HTML bodies are always escaped. Plain-text parts and subjects are not HTML, so they are not entity-encoded. */
  html: boolean;
}

export function renderTemplate(source: string, data: Record<string, unknown>, options: RenderOptions): string {
  return source.replace(PLACEHOLDER, (_m, raw: string) => {
    const path = raw.trim();
    if (!PATH.test(path)) return "";
    const value = lookup(data, path);
    return options.html ? escapeHtml(value) : value;
  });
}

/** Subjects are header values: never allow line breaks (header injection). */
export function renderSubject(source: string, data: Record<string, unknown>): string {
  return renderTemplate(source, data, { html: false }).replace(/[\r\n]+/g, " ").trim().slice(0, 255);
}

export interface PlaceholderScan {
  paths: string[];
  /** malformed placeholders, triple braces, stray braces */
  invalid: string[];
}

/** Every placeholder used by a source, plus anything that looks like a placeholder but is not valid. */
export function scanPlaceholders(source: string): PlaceholderScan {
  const paths = new Set<string>();
  const invalid: string[] = [];
  if (source.includes("{{{") || source.includes("}}}")) invalid.push("{{{ }}}");
  for (const match of source.matchAll(PLACEHOLDER)) {
    const path = (match[1] ?? "").trim();
    if (PATH.test(path) && !path.split(".").some((s) => FORBIDDEN_SEGMENTS.has(s))) paths.add(path);
    else invalid.push(path.slice(0, 60) || "(empty)");
  }
  // an opening or closing brace pair that never matched a well-formed placeholder
  const stripped = source.replace(PLACEHOLDER, "");
  if (stripped.includes("{{") || stripped.includes("}}")) invalid.push("{{ }} sin cerrar");
  return { paths: [...paths], invalid };
}
