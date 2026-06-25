// Minimal ambient declarations for cross-platform Web primitives that the core
// legitimately uses (available in both browsers and Node). Declared here so the
// platform-neutral typecheck (tsconfig.core.json) can run without pulling in the
// full DOM lib, which would otherwise allow accidental UI coupling.

interface AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
