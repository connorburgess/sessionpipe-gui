// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. The mark for server-rendered pages (the trust page, the 401
// page), inline so it needs no file the page may not be allowed to fetch. Same geometry
// as web/public/brand/mark.svg; the colours are the page's own --fg, --bg and --needs.

/** The mark as an inline SVG, `size` px square. */
export const markSvg = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="4" fill="var(--fg)"/><rect x="3" y="8" width="5" height="2" rx="1" fill="var(--bg)"/><rect x="3" y="11" width="10" height="2" rx="1" fill="var(--bg)"/><circle cx="11" cy="5" r="2" fill="var(--needs)"/></svg>`;

/** Mark and name, for a page header. Needs `.wordmark` styles from WORDMARK_CSS. */
export const wordmarkHtml = (): string =>
  `<span class="wordmark">${markSvg(20)}<span class="wordmark-text">sessionpipe <span class="wordmark-gui">gui</span></span></span>`;

export const WORDMARK_CSS =
  ".wordmark{display:inline-flex;align-items:center;gap:8px;color:var(--fg);font-size:15px;font-weight:500;line-height:1}.wordmark svg{flex:none}.wordmark-gui{color:var(--fg-3)}";
