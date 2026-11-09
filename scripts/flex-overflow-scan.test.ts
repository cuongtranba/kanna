import { expect, test } from "vite-plus/test"
import { findSqueezedFlexText } from "./flex-overflow-scan"

const scan = (jsx: string) => findSqueezedFlexText("Row.tsx", `export const Row = () => (\n${jsx}\n)\n`)

const badge = `<span className="shrink-0 whitespace-nowrap rounded-full">In use</span>`

test("flags the token row that overlapped its Concurrent control", () => {
  const hits = scan(`<div className="flex items-center gap-3">
    <span className={\`text-sm \${muted ? "text-muted-foreground" : "text-foreground"}\`}>{entry.label}</span>
    <code className="text-xs font-mono">{maskToken(entry.token)}</code>
    {isCurrent && ${badge}}
  </div>`)
  expect(hits.map((hit) => [hit.line, hit.reason])).toEqual([
    [3, "undeclared-text"],
    [4, "undeclared-text"],
  ])
})

test("accepts data text that declares it yields or holds", () => {
  expect(
    scan(`<div className="flex items-center gap-2">
      <span className="truncate">{label}</span>
      <code className="min-w-0 break-all">{token}</code>
      <span className="min-w-0 break-words">{notice}</span>
      <span className="shrink-0 tabular-nums">{count}</span>
      ${badge}
    </div>`),
  ).toEqual([])
})

test("flags a row where every data value holds its width", () => {
  expect(
    scan(`<div className="flex items-center gap-2">
      <span className="shrink-0">{label}</span>
      ${badge}
    </div>`).map((hit) => hit.reason),
  ).toEqual(["nothing-yields"])
})

test("leaves wrapping rows, columns and rows without a rigid sibling alone", () => {
  expect(
    scan(`<div>
      <div className="flex flex-wrap gap-2"><span>{label}</span>${badge}</div>
      <div className="flex flex-col gap-2"><span>{label}</span>${badge}</div>
      <div className="flex gap-2"><span>{label}</span><span>{other}</span></div>
      <div className="flex gap-2"><span className="sr-only">{label}</span>${badge}</div>
    </div>`),
  ).toEqual([])
})
