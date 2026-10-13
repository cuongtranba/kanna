---
target: c3-112
scope: insert
base: c3-112#n10600@v1:sha256:15c9707de7125833ceab6c6b06a292b2fdb075f4345ac6c1c788173003cdc426
---
| URL and tab sync | OUT | useRouteTabSync opens or refocuses the page tab for the current URL, keyed on location.key so re-clicking Settings refocuses its tab even at the same path; a page route opens its page tab and never a chat tab, even on /workflows/:chatId. In the other direction the focused tab writes its address to the URL: a chat to /chat/id and a page to its path, while board, terminal and changes tabs leave the URL alone. Closing the tab that owns the URL navigates to fallbackPathAfterClose | c3-104 | src/client/app/ChatPage/useRouteTabSync.ts |
| Page tab renderer | OUT | WorkspacePage supplies the page renderer of the content registry through PageTabContent, which loads each page lazily and resolves its route params from the tab own path, passing them as props because a page tab can be visible in a split pane while the URL belongs to another tab. It renders only while it is the active tab of its pane | c3-104 | src/client/components/panes/PageTabContent.tsx |
