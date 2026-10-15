// SPDX-License-Identifier: Apache-2.0
// /shortcuts: the whole keymap as one grouped table (action, keys as chips, scope), each
// chip a button that records a new binding in place (a chord, or two within 1.2 s; Esc
// cancels, Backspace unbinds), with the conflicts named and refused: another action in a
// scope that can be live at the same time, a prefix clash ("g" against "g b"), or a key
// the browser owns. Reset per row, Reset all, Export / Import JSON, and two presets as
// examples (Vim-style, Emacs-ish). A view plugin's registered keys are listed under its
// name. The quick-settings Keyboard tab shows the short form (`KeyboardQuick`).
import { useEffect, useMemo, useRef, useState } from "react";
import { Toggle } from "../components/bits";
import { groupActions, Keys } from "../components/ShortcutHelp";
import { Link } from "../lib/router";
import {
  type Action,
  activeKeys,
  allActions,
  applyPreset,
  bindingString,
  browserTakes,
  type Chord,
  type Conflict,
  chordOf,
  conflictFor,
  conflictWords,
  exportJson,
  getPreset,
  importJson,
  isOverridden,
  PRESETS,
  resetAll,
  resetBinding,
  type Scope,
  SEQUENCE_MS,
  setBinding,
  sharedWith,
  useShortcutMap,
} from "../lib/shortcuts";

const SCOPE_LABEL: Record<Scope, string> = {
  global: "everywhere",
  lists: "board · feed · inbox",
  board: "board",
  feed: "feed",
  inbox: "inbox",
  session: "session",
  panel: "side panel",
  review: "review",
  machines: "machines",
  palette: "palette",
  views: "view",
};

export function Shortcuts() {
  const map = useShortcutMap();
  const preset = getPreset();
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupActions(allActions()), [map]);
  const overridden = Object.keys(map).filter(isOverridden).length;

  const download = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sessionpipe-gui-shortcuts.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = importJson(await f.text());
      setNote({
        text:
          r.skipped.length === 0
            ? `Imported ${r.applied} ${r.applied === 1 ? "override" : "overrides"}.`
            : `Imported ${r.applied}; skipped ${r.skipped.length}: ${r.skipped
                .slice(0, 4)
                .map((s) => `${s.id} (${s.reason})`)
                .join(", ")}${r.skipped.length > 4 ? ", …" : ""}`,
      });
    } catch (e) {
      setNote({ text: `Not imported: ${e instanceof Error ? e.message : String(e)}`, err: true });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="page sc-page">
      <header className="sc-head">
        <div>
          <h1 className="sc-title">Keyboard shortcuts</h1>
          <p className="sc-lede">
            Click a key to change it; press the new key, or two in a row. <kbd>esc</kbd> cancels, <kbd>⌫</kbd> unbinds.{" "}
            <kbd>mod</kbd> is ⌘ on a Mac and Ctrl elsewhere. A key already used where both could be live is refused, as
            is one the browser owns.
          </p>
        </div>
        <div className="sc-tools">
          <button type="button" className="btn btn--sm btn--ghost" onClick={download}>
            Export
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={overridden === 0 && !preset}
            onClick={() => {
              resetAll();
              setNote({ text: "Every shortcut is back to its default." });
            }}
          >
            Reset all
          </button>
        </div>
      </header>

      <Presets onNote={(t, err) => setNote({ text: t, err })} />
      {note && (
        <p className={`page-note sc-note ${note.err ? "is-err" : ""}`} role="status">
          {note.text}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.group} className="sc-group" aria-label={g.group}>
          <h2 className="group-head">
            {g.group}
            {g.actions[0]?.view && <span className="group-count">view</span>}
          </h2>
          <ul className="sc-table">
            {g.actions.map((a) => (
              <Row key={a.id} action={a} keys={map[a.id] ?? []} />
            ))}
          </ul>
        </section>
      ))}
      <p className="page-note">
        A view plugin lists its own keys here through <code>api.shortcuts.register</code> (docs/theme-authoring.md).
      </p>
    </div>
  );
}

