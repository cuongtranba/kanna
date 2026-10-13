---
target: c3-112
scope: block
base: c3-112#n10596@v1:sha256:9fbf541a6663e76b20c74a29e86b2b258f12d01c102b9578d71585a9c799b709
---
| <WorkspacePage> route component | OUT | One page mounted at /chat/:chatId, /boards/:projectId/:boardId and every top-level page route (/, /settings/:sectionId, /cron, /workflows/:chatId, /boards/:projectId, /boards/stack/:stackId); the route opens its tab and the render gate is whether the workspace has tabs, so no route is privileged and none needs a chat to exist | c3-110 | src/client/app/ChatPage/index.tsx |
