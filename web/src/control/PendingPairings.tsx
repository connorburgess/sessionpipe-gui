// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. The pairings still waiting for a person (GET /pairings, every
// 3 s while the page is open), each with its six digits and a link to /pair?code=. When
// passkeys cannot work on this origin (http://localhost with TLS mode on), the link goes
// to the https origin instead, where approval can happen.
import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { ms, useNow } from "../lib/time";
import { controlApi, httpsPath, type Pairing } from "./api";
import { passkeysAvailable } from "./webauthn";
import "./control.css";

const POLL_MS = 3000;

export function usePendingPairings(): Pairing[] {
  const [list, setList] = useState<Pairing[]>([]);
  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const p = await controlApi.pairings();
        if (on) setList(p);
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

export function PendingPairings() {
  const list = usePendingPairings();
  const now = useNow();
  if (list.length === 0) return null;
  return (
    <section className="pending" aria-label="Pairings waiting for approval">
      <h2>{list.length === 1 ? "A machine is waiting to pair" : `${list.length} machines are waiting to pair`}</h2>
      <ul className="pending-list">
        {list.map((p) => {
          const left = Math.max(0, Math.ceil((ms(p.expiresAt) - now) / 1000));
          const pairPath = `/pair?code=${encodeURIComponent(p.code)}`;
          const https = passkeysAvailable(p.rpId) ? null : httpsPath(pairPath);
          return (
            <li key={p.code} className="pending-item" data-code={p.code}>
              <span className="pending-dot" aria-hidden="true" />
              <span className="pending-name">{p.machine.name}</span>
              <span className="pending-digits num" title="The digits the terminal printed">
                {p.check.slice(0, 3)} {p.check.slice(3)}
              </span>
              <span className="pending-meta">
                from {p.fromIp}
                {p.open ? " · open pairing" : ""}
                {p.machine.firstPairing ? " · first pairing" : ""} · {Math.floor(left / 60)} m{" "}
                {String(left % 60).padStart(2, "0")} s left
              </span>
              {https ? (
                <a href={https} className="pending-link" title="Passkeys work only on the https origin">
                  Approve on {new URL(https).host} →
                </a>
              ) : (
                <Link to={pairPath} className="pending-link">
                  Approve →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
