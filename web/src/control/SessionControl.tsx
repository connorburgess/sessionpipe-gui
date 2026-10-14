// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. The session page's control: the strip wired to a signed send
// (a prompt, Allow / Deny on an open permission, cancel) and, under it, what became of
// each message. The first send of the day asks for the passkey once (the day grant).
import type { Attention, MachineControl, SessionSummary } from "@shared/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ControlAction, ControlStrip } from "../components/ControlStrip";
import { ActivityList } from "./Activity";
import { ControlError } from "./api";
import { type CommandFields, sendCommand } from "./command";
import { useControlActivity, useGrant, useRpId } from "./hooks";
import { insecureHint, passkeysAvailable } from "./webauthn";
import { sendErrorWords } from "./words";
import "./control.css";

export function SessionControl({
  session,
  control,
  attentions,
}: {
  session: SessionSummary;
  control?: MachineControl;
  attentions: Attention[];
}) {
  const rp = useRpId();
  const secure = passkeysAvailable(rp);
  const grant = useGrant(rp);
  const [tap, setTap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = session.key;
  const mine = useCallback((a: { session?: string }) => a.session === key, [key]);
  const activity = useControlActivity(mine);

  /** Answers out for an attention, and attentions the machine said were no longer open
   *  (refused `no_attention`, or the answer expired): the strip shows no pair for those. */
  const [answers, setAnswers] = useState<Record<string, "sent" | "closed">>({});
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

  const working = session.state === "working" || session.state === "stale" || !!session.currentTurn;
  const tapHint = tap
    ? "Confirm with your passkey: it vouches for this browser for a day, so later sends need no tap."
    : control && secure && grant.exp === null
      ? "The first send of the day asks for your passkey once; this browser then signs by itself until tomorrow."
      : undefined;

  return (
    <>
      <ControlStrip
        session={session}
        control={control}
        attentions={attentions}
        onSend={secure && rp ? onSend : undefined}
        working={working}
        blocked={secure ? undefined : insecureHint()}
        note={error ?? tapHint}
        noteKind={error ? "err" : "info"}
        answers={answers}
      />
      <ActivityList items={activity} machine={session.machine} online={control?.online} />
    </>
  );
}
