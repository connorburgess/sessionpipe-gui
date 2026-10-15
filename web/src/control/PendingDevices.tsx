// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. Devices asking to be trusted (GET /devices, every 3 s while the
// page is open), each with its six digits. This browser, when the machine trusts its
// passkey, vouches for one with Approve: a signed `key.add` (session sessionpipe:keys)
// carrying the device's key goes through the same path as any command (CONTROL.md §2);
// the machine's `delivered` ack settles the request on the server. Shown on /machines and,
// as a bar, at the top of a session page.
import { useEffect, useState } from "react";
import { Select } from "../components/Select";
import { useMachines } from "../data/hooks";
import { ms, useNow } from "../lib/time";
import { ControlError, controlApi, type DeviceRequest } from "./api";
import { sendCommand } from "./command";
import { useControlActivity, useGrant, useRpId } from "./hooks";
import { insecureHint, passkeysAvailable } from "./webauthn";
import { outcomeWords, sendErrorWords } from "./words";
import "./control.css";

const POLL_MS = 3000;

export function usePendingDevices(): DeviceRequest[] {
  const [list, setList] = useState<DeviceRequest[]>([]);
  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const d = await controlApi.devices();
        if (on) setList(d);
      } catch {
        // the next tick tries again
      }
      if (on) timer = setTimeout(tick, document.visibilityState === "hidden" ? POLL_MS * 4 : POLL_MS);
    };
    void tick();
    return () => {
      on = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return list;
}

/** The grant did not satisfy the verifier even after a fresh tap: one passkey confirm over the command itself. */
const CONFIRM_FALLBACK = new Set(["bad_grant", "outside_grant", "bad_csig", "bad_assertion"]);

export function PendingDevices({ bar = false }: { bar?: boolean }) {
  const list = usePendingDevices();
  const machines = useMachines();
  const paired = machines.filter((m) => m.control);
  const rp = useRpId();
  const secure = passkeysAvailable(rp);
  const grant = useGrant(rp);
  const now = useNow();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tap, setTap] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Requests this page approved: request id → the key.add's activity id, so the row stays
   *  until the machine's word is in, even once the server stops listing it. */
  const [approved, setApproved] = useState<{ requestId: string; name: string; activityId: string; machine: string }[]>(
    [],
  );
  const activity = useControlActivity();

  const machineFor = (d: DeviceRequest) => {
    const id = target[d.requestId] ?? d.machineId ?? paired[0]?.control?.machineId;
    return paired.find((m) => m.control?.machineId === id);
  };

  const approve = async (d: DeviceRequest) => {
    const m = machineFor(d);
    if (!rp || !m?.control || busy) return;
    setBusy(d.requestId);
    setErrors((e) => ({ ...e, [d.requestId]: "" }));
    const fields = { kind: "key.add" as const, key: d.key, name: d.name };
    try {
      let a: Awaited<ReturnType<typeof sendCommand>>;
      try {
        a = await sendCommand(rp, m.control.machineId, fields, { onTap: () => setTap(true) });
      } catch (e) {
        if (!(e instanceof ControlError && e.code && CONFIRM_FALLBACK.has(e.code))) throw e;
        a = await sendCommand(rp, m.control.machineId, fields, { confirm: true, onTap: () => setTap(true) });
      }
      setApproved((list) => [...list, { requestId: d.requestId, name: d.name, activityId: a.id, machine: m.name }]);
    } catch (e) {
      setErrors((x) => ({ ...x, [d.requestId]: sendErrorWords(e) }));
    } finally {
      setTap(false);
      setBusy(null);
      grant.refresh();
    }
  };

  const reject = async (d: DeviceRequest) => {
    if (busy) return;
    setBusy(d.requestId);
    try {
      await controlApi.rejectDevice(d.requestId);
    } catch (e) {
      setErrors((x) => ({ ...x, [d.requestId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const open = list.filter((d) => !approved.some((a) => a.requestId === d.requestId));
  const settled = approved
    .map((a) => ({ ...a, msg: activity.find((x) => x.id === a.activityId) }))
    .filter((a) => !list.some((d) => d.requestId === a.requestId && d.status === "pending"));
  if (open.length === 0 && settled.length === 0) return null;

  return (
    <section
      className={`pending pending-devices ${bar ? "pending--bar" : ""}`}
      aria-label="Devices asking to be trusted"
    >
      <h2>
        {open.length === 0
          ? "A device was added"
          : open.length === 1
            ? "A device asks to be trusted"
            : `${open.length} devices ask to be trusted`}
      </h2>
      <ul className="pending-list">
        {open.map((d) => {
          const left = Math.max(0, Math.ceil((ms(d.expiresAt) - now) / 1000));
          const m = machineFor(d);
          const err = errors[d.requestId];
          return (
            <li key={d.requestId} className="pending-item" data-device={d.requestId}>
              <span className="pending-dot" aria-hidden="true" />
              <span className="pending-name">
                {d.name}
                {d.name !== d.device && <span className="pending-meta"> · {d.device}</span>}
              </span>
              <span className="pending-digits num" title="The digits the device shows">
                {d.check.slice(0, 3)} {d.check.slice(3)}
              </span>
              <span className="pending-meta">
                from {d.fromIp} · {Math.floor(left / 60)} m {String(left % 60).padStart(2, "0")} s left
              </span>
              <span className="pending-actions">
                {paired.length > 1 && (
                  <Select<string>
                    size="sm"
                    align="end"
                    aria-label="Machine to trust it on"
                    value={m?.control?.machineId ?? ""}
                    onChange={(id) => setTarget((t) => ({ ...t, [d.requestId]: id }))}
                    disabled={!!busy}
                    options={paired.map((p) => ({ value: p.control!.machineId, label: p.name }))}
                  />
                )}
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={!secure || !rp || !m || !!busy}
                  title={!secure ? insecureHint() : !m ? "pair a machine first" : `trust it on ${m.name}`}
                  onClick={() => void approve(d)}
                >
                  {busy === d.requestId ? (tap ? "Confirm with your passkey…" : "Sending…") : "Approve"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!busy}
                  onClick={() => void reject(d)}
                >
                  Reject
                </button>
              </span>
              {!secure && <span className="pending-meta pending-wide">{insecureHint()}</span>}
              {!m && secure && <span className="pending-meta pending-wide">pair a machine before adding devices</span>}
              {err ? (
                <span className="pending-meta pending-wide pending-err" role="alert">
                  {err}
                </span>
              ) : null}
            </li>
          );
        })}
        {settled.map((a) => (
          <li key={a.requestId} className="pending-item pending-item--settled" data-device={a.requestId}>
            <span className="pending-name">{a.name}</span>
            <span className="pending-meta" data-outcome={a.msg?.outcome ?? "queued"}>
              {a.msg?.outcome === "delivered"
                ? `added · ${a.machine} now answers to it; the device can answer and send`
                : a.msg
                  ? outcomeWords(a.msg, { machine: a.machine })
                  : `queued · waiting for ${a.machine} to take it`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
