---
target: c3-242
scope: block
base: c3-242#n13632@v1:sha256:f1530e660a89ae564e5d6f08a5f4e2e9cc59b3d1dfd62ec580581ee2140ea9d0
---
| Typed intent tools | OUT | Intent-named tools each dispatch one command or read one topic and are registered through the tool registrar; send_message and wait_for_chat share one poll loop that returns done, a cursor and a next instruction, understands queued messages, stops on the request abort signal and sends notifications/progress when the client asked for progress; a wait is capped at 100 seconds unless the connection streams; read_project_file checks real paths inside the project | c3-208 | src/server/remote-mcp/remote-mcp-tools-chat.ts, src/server/remote-mcp/send-and-wait.ts, src/server/remote-mcp/remote-mcp-follow.ts, src/server/remote-mcp/remote-mcp-follow-view.ts, src/server/remote-mcp/remote-mcp-tools-files.ts |
