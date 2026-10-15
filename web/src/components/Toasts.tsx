// SPDX-License-Identifier: Apache-2.0
// The toast stack: bottom-right on a desktop, under the top edge on a phone (the tab bar
// has the bottom). One card per moment the stream brings after the first snapshot: an
// attention opened (Allow / Deny right on the card when a control answer can reach it,
// through control/useSend.ts), a turn that ended with an error, a control reply that
// came back delivered from another device. A card click opens the session beside the
// page. The list and its rules live in lib/toasts.ts.
import type { ControlActivity, MachineControl, SessionKey, SessionSummary, StoredEvent } from "@shared/api";
import { useEffect, useRef } from "react";
import { answerState, useSessionSend } from "../control/useSend";
import { type OpenAttention, openAttentions, useAppState, useStore } from "../data/hooks";
import { ATTENTION_LABEL, oneLine, sessionTitle } from "../lib/format";
import { installSoundUnlock, type SoundKind, useSounds } from "../lib/sounds";
import { openSplit } from "../lib/split";
import { dismissToast, isOwnSend, pruneAttentionToasts, pushToast, type Toast, useToasts } from "../lib/toasts";
import { Redacted } from "./bits";

const attKey = (r: OpenAttention): string => `${r.session.key}|${r.attention.attentionId}`;

const soundFor = (r: OpenAttention): SoundKind =>
  r.attention.kind === "permission" ? "needsYou" : r.attention.kind === "error" ? "error" : "question";

function attentionToast(r: OpenAttention): Toast {
  const { session: s, attention: a } = r;
  return {
    id: `att|${attKey(r)}`,
    kind: "needs-you",
    sticky: true,
    session: s.key,
    attentionId: a.attentionId,
    answerable: r.answerable,
    title: sessionTitle(s),
    machine: s.machine,
    label: ATTENTION_LABEL[a.kind] ?? a.kind,
    tool: a.tool,
    body: a.message
      ? oneLine(a.message, 160)
      : a.tool
        ? undefined
        : r.answerable
          ? "a permission request"
          : "waiting in the terminal",
    sound: soundFor(r),
    at: Date.now(),
  };
}

function errorToast(e: StoredEvent, s: SessionSummary): Toast {
  const err = typeof e.data.error === "string" ? e.data.error : undefined;
  return {
    id: `err|${s.key}|${e.id}`,
    kind: "error",
    sticky: false,
    session: s.key,
    title: sessionTitle(s),
    machine: s.machine,
    label: "error",
    body: err ? `the turn ended with an error: ${err}` : "the turn ended with an error",
    sound: "error",
    at: Date.now(),
  };
}

function deliveredToast(a: ControlActivity, sessions: ReadonlyMap<SessionKey, SessionSummary>): Toast {
  const s = a.session ? sessions.get(a.session) : undefined;
  return {
    id: `ctl|${a.id}`,
    kind: "delivered",
    sticky: false,
    session: s?.key ?? a.session,
    title: s ? sessionTitle(s) : "a message",
    machine: s?.machine,
    label: "delivered",
    body: a.reply ? oneLine(a.reply, 160) : `your ${a.kind} reached ${s?.machine ?? "the machine"}`,
    sound: "done",
    at: Date.now(),
  };
}

/** Watches the store for the moments that toast. The first snapshot only seeds what is
 *  known; from then on every attention the stream opens, every error turn and every
 *  reply delivered to a message another device sent becomes a card. */
