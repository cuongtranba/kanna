---
target: c3-112
scope: insert
base: c3-112#n14557@v1:sha256:0787a54e716ded5e698a84efdfcf2e4c9b068a372f1d6aa0ec1934961fe6c841
---
| Page tab renderer | OUT | WorkspacePage supplies the page renderer of the content registry through PageTabContent, which loads each page lazily and resolves its route params from the tab own path, passing them as props because a page tab can be visible in a split pane while the URL belongs to another tab. It renders only while it is the active tab of its pane | c3-104 | src/client/components/panes/PageTabContent.tsx |
