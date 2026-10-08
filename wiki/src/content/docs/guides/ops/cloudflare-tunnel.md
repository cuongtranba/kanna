---
title: Cloudflare tunnel
description: Reach Kanna from anywhere through a Cloudflare tunnel, from a one-off share link to a permanent hostname on a pm2-managed checkout, plus the 403-on-login fix.
---

Kanna binds to `127.0.0.1` by default. A Cloudflare tunnel publishes it on HTTPS
without opening a port on your router. There are three ways to use one, from
quickest to most permanent.

## A temporary public link

```bash
kanna --share
kanna --share --port 4000
```

Kanna starts a `trycloudflare.com` quick tunnel and prints a QR code, the public
URL and the local URL. The link lasts as long as the process does. `--share`
cannot be combined with `--host` or `--remote`, and it does not open a browser.

Set a password whenever the URL is public: `kanna --share --password <secret>`.

## A named tunnel

Create a tunnel in the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/)
(**Networks → Tunnels → Create tunnel**, type **Cloudflared**), copy its
connector token, and add a public hostname that points at `http://localhost:3210`
(or the port you run Kanna on). Then:

```bash
kanna --cloudflared <token> --password <secret>
```

Kanna runs `cloudflared tunnel run --token <token>` for you and binds to
`127.0.0.1`, so the tunnel is the only way in. If it can read the public hostname
from cloudflared's output it prints the QR block; otherwise it keeps the tunnel
running and tells you to use the hostname you configured in Cloudflare.

Both `--share` and `--cloudflared` need the `cloudflared` binary
(`brew install cloudflared`, or see
[Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).

## A permanent install on macOS with pm2

This runs a git checkout of Kanna under pm2 behind a named tunnel, and makes the
in-app **Update** button pull, rebuild and reload it.

1. **Link the checkout as the global install.**

   ```bash
   cd ~/path/to/kanna
   bun install && bun run build
   bun link
   ```

2. **Create the named tunnel** as described above, pointing the hostname at
   `http://localhost:3210`.

3. **Write `scripts/pm2.env`** (gitignored) with the secrets the deploy script
   passes on as flags:

   ```bash
   KANNA_CLOUDFLARED_TOKEN=<connector token>
   KANNA_PASSWORD=<a long random password>   # openssl rand -base64 24
   ```

4. **Deploy.** `scripts/deploy.sh` installs pm2 if needed, renders the pm2
   config from `scripts/pm2.config.cjs.tmpl` (it needs `envsubst`, from
   `brew install gettext`), and starts the process:

   ```bash
   ./scripts/deploy.sh
   pm2 list
   pm2 logs kanna --lines 50
   ```

   Run `pm2 startup` once and then `pm2 save` to bring it back after a reboot.
   `KANNA_PM2_PROCESS_NAME` changes the process name if you run more than one.

5. **Update.** Press **Update** in the app, or run `git pull && ./scripts/deploy.sh`.
   The config sets `KANNA_RELOADER=pm2` and `KANNA_REPO_DIR`, so the button uses
   the git strategy described in [Self-update](/guides/ops/self-update/).

If you were running Kanna under launchd before, unload that agent first so pm2
can take over: `launchctl bootout gui/$(id -u)/io.silentium.kanna`.

## Troubleshooting: 403 on login

If the login page rejects the right password with **403** behind a tunnel, Kanna
is not trusting the proxy. Its CSRF check then compares the browser's
`https://` origin with the server's own `http://127.0.0.1` address and refuses
the mismatch.

- **Pass the tunnel to Kanna.** `--cloudflared <token>` and `--share` both turn
  on proxy trust. With the pm2 recipe, an empty `scripts/pm2.env` is the usual
  cause: check `pm2 logs kanna --lines 20` shows `--cloudflared` on the start
  line. A `cloudflared` daemon you run yourself does not turn it on, and there is
  no separate flag for it, so let Kanna start the tunnel.
- **Point the hostname at `http://`, not `https://`.** Kanna serves plain HTTP
  locally; Cloudflare terminates TLS.
- **Check the TLS mode** is Full or Flexible, not Full (strict) against a local
  origin.
- **Check for an Access policy** rewriting or stripping the `Origin` header.
