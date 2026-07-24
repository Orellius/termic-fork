import { archiveTask, openTask, requireTermicApi, snap, waitForAppShell, waitForText, waitVisible } from "../helpers";

// Settings/preferences subsystem. Guards that a real toggle in the Settings
// overlay flips the pref in the prefs store and the control reflects it.
describe("settings", () => {
  const LABEL = "Work-in-progress indicator";
  let original: boolean | undefined;

  after(async () => {
    // Restore the pref so repeated runs start from the same state (prefs
    // persist to the profile's settings.json).
    if (original === undefined) return;
    await browser.execute((v) => {
      window.__termic!.usePrefs.getState().setWorkingIndicator(v);
    }, original);
  });

  it("toggles a preference and it lands in the prefs store", async () => {
    await waitForAppShell();
    await requireTermicApi();

    // Open Settings -> Notifications, where the indicator toggles live since
    // General was split into per-domain pages.
    await browser.execute(() =>
      window.__termic!.useApp.getState().openSettings("notifications"),
    );
    await waitForText(LABEL);

    original = await browser.execute(
      () => window.__termic!.usePrefs.getState().workingIndicator,
    );

    // Click the actual toggle switch in that setting's row.
    await browser.execute((lbl) => {
      const labelEl = [...document.querySelectorAll("div")].find(
        (d) => d.textContent?.trim() === lbl,
      );
      const sw = labelEl
        ?.closest(".justify-between")
        ?.querySelector('[role="switch"]') as HTMLElement | null;
      if (!sw) throw new Error("toggle switch not found for: " + lbl);
      sw.click();
    }, LABEL);

    // The prefs store must reflect the flip (poll, don't sleep).
    await browser.waitUntil(
      () =>
        browser.execute(
          (orig) =>
            window.__termic!.usePrefs.getState().workingIndicator !== orig,
          original,
        ),
      { timeout: 8_000, timeoutMsg: "workingIndicator pref never changed" },
    );

    // ...and the switch's aria-checked must agree with the new store value.
    const now = await browser.execute(
      () => window.__termic!.usePrefs.getState().workingIndicator,
    );
    const checked = await browser.execute((lbl) => {
      const labelEl = [...document.querySelectorAll("div")].find(
        (d) => d.textContent?.trim() === lbl,
      );
      return labelEl
        ?.closest(".justify-between")
        ?.querySelector('[role="switch"]')
        ?.getAttribute("aria-checked");
    }, LABEL);
    expect(checked).toBe(String(now));

    await snap("settings.png");
  });
});

