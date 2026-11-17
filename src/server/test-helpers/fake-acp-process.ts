import { EventEmitter } from "node:events"
import { createInterface } from "node:readline"
import { PassThrough } from "node:stream"
import { isJsonObject, objectField, safeJsonParse, stringField, type JsonObject, type JsonValue } from "../../shared/json"
import type { StdioProcess } from "../stdio-process"

export interface FakeAcpRequest {
  id: number | string | null
  method: string
  params: JsonObject
}

export class FakeAcpAgent extends EventEmitter implements StdioProcess {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly requests: FakeAcpRequest[] = []
  killed = false
  private model = "gemini-4-carbon"
  private thoughtLevel = "medium"

  constructor(
    private readonly script: (request: FakeAcpRequest, agent: FakeAcpAgent) => void,
    private readonly sessionId = "sess-1",
  ) {
    super()
    const lines = createInterface({ input: this.stdin })
    lines.on("line", (line) => {
      const message = safeJsonParse(line)
      if (message === null || !isJsonObject(message)) return
      const id = message.id
      const request: FakeAcpRequest = {
        id: typeof id === "string" || typeof id === "number" ? id : null,
        method: stringField(message, "method") ?? "",
        params: objectField(message, "params") ?? {},
      }
      this.requests.push(request)
      this.script(request, this)
    })
  }

  methods(): string[] {
    return this.requests.map((request) => request.method)
  }

  setConfigCalls(): string[] {
    return this.requests
      .filter((request) => request.method === "session/set_config_option")
      .map((request) => `${stringField(request.params, "configId")}=${stringField(request.params, "value")}`)
  }

  answerSetup(request: FakeAcpRequest): boolean {
    if (request.id === null) return false
    switch (request.method) {
      case "initialize":
        this.respond(request.id, { protocolVersion: 1 })
        return true
      case "session/new":
        this.respond(request.id, { sessionId: this.sessionId, configOptions: this.configOptions() })
        return true
      case "session/resume":
        this.respond(request.id, { sessionId: stringField(request.params, "sessionId") ?? this.sessionId, configOptions: this.configOptions() })
        return true
      case "session/set_config_option": {
        const value = stringField(request.params, "value") ?? ""
        if (request.params.configId === "model") this.model = value
        else this.thoughtLevel = value
        this.respond(request.id, { configOptions: this.configOptions() })
        return true
      }
      case "session/set_mode":
        this.respond(request.id, {})
        return true
      default:
        return false
    }
  }

  respond(id: number | string, result: JsonValue) {
    this.send({ jsonrpc: "2.0", id, result })
  }

  fail(id: number | string, message: string) {
    this.send({ jsonrpc: "2.0", id, error: { code: -32603, message } })
  }

  update(update: JsonObject, sessionId = this.sessionId) {
    this.send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } })
  }

  send(message: JsonObject) {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  exit(code: number) {
    this.stderr.once("end", () => {
      this.emit("close", code)
    })
    this.stderr.end()
  }

  kill() {
    this.killed = true
    this.emit("close", 0)
  }

  private configOptions(): JsonValue {
    return [
      { id: "model", currentValue: this.model },
      { id: "thought_level", currentValue: this.thoughtLevel },
    ]
  }
}
