import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const APP_DIR = "apps/beacon-desktop"
const ELECTROBUN_VERSION = "2.0.2"
const FONT = "bricolage-grotesque-latin-wght-normal.woff2"

interface BuildOptions {
  stageDir: string
  env: "dev" | "canary" | "stable"
  stageOnly: boolean
}

function readOptions(argv: readonly string[]): BuildOptions {
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const env = valueOf("--env") ?? "stable"
  if (env !== "dev" && env !== "canary" && env !== "stable") throw new Error(`unknown --env ${env}`)
  return {
    stageDir: resolve(valueOf("--out") ?? "dist-beacon-desktop/stage"),
    env,
    stageOnly: argv.includes("--stage-only"),
  }
}

async function bundle(label: string, config: Parameters<typeof Bun.build>[0]): Promise<void> {
  const result = await Bun.build(config)
  if (!result.success) {
    for (const message of result.logs) process.stderr.write(`${message}\n`)
    throw new Error(`build-beacon-desktop: ${label} failed to bundle`)
  }
}

async function stage(options: BuildOptions): Promise<void> {
  const src = join(options.stageDir, "src")
  rmSync(options.stageDir, { recursive: true, force: true })
  mkdirSync(join(src, "fonts"), { recursive: true })

  await bundle("main process", {
    entrypoints: [join(APP_DIR, "src/main.ts")],
    outdir: src,
    target: "bun",
    format: "esm",
    naming: "main.js",
    external: ["electrobun", "electrobun/*"],
  })
  await bundle("view", {
    entrypoints: [join(APP_DIR, "src/view.tsx")],
    outdir: src,
    target: "browser",
    format: "esm",
    naming: "view.js",
    minify: true,
    external: ["electrobun", "electrobun/*"],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  })
  await bundle("link helper", {
    entrypoints: ["src/beacon/desktop/open-link-entry.adapter.ts"],
    outdir: src,
    target: "bun",
    format: "esm",
    naming: "open-link.js",
  })

  const version = JSON.parse(readFileSync("package.json", "utf8")).version
  for (const file of ["electrobun.config.ts", "hutch.config.ts", "package.json"]) {
    const text = readFileSync(join(APP_DIR, file), "utf8").replaceAll("0.0.0-kanna", version)
    writeFileSync(join(options.stageDir, file), text)
  }
  cpSync(join(APP_DIR, "src/index.html"), join(src, "index.html"))
  cpSync("src/beacon/desktop/view/beacon-desktop.css", join(src, "beacon-desktop.css"))
  cpSync(join("node_modules/@fontsource-variable/bricolage-grotesque/files", FONT), join(src, "fonts", FONT))
  cpSync(join(APP_DIR, "assets"), join(options.stageDir, "assets"), { recursive: true })
}

async function buildApp(options: BuildOptions): Promise<number> {
  const npx = ["npx", "--yes", `electrobun@${ELECTROBUN_VERSION}`, "build", `--env=${options.env}`]
  const command = process.platform === "win32" ? ["cmd.exe", "/d", "/c", ...npx] : npx
  const child = Bun.spawn(command, {
    cwd: options.stageDir,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  return child.exited
}

async function main(): Promise<number> {
  const options = readOptions(process.argv.slice(2))
  await stage(options)
  process.stdout.write(`build-beacon-desktop: staged ${options.stageDir}\n`)
  if (options.stageOnly) return 0
  const code = await buildApp(options)
  if (code === 0) process.stdout.write(`build-beacon-desktop: built into ${join(options.stageDir, "build")}\n`)
  return code
}

process.exitCode = await main()
