export interface ObjectUrlTracker {
  created: string[];
  revoked: string[];
  live(): string[];
  restore(): void;
}

/**
 * Replaces URL.createObjectURL/revokeObjectURL with counting fakes so tests can
 * assert that every object URL a renderer allocates is released again.
 */
export function trackObjectUrls(): ObjectUrlTracker {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let counter = 0;

  URL.createObjectURL = () => {
    const url = `blob:test/${++counter}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };

  return {
    created,
    revoked,
    live: () => created.filter((url) => !revoked.includes(url)),
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    },
  };
}
