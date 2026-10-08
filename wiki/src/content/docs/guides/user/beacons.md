---
title: Beacons — pair a machine
description: Install the kanna-beacon daemon, pair it with Kanna, grant it scope, and revoke it.
---

A **beacon** is a small companion daemon you install on a machine **you own**.
It dials out to your Kanna server, and lets the agent read files, and
optionally run commands, on that machine — inside limits you set. This replaces
the manual browser upload step when you reach Kanna over a Cloudflare tunnel
and your files live on another computer.

A beacon is **not remote control**. It does nothing until you pair it, it can
touch nothing you have not granted, and you can revoke it at any time.

## Prerequisite: set a Kanna password

Beacons work **only on a Kanna install that has a password set**. Without one,
pairing is refused and the server rejects every beacon connection. A beacon can
run commands on your machine, so whoever can sign into Kanna is trusted with
that power; a password is the minimum bar for that.

Set the password in Settings before you begin.

## Install

Pick one:

- **Installer script** (macOS and Linux):

  ```sh
  curl -fsSL https://raw.githubusercontent.com/cuongtranba/kanna/main/scripts/install-beacon.sh | sh
  ```

  It downloads the right binary from the latest GitHub release, verifies it
  against the release `SHA256SUMS`, and installs `kanna-beacon` into
  `~/.local/bin`. Set `KANNA_BEACON_VERSION`, `KANNA_BEACON_REPO` or
  `KANNA_BEACON_BIN_DIR` to override the release, source repo or install
  directory. If `~/.local/bin` is not on your `PATH`, add it or run the binary
  by its full path.

- **Download by hand** from the release page: `kanna-beacon-darwin-arm64`,
  `kanna-beacon-darwin-x64`, `kanna-beacon-linux-x64`, `kanna-beacon-linux-arm64`
  or `kanna-beacon-windows-x64.exe`, together with `SHA256SUMS`. Verify the
  checksum, rename the file to `kanna-beacon`, and mark it executable.

### macOS first run (Gatekeeper)

Phase 1 binaries are **not code-signed or notarized**, so macOS may refuse to
open a downloaded copy ("cannot be opened because the developer cannot be
verified"). The installer script downloads with `curl`, which normally avoids
the quarantine flag. If you downloaded the file in a browser, either:

- run `xattr -d com.apple.quarantine /path/to/kanna-beacon`, or
- try to open it once, then allow it under System Settings → Privacy & Security
  → "Open Anyway".

Only do this for a binary you downloaded from the official release and
checked against `SHA256SUMS`.

## Pair

1. In Kanna, open **Settings → Beacons** and choose **Pair a machine**. Kanna
   shows a short-lived one-time code with a countdown.
2. On the machine you are pairing, run the command Kanna shows (use **Copy
   command**):

   ```sh
   kanna-beacon pair <kanna-url> <code>
   ```

3. Start the daemon with `kanna-beacon run`. The machine appears under Beacons
   as **Online**.

The code works once and expires; if it lapses, mint a new one. Pairing stores a
private key on that machine. From then on the beacon proves who it is by
signing a challenge from the server, so there is no shared password to leak.

## Grant scope

A freshly paired beacon can do **nothing**. Scope is default-deny, and you
widen it per machine from **Settings → Beacons → Scope**:

| Setting | Effect |
| --- | --- |
| Folders the agent may read (`readRoots`) | The only directories the agent can read, list, search or fetch from. Anything outside is denied. Empty means no file access at all. |
| Allow running commands (`exec`) | Off by default. Until it is on, the agent cannot run commands or scripts on this machine. |
| Commands that always run without asking (`execAllowlist`) | With exec on, a command whose name is listed here runs immediately. Any other command asks you first. |
| Run commands and scripts from this chat without asking each time (`autoRunScripts`) | Removes the per-call approval prompt: reads inside your folders and any command you have enabled run immediately. |

Everything that is allowed but not pre-approved raises an approval prompt in
the chat, so you see what is about to run before it does.

### The auto-run consent

`autoRunScripts` is the one setting that takes the human out of the loop, so
treat turning it on as a one-time, informed consent: you are telling Kanna that
the agent may read inside your folders and run enabled commands and scripts on
**that machine** without asking each time, and that anyone who can sign into
your Kanna can do the same there (which is why a password is required). The
flag is **off by default** and **per machine**, so a beacon paired through the
bare CLI asks before every run until you turn it on. The transcript still
records every run, and turning the setting off withdraws the consent.

## Revoke

In **Settings → Beacons**, use **Revoke** on a machine. Kanna confirms, then the
agent loses access immediately and the machine must be paired again to come
back. To remove the daemon from the machine itself, delete the `kanna-beacon`
binary and its stored state.

## Troubleshooting

- **Pairing is refused** — no Kanna password is set. Set one first.
- **Code expired** — mint a new one; codes are single-use and short-lived.
- **Machine shows Offline** — check that `kanna-beacon run` is running and the
  Kanna URL is reachable from that machine.
- **Update available badge** — install a newer `kanna-beacon`; the daemon and
  server must speak a compatible protocol version, and an incompatible daemon
  exits rather than run.
