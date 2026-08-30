const unavailableFetch: typeof fetch = async () => {
  throw new Error("A fetch transport must be provided by the application runtime.");
};

export function fetchTransportOrUnavailable(transport: typeof fetch | undefined): typeof fetch {
  return transport ?? unavailableFetch;
}
