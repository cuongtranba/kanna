import type { JsonObject } from "../shared/json"
import { ANALYTICS_ENDPOINT } from "../shared/analytics"
import { PROD_SERVER_PORT } from "../shared/ports"
import type { ShareMode } from "../shared/share"
import { isTokenShareMode } from "../shared/share"
import { log } from "../shared/log"
import { createSerialQueue } from "./serial-lane"
interface AnalyticsRequestBody {
  userId: string
  environment: AnalyticsEnvironment
  event: {
    name: string
    properties: JsonObject
  }
}

export interface LaunchAnalyticsOptions {
  port: number
  host: string
  openBrowser: boolean
  share: ShareMode
  password: string | null
  strictPort: boolean
}

type AnalyticsLogger = Pick<typeof log, "info" | "warn">

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type AnalyticsEnvironment = "dev" | "prod"

function isAnalyticsLoggingEnabled() {
  return process.env.KANNA_LOG_ANALYTICS === "1"
}

export interface AnalyticsReporter {
  track: (eventName: string, properties?: JsonObject) => void
  trackLaunch: (options: LaunchAnalyticsOptions) => void
}

interface AnalyticsSettings {
  getState: () => {
    analyticsEnabled: boolean
    analyticsUserId: string
  }
}

export class KannaAnalyticsReporter implements AnalyticsReporter {
  private readonly settings: AnalyticsSettings
  private readonly endpoint: string
  private readonly fetchImpl: FetchLike
  private readonly currentVersion: string
  private readonly environment: AnalyticsEnvironment
  private readonly logger: AnalyticsLogger
  private readonly isLoggingEnabled: () => boolean
  private readonly queue = createSerialQueue()

  constructor(args: {
    settings: AnalyticsSettings
    currentVersion: string
    environment: AnalyticsEnvironment
    endpoint?: string
    fetchImpl?: FetchLike
    logger?: AnalyticsLogger
    isLoggingEnabled?: () => boolean
  }) {
    this.settings = args.settings
    this.currentVersion = args.currentVersion
    this.environment = args.environment
    this.endpoint = args.endpoint ?? ANALYTICS_ENDPOINT
    this.fetchImpl = args.fetchImpl ?? fetch
    this.logger = args.logger ?? log
    this.isLoggingEnabled = args.isLoggingEnabled ?? isAnalyticsLoggingEnabled
  }

  track(eventName: string, properties?: JsonObject) {
    const { analyticsEnabled, analyticsUserId } = this.settings.getState()
    if (!analyticsEnabled || !analyticsUserId) {
      return
    }

    const body: AnalyticsRequestBody = {
      userId: analyticsUserId,
      environment: this.environment,
      event: {
        name: eventName,
        properties: this.buildEventProperties(properties),
      },
    }

    this.queue
      .run(async () => {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        })
        if (!response.ok) {
          throw new Error(`Analytics request failed with status ${response.status}`)
        }
        if (this.isLoggingEnabled()) {
          this.logger.info("[kanna/analytics] Sent analytics event:", eventName, response.status)
        }
      })
      .catch((error) => {
        if (this.isLoggingEnabled()) {
          this.logger.warn("[kanna/analytics] Failed to send analytics event:", eventName, error)
        }
      })
  }

  flush(): Promise<void> {
    return this.queue.run(async () => {})
  }

  trackLaunch(options: LaunchAnalyticsOptions) {
    this.track("app_launch", getLaunchAnalyticsProperties(options))
  }

  private buildEventProperties(properties?: JsonObject) {
    return {
      current_version: this.currentVersion,
      environment: this.environment,
      ...(properties ?? {}),
    }
  }
}

export function getLaunchAnalyticsProperties(options: LaunchAnalyticsOptions) {
  return {
    custom_port_enabled: options.port !== PROD_SERVER_PORT,
    no_open_enabled: !options.openBrowser,
    password_enabled: Boolean(options.password),
    strict_port_enabled: options.strictPort,
    remote_enabled: options.host === "0.0.0.0",
    host_enabled: options.host !== "0.0.0.0" && options.host !== "127.0.0.1" && options.host !== "localhost",
    share_quick_enabled: options.share === "quick",
    share_token_enabled: isTokenShareMode(options.share),
  }
}

export const NoopAnalyticsReporter: AnalyticsReporter = {
  track: () => {},
  trackLaunch: () => {},
}