// The settings rail. General used to be an 18-block scroll; it is now split
// into General / Tasks / Notifications / Sandbox / CLI, with two settings
// rehomed into Appearance and Agents & Terminals. These cases pin each page
// to a control that lives ONLY there, so a section landing on the wrong rail
// item fails here instead of in a bug report.
describe("settings rail", () => {
  after(async () => {
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings());
  });

  /** Click a rail item by its label. Not clickByText: the CLI item carries an
   *  "exp" badge inside the button, so its textContent is "CLIexp". Scoped to
   *  the settings rail, since the app's own sidebar is an <aside> too and sits
   *  in the DOM behind the overlay. */
  const clickRail = (label: string) =>
    browser.execute((l) => {
      const el = [
        ...document.querySelectorAll('[data-testid="settings-rail"] button'),
      ].find((b) => b.querySelector("span")?.textContent?.trim() === l);
      if (!el) throw new Error(`no rail item: ${l}`);
      (el as HTMLElement).click();
    }, label);

  /** Appearance's sub-tab strip (Editor / Terminal / Interface). */
  const clickAppearanceTab = (id: string) =>
    browser.execute((t) => {
      const el = document.querySelector(`[data-appearance-tab="${t}"]`);
      if (!el) throw new Error(`no appearance tab: ${t}`);
      (el as HTMLElement).click();
    }, id);

  /** Visible text of the content pane only, so a negative assertion can't be
   *  satisfied (or defeated) by the sidebar behind the overlay. */
  const paneText = () =>
    browser.execute(
      () =>
        (document.querySelector('[data-testid="settings-pane"]') as HTMLElement | null)
          ?.innerText ?? "",
    );

  // Rail order, top to bottom, each pinned to a control that lives ONLY on
  // that page. Band order is meaningful (opened-by-choice, set-once, then the
  // perimeter — see docs/ui.md), so the sequence is asserted, not just the
  // membership.
  const pages: Array<[string, string, string]> = [
    ["general", "General", "Repos directory"],
    ["appearance", "Appearance", "Terminal font"],
    ["agents", "Agents & Terminals", "Copy on select"],
    ["tasks", "Tasks", "Branch prefix"],
    ["notifications", "Notifications", "Desktop notifications"],
    ["prompts", "Prompts", "Prompts"],
    ["shortcuts", "Shortcuts", "Shortcuts"],
    ["sandbox", "Sandbox", "Global sandbox defaults"],
    ["cli", "Termic CLI", "Enable CLI"],
  ];

  it("lists every page in band order", async () => {
    await waitForAppShell();
    await requireTermicApi();
    await browser.execute(() => window.__termic!.useApp.getState().openSettings("general"));
    await waitForText("Repos directory");

    const ids = await browser.execute(() =>
      [...document.querySelectorAll("[data-rail-item]")].map((b) =>
        b.getAttribute("data-rail-item"),
      ),
    );
    expect(ids).toEqual(pages.map(([id]) => id));
  });

  it("opens each page from the rail", async () => {
    for (const [, label, marker] of pages) {
      await clickRail(label);
      await waitForText(marker);
    }
    await snap("settings-rail.png");
  });

  // A rail entry whose tab id has no route in Settings.tsx renders an empty
  // pane: the click "works", the page is blank. Walk the rail from the DOM
  // (not a hard-coded list) so a future entry is covered the day it is added.
  it("routes every rail entry to a non-empty page", async () => {
    const ids: string[] = await browser.execute(() =>
      [...document.querySelectorAll("[data-rail-item]")].map(
        (b) => b.getAttribute("data-rail-item") as string,
      ),
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      await browser.execute((t) => {
        (document.querySelector(`[data-rail-item="${t}"]`) as HTMLElement).click();
      }, id);
      await browser.waitUntil(
        async () => ((await paneText()).trim().length ?? 0) > 40,
        { timeout: 8_000, timeoutMsg: `rail item "${id}" rendered an empty pane` },
      );
    }
  });

  it("marks the CLI page experimental", async () => {
    await clickRail("Termic CLI");
    await waitForText("Enable CLI");
    await waitForText("Experimental");
  });

  it("keeps General short: task, sandbox and notification settings moved off it", async () => {
    await clickRail("General");
    await waitForText("Repos directory");
    const pane = await paneText();
    for (const gone of ["Branch prefix", "Desktop notifications", "Sandbox new tasks by default", "Enable CLI"]) {
      expect(pane).not.toContain(gone);
    }
  });

  it("rehomes task expand behavior to Appearance and copy on select to Agents & Terminals", async () => {
    await clickRail("Appearance");
    await clickAppearanceTab("interface");
    await waitForText("Task expand behavior");
    await clickRail("Agents & Terminals");
    await waitForText("Copy on select");
  });

  // Appearance carries three sub-tabs. Terminal leads (the embedded terminal
  // is the product), which is why the live preview is click-armed: see the
  // pty case below.
  it("splits Appearance into Terminal, Editor and Interface", async () => {
    await clickRail("Appearance");
    await waitForText("Terminal font");

    const ids = await browser.execute(() =>
      [...document.querySelectorAll("[data-appearance-tab]")].map((b) =>
        b.getAttribute("data-appearance-tab"),
      ),
    );
    expect(ids).toEqual(["terminal", "editor", "interface"]);

    // Landing tab is Terminal, and the editor controls are not on it.
    const terminalPane = await paneText();
    expect(terminalPane).toContain("Terminal scrollback");
    expect(terminalPane).not.toContain("Code ligatures");

    await clickAppearanceTab("editor");
    await waitForText("Code ligatures");
    const editorPane = await paneText();
    expect(editorPane).toContain("Editor font");
    expect(editorPane).not.toContain("Terminal scrollback");

    await clickAppearanceTab("interface");
    await waitForText("UI zoom");
    const interfacePane = await paneText();
    expect(interfacePane).toContain("Dim inactive split panes");
    expect(interfacePane).not.toContain("Terminal font");
  });

  it("does not spawn the preview pty until the preview is armed", async () => {
    // TerminalPreview is a real AuxTerminal. Terminal being the landing tab
    // must not mean a settings visit forks a shell in $HOME, so a fresh open
    // shows the placeholder and mounts nothing.
    await clickRail("General");
    await clickRail("Appearance");
    await waitForText("Terminal font");
    const canvasesOnArrival = await browser.execute(
      () =>
        document.querySelectorAll('[data-testid="settings-pane"] canvas').length,
    );
    expect(canvasesOnArrival).toBe(0);

    await browser.execute(() => {
      const btn = document.querySelector('[data-testid="terminal-preview-start"]');
      if (!btn) throw new Error("preview placeholder missing on the landing tab");
      (btn as HTMLElement).click();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            document.querySelectorAll('[data-testid="settings-pane"] canvas')
              .length,
        )) > 0,
      { timeout: 10_000, timeoutMsg: "terminal preview never mounted after arming" },
    );

    // Armed stays armed for this Appearance session: leaving and returning to
    // the tab mounts the preview straight away, no second click.
    await clickAppearanceTab("editor");
    await waitForText("Code ligatures");
    await clickAppearanceTab("terminal");
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            document.querySelectorAll('[data-testid="settings-pane"] canvas')
              .length,
        )) > 0,
      { timeout: 10_000, timeoutMsg: "preview did not re-mount when armed" },
    );
    // Leave on Editor so the preview pty is torn down for the next case.
    await clickAppearanceTab("editor");
  });

  it("still deep-links the remote-images row on General", async () => {
    // The markdown preview's blocked-images banner opens Settings with this
    // highlight; the row has to be on the page the link targets.
    await browser.execute(() =>
      window.__termic!.useApp.getState().openSettings("general", undefined, "load-remote-images"),
    );
    await waitForText("Load remote images in markdown preview");
    const found = await browser.execute(
      () => !!document.getElementById("setting-load-remote-images"),
    );
    expect(found).toBe(true);
  });
});

