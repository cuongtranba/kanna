import { join } from "node:path"
import { NATS_SERVER_VERSION } from "../../shared/service-bus/nats-server-version"

export const NATS_RELEASE_BASE = "https://github.com/nats-io/nats-server/releases/download"

export interface NatsServerTarget {
  platform: string
  arch: string
  asset: string
  folder: string
  binaryName: string
}

const SUPPORTED: readonly { platform: string; arch: string; nats: string }[] = [
  { platform: "darwin", arch: "arm64", nats: "darwin-arm64" },
  { platform: "darwin", arch: "x64", nats: "darwin-amd64" },
  { platform: "linux", arch: "arm64", nats: "linux-arm64" },
  { platform: "linux", arch: "x64", nats: "linux-amd64" },
]

export function natsServerTarget(platform: string, arch: string, version = NATS_SERVER_VERSION): NatsServerTarget | null {
  const match = SUPPORTED.find((entry) => entry.platform === platform && entry.arch === arch)
  if (match === undefined) return null
  const folder = `nats-server-v${version}-${match.nats}`
  return { platform, arch, asset: `${folder}.tar.gz`, folder, binaryName: "nats-server" }
}

export function unsupportedTargetMessage(platform: string, arch: string): string {
  return `Embedded mode supports macOS and Linux in this release (this machine is ${platform}-${arch}); use external mode`
}

export function installedBinaryPath(dataDir: string, version = NATS_SERVER_VERSION): string {
  return join(dataDir, "nats", "bin", `nats-server-v${version}`)
}

export function natsRuntimePaths(dataDir: string): { root: string; config: string; store: string; pid: string } {
  const root = join(dataDir, "nats")
  return { root, config: join(root, "server.conf"), store: join(root, "store"), pid: join(root, "nats-server.pid") }
}
