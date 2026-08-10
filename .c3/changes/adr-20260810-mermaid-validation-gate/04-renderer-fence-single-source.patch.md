---
target: c3-114
scope: insert
base: c3-114#n7510@v1:sha256:1682d6ba9f3115730036b00a2451ef66639afb1196fbacb7545a4b13dbe009a2
---
| Fence boundaries diverge between the editor and the validator | The Lexical `MERMAID_FENCE` transformer grows its own start/end regex again instead of consuming `src/shared/mermaid-fences.ts`; the renderer and the server-side validation gate (c3-226) then disagree about where a diagram ends, so a diagram the gate cleared renders as something else | mermaid-fences tests pin a 4-backtick fence, an unterminated fence and a nested ``` at both the scanner and the transformer level | bun test --conditions production src/shared/mermaid-fences.test.ts src/client/components/lexical/markdown/renderMessage.test.tsx src/client/components/lexical/markdown/messageTransformers.test.ts |
