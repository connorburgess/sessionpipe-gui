// SPDX-License-Identifier: Apache-2.0
// The inbox: every open attention across all sessions and machines, newest first, in two
// groups: the prompts a control answer can reach (Allow / Deny, the same signed send as
// the session page, control/useSend.ts) and the ones waiting in a terminal. A row click
// opens its session beside the page; rows leave as the stream clears them. The header
// holds "Notify me" and a link to the notification sounds in Settings.
import type { MachineControl } from "@shared/api";
import { useMemo, useRef } from "react";
import { Ago, HarnessGlyph, Redacted } from "../components/bits";
import { LensChip, LensNote } from "../components/LensChip";
import { NotifyToggle } from "../components/NotifyToggle";
import { answerState, useSessionSend } from "../control/useSend";
import { type OpenAttention, useAppState, useOpenAttentions } from "../data/hooks";
import { ATTENTION_LABEL, oneLine, sessionTitle } from "../lib/format";
import { useListNav } from "../lib/keys";
import { Link, sessionPath } from "../lib/router";
import { type Lens, useLens } from "../lib/settings";
import { useShortcut } from "../lib/shortcuts";
import { openSplit } from "../lib/split";

export function Inbox() {
  const rows = useOpenAttentions();
  const { machines, snapshotAt, connection } = useAppState();
  const answer = useMemo(() => rows.filter((r) => r.answerable), [rows]);
  const terminal = useMemo(() => rows.filter((r) => !r.answerable), [rows]);
  const ordered = useMemo(() => [...answer, ...terminal], [answer, terminal]);
  const hrefs = useMemo(() => ordered.map((r) => sessionPath(r.session.harness, r.session.id)), [ordered]);
  const keys = useMemo(() => ordered.map((r) => r.session.key), [ordered]);
  const { cursor } = useListNav(hrefs, true, keys);
  // The tier lens: attention messages and tool names travel at tier 1 (lib/tier.ts).
  const lens = useLens();
  const hiddenByLens = lens === 0 ? rows.filter((r) => r.attention.message || r.attention.tool).length : 0;

  if (!snapshotAt)
    return (
      <p className="page-note">
        {connection === "live" || connection === "connecting"
          ? "Waiting for the first snapshot…"
          : "No connection to the receiver yet."}
      </p>
    );

  const group = (title: string, list: OpenAttention[], offset: number) =>
    list.length > 0 && (
      <section className="group inbox-group" aria-label={title}>
        <h2 className="group-head">
          {title}
          <span className="group-count num">{list.length}</span>
        </h2>
        <ol className="inbox-rows">
          {list.map((r, i) => (
            <InboxRow
              key={`${r.session.key}|${r.attention.attentionId}`}
              row={r}
              control={r.session.machine ? machines.get(r.session.machine)?.control : undefined}
              cursor={offset + i === cursor ? cursor : undefined}
              lens={lens}
            />
          ))}
        </ol>
      </section>
    );

  return (
    <div className="page inbox">
      <div className="inbox-head">
        <p className="inbox-lede">
          {rows.length === 0
            ? "Prompts, questions and errors from every session land here."
            : [
                answer.length > 0 && `${answer.length} ${answer.length === 1 ? "needs" : "need"} an answer`,
                terminal.length > 0 && `${terminal.length} waiting in a terminal`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
        <div className="inbox-tools">
          <LensChip />
          <NotifyToggle compact />
          <Link to="/settings?section=notifications" className="inbox-link" title="Notification sounds, in Settings">
            Sounds
          </Link>
        </div>
      </div>
      <LensNote lens={lens} hidden={hiddenByLens} />
      {rows.length === 0 ? (
        <p className="inbox-empty">nothing needs you</p>
      ) : (
        <>
          {group("Needs an answer", answer, 0)}
          {group("Waiting in a terminal", terminal, answer.length)}
        </>
      )}
    </div>
  );
}

function InboxRow({
  row,
  control,
  cursor,
  lens = null,
}: {
  row: OpenAttention;
  control?: MachineControl;
  cursor?: number;
  lens?: Lens;
}) {
  const { session: s, attention: raw } = row;
  // Below tier 1 the message and the tool stay on the sending machine.
  const a = lens === 0 ? { ...raw, message: undefined, tool: undefined } : raw;
  const ref = useRef<HTMLLIElement>(null);
  const open = (background = false) => openSplit(s.key, { from: ref.current?.getBoundingClientRect(), background });
  return (
    <li
      ref={ref}
      className={`inbox-row ${row.answerable ? "inbox-row--answerable" : "inbox-row--terminal"}`}
      data-attention={a.attentionId}
      data-session={s.key}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      aria-current={cursor !== undefined ? "true" : undefined}
    >
      <button
        type="button"
        className="inbox-main"
        data-nav-item=""
        onClick={(e) => open(e.metaKey || e.ctrlKey)}
        title="Open the session beside this page"
      >
        <span className="inbox-top">
          <HarnessGlyph name={s.harness} size="sm" />
          <span className="inbox-title">{sessionTitle(s)}</span>
          {s.machine && <span className="inbox-machine">{s.machine}</span>}
          <span className="inbox-age">
            <Ago iso={a.at} />
          </span>
        </span>
        <span className="inbox-what">
          <span className="inbox-kind">{ATTENTION_LABEL[a.kind] ?? a.kind}</span>
          {a.tool && <code>{a.tool}</code>}
          {a.message ? (
            <span className="inbox-msg">
              <Redacted text={oneLine(a.message, 200)} />
            </span>
          ) : !a.tool ? (
            <span className="inbox-msg">{row.answerable ? "a permission request" : "waiting for you"}</span>
          ) : null}
        </span>
      </button>
      {row.answerable ? (
        <Answer row={row} control={control} focused={cursor !== undefined} />
      ) : (
        <span className="inbox-note">waiting in the terminal</span>
      )}
    </li>
  );
}

/** Allow / Deny for one answerable prompt, through the same signed send as the session
 *  page; disabled with the reason when nothing can go (control/useSend.ts answerState). */
function Answer({
  row,
  control,
  focused = false,
}: {
  row: OpenAttention;
  control?: MachineControl;
  /** The row under the list cursor: `a` / `d` answer it (lib/shortcuts.ts). */
  focused?: boolean;
}) {
  const { session: s, attention: a } = row;
  const send = useSessionSend(s, control, s.openAttentions);
  const { reason, off, status, tag } = answerState(s, a, control, send);
  const answer = (allow: boolean) =>
    void send.onSend({ kind: "permission.answer", attentionId: a.attentionId, allow }).catch(() => {});
  // The inbox row wins over a session open beside the page (priority 2 > the panel's 0).
  const canKey = focused && !off && status !== "closed";
  useShortcut("inbox.allow", () => answer(true), { enabled: canKey, priority: 2 });
  useShortcut("inbox.deny", () => answer(false), { enabled: canKey, priority: 2 });
  return (
    <span className="inbox-answer" data-answer={tag}>
      {status !== "closed" && (
        <>
          <button type="button" className="btn btn--sm btn--allow" disabled={off} onClick={() => answer(true)}>
            Allow
          </button>
          <button type="button" className="btn btn--sm btn--deny" disabled={off} onClick={() => answer(false)}>
            Deny
          </button>
        </>
      )}
      {send.error ? (
        <span className="inbox-note inbox-note--err">{send.error}</span>
      ) : reason ? (
        <span className="inbox-note">{reason}</span>
      ) : null}
    </span>
  );
}
