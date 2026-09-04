---
title: Deploy with systemd
description: systemd unit for long-running Kanna.
---

## Unit file

`/etc/systemd/system/kanna.service`:

```ini
[Unit]
Description=Kanna
After=network.target

[Service]
Type=simple
User=kanna

# The data directory is always $HOME/.kanna and is not configurable directly,
# so point HOME at where you want state to live. systemd does not set HOME
# from User= on its own.
Environment=HOME=/var/lib/kanna

# Port and password are CLI flags — there is no KANNA_PORT / KANNA_PASSWORD.
ExecStart=/usr/local/bin/kanna --port 3210 --password changeme --no-open
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Enable + start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kanna
sudo systemctl status kanna
```

## Logs

```bash
journalctl -u kanna -f
```

## Self-update under systemd

Nothing to configure. The `kanna` command is a small **supervisor** that runs
the server as a child process: on a self-update the child installs the new
version and exits with a restart code, and the supervisor re-spawns it in
place. The process systemd is watching never exits, so `systemctl` is never
involved and no `Restart=` tuning is needed for updates.

`Restart=on-failure` above is there for genuine crashes.

