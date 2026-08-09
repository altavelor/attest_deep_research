import { IxplorerError } from "@core/errors";
import type { SubAgentLogEvent, SubAgentLogger } from "@application/research";
import type {
  IndexingFileLogEvent,
  IndexingLogger,
  IndexingPerformanceLogEvent,
} from "@adapters/indexing/IndexingService";
import type { IxplorerSettings } from "./types";
import { redactSensitiveData } from "@shared";

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
  probe: string;
  profileId: string;
  model: string;

  received: unknown;

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

export class PluginDebugLogger implements PluginRequestLogger, IndexingLogger, SubAgentLogger {
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
      ...(redactSensitiveData(context) as RequestLogContext),
      settings: redactSensitiveData(settings),
    });
  }

  logResponse(context: ResponseLogContext): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Response", {
      ...(redactSensitiveData(context) as ResponseLogContext),
      settings: redactSensitiveData(settings),
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
      context: redactSensitiveData(context),
      error: redactSensitiveData(serializeError(error)),
      settings: redactSensitiveData(this.getSettings()),
    });
  }

  logProbeResult(context: ProbeLogContext): void {
    if (!this.getSettings().debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Probe result", redactSensitiveData(context));
  }

  logConfiguration(stage: string, settings: IxplorerSettings): void {
    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Configuration", {
      stage,
      settings: redactSensitiveData(settings),
    });
  }

  logIndexingFile(event: IndexingFileLogEvent): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Indexing file", {
      ...event,
      settings: redactSensitiveData(settings),
    });
  }

  logSubAgent(event: SubAgentLogEvent): void {
    if (!this.getSettings().debugMode) {
      return;
    }

    this.console.debug(`[Ixplorer] SubAgent ${event.type}`, redactSensitiveData(event));
  }

  logIndexingPerformance(event: IndexingPerformanceLogEvent): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Indexing performance", {
      ...event,
      settings: redactSensitiveData(settings),
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
