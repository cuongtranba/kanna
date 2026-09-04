---
title: Deploy with Docker
description: Container deployment.
---

## Dockerfile (minimal)

```dockerfile
FROM oven/bun:1
RUN bun install -g @cuongtran001/kanna

# Kanna's data directory is always $HOME/.kanna — it is not configurable by a
# flag or an env var, so the volume has to be mounted where HOME points.
ENV HOME=/data
WORKDIR /data
VOLUME ["/data"]

EXPOSE 3210
CMD ["kanna", "--remote", "--no-open"]
```

:::caution[`KANNA_HOME` does not exist]
Older guides — including earlier versions of this page — told you to set
`ENV KANNA_HOME=/data`. Kanna never read that variable, so the container wrote
its chats to the image's own `$HOME` and lost every one of them on restart. Set
`HOME` instead, as above.
:::

## Build + run

```bash
docker build -t kanna .
docker run -d \
  --name kanna \
  -p 3210:3210 \
  -v kanna-data:/data \
  kanna --remote --no-open --password changeme
```

The password is a **CLI flag**, not an `-e` variable. Anything after the image
name is appended to `CMD`.

## Check the volume is actually being used

Worth doing once, because the failure mode is silent — the app works fine until
the container is replaced:

```bash
docker exec kanna ls /data/.kanna/data
```

You should see `settings.json` and the chat directories. An empty or missing
path means `HOME` is not pointing at the mount.

## The agent runs inside the container

Kanna spawns the `claude` / `codex` CLIs as subprocesses, and they inherit the
container's filesystem and `HOME`. So a containerised install needs those CLIs
present in the image, and the repositories you want to work on mounted in. It is
the same trade-off as any dev-container setup — the agent can only see what the
container can see.
