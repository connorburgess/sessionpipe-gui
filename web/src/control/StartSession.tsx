// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. Start a session on a paired machine (CONTROL.md §6 `start`): a
// harness it reported, a folder from its allowlist, the first message. The session id is
// ours (a UUID: claude-code's rule, and the name codex and gemini keep for a start); once
// the machine acks `delivered` the new session is one link away.
import type { MachineControl, MachineSummary } from "@shared/api";
import { sessionKey } from "@shared/api";
import { useId, useState } from "react";
import { harnessMark } from "../lib/format";
import { Link, sessionPath } from "../lib/router";
import { ActivityRow } from "./Activity";
import { uuid } from "./bytes";
import { sendCommand } from "./command";
import { useGrant, useMessage, useRpId } from "./hooks";
import { INSECURE_HINT, passkeysAvailable } from "./webauthn";
import { sendErrorWords } from "./words";
import "./control.css";

export function StartSession({ m, c }: { m: MachineSummary; c: MachineControl }) {
  const rp = useRpId();
  const secure = passkeysAvailable();
  const grant = useGrant(rp);
  const harnesses = c.harnesses?.length ? c.harnesses : Object.keys(m.harnesses);
  const [harness, setHarness] = useState(harnesses[0] ?? "claude-code");
  const [cwd, setCwd] = useState(c.folders?.[0] ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tap, setTap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; harness: string; sid: string } | null>(null);
  const msg = useMessage(sent?.id ?? null);
  const folderId = useId();

  const canSend = secure && !!rp && !busy && !!harness && cwd.trim().startsWith("/") && !!text.trim();

  const submit = async () => {
    if (!canSend || !rp) return;
    setBusy(true);
    setError(null);
    const sid = uuid();
    try {
      const a = await sendCommand(
        rp,
        c.machineId,
        { kind: "start", session: sessionKey(harness, sid), text: text.trim(), cwd: cwd.trim() },
        { onTap: () => setTap(true) },
      );
      setSent({ id: a.id, harness, sid });
      setText("");
    } catch (e) {
      setError(sendErrorWords(e));
    } finally {
      setTap(false);
      setBusy(false);
      grant.refresh();
    }
  };

  return (
    <div className="start">
      <dt>start</dt>
      <dd>
        {!secure ? (
          <span className="machine-ctl-row">{INSECURE_HINT}</span>
        ) : (
          <form
            className="start-form"
            aria-label={`Start a session on ${m.name}`}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="start-row">
              <label>
                harness
                <select value={harness} onChange={(e) => setHarness(e.target.value)} disabled={busy}>
                  {harnesses.map((h) => (
                    <option key={h} value={h}>
                      {harnessMark(h).label}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={folderId}>
                folder
                {c.folders && c.folders.length > 0 ? (
                  <select id={folderId} value={cwd} onChange={(e) => setCwd(e.target.value)} disabled={busy}>
                    {c.folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={folderId}
                    type="text"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    placeholder="/absolute/path on the machine"
                    className="mono"
                    disabled={busy}
                  />
                )}
              </label>
            </div>
            <label>
              first message
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What should the new session do?"
                disabled={busy}
                maxLength={20_000}
              />
            </label>
            <div className="start-actions">
              <button type="submit" className="btn" disabled={!canSend}>
                {busy ? "Sending…" : c.online ? "Start session" : "Start when it comes online"}
              </button>
              <span className="ctl-hint">
                {tap
                  ? "Confirm with your passkey: it vouches for this browser for a day."
                  : grant.exp === null
                    ? "The first send of the day asks for your passkey once."
                    : c.online
                      ? `${m.name} is listening`
                      : `${m.name} is offline; the start waits up to an hour`}
              </span>
            </div>
            {error && <p className="ctl-note ctl-note--err">{error}</p>}
          </form>
        )}
        {sent && (
          <ol className="start-acts" aria-label="Start sent">
            {msg && <ActivityRow a={msg} machine={m.name} online={c.online} />}
            {msg?.outcome === "delivered" && (
              <li className="start-link">
                <Link to={sessionPath(sent.harness, sent.sid)} className="start-open">
                  Open the new session →
                </Link>
              </li>
            )}
          </ol>
        )}
      </dd>
    </div>
  );
}
