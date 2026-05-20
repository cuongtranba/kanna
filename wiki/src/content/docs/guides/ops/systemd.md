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
Environment=KANNA_PORT=3210
Environment=KANNA_PASSWORD=changeme
Environment=KANNA_HOME=/var/lib/kanna
ExecStart=/usr/local/bin/kanna
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

The host-agnostic supervisor detects systemd and triggers `systemctl restart kanna` after pulling new code.
