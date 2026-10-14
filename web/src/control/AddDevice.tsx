// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. /add-device: this browser (a phone, usually) makes its own passkey
// for the receiver's rp id and asks to be trusted (CONTROL.md §2, "a trusted device vouches
// for a new one"). The page shows six digits; on a device the machine already trusts, the
// person compares them and approves, which sends a signed `key.add` carrying this key.
// The machine verifies it like any command, adds the key and acks `delivered`; this page
// polls until then. Nothing here is trusted on its own word.
import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { ms, useNow } from "../lib/time";
import { ControlError, controlApi, type DeviceRequest, httpsHere } from "./api";
import { useRpId } from "./hooks";
import {
  guessDeviceName,
  insecureHint,
  passkeysAvailable,
  registerPasskey,
  type StoredPasskey,
  storedPasskeys,
  webauthnError,
} from "./webauthn";
import { refusalWords } from "./words";
import "./control.css";

const POLL_MS = 2000;
export const NAME_MAX = 40;

type Phase =
  | { k: "idle" }
  | { k: "busy"; what: string }
  | { k: "waiting"; d: DeviceRequest }
  | { k: "added"; d: DeviceRequest }
  | { k: "failed"; d: DeviceRequest }
  | { k: "expired"; d: DeviceRequest }
  | { k: "rejected"; d: DeviceRequest };

function requestErrorWords(e: unknown): string {
  if (e instanceof ControlError) {
    if (e.reason === "bad_key") return "This passkey is in a shape the machine cannot use; make a new one.";
    if (e.status === 401) return "This page lost its key. Open the GUI again from the link or QR on the Mac.";
    return e.detail ?? e.reason;
  }
  return webauthnError(e);
}

