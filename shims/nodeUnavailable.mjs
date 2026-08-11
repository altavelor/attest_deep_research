/*
 * Stands in for Node built-ins that a bundled dependency imports but this
 * plugin never reaches. Obsidian Mobile has no Node runtime, so shipping the
 * real module is impossible; failing loudly on first use is better than
 * silently resolving to an empty object.
 *
 * Only add a built-in to the esbuild alias list after confirming the importing
 * code path is unreachable. Plugin code must use a port instead.
 */

function unavailable(property) {
  throw new Error(
    `Node built-in API "${String(property)}" is unavailable: this plugin runs in Obsidian's browser runtime.`,
  );
}

const handler = {
  get(_target, property) {
    if (property === "__esModule" || property === Symbol.toStringTag) {
      return undefined;
    }

    return unavailable(property);
  },
};

const stub = new Proxy({}, handler);

export const promises = stub;

export const basename = (...args) => unavailable("basename", args);
export const dirname = (...args) => unavailable("dirname", args);
export const join = (...args) => unavailable("join", args);
export const resolve = (...args) => unavailable("resolve", args);
export const createReadStream = (...args) => unavailable("createReadStream", args);
export const readFileSync = (...args) => unavailable("readFileSync", args);

export default stub;
