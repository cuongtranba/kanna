import { describe, expect, test } from "bun:test"
import { policy } from "./permission-gate"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import type { BeaconConfig } from "../shared/beacon-config"
import { beaconScriptHash } from "./beacon-crypto"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import type { JsonObject } from "../shared/json"

describe("policy.evaluate basics", () => {
  test("defaultAction 'ask' → ask verdict", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("ask")
  })

  test("defaultAction 'auto-allow' → auto-allow verdict", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-allow")
  })

  test("toolDenyList regex match → auto-deny with reason", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-deny")
    expect(verdict.reason).toContain("denylist")
  })

  test("deny-list overrides defaultAction auto-allow", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-deny")
  })

  test("mcp__kanna__ask_user_question always asks even under auto-allow policy", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__ask_user_question",
      args: { questions: [{ text: "x", header: "h", multiSelect: false, options: [{ label: "a", description: "" }, { label: "b", description: "" }] }] },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("ask")
  })

  test("mcp__kanna__exit_plan_mode always asks even under auto-allow policy", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__exit_plan_mode",
      args: { plan: "do stuff" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("ask")
  })

  test("interactive tools also ask under auto-deny policy (UI is the only outcome)", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__ask_user_question",
      args: { questions: [] },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-deny" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("ask")
  })
})

describe("bash arg parsing", () => {
  const policyWithDefaults = POLICY_DEFAULT

  test("plain `ls` → auto-allow", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("`cat ~/.ssh/id_rsa` → auto-deny (readPathDeny)", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat ~/.ssh/id_rsa" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("readPathDeny")
  })

  test("`cat ~/.claude/.credentials.json` → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat ~/.claude/.credentials.json" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
  })

  test("pipe `ls | grep foo` → ask (downgrades)", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls | grep foo" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("subshell `cat $(echo ~/.ssh/id_rsa)` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat $(echo ~/.ssh/id_rsa)" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("env-prefix `FOO=bar ls` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "FOO=bar ls" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("chain `ls && rm file` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls && rm file" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("`git status` (multi-word verb in autoAllowVerbs) → auto-allow", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "git status" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("unrecognized verb → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "curl https://example.com" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })
})

describe("path-deny for read/edit/write tools", () => {
  test("mcp__kanna__read path in readPathDeny → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "~/.ssh/id_rsa" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("readPathDeny")
  })

  test("mcp__kanna__read non-sensitive path → falls through to default", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "/tmp/project/src/foo.ts" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("mcp__kanna__write path in writePathDeny → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__write",
      args: { path: "/etc/passwd", content: "x" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("writePathDeny")
  })

  test("mcp__kanna__edit path in writePathDeny → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__edit",
      args: { path: "~/.aws/credentials", oldString: "a", newString: "b" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("writePathDeny")
  })

  test("mcp__kanna__glob with deny-matching path → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__glob",
      args: { path: "~/.ssh/" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
  })
})

describe("regex try/catch guard", () => {
  test("malformed pattern in bash denyList → skipped, returns default verdict instead of throwing", () => {
    const result = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls" },
      chatPolicy: {
        ...POLICY_DEFAULT,
        toolDenyList: [
          { tool: "mcp__kanna__bash", pattern: "[" },
        ],
      },
      cwd: "/tmp/project",
    })
    expect(result.verdict).toBe("auto-allow")
  })

  test("malformed pattern in non-bash denyList → skipped, returns default verdict instead of throwing", () => {
    const result = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: {
        ...POLICY_DEFAULT,
        toolDenyList: [
          { tool: "mcp__kanna__webfetch", pattern: "[" },
        ],
        defaultAction: "auto-allow",
      },
      cwd: "/tmp/project",
    })
    expect(result.verdict).toBe("auto-allow")
  })

  test("malformed pattern in non-bash allowList → skipped, falls to default action", () => {
    const result = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: {
        ...POLICY_DEFAULT,
        toolAllowList: [
          { tool: "mcp__kanna__webfetch", pattern: "[" },
        ],
        defaultAction: "ask",
      },
      cwd: "/tmp/project",
    })
    expect(result.verdict).toBe("ask")
  })
})

