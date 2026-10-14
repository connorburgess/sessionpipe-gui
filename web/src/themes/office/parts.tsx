// SPDX-License-Identifier: Apache-2.0
// The office's vector parts: <symbol>s defined once, placed with <use>. All of them live
// in the 96 × 80 desk cell grid (DESIGN.md §1, §3): desk top at y = 46.5, chair at the
// left, monitor centred at x = 61, the figure's hips at (18, 56). Colours are custom
// properties set on the cell (--o-tone, --o-wood, --o-bezel, --o-desk, --o-needs) that
// inherit into every <use>; a posture is a choice of parts and a tone, nothing more.

export const CELL_W = 96;
export const CELL_H = 80;
/** Where a standing figure's feet are, cell coordinates; the door is at the room's floor. */
export const FIGURE_X = 20;

export function OfficeDefs() {
  return (
    <svg className="office-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* chair, side on */}
        <symbol id="o-chair" overflow="visible">
          <rect x="8" y="36" width="3" height="22" rx="1.5" fill="var(--o-wood)" />
          <rect x="9" y="56" width="18" height="2.5" rx="1" fill="var(--o-wood)" />
          <rect x="17" y="58.5" width="2" height="11" fill="var(--o-wood)" />
          <rect x="11" y="69.5" width="14" height="2" rx="1" fill="var(--o-wood)" />
          <circle cx="13" cy="73.5" r="1.8" fill="var(--o-wood)" />
          <circle cx="23" cy="73.5" r="1.8" fill="var(--o-wood)" />
        </symbol>

        {/* desk: slab (text goes on its front), two legs, keyboard */}
        <symbol id="o-desk" overflow="visible">
          <rect x="30" y="54" width="2" height="20" fill="var(--o-wood)" />
          <rect x="86" y="54" width="2" height="20" fill="var(--o-wood)" />
          <rect
            x="28"
            y="46.5"
            width="62"
            height="8"
            rx="1"
            fill="var(--o-desk)"
            stroke="var(--o-wood)"
            strokeWidth="0.75"
          />
          <rect x="34" y="44.5" width="12" height="2" rx="0.8" fill="var(--o-wood)" />
        </symbol>

        {/* monitor frame; the screen rectangle is drawn by the cell so its fill can change */}
        <symbol id="o-monitor" overflow="visible">
          <rect x="55" y="45.3" width="12" height="1.2" fill="var(--o-wood)" />
          <rect x="60" y="43.5" width="2" height="2.5" fill="var(--o-wood)" />
          <rect
            x="46"
            y="20"
            width="30"
            height="24"
            rx="1.5"
            fill="var(--o-bezel)"
            stroke="var(--o-wood)"
            strokeWidth="0.75"
          />
        </symbol>

        {/* figure, side on, facing the screen: torso + head, legs under the desk */}
        <symbol id="o-torso-side" overflow="visible">
          <path d="M13 57 V43 a6 6 0 0 1 6 -6 h4 a5 5 0 0 1 5 5 V57 Z" fill="var(--o-tone)" />
          <rect x="18" y="33" width="5" height="6" fill="var(--o-tone)" />
          <circle cx="20.5" cy="30" r="6" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-legs-side" overflow="visible">
          <polyline
            points="24,57 36,57 37,70"
            fill="none"
            stroke="var(--o-tone)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="35" y="69" width="8" height="3.5" rx="1.5" fill="var(--o-tone)" />
        </symbol>

        {/* figure turned to the room: shoulders square on, legs in front of the chair */}
        <symbol id="o-torso-front" overflow="visible">
          <path d="M11 57 V45 a8 8 0 0 1 8 -8 h3 a8 8 0 0 1 8 8 V57 Z" fill="var(--o-tone)" />
          <rect x="18" y="33" width="5" height="6" fill="var(--o-tone)" />
          <circle cx="20.5" cy="30" r="6" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-legs-front" overflow="visible">
          <line x1="15.5" y1="56" x2="15.5" y2="70" stroke="var(--o-tone)" strokeWidth="4" strokeLinecap="round" />
          <line x1="25.5" y1="56" x2="25.5" y2="70" stroke="var(--o-tone)" strokeWidth="4" strokeLinecap="round" />
          <rect x="12.5" y="69" width="7" height="3.5" rx="1.5" fill="var(--o-tone)" />
          <rect x="22.5" y="69" width="7" height="3.5" rx="1.5" fill="var(--o-tone)" />
        </symbol>

        {/* arms: on the keys · raised (right) with the left down · both in the lap · hanging */}
        <symbol id="o-arm-type" overflow="visible">
          <polyline
            points="25,42 33,47 40,45.5"
            fill="none"
            stroke="var(--o-tone)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="40" cy="45.5" r="2" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-arm-raise" overflow="visible">
          <polyline
            points="28,42 34,35 35,25"
            fill="none"
            stroke="var(--o-tone)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="35" cy="24" r="2.2" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-arm-left-down" overflow="visible">
          <polyline points="13,43 12,54" fill="none" stroke="var(--o-tone)" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="12" cy="55" r="2" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-arm-lap" overflow="visible">
          <polyline points="13,43 14,54" fill="none" stroke="var(--o-tone)" strokeWidth="3.5" strokeLinecap="round" />
          <polyline points="28,43 27,54" fill="none" stroke="var(--o-tone)" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="15" cy="55" r="2" fill="var(--o-tone)" />
          <circle cx="26" cy="55" r="2" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-arm-rest" overflow="visible">
          <polyline points="25,42 27,52" fill="none" stroke="var(--o-tone)" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="27" cy="53" r="2" fill="var(--o-tone)" />
        </symbol>

        {/* desk lamp at the right end; the head is outlined when off and takes --o-needs when on */}
        <symbol id="o-lamp" overflow="visible">
          <rect x="83" y="44.5" width="7" height="2" rx="1" fill="var(--o-wood)" />
          <rect x="85.75" y="18" width="1.5" height="26.5" fill="var(--o-wood)" />
          <line x1="86.5" y1="19" x2="80" y2="15" stroke="var(--o-wood)" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M73 12 h10 l3.5 6 h-17 z"
            fill="var(--o-bezel)"
            stroke="var(--o-wood)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </symbol>
        <symbol id="o-lamp-on" overflow="visible">
          <path
            d="M73 12 h10 l3.5 6 h-17 z"
            fill="var(--o-needs)"
            stroke="var(--o-needs)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </symbol>

        {/* an error sheet on the desk corner, 6 × 4 */}
        <symbol id="o-sheet" overflow="visible">
          <rect
            x="0"
            y="0"
            width="6"
            height="4"
            rx="0.5"
            fill="var(--o-sheet)"
            stroke="var(--o-wood)"
            strokeWidth="0.6"
          />
        </symbol>

        {/* a helper (subagent) standing: 5 wide, 16 tall, feet at y = 16 */}
        <symbol id="o-helper" overflow="visible">
          <circle cx="2.5" cy="2.1" r="2.1" fill="var(--o-tone)" />
          <rect x="0.6" y="4.5" width="3.8" height="7" rx="1.9" fill="var(--o-tone)" />
          <line x1="1.5" y1="11.5" x2="1.5" y2="16" stroke="var(--o-tone)" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="3.5" y1="11.5" x2="3.5" y2="16" stroke="var(--o-tone)" strokeWidth="1.6" strokeLinecap="round" />
        </symbol>
        <symbol id="o-helper-raise" overflow="visible">
          <line x1="4" y1="5.5" x2="5.8" y2="1" stroke="var(--o-tone)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="6" cy="-0.8" r="1" fill="var(--o-needs)" />
        </symbol>

        {/* a standing figure for the walk: body plus two leg frames */}
        <symbol id="o-stand" overflow="visible">
          <circle cx="20.5" cy="33" r="6" fill="var(--o-tone)" />
          <rect x="18" y="36" width="5" height="6" fill="var(--o-tone)" />
          <path d="M14 58 V46 a6.5 6.5 0 0 1 6.5 -6.5 a6.5 6.5 0 0 1 6.5 6.5 V58 Z" fill="var(--o-tone)" />
        </symbol>
        <symbol id="o-legs-a" overflow="visible">
          <line x1="17.5" y1="57" x2="15" y2="72" stroke="var(--o-tone)" strokeWidth="4" strokeLinecap="round" />
          <line x1="23.5" y1="57" x2="26.5" y2="72" stroke="var(--o-tone)" strokeWidth="4" strokeLinecap="round" />
        </symbol>
        <symbol id="o-legs-b" overflow="visible">
          <line x1="17.5" y1="57" x2="19.5" y2="72" stroke="var(--o-tone)" strokeWidth="4" strokeLinecap="round" />
          <line x1="23.5" y1="57" x2="21.5" y2="72" stroke="var(--o-tone)" strokeWidth="4" strokeLinecap="round" />
        </symbol>
      </defs>
    </svg>
  );
}
