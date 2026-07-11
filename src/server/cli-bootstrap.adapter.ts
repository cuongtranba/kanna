export async function loadPackageVersion(): Promise<string> {
  const pkg: { version?: string } = await Bun.file(new URL("../../package.json", import.meta.url)).json()
  return pkg.version ?? "0.0.0"
}

export function getBunVersion(): string {
  return Bun.version
}
