// SPDX-License-Identifier: Apache-2.0
// The Notifications section of the Settings dialog (components/Settings.tsx mounts it):
// switch rows for system notifications (lib/notify.ts) and sounds (lib/sounds.ts), the
// volume, one row per kind of moment with its sound and a Test, and the file you can
// upload for any of them. Rows are 40 px on a 120 px label column; one element per
// control, so the shared Select / Switch / Slider can take their places.
import { useId, useRef, useState } from "react";
import { setNotifyPref, useNotifyPref } from "../lib/notify";
import {
  BUILTIN_SOUNDS,
  playSound,
  removeCustomSound,
  SOUND_KINDS,
  type SoundChoice,
  type SoundKind,
  setCustomSound,
  setSoundChoice,
  setSoundsOn,
  setSoundVolume,
  useSounds,
} from "../lib/sounds";
import { Slider, Switch } from "./bits";
import { Select } from "./Select";

export function NotificationsSettings() {
  const notify = useNotifyPref();
  const s = useSounds();
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const blocked = notify.permission === "denied" || notify.permission === "unsupported";
  const notifyHint =
    notify.permission === "unsupported"
      ? "not available in this browser"
      : notify.permission === "denied"
        ? "blocked for this site in the browser's settings"
        : "when a prompt needs you and this tab is in the background";
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setProblem(await setCustomSound(f));
  };
  return (
    <div className="ntf" data-sounds={s.on ? "on" : "off"}>
      <div className="ntf-row" data-row="notify">
        <span className="ntf-label" id={`${id}-notify`}>
          Notify me
        </span>
        <Switch on={notify.on} onChange={(v) => void setNotifyPref(v)} label="Notify me" disabled={blocked} />
        <span className="ntf-hint">{notifyHint}</span>
      </div>
      <div className="ntf-row" data-row="sounds">
        <span className="ntf-label">Sounds</span>
        <Switch on={s.on} onChange={setSoundsOn} label="Sounds" disabled={!s.supported} />
        {!s.supported && <span className="ntf-hint">not available in this browser</span>}
      </div>
      <div className="ntf-row" data-row="volume">
        <label className="ntf-label" htmlFor={`${id}-volume`}>
          Volume
        </label>
        <Slider
          id={`${id}-volume`}
          className="ntf-slider"
          label="Volume"
          value={s.volume}
          disabled={!s.on || !s.supported}
          onChange={setSoundVolume}
        />
        <span className="ntf-pct num">{Math.round(s.volume * 100)} %</span>
      </div>
      {SOUND_KINDS.map((k) => (
        <div className="ntf-row" data-kind={k.kind} key={k.kind}>
          <label className="ntf-label" htmlFor={`${id}-${k.kind}`} title={k.hint}>
            {k.label}
          </label>
          <Select<SoundChoice>
            id={`${id}-${k.kind}`}
            className="ntf-select"
            size="sm"
            value={s.kinds[k.kind]}
            disabled={!s.supported}
            onChange={(v) => setSoundChoice(k.kind as SoundKind, v)}
            options={[
              ...BUILTIN_SOUNDS.map((b) => ({ value: b.id as SoundChoice, label: b.label })),
              ...(s.custom ? [{ value: "custom" as SoundChoice, label: `Your sound · ${s.custom.name}` }] : []),
            ]}
          />
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={!s.supported}
            onClick={() => void playSound(k.kind, { test: true })}
            title={`Play the ${k.label.toLowerCase()} sound`}
          >
            Test
          </button>
        </div>
      ))}
      <div className="ntf-row" data-row="upload">
        <span className="ntf-label">Upload your own</span>
        {s.custom ? (
          <span className="ntf-file ellipsis" title={s.custom.name}>
            {s.custom.name} · {Math.max(1, Math.round(s.custom.bytes / 1024))} KB
          </span>
        ) : (
          <button
            type="button"
            className="btn btn--sm btn--ghost ntf-choose"
            disabled={!s.supported}
            onClick={() => file.current?.click()}
          >
            Choose a file…
          </button>
        )}
        {s.custom && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void removeCustomSound()}>
            Remove
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="audio/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload a sound"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            setProblem(null);
            void onFile(f);
          }}
        />
        {problem && (
          <span className="ntf-err" role="alert">
            {problem}
          </span>
        )}
      </div>
    </div>
  );
}

export default NotificationsSettings;
