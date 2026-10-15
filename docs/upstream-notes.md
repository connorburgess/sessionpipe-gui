# Upstream notes

Things the GUI works around today that belong in the sessionpipe client. Each one names
the workaround here so it can be removed once upstream ships the fix.

## Adapters should emit `files.changed` from write-tool inputs

**Observed.** A real store of 11k Claude Code events held 272 successful `Edit`/`Write`
calls and zero `files.changed` events. The Claude Code adapter never emits one; Gemini CLI
and Codex emit it only for some tools. `SessionSummary.counts.filesChanged` was therefore
always 0 on real data, and the Review page's Files view was empty.

**Proposal.** PROTOCOL.md §4 already allows a `files.changed` after any tool whose input
names the file it writes. Adapters should emit one from the write tool's input on its
`PostToolUse` (or equivalent) when the tool succeeded:

| Harness | Tools | Path in the input |
|---|---|---|
| Claude Code | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | `file_path` (`notebook_path` for notebooks) |
| Codex | `apply_patch` | `*** Update/Add/Delete File: <path>` lines of the patch |
| Gemini CLI | `write_file`, `replace` | `file_path` |
| Antigravity | `edit_file` | `path` / `file_path` |

Paths should be repo-relative when under the session's `cwd` (strip the prefix), else
absolute with the home directory as `~`, matching how `session.cwd` is already written.
`Bash` is out of scope: a shell command's targets are not knowable from its text. Emitting
at tier 1 would make the paths available to receivers that never see tier-3 inputs.

**Workaround in this repo** (`server/store/paths.ts`, used by `readings.ts` and
`store/review.ts`): a successful `tool.ended` of one of the tools above contributes the
path its input names, made repo-relative the same way; a `files.changed` naming the same
path within 10 s of that write is not counted twice. The slim index keeps the first 2 KB of
an input, which is where the path sits, so this needs no disk read. Remove the derivation
once adapters emit the event themselves.
