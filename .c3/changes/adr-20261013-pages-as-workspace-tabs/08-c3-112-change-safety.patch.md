---
target: c3-112
scope: insert
base: c3-112#n10607@v1:sha256:b0cc24baef9dac9360551a9063ffd8f309edd156d03355bd2b33d99bdbf4e194
---
| Page tab shows another tab page | A page reading useParams, or a nested Routes with a location prop, instead of props resolved from the tab own path | A Settings or Workflows tab in a split pane renders the section or chat of whichever tab owns the URL | bun test --conditions production src/client/app/SettingsPage.route.test.tsx src/client/app/ChatPage/ChatPage.tabs.test.tsx |
