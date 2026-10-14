// SPDX-License-Identifier: Apache-2.0
// The mark and the wordmark, drawn live from the tokens so they follow the theme:
// the tile is the foreground, the desk the background, the dot the one accent. The
// geometry is the 16-unit grid of web/public/brand/mark.svg (docs/brand.md); the
// wordmark here is set in the UI face, the SVG file in Inter is for places without CSS.

export function Mark({ size = 16 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="4" fill="var(--fg)" />
      <rect x="3" y="8" width="5" height="2" rx="1" fill="var(--bg)" />
      <rect x="3" y="11" width="10" height="2" rx="1" fill="var(--bg)" />
      <circle cx="11" cy="5" r="2" fill="var(--needs)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={20} />
      <span className="wordmark-text">
        sessionpipe <span className="wordmark-gui">gui</span>
      </span>
    </span>
  );
}
