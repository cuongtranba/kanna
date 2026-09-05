
import { join } from "node:path"
import { KANNA_PLUGIN_MANIFEST_FILENAME } from "../../shared/plugins/manifest"
import type { PluginScaffoldFile } from "./plugin-scaffold"

export async function pluginDirHasManifest(dir: string): Promise<boolean> {
  return Bun.file(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME)).exists()
}

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
