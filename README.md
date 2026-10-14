# sessionpipe-gui

**The sessionpipe GUI.** A local receiver with a live board for every coding-agent
session on your machines — Claude Code, Codex, Gemini CLI, Antigravity and the rest —
open from your laptop or any phone on your network.

```sh
npx sessionpipe-gui
```

That starts the receiver on port 7373, tails this machine's sessionpipe outbox (no sink
to configure), prints a QR code for your phone, and the one line that connects another
machine:

```sh
sessionpipe sink add http://192.168.1.21:7373 --tier 3 --token spg_…
```

Status: **pre-release**. Built against [sessionpipe](https://github.com/spacesheep-dev/sessionpipe)
protocol v1. Apache-2.0; see [ARCHITECTURE.md](ARCHITECTURE.md).
