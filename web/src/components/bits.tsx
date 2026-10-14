// SPDX-License-Identifier: Apache-2.0
// Small shared pieces: state marks, harness monograms, chips, ticking times, spinner,
// copy button, redaction highlighting, search input, segmented control.
import type { SessionState, Tier } from "@shared/api";
import { type ReactNode, useEffect, useId, useState } from "react";
import { harnessMark, STATE_HINT, STATE_LABEL } from "../lib/format";
import { HARNESS_ICONS } from "../lib/harnessIcons";
import { ago, durCoarse, ms, since, useNow } from "../lib/time";

/** `decorative` when the state's word is already visible beside it. */
export function StateDot({
  state,
  size = 6,
  decorative = false,
}: {
  state: SessionState;
  size?: number;
  decorative?: boolean;
}) {
  const style = { width: size, height: size };
  if (decorative) return <span className={`dot dot--${state}`} style={style} aria-hidden="true" />;
  return (
    <span
      className={`dot dot--${state}`}
      style={style}
      role="img"
      aria-label={STATE_LABEL[state]}
      title={STATE_HINT[state]}
    />
  );
}

/** "● working · 12 s": the state as text, no box. */
export function StateBadge({ state, since: sinceIso }: { state: SessionState; since?: string }) {
  const now = useNow();
  return (
    <span className={`badge badge--${state}`} title={STATE_HINT[state]}>
      <StateDot state={state} decorative />
      {STATE_LABEL[state]}
      {sinceIso && <span className="badge-since num">{since(sinceIso, now)}</span>}
    </span>
  );
}

/** The harness as a small monochrome mark (lib/harnessIcons.ts): 14 px beside text
 *  (`sm`), 16 px in a header (`md`). A harness without a mark keeps its two-letter
 *  monogram, "Cl", "Cx". */
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
  const icon = HARNESS_ICONS[name];
  const px = size === "sm" ? 14 : size === "md" ? 16 : 18;
  return (
    <span className={`glyph-wrap ${withLabel ? "glyph-wrap--label" : ""}`} title={m.label}>
      {icon ? (
        <svg
          className={`glyph glyph--${size} glyph--icon`}
          width={px}
          height={px}
          viewBox={icon.viewBox}
          role="img"
          aria-label={m.label}
        >
          <path fill="currentColor" d={icon.path} />
        </svg>
      ) : (
        <span className={`glyph glyph--${size}`} aria-hidden="true">
          {m.glyph}
        </span>
      )}
      {withLabel ? (
        <span className="glyph-label">{m.label}</span>
      ) : icon ? null : (
        <span className="sr-only">{m.label}</span>
      )}
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
      <svg className="search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
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
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="seg" disabled={disabled}>
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

/** A select rendered as quiet text with a caret. */
export function ChipSelect({
  value,
  options,
  onChange,
  all,
  label,
  optionLabel = (o) => o,
  icon,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  all: string;
  label: string;
  /** What an option is called; the value stays the raw id. */
  optionLabel?: (o: string) => string;
  /** Drawn before the chosen option's name in the chip (a native select has no icons). */
  icon?: (o: string) => ReactNode;
}) {
  if (options.length === 0) return null;
  return (
    <label className={`chipsel ${value ? "chipsel-on" : ""}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
      {value && icon ? icon(value) : null}
      <span className="chipsel-text ellipsis">{value ? optionLabel(value) : all}</span>
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