// Getting INTO settings, and back out. Every entry point in the app funnels
// through openSettings (store/app.ts), and each one names a tab: a tab id that
// no longer routes anywhere opens a blank pane rather than failing loudly, so
// these cases exercise the payloads the real call sites send.
describe("settings navigation", () => {
  const paneText = () =>
    browser.execute(
      () =>
        (document.querySelector('[data-testid="settings-pane"]') as HTMLElement | null)
          ?.innerText ?? "",
    );
  const settingsOpen = () =>
    browser.execute(() => !!window.__termic!.useApp.getState().view.settingsOpen);

  after(async () => {
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings());
  });

  it("opens on General with no tab argument (gear, Cmd+comma, dashboard)", async () => {
    await waitForAppShell();
    await requireTermicApi();
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings());
    await browser.execute(() => window.__termic!.useApp.getState().openSettings());
    await waitForText("Repos directory");
    expect(await settingsOpen()).toBe(true);
  });

  it("opens a project's settings from the rail's Projects list", async () => {
    const projectId = await browser.execute(
      () => window.__termic!.useApp.getState().projects[0]?.id,
    );
    await browser.execute(
      (id) => window.__termic!.useApp.getState().openSettings("repositories", id),
      projectId,
    );
    // Sub-tab label of a single-repo project; the page title is an editable
    // input, so its text is a value, not innerText.
    await waitForText("Scripts & run");
  });

  it("shows the empty state when a repositories link carries no project", async () => {
    await browser.execute(() =>
      window.__termic!.useApp.getState().openSettings("repositories"),
    );
    await waitForText("Pick a project on the left");
  });

  it("exposes one command-palette row per settings page", async () => {
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings());
    await browser.execute(() => window.__termic!.useUI.getState().openCommandPalette());
    await waitVisible('input[placeholder*="Type a command"]', 8_000);
    await browser.execute(() => {
      const input = document.querySelector(
        'input[placeholder*="Type a command"]',
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "settings");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The palette's deep links must keep pace with the rail: one row per page
    // (Prompts and Shortcuts are labelled without the word "settings", and the
    // per-project rows vary, so assert the ones that carry it).
    const labels: string[] = await browser.execute(() =>
      [...document.querySelectorAll("[data-row]")].map((r) => r.textContent ?? ""),
    );
    for (const needle of [
      "General settings",
      "Appearance settings",
      "Task settings",
      "Notification settings",
      "Sandbox settings",
      "Termic CLI settings",
    ]) {
      expect(labels.some((l) => l.includes(needle))).toBe(true);
    }
    await browser.execute(() => window.__termic!.useUI.getState().closeCommandPalette?.());
  });

  it("closes and reopens on General", async () => {
    await browser.execute(() => window.__termic!.useApp.getState().openSettings("sandbox"));
    await waitForText("Global sandbox defaults");
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings());
    await browser.waitUntil(async () => (await settingsOpen()) === false, {
      timeout: 5_000,
      timeoutMsg: "settings never closed",
    });
    await browser.execute(() => window.__termic!.useApp.getState().openSettings());
    await waitForText("Repos directory");
    expect(await paneText()).not.toContain("Global sandbox defaults");
  });
});

