import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveLoginShellPath } from "./login-shell-path"
import { runLoginShell } from "./login-shell-path.adapter"

const dir = mkdtempSync(join(tmpdir(), "kanna-login-shell-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function writeFakeShell(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe("login shell PATH", () => {
  test("appends the directories a login shell adds, ignoring what its rc prints", async () => {
    const shell = writeFakeShell(
      "rc-shell",
      [
        "echo 'Welcome back! PATH is not ready yet'",
        "export PATH=\"/opt/nvm/bin:$PATH:/usr/bin\"",
        "shift 3",
        "exec /bin/sh -c \"$1\"",
      ].join("\n"),
    )

    const outcome = await resolveLoginShellPath({
      platform: "darwin",
      env: { SHELL: shell, PATH: "/usr/bin:/bin" },
      fallbackShell: null,
      runShell: runLoginShell,
    })

    expect(outcome).toEqual({
      kind: "merged",
      path: "/usr/bin:/bin:/opt/nvm/bin",
      added: ["/opt/nvm/bin"],
      shell,
    })
  }, 30_000)

  test("gives up on a login shell that never answers instead of blocking boot", async () => {
    const shell = writeFakeShell("hung-shell", "exec sleep 30")

    const startedAt = performance.now()
    const stdout = await runLoginShell({ shell, args: ["-i", "-l", "-c", "true"], env: {}, timeoutMs: 200 })

    expect(stdout).toBeNull()
    expect(performance.now() - startedAt).toBeLessThan(5_000)
  }, 30_000)

  test("KANNA_LOGIN_SHELL_PATH=disabled keeps the inherited PATH without starting a shell", async () => {
    const started: string[] = []

    const outcome = await resolveLoginShellPath({
      platform: "darwin",
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin", KANNA_LOGIN_SHELL_PATH: "disabled" },
      fallbackShell: null,
      runShell: async (run) => {
        started.push(run.shell)
        return null
      },
    })

    expect(outcome).toEqual({ kind: "skipped", reason: "disabled" })
    expect(started).toEqual([])
  })
})
