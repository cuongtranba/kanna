import http from "node:http"
import type { AddressInfo } from "node:net"

export type HttpRequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void

export interface HttpServerHandle {
  port: number
  close: () => Promise<void>
}

export function createHttpServer(handler: HttpRequestHandler) {
  const server = http.createServer(handler)
  server.requestTimeout = 0
  server.timeout = 0
  server.keepAliveTimeout = 0
  return server
}

export function listen(server: http.Server, port: number, host: string): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      const addr = server.address()
      if (!addr || typeof addr !== "object") { reject(new Error("server.address() is not an AddressInfo")); return }
      resolve(addr)
    })
  })
}

export function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

export type HttpServer = http.Server
export type HttpIncomingMessage = http.IncomingMessage
export type HttpServerResponse = http.ServerResponse
