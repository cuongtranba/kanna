export async function loadPackageVersion(): Promise<string> {
  const pkg = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as { version?: string }
  return pkg.version ?? "0.0.0"
}

export function getBunVersion(): string {
  return Bun.version
}
