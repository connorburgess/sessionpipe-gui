// SPDX-License-Identifier: Apache-2.0
// The control affordance on a session: Ask / Allow / Deny. Rendered disabled until the
// control engineer wires it to POST /api/ui/control (phase 2). Keep this component
// self-contained: everything it needs comes through props.
import type { Attention, MachineControl, SessionSummary } from "@shared/api";
import { useState } from "react";

export interface ControlStripProps {
  session: SessionSummary;
  /** The session machine's control status, when it paired. */
  control?: MachineControl;
  attention?: Attention;
  /** Set by the control engineer; while absent the strip is disabled. */
  onSend?: (
    action: { kind: "prompt"; text: string } | { kind: "permission.answer"; attentionId: string; allow: boolean },
  ) => Promise<void>;
}

export function ControlStrip({ session, control, attention, onSend }: ControlStripProps) {
  const [text, setText] = useState("");
  const paired = !!control;
  const enabled = paired && !!onSend;
  const hint = !paired
    ? `pair ${session.machine ?? "this machine"} to send messages`
    : !onSend
      ? "sending arrives in the next release"
      : control?.online
        ? `${session.machine} is listening`
        : `${session.machine} is offline; the message waits`;
  return (
    <form
      className={`ctl ${enabled ? "" : "ctl--off"}`}
      aria-label="Control"
      onSubmit={(e) => {
        e.preventDefault();
        if (!enabled || !text.trim()) return;
        void onSend?.({ kind: "prompt", text: text.trim() }).then(() => setText(""));
      }}
    >
      {attention && attention.kind === "permission" ? (
        <div className="ctl-answer">
          <span className="ctl-q">
            Allow <code>{attention.tool ?? "this"}</code>?
          </span>
          <button
            type="button"
            className="btn btn--allow"
            disabled={!enabled}
            onClick={() =>
              void onSend?.({ kind: "permission.answer", attentionId: attention.attentionId, allow: true })
            }
          >
            Allow
          </button>
          <button
            type="button"
            className="btn btn--deny"
            disabled={!enabled}
            onClick={() =>
              void onSend?.({ kind: "permission.answer", attentionId: attention.attentionId, allow: false })
            }
          >
            Deny
          </button>
        </div>
      ) : null}
      <div className="ctl-ask">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask for the next turn…"
          disabled={!enabled}
          aria-label="Message for the next turn"
        />
        <button type="submit" className="btn btn--primary" disabled={!enabled || !text.trim()}>
          Send
        </button>
      </div>
      <p className="ctl-hint">{hint}</p>
    </form>
  );
}
