---
target: c3-242
scope: block
base: c3-242#n13605@v1:sha256:9bf37a28f14597569958cbe4e7245fda976005f910ecb0e53e2e688c6564ed1f
---
| Input — commands | router.dispatchCommand runs any ClientCommand through the same handlers as a WebSocket client and returns the first envelope carrying the generated id; it takes an optional CommandOrigin that it sets on its synthetic connection, and routeCommand stamps it onto chat.send and message.enqueue; router.readSnapshot builds a topic envelope with no connection | c3-208 |
