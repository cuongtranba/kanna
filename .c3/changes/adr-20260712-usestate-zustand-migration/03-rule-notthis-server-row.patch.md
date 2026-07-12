---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n8574@v1:sha256:4ecfdeb908793f6a7b598cc22bf840aa5498d82a49bf6bd1bbfe6ecb92c15cfd
---
| Feature store holds its own copy of a server snapshot (chats: ChatSnapshot[]) | Server snapshots live only in the WS-fed kannaStateStore, written by the useKannaState socket pipeline | Two sources of truth diverge; socket reconnect overwrites the copy mid-edit |
