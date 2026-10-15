# Releasing sessionpipe-gui

One npm package, `sessionpipe-gui`, published from a `v*` tag by GitHub Actions through
npm trusted publishing (no token anywhere), with provenance. The package carries Canvas
and Office, bundled at build time from a checkout of
[sessionpipe-gui-themes](https://github.com/spacesheep-dev/sessionpipe-gui-themes) beside
this one; the other extras install from npm, so **release the themes repo first** (its
`RELEASING.md`, which also settles the `@sessionpipe-gui/*` scope).

## One-time setup

1. **The first publish is by hand.** Trusted publishing cannot create a package that does
   not exist yet, so 0.1.0 goes up from a laptop, with the themes repo cloned beside this
   one and built:
   ```sh
   git clone https://github.com/spacesheep-dev/sessionpipe-gui-themes ../sessionpipe-gui-themes
   (cd ../sessionpipe-gui-themes && nvm use && npm ci && npm run build)
   nvm use && npm ci
   npm login                              # the owner's account (2FA on)
   npm publish --access public            # prepublishOnly runs build:release (bundle required) first
   npm run pack:check                     # what went up: no .map, bundled views in, ~500 kB
   ```
   `npm publish` refuses to run when `../sessionpipe-gui-themes` is missing or a view's
   build fails; `SPGUI_NO_BUNDLE=1 npm publish` ships without the views on purpose.
2. **Trusted publisher.** On npmjs.com, *sessionpipe-gui → Settings → Trusted Publisher →
   GitHub Actions*: organisation `spacesheep-dev`, repository `sessionpipe-gui`, workflow
   filename `release.yml`, environment `npm`. Save.
3. **The GitHub environment.** Repo *Settings → Environments → New environment* `npm`;
   a required reviewer if each release should wait for a click, otherwise empty.
4. Optionally the repository variable `THEMES_REF` (*Settings → Variables*), a tag of the
   themes repo to bundle from (`v0.1.0`); unset, the workflow bundles its `main`.
5. The repo is private today; the release workflow works either way. Make it public before
   the first `npx` so the README's screenshot links (raw.githubusercontent.com) resolve.

No `NPM_TOKEN` secret is needed or read; delete one if it exists.

## Each release

1. `main` green; `CHANGELOG.md` has a `## [X.Y.Z] - date` section (the *Unreleased* lines
   move under it; the compare links at the bottom get the new version). If a catalogue
   size changed (`server/extensions/catalog.ts`), fix it.
2. The themes repo released at the version the catalogue names (or `THEMES_REF` set).
3. Version, tag, push:
   ```sh
   npm version minor -m "Release %s"      # package.json + lock, a signed-off commit, the tag v0.2.0
   git push && git push --tags
   ```
   (`npm version` needs a clean tree; `-s` sign-off: set `git config commit.gpgsign` as
   usual and add `-s` through `npm version --sign-git-commit` or amend.)
4. The tag runs `.github/workflows/release.yml`: version check, both `npm ci`, typecheck,
   lint, vitest, `build:release`, `pack:check`, `npm publish --provenance`, then a GitHub
   Release with the changelog section and the tarball attached. A failed run can be
   re-run once the cause is fixed; npm refuses a second publish of the same version, so
   bump the patch and tag again if the publish step itself was the one that succeeded.

## The install smoke test

Before announcing, on any machine (never the receiver on :7373 you are using):

```sh
npm pack sessionpipe-gui@latest                     # or the local tarball from `npm pack`
npm i -g --prefix /tmp/x ./sessionpipe-gui-0.1.0.tgz
/tmp/x/bin/sessionpipe-gui --version                # 0.1.0
/tmp/x/bin/sessionpipe-gui --help | grep extras     # the subcommand is there
/tmp/x/bin/sessionpipe-gui --state /tmp/spgui-smoke --port 7399 --no-outbox --quiet &
curl -s http://localhost:7399/api/ui/themes | grep -o '"id":"\(canvas\|office\)"'   # both bundled views
curl -s http://localhost:7399/api/ui/extras | grep -o '"installed":true' | wc -l    # 2 (the bundled ones)
/tmp/x/bin/sessionpipe-gui --state /tmp/spgui-smoke extras add all                  # the three from npm
kill %1; rm -rf /tmp/x /tmp/spgui-smoke
```

With `npx`: `npx sessionpipe-gui@0.1.0 --version` from a directory with no package.json.
On an old Node the first line must read `sessionpipe-gui needs Node 20 or newer (you have v18.x)`.
