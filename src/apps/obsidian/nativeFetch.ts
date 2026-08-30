import { fetchTransportOrUnavailable } from "@shared";

export const nativeWindowFetch: typeof fetch = (input, init) =>
  typeof window === "undefined"
    ? fetchTransportOrUnavailable(undefined)(input, init)
    : window.fetch(input, init);
