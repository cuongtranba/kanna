---
title: Deploy with Docker
description: Container deployment.
---

## Dockerfile (minimal)

```dockerfile
FROM oven/bun:1
WORKDIR /app
RUN bun install -g @cuongtran001/kanna
ENV KANNA_HOME=/data
VOLUME ["/data"]
EXPOSE 3210
CMD ["kanna"]
```

## Build + run

```bash
docker build -t kanna .
docker run -d \
  --name kanna \
  -p 3210:3210 \
  -e KANNA_PASSWORD=changeme \
  -v kanna-data:/data \
  kanna
```

## Important: PTY mode requires host kernel access

PTY mode + sandbox (`sandbox-exec` on macOS, `bwrap` on Linux) need privileged host access. If you must run PTY in a container, run with `--privileged` or `--cap-add=SYS_ADMIN` and mount `/dev`. Otherwise stick to SDK mode (`KANNA_CLAUDE_DRIVER=sdk`, the default).
