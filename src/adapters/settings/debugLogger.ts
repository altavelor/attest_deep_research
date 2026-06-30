import { IxplorerError } from "../../core/errors";
import type {
  DeepResearchLogEvent,
  DeepResearchLogger,
} from "../../application/research/deepResearchPort";
import type {
  IndexingFileLogEvent,
  IndexingLogger,
  IndexingPerformanceLogEvent,
} from "../indexing/IndexingService";
import type { IxplorerSettings } from "./types";

export interface RequestLogContext {
  url: string;
  method: string;
  headers?: unknown;
  requestBody?: unknown;
}

export interface ResponseLogContext extends RequestLogContext {
  status: number;
  statusText: string;
  responseBody?: unknown;
}

export interface ProbeLogContext {
  /** Which probe produced the result, e.g. "tool-capabilities". */
  probe: string;
  profileId: string;
  model: string;
  /** The capability values the probe returned. */
  received: unknown;
  /** The values that were persisted onto the profile / cache. */
  saved: unknown;
}

export interface PluginRequestLogger {
  logRequest(context: RequestLogContext): void;
  logResponse(context: ResponseLogContext): void;
  logError(error: unknown, context?: Partial<RequestLogContext>): void;
}

export interface PluginDebugLoggerOptions {
  getSettings: () => IxplorerSettings;
  console?: Pick<Console, "debug" | "error">;
}

export class PluginDebugLogger
  implements PluginRequestLogger, IndexingLogger, DeepResearchLogger
{
  private readonly getSettings: () => IxplorerSettings;
  private readonly console: Pick<Console, "debug" | "error">;
  private readonly loggedErrors = new WeakSet<object>();

  constructor(options: PluginDebugLoggerOptions) {
    this.getSettings = options.getSettings;
    this.console = options.console ?? console;
  }

  logRequest(context: RequestLogContext): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Request", {
      ...(redactLogValue(context) as RequestLogContext),
      settings: redactLogValue(settings),
    });
  }

  logResponse(context: ResponseLogContext): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Response", {
      ...(redactLogValue(context) as ResponseLogContext),
      settings: redactLogValue(settings),
    });
  }

  logError(error: unknown, context: Partial<RequestLogContext> = {}): void {
    if (isObject(error)) {
      if (this.loggedErrors.has(error)) {
        return;
      }

      this.loggedErrors.add(error);
    }

    this.console.error("[Ixplorer] Error", {
      context,
      error: serializeError(error),
      settings: redactLogValue(this.getSettings()),
    });
  }

  logProbeResult(context: ProbeLogContext): void {
    if (!this.getSettings().debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Probe result", redactLogValue(context));
  }

  logConfiguration(stage: string, settings: IxplorerSettings): void {
    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Configuration", {
      stage,
      settings: redactLogValue(settings),
    });
  }

  logIndexingFile(event: IndexingFileLogEvent): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Indexing file", {
      ...event,
      settings: redactLogValue(settings),
    });
  }

  logDeepResearch(event: DeepResearchLogEvent): void {
    if (!this.getSettings().debugMode) {
      return;
    }

    this.console.debug(`[Ixplorer] DeepResearch ${event.type}`, redactLogValue(event));
  }

  logIndexingPerformance(event: IndexingPerformanceLogEvent): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Indexing performance", {
      ...event,
      settings: redactLogValue(settings),
    });
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof IxplorerError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }

  if (!isObject(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    redacted[key] =
      normalizedKey === "apikey" ||
        normalizedKey === "api_key" ||
        normalizedKey === "authorization" ||
        normalizedKey.includes("api-key")
        ? "[redacted]"
        : redactLogValue(item);
  }
  return redacted;
}
