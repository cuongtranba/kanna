function stripTrailingSeparators(path: string): string {
  return path.replace(/[/\\]+$/, "")
}

export function shortenHomePath(path: string, homeDir: string): string {
  const target = stripTrailingSeparators(path)
  const home = stripTrailingSeparators(homeDir)
  if (target === home) return "~"
  for (const separator of ["/", "\\"]) {
    if (target.startsWith(home + separator)) {
      return `~/${target.slice(home.length + 1).replace(/\\/g, "/")}`
    }
  }
  return target
}
