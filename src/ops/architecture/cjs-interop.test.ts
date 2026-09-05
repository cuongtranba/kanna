import { describe, expect, test } from "bun:test"
import path from "node:path"
import { scanCjsInterop } from "./cjs-interop-scan.adapter"
import {
  BUNDLED_ROOTS,
  checkCjsInterop,
  findDefaultImports,
  formatInteropBreach,
  isSanctioned,
  packageNameOf,
  SANCTIONED_INTEROP,
  type ClassifiedImport,
  type PackageInterop,
} from "./cjs-interop"

const SAFE: PackageInterop = { kind: "safe", reason: "r" }
const BROKEN: PackageInterop = { kind: "transpiled_cjs", reason: "transpiled CommonJS" }

const classified = (
  path: string,
  specifier: string,
  interop: PackageInterop,
): ClassifiedImport => ({ path, specifier, interop, line: 1, local: "x", binding: "default" })

describe("findDefaultImports", () => {
  const sitesFor = (source: string) => findDefaultImports("src/client/a.ts", source)

  test("finds a bare default import", () => {
    expect(sitesFor(`import useWebSocket from "react-use-websocket"`)).toEqual([
      { path: "src/client/a.ts", line: 1, specifier: "react-use-websocket", local: "useWebSocket", binding: "default" },
    ])
  })

  test("finds a default binding alongside named ones", () => {
    const sites = sitesFor(`import React, { useMemo } from "react"`)
    expect(sites).toMatchObject([{ specifier: "react", local: "React", binding: "default" }])
  })

  test("finds a default renamed inside the braces", () => {
    const sites = sitesFor(`import { default as hook, ReadyState } from "react-use-websocket"`)
    expect(sites).toMatchObject([{ local: "hook", binding: "default" }])
  })

  test("finds a namespace import only when the file reads `.default` off it", () => {
    expect(sitesFor(`import * as ns from "pkg"\nconst f = ns.default`)).toMatchObject([
      { local: "ns", binding: "namespace_default" },
    ])
    expect(sitesFor(`import * as ns from "pkg"\nconst f = ns.named`)).toEqual([])
  })

  test("ignores named-only, side-effect, and type-only imports", () => {
    expect(sitesFor(`import { ReadyState } from "react-use-websocket"`)).toEqual([])
    expect(sitesFor(`import "./styles.css"`)).toEqual([])
    expect(sitesFor(`import type Config from "pkg"`)).toEqual([])
  })

  test("ignores relative and node: specifiers, which no bundler interops", () => {
    expect(sitesFor(`import a from "./a"`)).toEqual([])
    expect(sitesFor(`import path from "node:path"`)).toEqual([])
  })

  test("ignores an import that only appears inside a comment", () => {
    expect(sitesFor(`// NOT \`import useWebSocket from "react-use-websocket"\`\n`)).toEqual([])
    expect(sitesFor(` * import Big from "pkg"\n`)).toEqual([])
    expect(sitesFor(`  // import Big from "pkg"\n`)).toEqual([])
  })

  test("still finds an indented import, so the anchor is not an escape hatch", () => {
    expect(sitesFor(`  import Big from "pkg"\n`)).toMatchObject([{ local: "Big" }])
  })

  test("does not step over a side-effect import to reach the next statement's `from`", () => {
    const sites = sitesFor(`import "./styles.css"\nimport Big from "pkg"\n`)
    expect(sites).toMatchObject([{ specifier: "pkg", local: "Big", line: 2 }])
  })

  test("reports the line a multi-line import statement starts on", () => {
    const source = `import { a } from "x"\n\nimport Big, {\n  one,\n  two,\n} from "pkg"\n`
    expect(findDefaultImports("src/client/a.ts", source)).toMatchObject([{ line: 3, local: "Big" }])
  })
})

describe("packageNameOf", () => {
  test("keeps both segments of a scoped package", () => {
    expect(packageNameOf("@radix-ui/react-dialog")).toBe("@radix-ui/react-dialog")
    expect(packageNameOf("@scope/name/deep/path")).toBe("@scope/name")
  })

  test("drops a subpath from an unscoped package", () => {
    expect(packageNameOf("react-use-websocket/dist/lib/use-websocket")).toBe("react-use-websocket")
  })
})

