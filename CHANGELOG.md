# Changelog

All notable changes to `sessionpipe-gui`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (`0.x`: anything may change between minors).

## [Unreleased]

## [0.1.0] - 2026-10-15

The first public release: a sessionpipe receiver with a face.

### Added

- **Receiver.** The sessionpipe HTTP binding (`/.well-known/sessionpipe`,
  `POST /api/sessionpipe/v1/events`) at every tier up to 3, with a bearer sink token;
  the local outbox tailed with zero configuration; `--demo` synthetic sessions and
  `--replay file.jsonl`. Scores 100 % on the upstream delivery conformance fixtures.
- **Store.** Append-only JSONL per session under `~/.local/state/sessionpipe-gui/`, an
  in-memory index rebuilt at boot, slim previews with the full event read back from disk
  by offset; `--keep-days`; *Forget* and `session.forgotten`.
- **Board, Session, Feed, Machines, Inbox, Review, Connect.** States `needs_you`,
  `working`, `stale`, `idle`, `done`; flags (slow tool, error streak, loop, compactions,
  sequence gap); Simple and Advanced modes; the tier lens; a split panel; the command
  palette; keyboard help and rebinding with vim and emacs presets; notifications, sounds
  and the installed-app badge.
- **Control.** A full control-channel receiver: pairing with six digits and a passkey,
  day keys, message, permission answer, stop, new session, images in the composer,
  `/add-device` for a phone, suggestions from plugins confirmed with a passkey.
- **TLS.** `--tls`: a local CA and certificate for `<machine>.local`, `localhost` and the
  LAN addresses, one port speaking both protocols, a trust page for phones.
- **Setup.** `/setup`: five live-detected steps for a first run.
- **Extensions.** Views (ES modules with `ThemeApi`), skins (tokens, fonts, shape, an
  optional stylesheet) and plugins (server-side, `PluginApi`), installed from a folder,
  archive, npm package or git URL; Canvas and Office bundled from
  `sessionpipe-gui-themes`; six built-in skins with Spacesheep as the default.
- **Extras.** `sessionpipe-gui extras list|add <id|all>`: the curated catalogue of
  official views, skins and plugins (Spacesheep Vivid, Paper Serif, ping-a-human; Canvas
  and Office marked bundled), installed from npm with the same installer; the same list
  with one-click buttons on the Views page (receiver machine only), and a line on the
  setup page pointing at it.
- **Packaging.** `npx sessionpipe-gui` / `npm i -g sessionpipe-gui`; `prepublishOnly`
  builds with the bundled views required; no source maps in the tarball; a plain
  "needs Node 20 or newer" instead of a stack trace on an old Node; releases published
  from a `v*` tag by GitHub Actions with npm provenance (RELEASING.md).
- **Phone.** The QR code with the UI key, a responsive layout, a PWA manifest and
  service worker.

[Unreleased]: https://github.com/spacesheep-dev/sessionpipe-gui/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/spacesheep-dev/sessionpipe-gui/releases/tag/v0.1.0
