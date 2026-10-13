---
target: c3-110
scope: block
base: c3-110#n10489@v1:sha256:5aa60d1f8f6e07bb8f14e51be8c126642908eed607e1134e290138a12bed6042
---
| Mounted <Routes> | OUT | Every workspace route mounts WorkspacePage: chat, board, and each top-level page (projects, settings, cron, workflows, boards), so opening a page adds or focuses a workspace tab instead of unmounting the workspace. Page params reach the page as props from its tab, never from the URL | c3-104, c3-112, c3-116, c3-117 | src/client/app/App.tsx |