export function AddDevicePage() {
  const rp = useRpId();
  const secure = passkeysAvailable(rp);
  const now = useNow();
  const [known, setKnown] = useState<StoredPasskey[]>([]);
  const [name, setName] = useState(guessDeviceName());
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<number | null>(null);
  const httpsHref = secure ? null : httpsHere();

  useEffect(() => {
    if (!rp) return;
    const list = storedPasskeys(rp);
    setKnown(list);
    if (list[0]?.name) setName(list[0].name);
  }, [rp]);

  useEffect(() => {
    let on = true;
    controlApi
      .machines()
      .then((m) => on && setPaired(m.length))
      .catch(() => on && setPaired(null));
    return () => {
      on = false;
    };
  }, []);

  // While waiting, ask every two seconds how the request stands.
  const waitingId = phase.k === "waiting" ? phase.d.requestId : null;
  useEffect(() => {
    if (!waitingId) return;
    let on = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const d = await controlApi.device(waitingId);
        if (!on) return;
        if (d.status === "added") setPhase({ k: "added", d });
        else if (d.status === "failed") setPhase({ k: "failed", d });
        else if (d.status === "expired") setPhase({ k: "expired", d });
        else setPhase({ k: "waiting", d });
      } catch (e) {
        if (!on) return;
        if (e instanceof ControlError && e.status === 404) {
          setPhase((p) => (p.k === "waiting" ? { k: "rejected", d: p.d } : p));
          return;
        }
        // a dropped connection: the next tick tries again
      }
      if (on) timer = setTimeout(tick, document.visibilityState === "hidden" ? POLL_MS * 3 : POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      on = false;
      if (timer) clearTimeout(timer);
    };
  }, [waitingId]);

  const ask = async (fresh: boolean) => {
    if (!rp) return;
    setError(null);
    const deviceName = name.trim().slice(0, NAME_MAX) || guessDeviceName();
    try {
      let key: StoredPasskey | undefined = fresh ? undefined : known[0];
      if (!key) {
        setPhase({ k: "busy", what: "Making a passkey on this device…" });
        key = await registerPasskey(rp, deviceName);
        setKnown(storedPasskeys(rp));
      }
      setPhase({ k: "busy", what: "Asking to be trusted…" });
      const d = await controlApi.deviceRequest({ key: { id: key.id, alg: key.alg, spki: key.spki }, name: deviceName });
      setPhase({ k: "waiting", d });
    } catch (e) {
      setError(requestErrorWords(e));
      setPhase({ k: "idle" });
    }
  };

  const d = "d" in phase ? phase.d : null;
  const left = d ? ms(d.expiresAt) - now : 0;
  const digits = d?.check.padStart(6, "0");

  return (
    <div className="page pair add-device">
      <div>
        <h1>Add this device</h1>
        <p className="pair-lead">
          A machine answers only to passkeys it trusts. This device makes its own, and a device the machine already
          trusts (the Mac that paired) vouches for it: six digits here, the same six there, one tap to approve.
        </p>
      </div>

      {d && digits && (
        <div className="pair-check">
          <span className="pair-check-label">
            {phase.k === "waiting" ? "Approve on a device that is already trusted. It shows" : "The digits were"}
          </span>
          <div
            className="pair-digits num"
            role="img"
            aria-label={`check digits ${digits.split("").join(" ")}`}
            data-check={d.check}
          >
            {digits.slice(0, 3)}
            <span className="pair-digits-gap" />
            {digits.slice(3)}
          </div>
          {phase.k === "waiting" && (
            <span className={`pair-countdown ${left < 90_000 ? "is-soon" : ""}`}>
              {phase.d.status === "sent"
                ? "Approved · waiting for the machine to add the key…"
                : `Waiting for approval · ${countdown(left)} left`}
            </span>
          )}
        </div>
      )}

      {phase.k === "added" ? (
        <div className="pair-note pair-note--ok" role="status" data-added>
          <strong>Done.</strong> This device can now answer and send: “{phase.d.name}” is a passkey the machine trusts.
          <br />
          <Link to="/">Open the board →</Link>
        </div>
      ) : phase.k === "failed" ? (
        <div className="pair-note pair-note--err" role="alert">
          <strong>Not added.</strong> The machine said no: {refusalWords(phase.d.code)}
          {phase.d.detail && !phase.d.code ? ` (${phase.d.detail})` : ""}.
        </div>
      ) : phase.k === "expired" ? (
        <div className="pair-note pair-note--quiet" role="status">
          <strong>The request expired.</strong> Nobody approved it within ten minutes. Ask again when a trusted device
          is at hand.
        </div>
      ) : phase.k === "rejected" ? (
        <div className="pair-note pair-note--quiet" role="status">
          <strong>Rejected.</strong> A trusted device turned this request down. Nothing was trusted.
        </div>
      ) : phase.k === "waiting" ? (
        <p className="pair-note">
          On the Mac (or any device the machine already trusts), open <strong>Machines</strong> in the GUI: this request
          is listed there with the same digits. Approve it with the passkey that paired.
        </p>
      ) : null}

      {!secure && (
        <p className="pair-note pair-note--err">
          {insecureHint()}
          {httpsHref ? (
            <>
              {" "}
              <a href={httpsHref}>Open on {new URL(httpsHref).host} →</a>
            </>
          ) : null}
        </p>
      )}
      {secure && paired === 0 && (
        <p className="pair-note">
          No machine is paired with this receiver yet. Pair one from its terminal first (
          <Link to="/machines">Machines</Link>
          ), then add this device.
        </p>
      )}
      {error && (
        <p className="pair-note pair-note--err" role="alert">
          {error}
        </p>
      )}

      {phase.k === "busy" ? (
        <p className="page-note" role="status">
          {phase.what}
        </p>
      ) : phase.k === "idle" || phase.k === "expired" || phase.k === "rejected" || phase.k === "failed" ? (
        <form
          className="pair-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(false);
          }}
        >
          <label>
            What to call this device
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-label="Device name"
              placeholder={guessDeviceName()}
            />
          </label>
          <div className="pair-actions">
            <button type="submit" className="btn btn--primary" disabled={!secure || !rp}>
              {known.length ? `Add this device with its passkey “${known[0]?.name ?? "here"}”` : "Add this device"}
            </button>
            {known.length > 0 && secure && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void ask(true)}>
                make a new passkey instead
              </button>
            )}
          </div>
        </form>
      ) : null}

      <p className="page-note">
        <Link to="/machines">← Machines</Link>
      </p>
    </div>
  );
}

function countdown(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} m ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}