describe("policy.evaluate restrictedAllowedPaths", () => {
  test("read inside root passes", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "docs/foo.md" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/repo/kanna",
      restrictedAllowedPaths: ["/repo/kanna/docs"],
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("read outside root → auto-deny restrictedAllowedPaths", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "../other/secret.txt" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/repo/kanna",
      restrictedAllowedPaths: ["/repo/kanna/docs"],
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toMatch(/restrictedAllowedPaths/)
  })

  test("write outside root → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__edit",
      args: { path: "/etc/passwd" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/repo/kanna",
      restrictedAllowedPaths: ["/repo/kanna/docs"],
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toMatch(/restrictedAllowedPaths/)
  })

  test("bash path arg outside root → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat /etc/passwd" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow", bash: { autoAllowVerbs: ["cat"] } },
      cwd: "/repo/kanna",
      restrictedAllowedPaths: ["/repo/kanna/docs"],
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toMatch(/restrictedAllowedPaths/)
  })

  test("bash path arg inside root passes", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat docs/readme.md" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow", bash: { autoAllowVerbs: ["cat"] } },
      cwd: "/repo/kanna",
      restrictedAllowedPaths: ["/repo/kanna/docs"],
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("multiple roots: pass when path matches any root", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "wiki/guide.md" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/repo/kanna",
      restrictedAllowedPaths: ["/repo/kanna/docs", "/repo/kanna/wiki"],
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("no restriction (undefined) falls back to legacy chat-level deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "../other/secret.txt" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/repo/kanna",
    })
    expect(v.verdict).toBe("auto-allow")
  })
})

describe("policy.evaluate beacon tools", () => {
  const scope: BeaconScope = {
    ...DEFAULT_BEACON_SCOPE,
    exec: true,
    execAllowlist: ["git"],
    readRoots: ["/data"],
  }
  const beacon: BeaconConfig = {
    id: "b1",
    label: "Build box",
    publicKey: "key",
    os: "linux",
    scope,
    enabled: true,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  }
  const evaluateBeacon = (toolName: string, args: JsonObject, config: BeaconConfig = beacon) =>
    policy.evaluate({ toolName, args, chatPolicy: POLICY_DEFAULT, cwd: "/tmp", beacons: [config] }).verdict
  const withScope = (patch: Partial<BeaconScope>): BeaconConfig => ({ ...beacon, scope: { ...scope, ...patch } })

  test("a read inside the read roots asks while auto-run is off and auto-allows when it is on", () => {
    const args = { beaconId: "b1", path: "/data/notes.txt" }
    expect(evaluateBeacon("mcp__kanna__beacon_read", args)).toBe("ask")
    expect(evaluateBeacon("mcp__kanna__beacon_read", args, withScope({ autoRunScripts: true }))).toBe("auto-allow")
  })

  test("a read outside the read roots is denied even with auto-run on", () => {
    const args = { beaconId: "b1", path: "/etc/passwd" }
    expect(evaluateBeacon("mcp__kanna__beacon_read", args, withScope({ autoRunScripts: true }))).toBe("auto-deny")
  })

  test("exec auto-allows an allowlisted verb, asks for an unlisted one and is denied when exec is off", () => {
    expect(evaluateBeacon("mcp__kanna__beacon_exec", { beaconId: "b1", cmd: "git", args: ["status"] })).toBe("auto-allow")
    expect(evaluateBeacon("mcp__kanna__beacon_exec", { beaconId: "b1", cmd: "make" })).toBe("ask")
    expect(evaluateBeacon("mcp__kanna__beacon_exec", { beaconId: "b1", cmd: "git" }, withScope({ exec: false }))).toBe("auto-deny")
  })

  test("a script asks unless auto-run is on", () => {
    const args = { beaconId: "b1", body: "echo hi" }
    expect(evaluateBeacon("mcp__kanna__beacon_script", args)).toBe("ask")
    expect(evaluateBeacon("mcp__kanna__beacon_script", args, withScope({ autoRunScripts: true }))).toBe("auto-allow")
  })

  test("a script whose body hash is trusted auto-allows with auto-run off and an untrusted body asks", () => {
    const trusted = withScope({ trustedScriptHashes: [beaconScriptHash("echo hi")] })
    expect(evaluateBeacon("mcp__kanna__beacon_script", { beaconId: "b1", body: "echo hi" }, trusted)).toBe("auto-allow")
    expect(evaluateBeacon("mcp__kanna__beacon_script", { beaconId: "b1", body: "echo changed" }, trusted)).toBe("ask")
  })

  test("a trusted script hash does not allow a script once exec is off", () => {
    const config = withScope({ exec: false, trustedScriptHashes: [beaconScriptHash("echo hi")] })
    expect(evaluateBeacon("mcp__kanna__beacon_script", { beaconId: "b1", body: "echo hi" }, config)).toBe("auto-deny")
  })

  test("beacon_list is always allowed because it only reads metadata", () => {
    expect(evaluateBeacon("mcp__kanna__beacon_list", {})).toBe("auto-allow")
  })

  test("an unknown or disabled beacon is denied", () => {
    const args = { beaconId: "ghost", path: "/data/a" }
    expect(evaluateBeacon("mcp__kanna__beacon_read", args)).toBe("auto-deny")
    expect(evaluateBeacon("mcp__kanna__beacon_read", { beaconId: "b1", path: "/data/a" }, { ...beacon, enabled: false })).toBe("auto-deny")
  })

  test("an ask verdict forces a prompt even when the chat default is auto-allow", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__beacon_exec",
      args: { beaconId: "b1", cmd: "make" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
      beacons: [beacon],
    })
    expect(verdict.verdict).toBe("ask")
  })
})
