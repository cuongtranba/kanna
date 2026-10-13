---
target: c3-104
scope: insert
base: c3-104#n10433@v1:sha256:411ecc9bae667c342ff215e168c31def6b4ac6847548735835bdb72230eeff1e
---
| Page tabs | OUT | A top-level page (projects, settings, cron, workflows, boards) is a tab of kind page whose path is the last URL visited on it. pageTabs.ts holds the single URL-to-page route table (resolvePageRoute, pageTargetForPath), checking the stack-board route before the single-board route and treating chat and single-board routes as not pages. fallbackPathAfterClose names where to land when the tab owning the URL closes: the focused chat or page, then any chat, then any page, then the root | c3-112 | src/client/lib/paneTree/pageTabs.ts |
| Tab retarget | OUT | openTab on an id that already exists replaces the stored target when the new one differs and keeps the tab where it is, instead of treating open as a no-op, so one tab can follow a changing path | c3-112 | src/client/lib/paneTree/operations.ts |
| Page tab repair | OUT | A persisted page tab whose path no longer resolves to its page kind is dropped during normalization, so a renamed route cannot strand a dead tab in the saved workspace | c3-112 | src/client/lib/paneTree/tabTarget.ts |
