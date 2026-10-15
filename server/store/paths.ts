// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. Which files a session changed. The protocol has `files.changed`
// for it (PROTOCOL.md §4), but the Claude Code adapter never sends one, so the store also
// reads the path out of a write tool's input on its `tool.ended` (tier 3 carries the
// input). Both readings land in the same per-session set, as repo-relative paths, so
// counts.filesChanged, the Review page and the digest all agree (docs/upstream-notes.md).
import type { ProtocolEvent } from "../../shared/api.js";

/** Tools that write a file and name it in their input: Claude Code, then Codex / Gemini
 *  CLI / Antigravity. Bash is left alone: a shell command's targets are not knowable. */
export const WRITE_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "write_file",
  "replace",
  "apply_patch",
  "edit_file",
]);

/** The input keys a path sits under, in the order the harnesses use them. */
const PATH_KEYS = ["file_path", "notebook_path", "path"] as const;
/** A cut JSON string still shows its first keys: `"file_path":"…"`. */
const PATH_RE = /"(?:file_path|notebook_path|path)"\s*:\s*"((?:[^"\\]|\\.)*)"/;
/** Codex's apply_patch names its files in the patch text. */
const PATCH_RE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The paths a write tool's input names, as given. The input may be the object the hook
 *  carried, or the index's slim copy: its JSON cut to a preview, which still begins with
 *  the path. Empty for anything that is not a write tool or carries no input. */
export function pathsInInput(tool: string | undefined, input: unknown): string[] {
  if (!tool || !WRITE_TOOLS.has(tool) || input === undefined || input === null) return [];
  let obj: Record<string, unknown> | null = null;
  let text: string | null = null;
  if (typeof input === "string") {
    text = input;
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
    } catch {
      // a cut preview: fall through to the regexes
    }
  } else if (typeof input === "object") obj = input as Record<string, unknown>;

  const out: string[] = [];
  if (obj) {
    for (const k of PATH_KEYS) {
      const p = str(obj[k]);
      if (p) {
        out.push(p);
        break;
      }
    }
    if (tool === "apply_patch")
      for (const v of Object.values(obj)) if (typeof v === "string") out.push(...patchFiles(v));
  } else if (text) {
    const m = PATH_RE.exec(text);
    if (m?.[1]) out.push(JSON.parse(`"${m[1]}"`) as string);
    if (tool === "apply_patch") out.push(...patchFiles(text.replace(/\\n/g, "\n")));
  }
  return [...new Set(out)];
}

function patchFiles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PATCH_RE)) if (m[1]) out.push(m[1].trim());
  return out;
}

/** `/Users/me/…` and `/home/me/…` → `~/…` (the client already writes `cwd` that way). */
export function tildify(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** A path as the repo sees it: under the session's cwd it loses that prefix; a path
 *  elsewhere keeps its place, with the home directory as `~`. Already-relative paths
 *  stay as they are. */
export function relativePath(p: string, cwd?: string): string {
  const path = p.trim();
  if (!path.startsWith("/") && !path.startsWith("~")) return path;
  const tp = tildify(path);
  if (cwd) {
    const base = tildify(cwd.trim()).replace(/\/+$/, "");
    if (base && tp.startsWith(`${base}/`)) return tp.slice(base.length + 1);
    if (tp === base) return ".";
  }
  return tp;
}

/** Every path an event says the session changed, repo-relative: a `files.changed`'s
 *  `paths`, or the file a successful write tool named in its input. */
export function changedPaths(ev: Pick<ProtocolEvent, "type" | "data">, cwd?: string): string[] {
  const d = ev.data;
  if (ev.type === "files.changed") {
    const paths = Array.isArray(d.paths) ? d.paths : [];
    return [
      ...new Set(paths.filter((p): p is string => typeof p === "string" && p !== "").map((p) => relativePath(p, cwd))),
    ];
  }
  if (ev.type === "tool.ended" && d.ok !== false) {
    return [...new Set(pathsInInput(str(d.tool), d.input).map((p) => relativePath(p, cwd)))];
  }
  return [];
}
