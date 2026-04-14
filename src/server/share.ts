import { existsSync } from "node:fs"
import { renderANSI } from "uqr"
import { Tunnel, bin as cloudflaredBin, install as installCloudflared } from "cloudflared"

export interface StartedShareTunnel {
  publicUrl: string
  stop: () => void
}

export interface ShareTunnelProcess {
  once(event: "url", listener: (url: string) => void): ShareTunnelProcess
  once(event: "error", listener: (error: Error) => void): ShareTunnelProcess
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): ShareTunnelProcess
  off(event: "url", listener: (url: string) => void): ShareTunnelProcess
  off(event: "error", listener: (error: Error) => void): ShareTunnelProcess
  off(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): ShareTunnelProcess
  stop(): boolean
}

export interface ShareTunnelDeps {
  cloudflaredBin?: string
  existsSync?: (path: string) => boolean
  installCloudflared?: (to: string) => Promise<string>
  createQuickTunnel?: (localUrl: string) => ShareTunnelProcess
  log?: (message: string) => void
}

export async function renderTerminalQr(url: string) {
  return renderANSI(url, {
    ecc: "L",
    border: 2,
  })
}

export async function ensureCloudflaredInstalled(
  deps: ShareTunnelDeps = {},
) {
  const resolvedBin = deps.cloudflaredBin ?? cloudflaredBin
  const fileExists = deps.existsSync ?? existsSync
  const installBinary = deps.installCloudflared ?? installCloudflared

  if (fileExists(resolvedBin)) {
    return resolvedBin
  }

  deps.log?.("installing cloudflared binary")
  await installBinary(resolvedBin)
  return resolvedBin
}

export async function startShareTunnel(localUrl: string, deps: ShareTunnelDeps = {}): Promise<StartedShareTunnel> {
  await ensureCloudflaredInstalled(deps)
  const tunnel = (deps.createQuickTunnel ?? ((url) => Tunnel.quick(url)))(localUrl)

  const publicUrl = await new Promise<string>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      tunnel.off("url", handleUrl)
      tunnel.off("error", handleError)
      tunnel.off("exit", handleExit)
    }

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const handleUrl = (url: string) => {
      settle(() => resolve(url))
    }

    const handleError = (error: Error) => {
      settle(() => reject(error))
    }

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle(() => reject(new Error(`Cloudflare tunnel exited before a public URL was ready (code: ${String(code)}, signal: ${String(signal)})`)))
    }

    tunnel.once("url", handleUrl)
    tunnel.once("error", handleError)
    tunnel.once("exit", handleExit)
  })

  return {
    publicUrl,
    stop: () => {
      tunnel.stop()
    },
  }
}

export async function logShareDetails(
  log: (message: string) => void,
  publicUrl: string,
  localUrl: string,
  renderShareQrImpl: (url: string) => Promise<string> = renderTerminalQr,
) {
  const qrCode = await renderShareQrImpl(publicUrl)

  log("QR Code:")
  log(qrCode.trimEnd())
  log("")
  log("Public URL:")
  log(publicUrl)
  log("")
  log("Local URL:")
  log(localUrl)
}