function useToastEffects(): void {
  const store = useStore();
  useEffect(() => {
    /** Open attention keys; null until the first snapshot seeds it. */
    let known: Set<string> | null = null;
    /** Control message id → the outcome last seen. */
    let outcomes = new Map<string, string | undefined>();
    const check = () => {
      const st = store.get();
      if (!st.snapshotAt) return;
      const rows = openAttentions(st.sessions);
      const ids = new Set(rows.map(attKey));
      const next = new Map(st.control.map((a) => [a.id, a.outcome]));
      if (known === null) {
        known = ids;
        outcomes = next;
        return;
      }
      const fresh = rows.filter((r) => !known?.has(attKey(r)));
      known = ids;
      // Oldest first, so the newest ends up nearest the corner.
      for (const r of fresh.reverse()) {
        // An older server may pass on a harness's notification about a prompt already
        // open as an answerable one (readings.ts folds these): one card, not two.
        const twin =
          !r.answerable &&
          r.attention.kind === "permission" &&
          rows.some((x) => x.session.key === r.session.key && x.answerable);
        if (!twin) pushToast(attentionToast(r));
      }
      pruneAttentionToasts(ids);
      for (const a of st.control) {
        const before = outcomes.get(a.id);
        const seen = outcomes.has(a.id);
        if (a.outcome === "delivered" && seen && before !== "delivered" && !isOwnSend(a.id))
          pushToast(deliveredToast(a, st.sessions));
      }
      outcomes = next;
    };
    check();
    const offState = store.subscribe(check);
    const offEvents = store.onEvent((e, s) => {
      if (known === null || s.parentId) return;
      if (e.type === "turn.ended" && e.data.reason === "error") pushToast(errorToast(e, s));
    });
    return () => {
      offState();
      offEvents();
    };
  }, [store]);
}

export function Toasts() {
  useToastEffects();
  useEffect(() => installSoundUnlock(), []);
  const list = useToasts();
  const { sessions, machines } = useAppState();
  const sounds = useSounds();
  if (list.length === 0) return null;
  return (
    <section className="toasts" aria-label="Notifications">
      {list.map((t) => (
        <ToastCard
          key={t.id}
          toast={t}
          session={t.session ? sessions.get(t.session) : undefined}
          control={(k) => machines.get(k)?.control}
        />
      ))}
      {sounds.on && sounds.wanted && !sounds.unlocked && (
        <p className="toast-unlock">click anywhere once to enable sound</p>
      )}
    </section>
  );
}

function ToastCard({
  toast: t,
  session,
  control,
}: {
  toast: Toast;
  session?: SessionSummary;
  control: (machine: string) => MachineControl | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = () => {
    if (!t.session) return;
    openSplit(t.session, { from: ref.current?.getBoundingClientRect() });
    dismissToast(t.id);
  };
  const attention = t.attentionId ? session?.openAttentions.find((a) => a.attentionId === t.attentionId) : undefined;
  return (
    <div
      ref={ref}
      className={`toast toast--${t.kind}`}
      data-toast={t.kind}
      data-session={t.session}
      data-attention={t.attentionId}
      data-sticky={t.sticky ? "true" : undefined}
      role="status"
    >
      <button
        type="button"
        className="toast-main"
        onClick={open}
        disabled={!t.session}
        title={t.session ? "Open the session beside this page" : undefined}
      >
        <span className="toast-top">
          {t.kind === "needs-you" && <span className="toast-dot" aria-hidden="true" />}
          <span className="toast-title">{t.title}</span>
          {t.machine && <span className="toast-machine">{t.machine}</span>}
        </span>
        <span className="toast-body">
          <span className="toast-label">{t.label}</span>
          {t.tool && <code>{t.tool}</code>}
          {t.body && (
            <span className="toast-msg">
              <Redacted text={t.body} />
            </span>
          )}
        </span>
      </button>
      <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
        ×
      </button>
      {t.answerable && session && attention && (
        <ToastAnswer
          toast={t}
          session={session}
          attention={attention}
          control={session.machine ? control(session.machine) : undefined}
        />
      )}
    </div>
  );
}

/** Allow / Deny on the card, through the same signed send as the session page and the
 *  inbox; the card leaves once an answer is out. */
function ToastAnswer({
  toast,
  session: s,
  attention: a,
  control,
}: {
  toast: Toast;
  session: SessionSummary;
  attention: NonNullable<SessionSummary["openAttentions"]>[number];
  control?: MachineControl;
}) {
  const send = useSessionSend(s, control, s.openAttentions);
  const { reason, off, status, tag } = answerState(s, a, control, send);
  const answer = (allow: boolean) =>
    void send
      .onSend({ kind: "permission.answer", attentionId: a.attentionId, allow })
      .then(() => dismissToast(toast.id))
      .catch(() => {});
  return (
    <span className="toast-actions" data-answer={tag}>
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
        <span className="toast-note toast-note--err">{send.error}</span>
      ) : reason ? (
        <span className="toast-note">{reason}</span>
      ) : null}
    </span>
  );
}
