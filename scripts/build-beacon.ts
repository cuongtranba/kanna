import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { BEACON_RELEASE_TARGETS, type BeaconReleaseTarget } from "../src/beacon/self-update"

const ENTRY = "src/beacon/entry.adapter.ts"
const OUT_DIR = "dist-beacon"

const TARGETS = BEACON_RELEASE_TARGETS

function selectTargets(argv: readonly string[]): readonly BeaconReleaseTarget[] {
  if (!argv.includes("--host")) return TARGETS
  const host = TARGETS.find((target) => target.platform === process.platform && target.arch === process.arch)
  if (!host) {
    throw new Error(`no beacon target for host ${process.platform}-${process.arch}`)
  }
  return [host]
}

async function compile(target: BeaconReleaseTarget): Promise<boolean> {
  const outfile = join(OUT_DIR, target.asset)
  const child = Bun.spawn(
    ["bun", "build", "--compile", `--target=${target.bunTarget}`, `--outfile=${outfile}`, ENTRY],
    { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
  )
  const code = await child.exited
  if (code !== 0) {
    process.stderr.write(`build-beacon: ${target.bunTarget} failed with exit code ${code}\n`)
    return false
  }
  return true
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

async function main(): Promise<number> {
  const targets = selectTargets(process.argv.slice(2))
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const built: BeaconReleaseTarget[] = []
  let failed = false
  for (const target of targets) {
    if (await compile(target)) built.push(target)
    else failed = true
  }

  const sums = built.map((target) => `${sha256Of(join(OUT_DIR, target.asset))}  ${target.asset}\n`).join("")
  writeFileSync(join(OUT_DIR, "SHA256SUMS"), sums)
  process.stdout.write(`build-beacon: ${built.length}/${targets.length} binaries in ${OUT_DIR}/\n`)
  return failed ? 1 : 0
}

process.exitCode = await main()
