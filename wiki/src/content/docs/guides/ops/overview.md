---
title: Ops Overview
description: Self-host Kanna under pm2, systemd, docker, or plain shell.
---

Kanna is a single Bun process listening on `:3210` (configurable via `KANNA_PORT`). Self-hosting choices:

- [Self-host basics](/guides/ops/self-host/) — env vars, persistence, ports
- [pm2](/guides/ops/pm2/) — recommended for VPS deployments
- [systemd](/guides/ops/systemd/) — long-running service on Linux
- [docker](/guides/ops/docker/) — containerised deployment
- [OAuth pool admin](/guides/ops/oauth-pool-admin/) — managing tokens at scale
- [Sandboxing](/guides/ops/sandboxing/) — toggle and tune the PTY sandbox

For env var reference see [Reference → Env Vars](/reference/env-vars/).
