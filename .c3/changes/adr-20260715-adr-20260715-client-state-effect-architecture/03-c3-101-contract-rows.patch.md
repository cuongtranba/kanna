---
target: c3-101
scope: insert
base: c3-101#n5597@v1:sha256:829038d662a343b69565b108508ee9a7fa028184c56779835c0608e95718e6e0
---
| SocketBridge | IN | Mounts useWebSocket (react-use-websocket) with filter:()=>false+onMessage; writes sendMessage+readyState into socketStore | c3-110 | src/client/app/SocketBridge.tsx |
| socketStore.sendMessage | OUT | Stable send function for outbound frames; called by protocol actions to dispatch WS commands | c3-110 | src/client/stores/socketStore.ts |
