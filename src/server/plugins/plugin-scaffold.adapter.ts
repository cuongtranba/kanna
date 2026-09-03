/**
 * The only file allowed to write a scaffolded plugin to disk (side-effect
 * seal: `.adapter.ts`). The skeleton's CONTENT is decided by the pure
 * `plugin-scaffold.ts`; this file wraps `Bun.file` / `Bun.write` and holds no
 * policy beyond that.
 */

import { join } from "node:path"
import { KANNA_PLUGIN_MANIFEST_FILENAME } from "../../shared/plugins/manifest"
import type { PluginScaffoldFile } from "./plugin-scaffold"

/**
 * True when `dir` already holds a plugin manifest. `plugin_scaffold` refuses
 * in that case rather than overwriting: a scaffold is a create gesture, and
 * clobbering an author's entry file is not undoable from a tool call.
 */
export async function pluginDirHasManifest(dir: string): Promise<boolean> {
  return Bun.file(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME)).exists()
}

/** Writes every skeleton file, creating `dir` if needed. Returns the absolute paths written. */
export async function writePluginScaffold(
  dir: string,
  files: readonly PluginScaffoldFile[],
): Promise<readonly string[]> {
  const written: string[] = []
  for (const file of files) {
    const target = join(dir, file.path)
    await Bun.write(target, file.contents)
    written.push(target)
  }
  return written
}
