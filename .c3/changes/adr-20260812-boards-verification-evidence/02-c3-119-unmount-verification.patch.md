---
target: c3-119
scope: block
base: c3-119#n8523@v1:sha256:e458090f6799757de3a3481c6f3303948729815c8fb9e71bb3522c059e06cddf
---
| Unmounted root leak | A board test mounts a portal-opening component without unmounting its root | The preload sweep fails the test that leaked | bun test --conditions production src/client/components/boards/CardDrawer.test.tsx |