describe("checkCjsInterop", () => {
  const sanctioned = [{ path: "src/client/lib/shim.ts", specifier: "pkg", reason: "r" }]

  test("accepts a default import from a package both interops agree on", () => {
    expect(checkCjsInterop([classified("src/client/a.ts", "react", SAFE)], 1, [])).toEqual([])
  })

  test("rejects a default import from a transpiled CommonJS package", () => {
    const breaches = checkCjsInterop([classified("src/client/a.ts", "pkg", BROKEN)], 1, [])
    expect(breaches).toMatchObject([{ kind: "cjs_default_import", path: "src/client/a.ts", specifier: "pkg" }])
  })

  test("rejects a package it could not classify, rather than assuming it safe", () => {
    const unknown: PackageInterop = { kind: "unknown", reason: "no manifest" }
    expect(checkCjsInterop([classified("src/client/a.ts", "pkg", unknown)], 1, []))
      .toMatchObject([{ kind: "unclassified_package", specifier: "pkg" }])
  })

  test("accepts the sanctioned chokepoint and nothing else importing the same package", () => {
    const breaches = checkCjsInterop(
      [classified("src/client/lib/shim.ts", "pkg", BROKEN), classified("src/client/a.ts", "pkg", BROKEN)],
      2,
      sanctioned,
    )
    expect(breaches).toMatchObject([{ kind: "cjs_default_import", path: "src/client/a.ts" }])
  })

  test("rejects a sanction covering an import that no longer exists", () => {
    expect(checkCjsInterop([], 1, sanctioned))
      .toEqual([{ kind: "sanction_stale", path: "src/client/lib/shim.ts", specifier: "pkg" }])
  })

  test("a scan that reached no files reports as inert, never as a clean tree", () => {
    expect(checkCjsInterop([classified("src/client/a.ts", "pkg", BROKEN)], 0, []))
      .toEqual([{ kind: "scan_empty", roots: BUNDLED_ROOTS }])
  })
})

describe("formatInteropBreach", () => {
  test("names the file, the package, and the runtime symptom", () => {
    const message = formatInteropBreach({
      kind: "cjs_default_import",
      path: "src/client/app/SocketBridge.tsx",
      line: 22,
      specifier: "react-use-websocket",
      local: "useWebSocket",
      binding: "default",
      reason: "transpiled CommonJS",
    })
    expect(message).toContain("src/client/app/SocketBridge.tsx:22")
    expect(message).toContain("react-use-websocket")
    expect(message).toContain("is not a function")
    expect(message).toContain("SANCTIONED_INTEROP")
  })

  test("the inert-scan message refuses to read as a clean tree", () => {
    expect(formatInteropBreach({ kind: "scan_empty", roots: BUNDLED_ROOTS })).toContain("inert")
  })

  test("a stale sanction is described as a hole, not a leftover", () => {
    const message = formatInteropBreach({ kind: "sanction_stale", path: "src/client/lib/shim.ts", specifier: "pkg" })
    expect(message).toContain("Delete the entry")
  })
})

describe("the bundled client survives rolldown's CommonJS interop", () => {
  const root = path.resolve(import.meta.dir, "../../..")
  const scan = scanCjsInterop(root)

  test("no file default-imports a package whose default binding rolldown resolves differently", () => {
    expect(checkCjsInterop(scan.imports, scan.filesScanned).map(formatInteropBreach).join("\n\n")).toBe("")
  })

  test("the scan reaches real client source, so a silently-empty gate cannot pass", () => {
    expect(scan.filesScanned).toBeGreaterThan(100)
    expect(scan.imports.some((site) => site.specifier === "react")).toBe(true)
  })

  test("react-use-websocket is still the transpiled-CommonJS package this gate was built for", () => {
    const site = scan.imports.find((entry) => entry.specifier === "react-use-websocket")
    expect(site?.interop.kind).toBe("transpiled_cjs")
    expect(site?.path).toBe("src/client/lib/useWebSocket.ts")
  })

  test("every sanction cites a reason", () => {
    for (const entry of SANCTIONED_INTEROP) {
      expect(entry.reason.length).toBeGreaterThan(40)
      expect(isSanctioned({ path: entry.path, specifier: entry.specifier, line: 1, local: "x", binding: "default" }))
        .toBe(true)
    }
  })
})
