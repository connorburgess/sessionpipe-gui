// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. The one signed send path for a session, shared by the session
// page's strip (SessionControl) and the inbox's Allow / Deny: builds the command for a
// strip action, signs it with the day grant (one passkey tap a day), and remembers which
// attentions have an answer out or were closed by the machine, so no second answer goes.
import type { Attention, MachineControl, SessionSummary } from "@shared/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlAction } from "../components/ControlStrip";
import { ControlError } from "./api";
import { type CommandFields, sendCommand } from "./command";
import { useControlActivity, useGrant, useRpId } from "./hooks";
import { passkeysAvailable } from "./webauthn";
import { sendErrorWords } from "./words";

export type AnswerStatus = "sent" | "closed";

export interface SessionSend {
  /** The receiver's rp id; null until known. */
  rp: string | null;
  /** Passkeys can work on this page (secure context under the rp id). */
  secure: boolean;
  grant: ReturnType<typeof useGrant>;
  /** A passkey prompt is up right now. */
  tap: boolean;
  /** The last send's refusal, in words; null once a send is retried. */
  error: string | null;
  /** Per attention id: "sent" while an answer is out, "closed" once the machine said the
   *  prompt is no longer open (answered in its terminal, or expired). */
  answers: Readonly<Record<string, AnswerStatus>>;
  /** This session's control activity, newest first. */
  activity: ReturnType<typeof useControlActivity>;
  /** Signs and sends one strip action; throws the refusal after recording it in `error`. */
  onSend: (action: ControlAction) => Promise<void>;
}

export function useSessionSend(
  session: SessionSummary,
  control: MachineControl | undefined,
  attentions: readonly Attention[],
): SessionSend {
  const rp = useRpId();
  const secure = passkeysAvailable(rp);
  const grant = useGrant(rp);
  const [tap, setTap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = session.key;
  const mine = useCallback((a: { session?: string }) => a.session === key, [key]);
  const activity = useControlActivity(mine);

  const [answers, setAnswers] = useState<Record<string, AnswerStatus>>({});
  /** Message id → the attention its answer named. */
  const sent = useRef(new Map<string, string>());
  useEffect(() => {
    const closed: string[] = [];
    for (const a of activity) {
      const att = sent.current.get(a.id);
      if (!att) continue;
      if ((a.outcome === "refused" && (a.code === "no_attention" || a.code === "expired")) || a.outcome === "expired")
        closed.push(att);
    }
    if (closed.length)
      setAnswers((prev) => {
        const next = { ...prev };
        for (const att of closed) next[att] = "closed";
        return next;
      });
  }, [activity]);
  // An attention the stream cleared needs no memory any more.
  useEffect(() => {
    const open = new Set(attentions.map((a) => a.attentionId));
    setAnswers((prev) => {
      const keep = Object.entries(prev).filter(([id]) => open.has(id));
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [attentions]);

  const onSend = useCallback(
    async (action: ControlAction) => {
      if (!control || !rp) return;
      setError(null);
      let fields: CommandFields;
      switch (action.kind) {
        case "prompt":
          fields = { kind: "prompt", session: key, text: action.text };
          break;
        case "permission.answer":
          fields = {
            kind: "permission.answer",
            session: key,
            for: action.attentionId,
            decision: action.allow ? "allow" : "deny",
            ...(action.note ? { note: action.note } : {}),
          };
          break;
        case "cancel":
          fields = { kind: "cancel", session: key, ...(action.note ? { note: action.note } : {}) };
          break;
      }
      const att = action.kind === "permission.answer" ? action.attentionId : null;
      if (att && answers[att]) return;
      try {
        const carried = await sendCommand(rp, control.machineId, fields, { onTap: () => setTap(true) });
        if (att) {
          sent.current.set(carried.id, att);
          setAnswers((prev) => ({ ...prev, [att]: "sent" }));
        }
      } catch (e) {
        if (att && e instanceof ControlError && e.code === "no_attention")
          setAnswers((prev) => ({ ...prev, [att]: "closed" }));
        setError(sendErrorWords(e));
        throw e;
      } finally {
        setTap(false);
        grant.refresh();
      }
    },
    [control, rp, key, grant.refresh, answers],
  );

  return { rp, secure, grant, tap, error, answers, activity, onSend };
}