/** The two presets as switches; one on turns the other off. */
export function Presets({
  onNote,
  compact = false,
}: {
  onNote?: (text: string, err?: boolean) => void;
  compact?: boolean;
}) {
  useShortcutMap();
  const current = getPreset();
  const pick = (id: string, on: boolean) => {
    const r = applyPreset(on ? id : null);
    if (!onNote) return;
    if (!on) onNote(`${PRESETS[id]?.name} is off; its keys are back to the defaults.`);
    else if (r.skipped.length === 0) onNote(`${PRESETS[id]?.name} is on.`);
    else onNote(`${PRESETS[id]?.name} is on; skipped ${r.skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}.`);
  };
  return (
    <div className={`sc-presets ${compact ? "sc-presets--compact" : ""}`}>
      {Object.values(PRESETS).map((p) => (
        <div key={p.id} className="sc-preset" data-preset={p.id}>
          <Toggle on={current === p.id} onChange={(v) => pick(p.id, v)} label={`${p.name} preset`} />
          <span className="sc-preset-text">
            <span className="sc-preset-name">{p.name}</span>
            {!compact && <span className="sc-preset-hint">{p.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Row({ action: a, keys }: { action: Action; keys: string[] }) {
  /** Which chip is being re-recorded (its index), or `keys.length` for a new one. */
  const [recording, setRecording] = useState<number | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const start = (i: number, from: HTMLElement) => {
    returnTo.current = from;
    setRecording(i);
  };
  const stop = () => {
    setRecording(null);
    const el = returnTo.current;
    returnTo.current = null;
    // The chip that was clicked, if it still exists, else the row's add button.
    requestAnimationFrame(() => {
      if (el?.isConnected) el.focus();
      else document.querySelector<HTMLElement>(`.sc-row[data-action="${CSS.escape(a.id)}"] .sc-add`)?.focus();
    });
  };
  const commit = (binding: string | null, i: number) => {
    const next = [...keys];
    if (binding === null) next.splice(i, 1);
    else if (i < next.length) next[i] = binding;
    else next.push(binding);
    setBinding(a.id, next.length === 0 ? null : [...new Set(next)]);
  };
  const shared = keys.flatMap((k) => sharedWith(a.id, k).map((o) => o.label));
  return (
    <li className="sc-row" data-action={a.id} data-overridden={isOverridden(a.id) || undefined}>
      <span className="sc-row-label">
        {a.label}
        {a.hint && <span className="sc-row-hint">{a.hint}</span>}
        {shared.length > 0 && <span className="sc-row-hint">also {[...new Set(shared)].join(", ")} elsewhere</span>}
      </span>
      <span className="sc-row-keys">
        {keys.map((k, i) =>
          recording === i ? (
            <Recorder
              key={`rec-${k}`}
              action={a}
              replacing={k}
              onDone={(b) => {
                commit(b, i);
                stop();
              }}
              onCancel={stop}
            />
          ) : (
            <button
              key={k}
              type="button"
              className={`sc-key ${browserTakes(k) === "soft" ? "sc-key--soft" : ""}`}
              onClick={(e) => start(i, e.currentTarget)}
              aria-label={`${a.label}: ${k}. Press to change`}
              title={browserTakes(k) === "soft" ? "The browser may take this key first" : "Change this key"}
            >
              <Keys binding={k} />
            </button>
          ),
        )}
        {keys.length === 0 && recording === null && <span className="sc-unbound">unbound</span>}
        {recording === keys.length ? (
          <Recorder
            action={a}
            onDone={(b) => {
              if (b) commit(b, keys.length);
              stop();
            }}
            onCancel={stop}
          />
        ) : (
          <button
            type="button"
            className="sc-add"
            onClick={(e) => start(keys.length, e.currentTarget)}
            aria-label={`Add a key for ${a.label}`}
            title="Add a key"
          >
            +
          </button>
        )}
      </span>
      <span className="sc-row-scope">
        <span className="sc-scope">{a.view ? a.group : SCOPE_LABEL[a.scope]}</span>
        {isOverridden(a.id) && (
          <button
            type="button"
            className="sc-reset"
            onClick={() => resetBinding(a.id)}
            aria-label={`Reset ${a.label} to its default`}
          >
            reset
          </button>
        )}
      </span>
    </li>
  );
}

/** "press keys…": captures one chord, then waits SEQUENCE_MS for a second; a conflict is
 *  shown and refused (the recorder stays open for another try). */
function Recorder({
  action,
  replacing,
  onDone,
  onCancel,
}: {
  action: Action;
  /** The binding this one replaces: the same key again is fine, not a conflict. */
  replacing?: string;
  onDone: (binding: string | null) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [first, setFirst] = useState<Chord | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [soft, setSoft] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    ref.current?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const tryCommit = (seq: Chord[]) => {
    const binding = bindingString(seq);
    const c = binding === replacing ? null : conflictFor(action.id, binding);
    // The same key already on this action (another chip): nothing to do.
    const dup = binding !== replacing && activeKeys(action.id).includes(binding);
    if (c) {
      setConflict(c);
      setFirst(null);
      return;
    }
    if (dup) {
      onCancel();
      return;
    }
    onDone(binding);
  };

  const onKey = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const native = e.nativeEvent;
    if (native.key === "Escape" && !first) {
      onCancel();
      return;
    }
    if ((native.key === "Backspace" || native.key === "Delete") && !first && !native.metaKey && !native.ctrlKey) {
      onDone(null);
      return;
    }
    if (native.key === "Tab" && !first && !native.ctrlKey) return; // Tab leaves the recorder
    const chord = chordOf(native);
    if (!chord) return;
    setConflict(null);
    setSoft(browserTakes(bindingString([chord])) === "soft");
    if (first) {
      if (timer.current) clearTimeout(timer.current);
      tryCommit([first, chord]);
      return;
    }
    // A chord with a modifier is a whole binding by itself; a bare key may start a sequence.
    if (chord.mod || chord.ctrl || chord.alt || chord.meta || chord.key.length > 1) {
      tryCommit([chord]);
      return;
    }
    setFirst(chord);
    timer.current = setTimeout(() => tryCommit([chord]), SEQUENCE_MS);
  };

  return (
    <span className="sc-recorder" data-recording>
      {/* biome-ignore lint/a11y/useSemanticElements: a key-capturing field has no native element */}
      <span
        ref={ref}
        className="sc-rec-field"
        role="textbox"
        aria-label={`New key for ${action.label}: press it now`}
        aria-describedby={conflict ? "sc-conflict" : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={(e) => {
          // Focus left without a key: cancel, unless it moved into the recorder's own parts.
          if (!ref.current?.parentElement?.contains(e.relatedTarget as Node)) onCancel();
        }}
      >
        {first ? (
          <>
            <Keys binding={bindingString([first])} /> <span className="sc-rec-then">then…</span>
          </>
        ) : (
          "press keys…"
        )}
      </span>
      {conflict && (
        <span className="sc-conflict" id="sc-conflict" role="alert">
          {conflictWords(conflict)} · try another
        </span>
      )}
      {!conflict && soft && <span className="sc-soft">the browser may take this key first</span>}
    </span>
  );
}

/** The quick-settings Keyboard tab: the presets, the keys most people want, the link. */
export function KeyboardQuick() {
  const map = useShortcutMap();
  const show = ["palette.toggle", "search.focus", "help.toggle", "nav.board", "nav.inbox", "list.down", "list.open"];
  return (
    <div className="qs-row sc-quick">
      <span className="qs-label">Keyboard</span>
      <ul className="sc-quick-list">
        {show.map((id) => {
          const a = allActions().find((x) => x.id === id);
          if (!a) return null;
          const keys = map[id] ?? [];
          return (
            <li key={id}>
              <span>{a.label}</span>
              <span className="sc-row-keys">
                {keys.length === 0 ? <span className="sc-unbound">unbound</span> : <Keys binding={keys[0]!} />}
              </span>
            </li>
          );
        })}
      </ul>
      <Presets compact />
      <p className="qs-note">
        <Link to="/shortcuts">All shortcuts, and change any →</Link>
      </p>
    </div>
  );
}
