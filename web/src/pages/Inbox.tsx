// SPDX-License-Identifier: Apache-2.0
// The inbox: every open attention across all sessions and machines, newest first, in two
// groups: the prompts a control answer can reach (Allow / Deny, the same signed send as
// the session page, control/useSend.ts) and the ones waiting in a terminal. A row click
// opens its session beside the page; rows leave as the stream clears them.
import type { MachineControl } from "@shared/api";
import { useMemo, useRef } from "react";
import { Ago, HarnessGlyph, Redacted } from "../components/bits";
import { preHello } from "../components/ControlStrip";
import { NotifyToggle } from "../components/NotifyToggle";
import { useSessionSend } from "../control/useSend";
import { insecureHint } from "../control/webauthn";
import { type OpenAttention, useAppState, useOpenAttentions } from "../data/hooks";
import { ATTENTION_LABEL, oneLine, sessionTitle } from "../lib/format";
import { useListNav } from "../lib/keys";
import { sessionPath } from "../lib/router";
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
        <NotifyToggle compact />
      </div>
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

function InboxRow({ row, control, cursor }: { row: OpenAttention; control?: MachineControl; cursor?: number }) {
  const { session: s, attention: a } = row;
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
        <Answer row={row} control={control} />
      ) : (
        <span className="inbox-note">waiting in the terminal</span>
      )}
    </li>
  );
}

/** Allow / Deny for one answerable prompt, through the same signed send as the session
 *  page. Disabled with the reason when nothing can go: the machine is not paired, this
 *  page cannot use passkeys, the prompt predates the pairing, or an answer is already out. */
function Answer({ row, control }: { row: OpenAttention; control?: MachineControl }) {
  const { session: s, attention: a } = row;
  const { rp, secure, tap, error, answers, onSend } = useSessionSend(s, control, s.openAttentions);
  const status = answers[a.attentionId];
  const early = preHello(a, control);
  const reason = !control
    ? `pair ${s.machine ?? "this machine"} to send messages`
    : !secure
      ? insecureHint()
      : early
        ? "raised before this machine was paired; answer it in its terminal"
        : status === "closed"
          ? "answered in the terminal, or expired"
          : status === "sent"
            ? `answer sent · waiting for ${s.machine ?? "the machine"}`
            : tap
              ? "confirm with your passkey"
              : null;
  const off = !control || !secure || !rp || early || !!status;
  const send = (allow: boolean) =>
    void onSend({ kind: "permission.answer", attentionId: a.attentionId, allow }).catch(() => {});
  return (
    <span
      className="inbox-answer"
      data-answer={!control ? "unpaired" : !secure ? "blocked" : (status ?? (early ? "pre-hello" : "open"))}
    >
      {status !== "closed" && (
        <>
          <button type="button" className="btn btn--sm btn--allow" disabled={off} onClick={() => send(true)}>
            Allow
          </button>
          <button type="button" className="btn btn--sm btn--deny" disabled={off} onClick={() => send(false)}>
            Deny
          </button>
        </>
      )}
      {error ? (
        <span className="inbox-note inbox-note--err">{error}</span>
      ) : reason ? (
        <span className="inbox-note">{reason}</span>
      ) : null}
    </span>
  );
}
