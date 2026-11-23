---
target: c3-238
scope: block
base: c3-238#n14314@v1:sha256:8754943e4fbc5021b060e94e438f66935d5c674c971b9a41f660ca0e4e369556
---
| PluginService | OUT | install / list / reload / restore / setEnabled / start / startEnabled / stop / status / call / logs / clientBundle / recordClientError — the one surface the CLI, HTTP and MCP paths share. startEnabled starts every enabled plugin, logs a failure and continues; only the server's http-dispatcher calls it, behind the global plugins switch, never the CLI process | c3-210 | src/server/plugins/plugin-service.ts |
