import { Plugin } from "obsidian";

export default class IxplorerPlugin extends Plugin {
  async onload(): Promise<void> {
    // Registration hooks will be added by the feature tasks that introduce them.
  }

  onunload(): void {
    // No runtime resources are registered in the foundation scaffold.
  }
}
