---
target: rule-mcp-name-reserved
scope: block
base: rule-mcp-name-reserved#n13943@v1:sha256:a373c4792327d02f0fe9b56e61b512b12211bae396d9e7b860e6aa09b367eeec
---
| Only enforce at the API route level | Enforce at storage + the SDK build function | The build function receives a deserialized AppSettingsSnapshot; it must not trust that storage already validated |
