---
target: c3-104
scope: insert
base: c3-104#n10443@v1:sha256:e470abca9ddccceb383ce454962e7ec7c7b12ea5197888d2ed306ba6774ccf36
---
| Two Settings tabs, or Settings forgets its section | Deriving a page tab id from its path instead of its page kind, or making openTab a no-op for an existing id | A second Settings tab appears per section, or the tab reopens on the first section after reload | bun test --conditions production src/client/stores/paneLayoutStore.test.ts src/client/lib/paneTree/pageTabs.test.ts |
