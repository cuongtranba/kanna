---
target: c3-242
scope: block
base: c3-242#n13304@v1:sha256:82d586df10be0abff7033da234f45d81c90c405f6f1486802ec861e09e0a842c
---
| Lifecycle | One runtime per server process, created in startKannaServer, started once the listen port is final and stopped before shutdownServices; one MCP server instance per HTTP request, built by the createMcpHandler factory and discarded with its response |
