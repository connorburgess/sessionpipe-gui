# Screenshots

Every image the README shows, all from **demo data** (`--demo`), never from a real state
dir: no real session, token or address of anyone's ever lands here. Dark, the Spacesheep
skin, 1440 × 900 at 2× for the desktop shots and 390 × 844 at 3× for the phone shots.

| File | Page | How it is set up |
|---|---|---|
| `board.png` | `/` | Advanced mode, a card in every group, done collapsed |
| `board.gif` | `/` | Six seconds of the board updating live (made only when `ffmpeg` is present) |
| `setup.png` | `/setup` | From the receiver machine; the live steps as they stand on a fresh state dir |
| `session-simple.png` | `/s/…` | Simple mode: the chat, a composer at the bottom |
| `session-advanced.png` | `/s/…` | Advanced mode: the timeline of the same session |
| `inbox.png` | `/inbox` | At least one answerable prompt and one waiting in a terminal |
| `canvas.png` | `/t/canvas` | The canvas view with the Map on, after Tidy and Fit |
| `office.png` | `/t/office` | The office view, iso style |
| `review.png` | `/review` | A search with hits, the Files tab below |
| `connect.png` | `/connect` | The QR code loaded; the sink token in its **masked** state |
| `appearance.png` | any | The appearance popover open, Spacesheep selected |
| `keyboard.png` | any | The `?` help open |
| `phone-trust.png` | `/trust` | The TLS instance's trust page, on the phone viewport |
| `phone-board.png`, `phone-session.png` | `/`, `/s/…` | The phone viewport, Simple mode |

The themes repo's shots (`sessionpipe-gui-themes/docs/screenshots/`: `canvas.png`,
`office-iso.png`, `office-figures.png`, `spacesheep-vivid-dark.png`, `ping-a-human.png`)
are taken in the same run, from the same server.

## Regenerating

1. Build both repos from a clean tree:

   ```sh
   node scripts/build.mjs && npx vite build --config web/vite.config.ts
   (cd ../sessionpipe-gui-themes && npm run build)
   ```

2. Start two throwaway servers on free ports (never a port someone is running the GUI on;
   the e2e suite owns 7311 and 7312) against a scratch state dir, and link the packages
   from the themes repo into that state:

   ```sh
   STATE=$(mktemp -d)
   node dist/cli.js --state "$STATE" view link ../sessionpipe-gui-themes/packages/canvas
   node dist/cli.js --state "$STATE" view link ../sessionpipe-gui-themes/packages/office
   node dist/cli.js --state "$STATE" plugin link ../sessionpipe-gui-themes/packages/plugin-ping-a-human
   mkdir -p "$STATE/color-themes" && cp ../sessionpipe-gui-themes/packages/color-themes/*.json "$STATE/color-themes/"
   node dist/cli.js --port 7391 --state "$STATE" --no-outbox --demo --speed 10 --quiet &
   node dist/cli.js --port 7392 --state "$STATE-tls" --no-outbox --tls --rp-id localhost --quiet &
   ```

   The demo is deterministic (the same seed gives the same team), and `--speed 10` gets
   every state onto the board within a minute or two. The second instance exists only for
   the trust page; `--rp-id localhost` because the headless browser cannot resolve this
   machine's `.local` name.

3. Shoot with the script in this folder, which drives Chromium through the repo's
   `@playwright/test` dependency and writes straight here:

   ```sh
   node docs/screenshots/shoot.mjs --base http://127.0.0.1:7391 --tls https://localhost:7392 \
     --themes ../sessionpipe-gui-themes/docs/screenshots
   ```

   It sets Advanced or Simple mode and the skin through `localStorage` before each page,
   waits for the stream to read `live` and for the elements each shot needs, disables CSS
   animations for the capture, and records the video the GIF is cut from. The GIF is made
   with `ffmpeg` (palette pass, then `paletteuse`, 960 px wide, 10 fps) and skipped when
   `ffmpeg` is not installed.

4. Look at every image before committing it. Then, if `pngquant` is installed:

   ```sh
   pngquant --ext .png --force --quality 70-90 docs/screenshots/*.png
   ```

   Keep each PNG under 600 KB and the folder under 8 MB; the GIF under 2 MB. Delete a
   shot the README no longer shows rather than leave it in the folder.

5. Stop the throwaway servers and remove the scratch state dir.

`test/e2e/screenshots.spec.ts` is the older, smaller set the e2e suite can write with
`SHOTS=1`; this folder's script supersedes it for the README.
