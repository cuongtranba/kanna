# Claude PTY Linux Sandbox Implementation Plan (P4.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the macOS sandbox (P4) to Linux via `bwrap` (bubblewrap). Same policy → equivalent filesystem denies. Detect `bwrap` binary at runtime; refuse to enable Linux sandbox if not installed.

**Architecture:** New `profile-linux.ts` translates `readPathDeny`/`writePathDeny` into bwrap argv. `wrap.ts` becomes async and dispatches per platform — on darwin writes a `.sb` profile to disk then wraps with `sandbox-exec`; on linux returns inline bwrap argv. `platform.ts` gains `detectBwrap()` so Linux is "supported" only when `bwrap` is on PATH. Tool-subprocess profile (separate sandbox for `mcp__kanna__bash` subprocess) is deferred to a later phase — bash tool already gates via `permission-gate` and the subprocess inherits Kanna server's process; defense-in-depth sandbox for bash is nice-to-have, not P4.1 scope.

**Tech Stack:** Bun + TypeScript strict. `node:child_process` for `which bwrap` detection, `node:fs/promises` for profile-file writes. `bwrap` is not bundled with most distros — users on Ubuntu/Debian install via `apt install bubblewrap`; Arch via `pacman -S bubblewrap`; Fedora `dnf install bubblewrap`.

---

## Scope check

P4.1 ships **Linux bwrap parity** with P4 macOS sandbox. Specifically:

- Same policy → same denies, expressed in bwrap's bind/tmpfs/ro-bind primitives.
- Runtime `bwrap` detection — refuse to enable Linux sandbox if absent.
- Preflight sentinel verifies bwrap actually denies.
- Driver remains untouched at the call site — `wrap.ts` hides the platform dispatch.

Deferred to later:
- Tool-subprocess sandbox profile (`mcp__kanna__bash` spawning).
- Workspace-secret glob enumeration (`**/.env` etc.).
- Per-chat policy threading into sandbox (uses `POLICY_DEFAULT` still).

---

## File Structure

**Created:**

```
src/server/claude-pty/sandbox/
  ├── profile-linux.ts       # bwrap argv generator from policy
  ├── profile-linux.test.ts
  └── detect.ts              # detectBwrap() runtime check
      detect.test.ts
```

**Modified:**

```
src/server/claude-pty/sandbox/platform.ts    # add async isSandboxEnabledAsync (detects bwrap on linux)
src/server/claude-pty/sandbox/platform.test.ts
src/server/claude-pty/sandbox/wrap.ts        # async dispatch per platform
src/server/claude-pty/sandbox/wrap.test.ts
src/server/claude-pty/sandbox/preflight.ts   # linux variant via bwrap
src/server/claude-pty/sandbox/preflight.test.ts
src/server/claude-pty/driver.ts              # adapt to async wrap
CLAUDE.md
```

---

## Conventions

- TypeScript strict, no `any`. One commit per task.
- Linux tests platform-conditional via `if (process.platform !== "linux") return`.
- macOS tests preserved unchanged.
- `bwrap` runtime detection cached for process lifetime.

---

## Task 1: Detect bwrap on PATH

**Files:**
- Create: `src/server/claude-pty/sandbox/detect.ts`
- Create: `src/server/claude-pty/sandbox/detect.test.ts`

`detectBwrap(): Promise<boolean>` checks if `/usr/bin/bwrap` or `bwrap` is on PATH. Caches result in module-scope so subsequent calls are O(1).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { detectBwrap, resetBwrapCacheForTest } from "./detect"

