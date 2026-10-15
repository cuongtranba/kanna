---
target: c3-211
scope: insert
base: c3-211#n11972@v1:sha256:3cf8e54109ff79b37b727e01c0ea898e49c07a12d2a808ba841bf20e2d2e679d
---
| update_plan tool | IN | Every thread starts with tools.update_plan enabled; an item/tool/call for update_plan and each turn/plan/updated notification become one plan entry of steps and an explanation | The plan is display only; Kanna answers the tool call itself and never forwards it to another tool | src/server/codex-app-server.ts |
