// SPDX-License-Identifier: Apache-2.0
// Small shared pieces: state marks, harness monograms, chips, ticking times, spinner,
// copy button, redaction highlighting, search input, segmented control.
import type { SessionState, Tier } from "@shared/api";
import { type ReactNode, useEffect, useId, useState } from "react";
import { harnessMark, STATE_HINT, STATE_LABEL } from "../lib/format";
import { ago, durCoarse, ms, since, useNow } from "../lib/time";

export function StateDot({ state, size = 10 }: { state: SessionState; size?: number }) {
  return (
    <span
      className={`dot dot--${state}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={STATE_LABEL[state]}
      title={STATE_HINT[state]}
    />
  );
}

export function StateBadge({ state, since: sinceIso }: { state: SessionState; since?: string }) {
  const now = useNow();
  return (
    <span className={`badge badge--${state}`} title={STATE_HINT[state]}>
      <StateDot state={state} size={8} />
      {STATE_LABEL[state]}
      {sinceIso && <span className="badge-since num">{since(sinceIso, now)}</span>}
    </span>
  );
}

export function HarnessGlyph({
  name,
  size = "md",
  withLabel = false,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  withLabel?: boolean;
}) {
  const m = harnessMark(name);
  return (
    <span className={`glyph-wrap ${withLabel ? "glyph-wrap--label" : ""}`} title={m.label}>
      <span className={`glyph glyph--${size}`} style={{ "--h": m.hue } as React.CSSProperties} aria-hidden="true">
        {m.glyph}
      </span>
      {withLabel ? <span className="glyph-label">{m.label}</span> : <span className="sr-only">{m.label}</span>}
    </span>
  );
}

export function Chip({
  children,
  kind,
  title,
}: {
  children: ReactNode;
  kind?: "machine" | "repo" | "model" | "tier" | "plain";
  title?: string;
}) {
  return (
    <span className={`chip chip--${kind ?? "plain"}`} title={title}>
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Chip kind="tier" title="The highest tier any event of this session arrived at">
      tier {tier}
    </Chip>
  );
}

/** "12 s ago", ticking. */
export function Ago({ iso, prefix }: { iso: string | undefined; prefix?: string }) {
  const now = useNow();
  if (!iso) return null;
  return (
    <time dateTime={iso} className="num" title={new Date(iso).toLocaleString()}>
      {prefix}
      {ago(iso, now)}
    </time>
  );
}

/** Elapsed since an instant, ticking: "4 m 12 s"; `coarse` drops the seconds past a minute. */
export function Since({ iso, coarse = false }: { iso: string | undefined; coarse?: boolean }) {
  const now = useNow();
  if (!iso) return null;
  return (
    <time dateTime={iso} className="num" title={new Date(iso).toLocaleString()}>
      {coarse ? durCoarse(now - ms(iso)) : since(iso, now)}
    </time>
  );
}

export function Spinner({ label = "running" }: { label?: string }) {
  return <span className="spinner" role="img" aria-label={label} />;
}

export function CopyButton({ text, label = "Copy", small = false }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setDone(true);
    }
  };
  return (
    <button
      type="button"
      className={`btn ${small ? "btn--sm" : ""} ${done ? "btn--done" : ""}`}
      onClick={copy}
      aria-live="polite"
    >
      {done ? "Copied" : label}
    </button>
  );
}

const REDACTED = /(\[redacted\])/gi;

/** Text with every `[redacted]` placeholder highlighted. */
export function Redacted({ text }: { text: string }) {
  if (!REDACTED.test(text)) return <>{text}</>;
  REDACTED.lastIndex = 0;
  const parts = text.split(REDACTED);
  return (
    <>
      {parts.map((p, i) =>
        REDACTED.test(p) ? (
          <mark key={i} title="Removed on the sending machine by the secrets ruleset">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <span className="search-icon" aria-hidden="true">
        ⌕
      </span>
      <input
        data-search
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        enterKeyHint="search"
      />
      <kbd title="Press / to search">/</kbd>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <fieldset className="seg">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={String(o.value)} className={`seg-opt ${o.value === value ? "seg-on" : ""}`} title={o.title}>
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

/** A select rendered as a chip. */
export function ChipSelect({
  value,
  options,
  onChange,
  all,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  all: string;
  label: string;
}) {
  if (options.length === 0) return null;
  return (
    <label className={`chipsel ${value ? "chipsel-on" : ""}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="chipsel-text">{value || all}</span>
      <span aria-hidden="true" className="chipsel-caret">
        ▾
      </span>
    </label>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? "toggle-on" : ""}`}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <span className="toggle-knob" />
    </button>
  );
}
