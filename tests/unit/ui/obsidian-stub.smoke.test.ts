// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  App,
  DropdownComponent,
  ItemView,
  Menu,
  MemoryDataAdapter,
  Notice,
  Plugin,
  Setting,
  TFile,
  WorkspaceLeaf,
  takeNotices,
} from "../../stubs/obsidian";

import {
  advanceTime,
  createContainer,
  pendingTimerCount,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

const VIEW_TYPE = "smoke-view";

class SmokeView extends ItemView {
  opened = 0;
  closed = 0;

  getViewType(): string {
    return VIEW_TYPE;
  }

  async onOpen(): Promise<void> {
    this.opened += 1;
    this.contentEl.createDiv({ cls: "smoke-body", text: "ready" });
  }

  async onClose(): Promise<void> {
    this.closed += 1;
    this.contentEl.empty();
  }
}

const LATE_VIEW_TYPE = "late-smoke-view";

class LateRegisteringView extends ItemView {
  readonly lifecycle: string[] = [];

  getViewType(): string {
    return LATE_VIEW_TYPE;
  }

  async onload(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.register(() => {});
    this.lifecycle.push("onload");
  }

  async onOpen(): Promise<void> {
    this.lifecycle.push("onOpen");
  }
}

class SmokePlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE, (leaf) => new SmokeView(leaf));
    this.addCommand({ id: "smoke", name: "Smoke", callback: () => {} });
  }
}

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  restoreDomTimers();
  resetDom();
});

describe("Plugin stub", () => {
  it("releases registered views and commands on unload", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();

    expect(plugin.commands).toHaveLength(1);
    expect(app.workspace.getViewFactory(VIEW_TYPE)).toBeDefined();

    plugin.unload();

    expect(plugin.commands).toHaveLength(0);
    expect(app.workspace.getViewFactory(VIEW_TYPE)).toBeUndefined();
  });

  it("leaves a replacement view factory registered when an earlier plugin unloads", async () => {
    const app = new App();
    const first = new SmokePlugin(app);
    const second = new SmokePlugin(app);
    await first.onload();
    await second.onload();
    const replacement = app.workspace.getViewFactory(VIEW_TYPE);

    first.unload();

    expect(app.workspace.getViewFactory(VIEW_TYPE)).toBe(replacement);
  });

  it("round-trips persisted data through loadData and saveData", async () => {
    const plugin = new SmokePlugin(new App());

    expect(await plugin.loadData()).toBeNull();
    await plugin.saveData({ debugMode: true });

    expect(await plugin.loadData()).toEqual({ debugMode: true });
  });
});

describe("Component registration bookkeeping", () => {
  it("removes DOM listeners registered through registerDomEvent on unload", () => {
    const view = new SmokeView(new App().workspace.createLeaf());
    const button = container.createEl("button");
    let clicks = 0;
    view.registerDomEvent(button, "click", () => {
      clicks += 1;
    });

    button.dispatchEvent(new Event("click"));
    view.unload();
    button.dispatchEvent(new Event("click"));

    expect(clicks).toBe(1);
  });
});

describe("Workspace and WorkspaceLeaf stubs", () => {
  it("instantiates the registered view and reports it by type", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();

    const leaf = app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });

    expect(app.workspace.getLeavesOfType(VIEW_TYPE)).toEqual([leaf]);
    expect((leaf.view as SmokeView).opened).toBe(1);
    expect(leaf.view?.contentEl.querySelector(".smoke-body")?.textContent).toBe("ready");
  });

  it("releases what the view registered when its leaf is detached", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE });
    const button = container.createEl("button");
    let clicks = 0;
    leaf.view?.registerDomEvent(button, "click", () => {
      clicks += 1;
    });

    await leaf.detach();
    button.dispatchEvent(new Event("click"));

    expect(clicks).toBe(0);
  });

  it("attaches the opened view to the document", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();
    const leaf = app.workspace.getLeaf(true);

    await leaf.setViewState({ type: VIEW_TYPE });

    expect(leaf.view?.containerEl.isConnected).toBe(true);
    expect(leaf.view?.contentEl.querySelector(".smoke-body")?.isConnected).toBe(true);

    await leaf.detach();

    expect(document.body.querySelector(".smoke-body")).toBeNull();
  });

  it("waits for an asynchronous onload before reporting the view as opened", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    plugin.registerView(LATE_VIEW_TYPE, (leaf) => new LateRegisteringView(leaf));
    const leaf = app.workspace.getLeaf(true);

    await leaf.setViewState({ type: LATE_VIEW_TYPE });

    const view = leaf.view as LateRegisteringView;
    expect(view.lifecycle).toEqual(["onload", "onOpen"]);
    expect(view.registrationCount()).toBe(1);
  });

  it("releases the previous view when a leaf is given a new view state", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE });
    const replaced = leaf.view as SmokeView;
    const button = container.createEl("button");
    let clicks = 0;
    replaced.registerDomEvent(button, "click", () => {
      clicks += 1;
    });

    await leaf.setViewState({ type: VIEW_TYPE });
    button.dispatchEvent(new Event("click"));

    expect(leaf.view).not.toBe(replaced);
    expect(replaced.closed).toBe(1);
    expect(clicks).toBe(0);
  });

  it("keeps the attached view when the requested view type is unknown", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE });
    const view = leaf.view as SmokeView;

    await expect(leaf.setViewState({ type: "unregistered" })).rejects.toThrow(
      'No view registered for type "unregistered".',
    );

    expect(leaf.view).toBe(view);
    expect(view.closed).toBe(0);
  });

  it("closes the view and drops the leaf on detach", async () => {
    const app = new App();
    const plugin = new SmokePlugin(app);
    await plugin.onload();
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE });
    const view = leaf.view as SmokeView;

    await leaf.detach();

    expect(view.closed).toBe(1);
    expect(app.workspace.getLeavesOfType(VIEW_TYPE)).toHaveLength(0);
  });

  it("records revealed leaves and opened links instead of touching a workspace", async () => {
    const app = new App();

    const leaf = app.workspace.createLeaf();
    await app.workspace.revealLeaf(leaf);
    await app.workspace.openLinkText("Notes/Target.md", "");

    expect(app.workspace.revealedLeaves).toEqual([leaf]);
    expect(app.workspace.openedLinks).toEqual([{ target: "Notes/Target.md", sourcePath: "" }]);
  });
});