describe("detectBwrap", () => {
  test("returns boolean (real platform check)", async () => {
    resetBwrapCacheForTest()
    const result = await detectBwrap()
    expect(typeof result).toBe("boolean")
  })

  test("subsequent calls hit cache (same result)", async () => {
    resetBwrapCacheForTest()
    const first = await detectBwrap()
    const second = await detectBwrap()
    expect(second).toBe(first)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/server/claude-pty/sandbox/detect.ts`**

```ts
import { spawn } from "node:child_process"

let cached: boolean | null = null

export async function detectBwrap(): Promise<boolean> {
  if (cached !== null) return cached
  cached = await new Promise<boolean>((resolve) => {
    // /usr/bin/which bwrap exits 0 if present.
    const child = spawn("/usr/bin/which", ["bwrap"], { stdio: ["ignore", "ignore", "ignore"] })
    child.on("close", (code) => resolve(code === 0))
    child.on("error", () => resolve(false))
  })
  return cached
}

export function resetBwrapCacheForTest(): void {
  cached = null
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/sandbox/detect.ts src/server/claude-pty/sandbox/detect.test.ts
git commit -m "feat(claude-pty/sandbox): detectBwrap runtime check"
```

---

## Task 2: bwrap profile generator

**Files:**
- Create: `src/server/claude-pty/sandbox/profile-linux.ts`
- Create: `src/server/claude-pty/sandbox/profile-linux.test.ts`

`generateBwrapArgs({ policy, homeDir }): string[]` returns argv flags to inject before the claude command.

bwrap mental model:
- `--bind /src /dst` mount read-write
- `--ro-bind /src /dst` mount read-only
- `--tmpfs <path>` shadow `<path>` with an empty tmpfs (hides original contents — effective "deny")
- `--dev /dev`, `--proc /proc` for system mounts
- `--die-with-parent` clean exit

Strategy:
1. Start with a permissive base: bind `/` rw onto `/`. (Sandbox is for path-deny, not full confinement.)
2. For each `readPathDeny` entry, shadow with `--tmpfs <expanded-path>` (replaces the path with empty tmpfs).
3. For each `writePathDeny` entry, `--tmpfs <path>` too (denies both read and write).
4. Add `--die-with-parent` and `--unshare-pid` / no — keep network + pid intact for claude.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { generateBwrapArgs } from "./profile-linux"

const POLICY = {
  defaultAction: "ask" as const,
  bash: { autoAllowVerbs: [] },
  readPathDeny: ["~/.ssh", "/etc/shadow"],
  writePathDeny: ["/etc/**"],
  toolDenyList: [],
  toolAllowList: [],
}

describe("generateBwrapArgs", () => {
  test("emits base --bind / / and --die-with-parent", () => {
    const args = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    expect(args).toContain("--bind")
    expect(args).toContain("--die-with-parent")
  })

  test("emits --tmpfs for each readPathDeny entry (expanded)", () => {
    const args = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    const homePos = args.findIndex((a, i) => a === "--tmpfs" && args[i + 1] === "/home/u/.ssh")
    expect(homePos).toBeGreaterThanOrEqual(0)
    const etcPos = args.findIndex((a, i) => a === "--tmpfs" && args[i + 1] === "/etc/shadow")
    expect(etcPos).toBeGreaterThanOrEqual(0)
  })

  test("emits --tmpfs for writePathDeny (strips /** suffix)", () => {
    const args = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    const pos = args.findIndex((a, i) => a === "--tmpfs" && args[i + 1] === "/etc")
    expect(pos).toBeGreaterThanOrEqual(0)
  })

  test("skips entries containing wildcards (no glob support in bwrap argv)", () => {
    const args = generateBwrapArgs({
      policy: { ...POLICY, readPathDeny: ["**/.env"] },
      homeDir: "/home/u",
    })
    // Wildcard entries are silently skipped (not translated). bwrap argv doesn't glob.
    expect(args.find((a, i) => a === "--tmpfs" && args[i + 1]?.includes("*"))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/server/claude-pty/sandbox/profile-linux.ts`**

```ts
import path from "node:path"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"

function expandTilde(p: string, homeDir: string): string {
  if (!p.startsWith("~")) return p
  return path.join(homeDir, p.slice(1).replace(/^\//, ""))
}

function stripGlobSuffix(p: string): string | null {
  if (p.endsWith("/**")) return p.slice(0, -3)
  if (p.includes("*")) return null
  return p
}

export function generateBwrapArgs(args: {
  policy: ChatPermissionPolicy
  homeDir: string
}): string[] {
  const deny = new Set<string>()
  for (const raw of args.policy.readPathDeny) {
    const expanded = expandTilde(raw, args.homeDir)
    const stripped = stripGlobSuffix(expanded)
    if (stripped) deny.add(stripped)
  }
  for (const raw of args.policy.writePathDeny) {
    const expanded = expandTilde(raw, args.homeDir)
    const stripped = stripGlobSuffix(expanded)
    if (stripped) deny.add(stripped)
  }

  const argv: string[] = [
    "--bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
  ]
  for (const p of deny) {
    argv.push("--tmpfs", p)
  }
  return argv
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/sandbox/profile-linux.ts src/server/claude-pty/sandbox/profile-linux.test.ts
git commit -m "feat(claude-pty/sandbox): bwrap argv generator from policy"
```

---

## Task 3: Async platform support check

**Files:**
- Modify: `src/server/claude-pty/sandbox/platform.ts`
- Modify: `src/server/claude-pty/sandbox/platform.test.ts`

Add `isSandboxEnabledAsync({platform, env})`: returns true if platform supports sandboxing AND env doesn't force off. For Linux, also requires `detectBwrap()` to succeed.

Keep the existing synchronous `isSandboxEnabled` for backward compatibility (it can still return false for Linux because the synchronous version can't probe `bwrap`).

- [ ] **Step 1: Failing test**

Append to `platform.test.ts`:

```ts
import { isSandboxEnabledAsync } from "./platform"
import { resetBwrapCacheForTest } from "./detect"

describe("isSandboxEnabledAsync", () => {
  test("respects env=off on linux", async () => {
    expect(await isSandboxEnabledAsync({ platform: "linux", env: "off" })).toBe(false)
  })

  test("linux: depends on bwrap detection (sync no, async maybe yes)", async () => {
    resetBwrapCacheForTest()
    // The actual return depends on whether bwrap is installed on the test machine.
    // We just assert the function is async and returns boolean.
    const r = await isSandboxEnabledAsync({ platform: "linux", env: undefined })
    expect(typeof r).toBe("boolean")
  })

  test("darwin: always enabled when env not 'off'", async () => {
    expect(await isSandboxEnabledAsync({ platform: "darwin", env: undefined })).toBe(true)
  })

  test("win32: always false", async () => {
    expect(await isSandboxEnabledAsync({ platform: "win32", env: "on" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

In `platform.ts`:

```ts
import { detectBwrap } from "./detect"

export async function isSandboxEnabledAsync(args: {
  platform: NodeJS.Platform
  env: string | undefined
}): Promise<boolean> {
  if (args.env === "off") return false
  if (args.platform === "darwin") return true
  if (args.platform === "linux") return await detectBwrap()
  return false
}
```

Update `isSandboxSupported` to also return true for linux when bwrap is detected? No — keep it sync. Async version is the authoritative gate.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/sandbox/platform.ts src/server/claude-pty/sandbox/platform.test.ts
git commit -m "feat(claude-pty/sandbox): async isSandboxEnabled for bwrap-gated linux"
```

---

## Task 4: Async wrap dispatch

**Files:**
- Modify: `src/server/claude-pty/sandbox/wrap.ts`
- Modify: `src/server/claude-pty/sandbox/wrap.test.ts`

Convert `wrapWithSandbox` to async. Internally dispatches per platform:
- darwin: existing sandbox-exec wrap.
- linux: prepend bwrap argv from `generateBwrapArgs`.
- other: pass through.

API change: caller passes `policy + homeDir` instead of pre-written profile path. For darwin, `wrap.ts` still writes the `.sb` file internally to `runtimeDir`.

- [ ] **Step 1: Update existing wrap.test.ts**

Replace the existing tests with the new async signature:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { wrapWithSandbox } from "./wrap"
import { POLICY_DEFAULT } from "../../../shared/permission-policy"

describe("wrapWithSandbox (async dispatch)", () => {
  test("darwin enabled → prepends sandbox-exec and writes profile", async () => {
    if (process.platform !== "darwin") return
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "darwin",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/Users/u",
        runtimeDir,
        command: "/usr/local/bin/claude",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("/usr/bin/sandbox-exec")
      expect(result.args[0]).toBe("-f")
      const profile = await readFile(result.args[1], "utf8")
      expect(profile).toContain("(version 1)")
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })

  test("linux enabled → prepends bwrap argv", async () => {
    if (process.platform !== "linux") return
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "linux",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/home/u",
        runtimeDir,
        command: "/usr/local/bin/claude",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("/usr/bin/bwrap")
      expect(result.args).toContain("--bind")
      expect(result.args).toContain("--die-with-parent")
      expect(result.args).toContain("/usr/local/bin/claude")
      expect(result.args).toContain("--model")
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })

  test("disabled → pass through", async () => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "darwin",
        enabled: false,
        policy: POLICY_DEFAULT,
        homeDir: "/Users/u",
        runtimeDir,
        command: "/usr/local/bin/claude",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("/usr/local/bin/claude")
      expect(result.args).toEqual(["--model", "x"])
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })

  test("unsupported platform → pass through", async () => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-wrap-"))
    try {
      const result = await wrapWithSandbox({
        platform: "win32",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/Users/u",
        runtimeDir,
        command: "claude.exe",
        args: ["--model", "x"],
      })
      expect(result.command).toBe("claude.exe")
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Rewrite `src/server/claude-pty/sandbox/wrap.ts`**

```ts
import path from "node:path"
import { writeFile } from "node:fs/promises"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"
import { generateMacosProfile } from "./profile-macos"
import { generateBwrapArgs } from "./profile-linux"

const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
const BWRAP = "/usr/bin/bwrap"

export interface WrapArgs {
  platform: NodeJS.Platform
  enabled: boolean
  policy: ChatPermissionPolicy
  homeDir: string
  runtimeDir: string
  command: string
  args: string[]
}

export interface WrapResult {
  command: string
  args: string[]
}

export async function wrapWithSandbox(opts: WrapArgs): Promise<WrapResult> {
  if (!opts.enabled) {
    return { command: opts.command, args: opts.args }
  }
  if (opts.platform === "darwin") {
    const profileBody = generateMacosProfile({ policy: opts.policy, homeDir: opts.homeDir })
    const profilePath = path.join(opts.runtimeDir, "claude-sandbox.sb")
    await writeFile(profilePath, profileBody, "utf8")
    return {
      command: SANDBOX_EXEC,
      args: ["-f", profilePath, opts.command, ...opts.args],
    }
  }
  if (opts.platform === "linux") {
    const bwrapArgv = generateBwrapArgs({ policy: opts.policy, homeDir: opts.homeDir })
    return {
      command: BWRAP,
      args: [...bwrapArgv, opts.command, ...opts.args],
    }
  }
  return { command: opts.command, args: opts.args }
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/sandbox/wrap.ts src/server/claude-pty/sandbox/wrap.test.ts
git commit -m "refactor(claude-pty/sandbox): async wrapWithSandbox dispatches darwin/linux"
```

---

## Task 5: Update driver call site

**Files:**
- Modify: `src/server/claude-pty/driver.ts`
- Modify: `src/server/claude-pty/driver.test.ts`

`wrap.ts` signature changed — driver passes `policy + homeDir + runtimeDir` instead of pre-written `profilePath`. Driver no longer needs to import `generateMacosProfile` or `writeFile` (the wrap helper does that). Also switch from `isSandboxEnabled` (sync) to `isSandboxEnabledAsync` for Linux gating.

- [ ] **Step 1: Modify `driver.ts`**

Remove these imports:
```ts
// import { generateMacosProfile } from "./sandbox/profile-macos"  ← delete
// import { writeFile } from "node:fs/promises"  ← keep only if used elsewhere
```

Replace the sandbox setup block:

```ts
// Before:
const sandboxOn = isSandboxEnabled({ platform: process.platform, env: env.KANNA_PTY_SANDBOX })
let sandboxProfilePath: string | null = null
if (sandboxOn) {
  const profileBody = generateMacosProfile({ policy: POLICY_DEFAULT, homeDir: home })
  sandboxProfilePath = path.join(runtimeDir, "claude-sandbox.sb")
  await writeFile(sandboxProfilePath, profileBody, "utf8")
}

// After:
const sandboxOn = await isSandboxEnabledAsync({ platform: process.platform, env: env.KANNA_PTY_SANDBOX })
```

Update `isSandboxEnabledAsync` import. Replace the wrap call:

```ts
// Before:
const wrapped = sandboxProfilePath
  ? wrapWithSandbox({
      platform: process.platform,
      enabled: sandboxOn,
      profilePath: sandboxProfilePath,
      command: claudeBin,
      args: cliArgs,
    })
  : { command: claudeBin, args: cliArgs }

// After:
const wrapped = await wrapWithSandbox({
  platform: process.platform,
  enabled: sandboxOn,
  policy: POLICY_DEFAULT,
  homeDir: home,
  runtimeDir,
  command: claudeBin,
  args: cliArgs,
})
```

- [ ] **Step 2: Run existing driver tests**

```bash
bun test src/server/claude-pty/driver.test.ts
```

The existing P4 macOS-on test should still pass — same effective behavior via the new path. If it fails, adjust.

- [ ] **Step 3: Run full server suite + check**

```bash
bun test src/server
bun x tsc --noEmit
bun run lint
bun run check
```

All clean.

- [ ] **Step 4: Commit**

```bash
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git commit -m "refactor(claude-pty): use async wrapWithSandbox + isSandboxEnabledAsync"
```

---

## Task 6: Linux preflight sentinel

**Files:**
- Modify: `src/server/claude-pty/sandbox/preflight.ts`
- Modify: `src/server/claude-pty/sandbox/preflight.test.ts`

Current `runSandboxPreflight` is macOS-only (sandbox-exec). Extend to Linux: spawn `/usr/bin/bwrap <argv> /bin/cat <sentinelPath>`. If exit 0 → sentinel readable → preflight fail.

Signature changes: takes `policy + homeDir + runtimeDir` instead of `profileBody`. The Linux path uses `generateBwrapArgs` directly; the macOS path writes a profile file (same as before).

Or simpler: keep a unified API: caller passes platform + enabled + sentinel path + policy + homeDir + runtimeDir. preflight figures out the rest.

- [ ] **Step 1: Update tests**

Replace test setup with policy-based shape. Add Linux variant gated by platform.

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runSandboxPreflight } from "./preflight"
import { POLICY_DEFAULT } from "../../../shared/permission-policy"

describe("runSandboxPreflight (cross-platform)", () => {
  test("macOS: ok when sentinel denied", async () => {
    if (process.platform !== "darwin") return
    const home = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-mac-"))
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-runtime-"))
    try {
      await mkdir(path.join(home, ".ssh"), { recursive: true })
      await writeFile(path.join(home, ".ssh", "id_rsa"), "SECRET", "utf8")
      const policy = { ...POLICY_DEFAULT, readPathDeny: [`${home}/.ssh`] }
      const result = await runSandboxPreflight({
        platform: "darwin",
        enabled: true,
        policy,
        homeDir: home,
        runtimeDir,
        sentinelPath: `${home}/.ssh/id_rsa`,
      })
      expect(result.ok).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(runtimeDir, { recursive: true, force: true })
    }
  })

  test("linux: ok when sentinel denied via bwrap tmpfs", async () => {
    if (process.platform !== "linux") return
    // Requires bwrap installed on the test machine.
    const home = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-lin-"))
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-runtime-"))
    try {
      await mkdir(path.join(home, ".ssh"), { recursive: true })
      await writeFile(path.join(home, ".ssh", "id_rsa"), "SECRET", "utf8")
      const policy = { ...POLICY_DEFAULT, readPathDeny: [`${home}/.ssh`] }
      const result = await runSandboxPreflight({
        platform: "linux",
        enabled: true,
        policy,
        homeDir: home,
        runtimeDir,
        sentinelPath: `${home}/.ssh/id_rsa`,
      })
      expect(result.ok).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(runtimeDir, { recursive: true, force: true })
    }
  })

  test("returns ok on unsupported platform", async () => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pf-win-"))
    try {
      const result = await runSandboxPreflight({
        platform: "win32",
        enabled: true,
        policy: POLICY_DEFAULT,
        homeDir: "/tmp",
        runtimeDir,
        sentinelPath: "/tmp/x",
      })
      expect(result.ok).toBe(true)
    } finally { await rm(runtimeDir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run → tests should FAIL on signature mismatch (preflight expects old args).**

- [ ] **Step 3: Rewrite `src/server/claude-pty/sandbox/preflight.ts`**

```ts
import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"
import { generateMacosProfile } from "./profile-macos"
import { generateBwrapArgs } from "./profile-linux"

export interface SandboxPreflightArgs {
  platform: NodeJS.Platform
  enabled: boolean
  policy: ChatPermissionPolicy
  homeDir: string
  runtimeDir: string
  sentinelPath: string
}

export type SandboxPreflightResult =
  | { ok: true }
  | { ok: false; reason: string }

async function spawnExitCode(command: string, args: string[]): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "ignore"] })
    child.on("close", (code) => resolve(code ?? -1))
    child.on("error", () => resolve(-1))
  })
}

export async function runSandboxPreflight(args: SandboxPreflightArgs): Promise<SandboxPreflightResult> {
  if (!args.enabled) return { ok: true }

  if (args.platform === "darwin") {
    const profileBody = generateMacosProfile({ policy: args.policy, homeDir: args.homeDir })
    const profilePath = path.join(args.runtimeDir, "preflight.sb")
    await writeFile(profilePath, profileBody, "utf8")
    const code = await spawnExitCode("/usr/bin/sandbox-exec", ["-f", profilePath, "/bin/cat", args.sentinelPath])
    if (code === 0) {
      return { ok: false, reason: `sentinel readable under sandbox: ${args.sentinelPath}` }
    }
    return { ok: true }
  }

  if (args.platform === "linux") {
    const bwrapArgv = generateBwrapArgs({ policy: args.policy, homeDir: args.homeDir })
    const code = await spawnExitCode("/usr/bin/bwrap", [...bwrapArgv, "/bin/cat", args.sentinelPath])
    if (code === 0) {
      return { ok: false, reason: `sentinel readable under bwrap: ${args.sentinelPath}` }
    }
    return { ok: true }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run tests** → PASS (macOS test on Darwin, Linux test on Linux, win32 test everywhere).

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/sandbox/preflight.ts src/server/claude-pty/sandbox/preflight.test.ts
git commit -m "feat(claude-pty/sandbox): preflight extended for linux bwrap"
```

---

## Task 7: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the existing "OS sandbox (P4)" block**

Replace its body with:

```md

**OS sandbox (P4 + P4.1):** Every PTY spawn is wrapped with an OS-level
sandbox when supported:
- macOS: `/usr/bin/sandbox-exec -f <profile.sb>`. Profile generated per
  spawn from `POLICY_DEFAULT.readPathDeny` + `writePathDeny`. Default on.
- Linux: `/usr/bin/bwrap <flags> claude ...`. Each deny entry becomes
  `--tmpfs <path>` (replaces the path with an empty in-memory filesystem).
  Default on **only when `bwrap` is installed** (`apt install bubblewrap` /
  `pacman -S bubblewrap` / `dnf install bubblewrap`). If absent, sandbox
  silently disables — set `KANNA_PTY_SANDBOX=off` to suppress the gap.
- Windows: PTY refused per spec.

Set `KANNA_PTY_SANDBOX=off` to skip (advanced users, loses defense-in-depth
against built-in tool credential reads).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: P4.1 Linux bwrap sandbox parity"
```

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-05-14-claude-pty-driver-design.md` §"Sandboxing the spawn"):
- Linux bwrap profile + preflight — Tasks 1-6.
- Cross-platform dispatch in driver — Task 5.
- Docs — Task 7.

**Deferred:**
- Tool-subprocess sandbox profile (`mcp__kanna__bash` subprocess) — bash tool already gates via `permission-gate`; OS-level sandbox for bash subprocess is defense-in-depth, ship later.
- Workspace-secret glob enumeration — bwrap argv has no glob; same limitation as macOS `.sb`. Add explicit absolute entries to `readPathDeny` if needed.
- Per-chat policy threading — still uses `POLICY_DEFAULT`. P5 wires per-chat.

**2. Placeholder scan:** No TBD/TODO.

**3. Type consistency:** `WrapArgs`, `SandboxPreflightArgs` shapes consistent across tasks. `generateBwrapArgs` parallels `generateMacosProfile` in signature.

**4. Edge cases:**
- Glob entries (`**/.env`) silently skipped on Linux. Same as macOS (treat as literal there). Document.
- bwrap absent → sandbox silently off. User sees PTY working without protection. Acceptable for v1 but worth surfacing as a UI banner later (P7).
- bwrap's `--tmpfs` shadows the dir with EMPTY tmpfs. Original content is hidden, not deleted. After PTY exits, original is back.

---
