import { errorMessage, toError } from "../../shared/errors"
import {
  buildPluginBundlesInProcess,
  PLUGIN_BUILD_RESULT_MARKER,
  type BuildPluginBundlesResult,
} from "./plugin-build.adapter"

function writeVerdict(result: BuildPluginBundlesResult): Promise<void> {
  return new Promise((resolveWrite) => {
    process.stdout.write(`${PLUGIN_BUILD_RESULT_MARKER}${JSON.stringify(result)}\n`, () => resolveWrite())
  })
}

async function main(): Promise<void> {
  const sourceDir = process.argv[2]
  const entry = process.argv[3]
  const result =
    sourceDir !== undefined && entry !== undefined
      ? await buildPluginBundlesInProcess({ sourceDir, entry })
      : { ok: false as const, errors: ["plugin build child needs sourceDir and entry arguments"] }
  await writeVerdict(result)
  process.exit(0)
}

void main().catch(async (error) => {
  await writeVerdict({ ok: false, errors: [errorMessage(toError(error))] })
  process.exit(0)
})
