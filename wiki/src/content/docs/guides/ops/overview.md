---
title: Ops Overview
description: Self-host Kanna under pm2, systemd, docker, or plain shell.
---

Kanna is a single Bun process listening on `:3210` (change it with `--port`).
Self-hosting choices:

- [Self-host basics](/guides/ops/self-host/) — CLI flags, persistence, ports
- [pm2](/guides/ops/pm2/) — recommended for VPS deployments
- [systemd](/guides/ops/systemd/) — long-running service on Linux
- [docker](/guides/ops/docker/) — containerised deployment
- [OAuth pool admin](/guides/ops/oauth-pool-admin/) — managing tokens at scale

Start with **Self-host basics**: port, password and the data directory are not
configured the way most guides on the internet assume.

For the env var reference see [Reference → Env Vars](/reference/env-vars/).