describe("ItemView stub", () => {
  it("exposes the leaf's app and an empty content element", () => {
    const app = new App();
    const leaf = new WorkspaceLeaf(app.workspace);

    const view = new SmokeView(leaf);

    expect(view.app).toBe(app);
    expect(view.leaf).toBe(leaf);
    expect(view.contentEl.parentElement).toBe(view.containerEl);
  });
});

describe("Menu stub", () => {
  it("renders items as DOM nodes and invokes the click handler of enabled items", () => {
    const menu = new Menu();
    const chosen: string[] = [];
    menu.setUseNativeMenu(false);
    menu.addItem((item) => item.setTitle("Alpha").onClick(() => chosen.push("alpha")));
    menu.addItem((item) =>
      item
        .setTitle("Beta")
        .setDisabled(true)
        .onClick(() => chosen.push("beta")),
    );
    menu.showAtPosition({ x: 0, y: 0 });

    const items = Array.from(menu.dom.querySelectorAll<HTMLElement>(".menu-item"));
    items.forEach((item) => item.dispatchEvent(new Event("click")));

    expect(menu.dom.isConnected).toBe(true);
    expect(items.map((item) => item.textContent)).toEqual(["Alpha", "Beta"]);
    expect(chosen).toEqual(["alpha"]);

    menu.hide();

    expect(menu.dom.isConnected).toBe(false);
  });
});

describe("DropdownComponent stub", () => {
  it("reports the selected option through onChange", () => {
    const selected: string[] = [];
    const dropdown = new DropdownComponent(container);
    dropdown
      .addOption("a", "Alpha")
      .addOption("b", "Beta")
      .setValue("a")
      .onChange((value) => {
        selected.push(value);
      });

    dropdown.selectOption("b");

    expect(dropdown.getValue()).toBe("b");
    expect(selected).toEqual(["b"]);
  });

  it("is reachable through Setting.addDropdown", () => {
    let captured: DropdownComponent | null = null;
    new Setting(container).setName("Model").addDropdown((dropdown) => {
      captured = dropdown.addOption("x", "X");
    });

    expect(captured).toBeInstanceOf(DropdownComponent);
    expect(container.querySelectorAll("select option")).toHaveLength(1);
  });
});

describe("Vault stub", () => {
  it("serves the declared files and resolves them by path", () => {
    const app = new App();
    const note = new TFile("Notes/One.md", { size: 12 });
    app.vault.setFiles([note]);

    expect(app.vault.getFiles()).toEqual([note]);
    expect(app.vault.getAbstractFileByPath("Notes/One.md")).toBe(note);
    expect(app.vault.getAbstractFileByPath("Missing.md")).toBeNull();
  });

  it("stores adapter writes in memory so no test reaches the real filesystem", async () => {
    const app = new App();
    const adapter = app.vault.adapter as MemoryDataAdapter;

    expect(adapter).toBeInstanceOf(MemoryDataAdapter);

    await adapter.mkdir(".attest");
    await adapter.write(".attest/state.json", '{"ok":true}');

    expect(await adapter.read(".attest/state.json")).toBe('{"ok":true}');
    expect(await adapter.list(".attest")).toEqual({
      files: [".attest/state.json"],
      folders: [],
    });
    expect(await adapter.exists("/tmp/attest-test")).toBe(false);
  });
});

describe("Notice stub", () => {
  it("records raised notices and marks dismissed ones", () => {
    takeNotices();

    const notice = new Notice("Indexing finished");
    notice.hide();

    const raised = takeNotices();
    expect(raised.map((entry) => entry.message)).toEqual(["Indexing finished"]);
    expect(raised[0].isHidden).toBe(true);
    expect(takeNotices()).toEqual([]);
  });
});

describe("DOM helper additions", () => {
  it("reports class membership and appends text nodes", () => {
    const el = container.createDiv({ cls: "attest-chat" });

    expect(el.hasClass("attest-chat")).toBe(true);
    expect(el.hasClass("is-hidden")).toBe(false);

    el.appendText("first");
    el.appendText(" second");

    expect(el.textContent).toBe("first second");
  });
});

describe("fake timer harness", () => {
  it("advances window timers explicitly and reports pending ones", async () => {
    useDomFakeTimers();
    const fired: string[] = [];
    window.setTimeout(() => fired.push("late"), 1_000);

    await advanceTime(999);
    expect(fired).toEqual([]);
    expect(pendingTimerCount()).toBe(1);

    await advanceTime(1);
    expect(fired).toEqual(["late"]);
    expect(pendingTimerCount()).toBe(0);
  });

  it("advances animation frames", async () => {
    useDomFakeTimers();
    let frames = 0;
    window.requestAnimationFrame(() => {
      frames += 1;
    });

    await advanceTime(16);

    expect(frames).toBe(1);
  });
});
