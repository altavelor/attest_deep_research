import { IxplorerError } from "../shared/errors";
import type { IxplorerSettings } from "./settings";

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

export interface PluginRequestLogger {
  logRequest(context: RequestLogContext): void;
  logResponse(context: ResponseLogContext): void;
  logError(error: unknown, context?: Partial<RequestLogContext>): void;
}

export interface PluginDebugLoggerOptions {
  getSettings: () => IxplorerSettings;
  console?: Pick<Console, "debug" | "error">;
}

export class PluginDebugLogger implements PluginRequestLogger {
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
      ...context,
      settings,
    });
  }

  logResponse(context: ResponseLogContext): void {
    const settings = this.getSettings();

    if (!settings.debugMode) {
      return;
    }

    this.console.debug("[Ixplorer] Response", {
      ...context,
      settings,
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
      settings: this.getSettings(),
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