// P2: preference setters persist to the prefs store. Cases: global default
// sandbox toggle, editor font, terminal font. Each restores its original.
describe("preferences", () => {
  const orig: Record<string, unknown> = {};
  const get = (k: string) =>
    browser.execute((key) => (window.__termic!.usePrefs.getState() as any)[key], k);

  after(async () => {
    await browser.execute((o) => {
      const p = window.__termic!.usePrefs.getState();
      if ("globalDefaultSandbox" in o)
        p.setGlobalDefaultSandbox(o.globalDefaultSandbox);
      if ("editorFontId" in o) p.setEditorFontId(o.editorFontId);
      if ("terminalFontId" in o) p.setTerminalFontId(o.terminalFontId);
    }, orig);
  });

  it("toggles the global default sandbox pref", async () => {
    await waitForAppShell();
    await requireTermicApi();
    orig.globalDefaultSandbox = await get("globalDefaultSandbox");
    await browser.execute(
      (v) => window.__termic!.usePrefs.getState().setGlobalDefaultSandbox(!v),
      orig.globalDefaultSandbox,
    );
    await browser.waitUntil(
      async () => (await get("globalDefaultSandbox")) !== orig.globalDefaultSandbox,
      { timeout: 5_000, timeoutMsg: "sandbox default never changed" },
    );
  });

  it("sets the editor font", async () => {
    orig.editorFontId = await get("editorFontId");
    await browser.execute(() =>
      window.__termic!.usePrefs.getState().setEditorFontId("jetbrains-mono"),
    );
    await browser.waitUntil(
      async () => (await get("editorFontId")) === "jetbrains-mono",
      { timeout: 5_000, timeoutMsg: "editor font never applied" },
    );
  });

  it("sets the terminal font", async () => {
    orig.terminalFontId = await get("terminalFontId");
    await browser.execute(() =>
      window.__termic!.usePrefs.getState().setTerminalFontId("jetbrains-mono"),
    );
    await browser.waitUntil(
      async () => (await get("terminalFontId")) === "jetbrains-mono",
      { timeout: 5_000, timeoutMsg: "terminal font never applied" },
    );
    await snap("prefs.png");
  });
});

// P1: per-task sandbox. Enable enforce mode then turn it off via taskSetSandbox
// (killLive=false so the running PTY isn't disrupted) and assert the task's
// sandbox mode follows.
describe("task sandbox", () => {
  let taskId: string | undefined;
  after(async () => {
    if (taskId) {
      await browser.execute(async (id) => {
        await window.__termic!.ipc.taskSetSandbox(id, "off", [], [], false);
        await window.__termic!.useApp.getState().loadAll();
      }, taskId);
      await archiveTask(taskId);
    }
  });

  const mode = () =>
    browser.execute(
      (id) =>
        window.__termic!.useApp
          .getState()
          .tasks.find((t: any) => t.id === id)?.sandbox_mode,
      taskId,
    );

  it("enables enforce mode", async () => {
    await waitForAppShell();
    await requireTermicApi();
    taskId = await openTask("e2e-sandbox");
    await browser.execute(async (id) => {
      await window.__termic!.ipc.taskSetSandbox(id, "enforce", [], [], false);
      await window.__termic!.useApp.getState().loadAll();
    }, taskId);
    await browser.waitUntil(async () => (await mode()) === "enforce", {
      timeout: 8_000,
      timeoutMsg: "sandbox never became enforce",
    });
  });

  it("turns the sandbox off", async () => {
    await browser.execute(async (id) => {
      await window.__termic!.ipc.taskSetSandbox(id, "off", [], [], false);
      await window.__termic!.useApp.getState().loadAll();
    }, taskId);
    await browser.waitUntil(async () => (await mode()) === "off", {
      timeout: 8_000,
      timeoutMsg: "sandbox never turned off",
    });
    await snap("sandbox.png");
  });
});
