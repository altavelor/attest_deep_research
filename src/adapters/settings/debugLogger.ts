import { AttestError } from "@core/errors";
import type { SubAgentLogEvent, SubAgentLogger } from "@application/research";
import type {
  IndexingFileLogEvent,
  IndexingLogger,
  IndexingPerformanceLogEvent,
} from "@adapters/indexing/IndexingService";
import type { AttestSettings } from "./types";
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
  getSettings: () => AttestSettings;
  console?: Pick<Console, "debug" | "error">;
}

export class PluginDebugLogger implements PluginRequestLogger, IndexingLogger, SubAgentLogger {
  private readonly getSettings: () => AttestSettings;
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

    this.console.debug("[Attest] Request", {
      ...redactSensitiveData(context),
      settings: redactSensitiveData(settings),
    });
  }

  logResponse(context: ResponseLogContext): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Attest] Response", {
      ...redactSensitiveData(context),
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

    this.console.error("[Attest] Error", {
      context: redactSensitiveData(context),
      error: redactSensitiveData(serializeError(error)),
      settings: redactSensitiveData(this.getSettings()),
    });
  }

  logProbeResult(context: ProbeLogContext): void {
    if (!this.getSettings().debugMode) {
      return;
    }

    this.console.debug("[Attest] Probe result", redactSensitiveData(context));
  }

  logConfiguration(stage: string, settings: AttestSettings): void {
    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Attest] Configuration", {
      stage,
      settings: redactSensitiveData(settings),
    });
  }

  logIndexingFile(event: IndexingFileLogEvent): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Attest] Indexing file", {
      ...event,
      settings: redactSensitiveData(settings),
    });
  }

  logSubAgent(event: SubAgentLogEvent): void {
    if (!this.getSettings().debugMode) {
      return;
    }

    this.console.debug(`[Attest] SubAgent ${event.type}`, redactSensitiveData(event));
  }

  logIndexingPerformance(event: IndexingPerformanceLogEvent): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Attest] Indexing performance", {
      ...event,
      settings: redactSensitiveData(settings),
    });
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof AttestError) {
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
