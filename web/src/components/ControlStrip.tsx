// SPDX-License-Identifier: Apache-2.0
// The control affordance on a session: Ask / Allow / Deny / Cancel. Disabled with a hint
// until the machine paired and `onSend` is wired (web/src/control/SessionControl.tsx
// signs and sends). Keep this component self-contained: everything it needs comes
// through props.
import type { Attention, MachineControl, SessionSummary } from "@shared/api";
import { type KeyboardEvent, useState } from "react";
import { httpsHere } from "../control/api";

export type ControlAction =
  | { kind: "prompt"; text: string }
  | { kind: "permission.answer"; attentionId: string; allow: boolean; note?: string }
  | { kind: "cancel"; note?: string };

export interface ControlStripProps {
  session: SessionSummary;
  /** The session machine's control status, when it paired. */
  control?: MachineControl;
  /** One open attention (kept for callers that pass just the first). */
  attention?: Attention;
  /** Every open attention; the permission ones get an Allow / Deny pair each (CONTROL.md §7). */
  attentions?: Attention[];
  /** Set by the control engineer; while absent the strip is disabled. */
  onSend?: (action: ControlAction) => Promise<void>;
  /** A turn is running: offer Cancel. */
  working?: boolean;
  /** Why nothing here can work (no secure context): replaces the hint and disables the strip. */
  blocked?: string;
  /** One extra line under the hint: an error, or why a passkey prompt is about to appear. */
  note?: string;
  noteKind?: "info" | "err";
}

export function ControlStrip({
  session,
  control,
  attention,
  attentions,
  onSend,
  working,
  blocked,
  note,
  noteKind = "info",
}: ControlStripProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const paired = !!control;
  const httpsHref = blocked ? httpsHere() : null;
  const enabled = paired && !!onSend && !blocked;
  const hint = blocked
    ? blocked
    : !paired
      ? `pair ${session.machine ?? "this machine"} to send messages`
      : !onSend
        ? "sending arrives in the next release"
        : control?.online
          ? `${session.machine} is listening · Enter sends, Shift+Enter for a new line`
          : `${session.machine} is offline; the message waits`;
  const open = (attentions ?? (attention ? [attention] : [])).filter((a) => a.kind === "permission");

  const run = (id: string, action: ControlAction, after?: () => void) => {
    if (!enabled || busy) return;
    setBusy(id);
    void onSend?.(action)
      .then(after)
      .catch(() => {})
      .finally(() => setBusy(null));
  };
  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    run("prompt", { kind: "prompt", text: t }, () => setText(""));
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendText();
    }
  };

  return (
    <form
      className={`ctl ${enabled ? "" : "ctl--off"} ${blocked ? "ctl--blocked" : ""}`}
      aria-label="Control"
      onSubmit={(e) => {
        e.preventDefault();
        sendText();
      }}
    >
      {open.map((a) => (
        <div className="ctl-answer" key={a.attentionId} data-attention={a.attentionId}>
          <span className="ctl-q">
            Allow <code>{a.tool ?? "this"}</code>?{a.message && <span className="ctl-answer-msg"> {a.message}</span>}
          </span>
          <button
            type="button"
            className="btn btn--allow"
            disabled={!enabled || !!busy}
            onClick={() =>
              run(`allow:${a.attentionId}`, { kind: "permission.answer", attentionId: a.attentionId, allow: true })
            }
          >
            {busy === `allow:${a.attentionId}` ? "Sending…" : "Allow"}
          </button>
          <button
            type="button"
            className="btn btn--deny"
            disabled={!enabled || !!busy}
            onClick={() =>
              run(`deny:${a.attentionId}`, { kind: "permission.answer", attentionId: a.attentionId, allow: false })
            }
          >
            {busy === `deny:${a.attentionId}` ? "Sending…" : "Deny"}
          </button>
        </div>
      ))}
      <div className="ctl-ask">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask for the next turn…"
          disabled={!enabled}
          aria-label="Message for the next turn"
          rows={1}
          enterKeyHint="send"
        />
        <button
          type="submit"
          className={`btn ${enabled ? "btn--primary" : "btn--ghost"}`}
          disabled={!enabled || !!busy || !text.trim()}
        >
          {busy === "prompt" ? "Sending…" : "Send"}
        </button>
        {working && (
          <button
            type="button"
            className="btn btn--ghost ctl-cancel"
            disabled={!enabled || !!busy}
            onClick={() => run("cancel", { kind: "cancel" })}
            title="Stop the running turn"
          >
            {busy === "cancel" ? "Sending…" : "Cancel"}
          </button>
        )}
      </div>
      <p className="ctl-hint">
        {hint}
        {blocked && httpsHref ? (
          <a className="ctl-open-https" href={httpsHref}>
            Open on {new URL(httpsHref).host} →
          </a>
        ) : null}
      </p>
      {note && <p className={`ctl-note ctl-note--${noteKind}`}>{note}</p>}
    </form>
  );
}
