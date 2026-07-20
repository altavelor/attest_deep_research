/**
 * WHATWG globals that every build target provides (Node, browsers, Electron,
 * Deno, Bun) but that ECMAScript itself does not define, so `lib: ["ES2022"]`
 * omits them.
 *
 * The platform-neutrality check in tsconfig.core.json runs with `types: []` and
 * no DOM lib, which is what keeps `document`, `window` and Node APIs out of
 * core. Without this file that same setting also rejects standard web globals —
 * conflating "not available everywhere" with "not part of the language".
 * Declaring them here draws the line where it belongs: core may rely on the
 * language and on web standards, never on a specific platform.
 *
 * The shapes are spelled out structurally on purpose. Aliasing them to
 * `typeof globalThis.X` is self-referential under `types: []` and silently
 * resolves to `any`, which would make the whole check vacuous.
 *
 * Add to this file only globals that are genuinely universal. Anything Node- or
 * Obsidian-specific belongs behind a port in `application/ports`.
 */

interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(callback: (value: string, key: string, parent: URLSearchParams) => void): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

declare const URLSearchParams: {
  prototype: URLSearchParams;
  new (init?: string[][] | Record<string, string> | string | URLSearchParams): URLSearchParams;
};

interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}

declare const URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  canParse(url: string | URL, base?: string): boolean;
  parse(url: string | URL, base?: string): URL | null;
};

interface TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}

declare const TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string;
}

declare const TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoder;
};
