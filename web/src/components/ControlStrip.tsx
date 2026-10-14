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
  /** Per attention id: "sent" while an answer is out (no second one goes), "closed" once
   *  the machine said the prompt is no longer open (answered in its terminal, or expired). */
  answers?: Readonly<Record<string, "sent" | "closed">>;
}

/** An attention raised before the daemon said hello cannot be answered from here: the hook
 *  only waits on the daemon when it was already running. A minute of slack covers the two
 *  clocks (the sender stamps `at`, the receiver stamps the hello). */
export const preHello = (a: Attention, control: MachineControl | undefined): boolean =>
  !!control && (!control.lastHelloAt || Date.parse(a.at) < Date.parse(control.lastHelloAt) - 60_000);

/** Whether a control answer can reach this prompt (shared/api.ts `answerable`). Claude Code
 *  raises two attentions per permission: the hook's (answerable) and a notification about
 *  it (`notif-…`, nobody can answer). An older server leaves the field unset. */
export const answerable = (a: Attention): boolean => a.answerable ?? !a.attentionId.startsWith("notif-");

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
  answers,
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
  const permissions = (attentions ?? (attention ? [attention] : [])).filter((a) => a.kind === "permission");
  // The answerable prompt(s) only; a notification twin adds nothing. With no answerable one,
  // the notification is shown as what it is: a prompt waiting in the terminal.
  const open = permissions.some(answerable) ? permissions.filter(answerable) : permissions;

  const run = (id: string, action: ControlAction, after?: () => void) => {
    if (!enabled || busy) return;
    if (action.kind === "permission.answer" && answers?.[action.attentionId]) return;
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
      {open.map((a) => {
        const status = answers?.[a.attentionId];
        const terminal = !answerable(a);
        const early = !terminal && preHello(a, control);
        const off = !enabled || !!busy || status === "sent" || early;
        return (
          <div
            className="ctl-answer"
            key={a.attentionId}
            data-attention={a.attentionId}
            data-answer={terminal ? "terminal" : (status ?? (early ? "pre-hello" : "open"))}
          >
            <span className="ctl-q">
              Allow {a.tool ? <code>{a.tool}</code> : "this"}?
              {a.message ? (
                <span className="ctl-answer-msg"> {a.message}</span>
              ) : a.tool ? null : (
                <span className="ctl-answer-msg"> a permission request</span>
              )}
            </span>
            {terminal ? (
              <span className="ctl-answer-note">waiting in the terminal</span>
            ) : status === "closed" ? (
              <span className="ctl-answer-note">answered in the terminal, or expired</span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--allow"
                  disabled={off}
                  onClick={() =>
                    run(`allow:${a.attentionId}`, {
                      kind: "permission.answer",
                      attentionId: a.attentionId,
                      allow: true,
                    })
                  }
                >
                  {busy === `allow:${a.attentionId}` ? "Sending…" : "Allow"}
                </button>
                <button
                  type="button"
                  className="btn btn--deny"
                  disabled={off}
                  onClick={() =>
                    run(`deny:${a.attentionId}`, {
                      kind: "permission.answer",
                      attentionId: a.attentionId,
                      allow: false,
                    })
                  }
                >
                  {busy === `deny:${a.attentionId}` ? "Sending…" : "Deny"}
                </button>
                {early ? (
                  <span className="ctl-answer-note">
                    raised before this machine was paired; answer it in its terminal
                  </span>
                ) : status === "sent" ? (
                  <span className="ctl-answer-note">answer sent · waiting for {session.machine ?? "the machine"}</span>
                ) : null}
              </>
            )}
          </div>
        );
      })}
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
