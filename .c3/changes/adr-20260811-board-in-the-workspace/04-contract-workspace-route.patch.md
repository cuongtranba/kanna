---
target: c3-112
scope: block
base: c3-112#n7889@v1:sha256:e9a6e02f66d5d9eafcb2fe91026b875959324a7f725ed4c9aafca9ff138629b8
---
| <WorkspacePage> route component | OUT | One page mounted at both /chat/:chatId and /boards/:projectId/:boardId; the route param opens its tab and the render gate is whether the workspace has tabs, so neither route is privileged and neither needs a chat to exist | c3-110 | src/client/app/ChatPage/index.tsx |
