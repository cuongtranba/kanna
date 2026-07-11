import { Flower } from "lucide-react"
import type { AnyValue } from "../../../shared/errors"
import type { ChatSnapshot, ChatSnapshotMessage } from "../../../shared/session-share/types"
import { renderMarkdownToReact } from "../../components/lexical/markdown/lexicalToReact"
import { HighlightedCode } from "../../components/messages/HighlightedCode"
import { ThinkingBlock } from "../../components/messages/ThinkingBlock"
import { TranscriptRenderOptionsProvider } from "../../components/messages/render-context"

export interface ShareViewPageProps {
  snapshot: ChatSnapshot
}

function stringifyInput(input: AnyValue): string {
  if (typeof input === "string") return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function stringifyOutput(output: AnyValue): string {
  if (typeof output === "string") return output
  if (output === null || output === undefined) return ""
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function MessageView({ message }: { message: ChatSnapshotMessage }) {
  switch (message.kind) {
    case "user_prompt":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] sm:max-w-[80%] rounded-[20px] border border-border bg-muted px-3.5 py-1.5 text-primary prose prose-sm prose-invert [&_p]:whitespace-pre-line">
            {renderMarkdownToReact(message.text)}
          </div>
        </div>
      )
    case "assistant_text":
      return (
        <div className="text-pretty prose prose-sm dark:prose-invert w-full max-w-[70ch] space-y-4">
          {renderMarkdownToReact(message.text)}
        </div>
      )
    case "assistant_thinking":
      return (
        <div className="w-full max-w-[70ch]">
          <ThinkingBlock content={message.text} />
        </div>
      )
    case "tool_call":
      return (
        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-muted-foreground border-b border-border bg-muted/40">
            <span className="font-semibold text-foreground">{message.name}</span>
          </div>
          <HighlightedCode source={stringifyInput(message.input)} lang="json" />
        </div>
      )
    case "tool_result": {
      const text = stringifyOutput(message.output)
      if (!text) return null
      return (
        <div
          className={
            `rounded-lg border overflow-hidden ${ 
            message.isError ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"}`
          }
        >
          <div className="px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
            {message.isError ? "tool error" : "tool result"}
          </div>
          <HighlightedCode source={text} lang="json" />
        </div>
      )
    }
    case "diff":
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1 text-xs font-mono text-muted-foreground border-b border-border bg-muted/40">
            {message.path}
          </div>
          <HighlightedCode source={message.patch} lang="diff" />
        </div>
      )
    case "terminal_chunk":
      return (
        <div className="rounded-lg border border-border overflow-hidden">
          <HighlightedCode source={message.chunk} lang="bash" />
        </div>
      )
    case "omitted":
      return (
        <div className="text-center text-xs italic text-muted-foreground">
          [content omitted: {message.reason}]
        </div>
      )
  }
}

export function ShareViewPage({ snapshot }: ShareViewPageProps) {
  const { chatMeta, messages } = snapshot
  return (
    <TranscriptRenderOptionsProvider value={{ readonly: true, localLinkMode: "text" }}>
      <main className="h-[100dvh] overflow-y-auto overscroll-contain bg-background text-foreground">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[800px] items-center gap-3 px-4 py-3 sm:px-6">
            <Flower className="h-5 w-5 text-logo shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-foreground">{chatMeta.title}</h1>
              <p className="truncate text-xs text-muted-foreground">
                Read-only · model {chatMeta.model}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Shared
            </span>
          </div>
        </header>
        <ol className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 py-8 sm:px-6">
          {messages.map((m) => (
            <li key={m.id} className="contents">
              <MessageView message={m} />
            </li>
          ))}
          {messages.length === 0 ? (
            <li className="text-center text-sm text-muted-foreground">
              This shared chat has no messages.
            </li>
          ) : null}
        </ol>
      </main>
    </TranscriptRenderOptionsProvider>
  )
}
