---
target: rule-mcp-name-reserved
scope: block
base: rule-mcp-name-reserved#n13941@v1:sha256:44741fd4922c6481bcbef4a43bca17bad58c8aff1befb865c524ebab5ca43e6c
---
| Skip name check in buildUserMcpServers because validateMcpShape already rejects it | Keep the filter at both sites | Defense-in-depth: storage validation can be bypassed by direct DB writes or migration gaps |
