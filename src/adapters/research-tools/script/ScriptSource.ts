import type { Tool } from "@core/agent";
import type { ScriptRunner } from "@application/ports";
import type { ComputationRecorder, DataSource, DataSourceDescriptor } from "@application/sources";
import { RunJsTool } from "./RunJsTool";

export interface ScriptSourceOptions {
  runner: ScriptRunner;
  recorder: ComputationRecorder;
}

/** Offers sandboxed calculations as a research source whose results are recorded as computations. */
export class ScriptSource implements DataSource {
  readonly descriptor: DataSourceDescriptor = {
    id: "script",
    kind: "compute",
    title: "Calculations",
    available: true,
  };

  constructor(private readonly options: ScriptSourceOptions) {}

  tools(): Tool[] {
    return [
      new RunJsTool({ runner: this.options.runner, recorder: this.options.recorder }) as Tool,
    ];
  }
}
