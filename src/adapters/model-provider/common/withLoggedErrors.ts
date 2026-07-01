import type { PluginRequestLogger } from "@adapters/settings/debugLogger";

/**
 * Run an async operation, forwarding any thrown error to the optional request
 * logger before rethrowing. Shared by the chat and embedding clients so the
 * error-logging contract stays in one place.
 */
export async function withLoggedErrors<T>(
  operation: () => Promise<T>,
  logger?: PluginRequestLogger,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger?.logError(error);
    throw error;
  }
}
