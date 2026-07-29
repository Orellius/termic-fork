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

  it("documents that agents in tasks can drive the CLI", async () => {
    // Task PTYs carry TERMIC_CLI / TERMIC_TASK_ID (lib.rs), so an unsandboxed
    // agent can spawn sibling tasks. The page has to say so: it is the least
    // guessable thing the CLI does.
    await clickRail("Termic CLI");
    await waitForText("Agents can drive it too");
    const pane = await paneText();
    expect(pane).toContain("$TERMIC_CLI");
    expect(pane).toContain("enforced sandbox");
  });

  it("lets the getting-started commands be selected for copying", async () => {
    // index.css turns selection off app-wide, so these copy-me commands have to
    // opt back in. Read off the command text, not the `data-selectable`
    // attribute, so only losing selectability fails.
    await clickRail("Termic CLI");
    await waitForText("Getting started");
    const selectable = await browser.execute(() => {
      const cmd = [
        ...document.querySelectorAll('[data-testid="settings-pane"] span'),
      ].find((s) => s.textContent?.includes("fix the login redirect"));
      if (!cmd) throw new Error("no getting-started command line");
      // WKWebView only resolves the prefixed longhand.
      return getComputedStyle(cmd).getPropertyValue("-webkit-user-select");
    });
    expect(selectable).toBe("text");
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

// P1: the signal inspector (Settings → Agents & Terminals). Editing an agent's
// work-done patterns used to be guesswork — the strings you must match are OSC
// titles, termic consumes them, and nothing ever showed them to you. These
// cases drive the real panel: observed titles show up, unmatched ones are
// visible (they're the ones worth patterning), clicking + writes an ESCAPED
// pattern into the agent, and a labelled capture proposes a generalized one.
describe("agent signal inspector", () => {
  const AGENT = "fakeagent";
  /** fakeagent ships with claude-shaped signals, and other specs depend on
   *  them. Snapshot and restore rather than clearing: an earlier version of
   *  this teardown wiped them, which silently rewrote the shared .e2e profile
   *  and made the "adds a pattern" case pass locally (empty list) while
   *  failing on CI's fresh seed. Never leave the fixture altered. */
  let originalSignals: unknown;

  const clickRail = (label: string) =>
    browser.execute((l) => {
      const el = [
        ...document.querySelectorAll('[data-testid="settings-rail"] button'),
      ].find((b) => b.querySelector("span")?.textContent?.trim() === l);
      if (!el) throw new Error(`no rail item: ${l}`);
      (el as HTMLElement).click();
    }, label);

  /** Feed the buffer directly. The module is the same one TerminalPane calls
   *  on every OSC title, so this exercises the real path without needing a
   *  live agent to cooperate on a timer. */
  const feed = (titles: string[]) =>
    browser.execute((a, ts) => {
      const m = window.__termic!.signalLog;
      m.resetSignalLog(a);
      for (const t of ts) m.recordTitle(a, t, null);
    }, AGENT, titles);

  /** Text of the fakeagent card ONLY. Every agent card renders the same
   *  labels, so an unscoped read would happily pass on claude's panel. */
  const cardText = () =>
    browser.execute(
      (a) =>
        (document.querySelector(`[data-agent-card="${a}"]`) as HTMLElement | null)
          ?.innerText ?? "",
      AGENT,
    );

  /** Click a button by exact label, scoped to the fakeagent card. */
  const clickInCard = (label: string) =>
    browser.execute(
      (a, l) => {
        const card = document.querySelector(`[data-agent-card="${a}"]`);
        if (!card) throw new Error(`no card for ${a}`);
        const el = [...card.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === l,
        );
        if (!el) throw new Error(`no "${l}" button in the ${a} card`);
        (el as HTMLElement).click();
      },
      AGENT,
      label,
    );

  before(async () => {
    await waitForAppShell();
    await requireTermicApi();
    await browser.execute(() => window.__termic!.useApp.getState().openSettings());
    originalSignals = await browser.execute(
      (a) =>
        window.__termic!.useApp
          .getState()
          .agents.find((ag: any) => ag.id === a)?.capabilities?.signals ?? null,
      AGENT,
    );
    await clickRail("Agents & Terminals");
    // The page is a pill strip plus the ACTIVE agent's card — only one card is
    // mounted at a time, so select fakeagent before touching anything.
    await browser.execute((a) => {
      const pill = document.querySelector(`[data-agent-id="${a}"]`) as HTMLElement | null;
      if (!pill) throw new Error(`no agent pill for ${a}`);
      pill.click();
    }, AGENT);
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          (a) => !!document.querySelector(`[data-agent-card="${a}"]`),
          AGENT,
        )) as boolean,
      { timeout: 8_000, timeoutMsg: "fakeagent card never mounted" },
    );
  });

  after(async () => {
    await browser.execute(async (a, orig) => {
      window.__termic!.signalLog.resetSignalLog(a);
      // Put the agent back EXACTLY as found (see originalSignals above).
      const app = window.__termic!.useApp.getState();
      const agents = app.agents.map((ag: any) =>
        ag.id === a ? { ...ag, capabilities: { ...ag.capabilities, signals: orig } } : ag);
      await window.__termic!.ipc.agentsSave(agents);
      await app.loadAll();
    }, AGENT, originalSignals);
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings());
  });

  it("shows observed titles with counts, marked unmatched", async () => {
    await feed(["⠋ demo", "⠋ demo", "⠙ demo", "✳ demo", "Compiling project"]);
    await clickInCard("Show what this agent is emitting…");
    await browser.waitUntil(async () => (await cardText()).includes("⠋ demo"), {
      timeout: 8_000,
      timeoutMsg: "observed titles never rendered",
    });
    const text = await cardText();
    // The count is what makes a spinner readable at all: one row, not 50.
    expect(text).toContain("⠙ demo");
    expect(text).toContain("✳ demo");

    // Live match preview, read off data-live-class rather than the card's
    // text. The "+ Busy" / "+ Done" buttons on every row carry those exact
    // words, so a text assertion passes even when nothing classifies — which
    // is precisely how the first version of this case passed against a
    // profile whose patterns had been wiped.
    const classes = (await browser.execute(
      (a) =>
        [...document.querySelectorAll(`[data-agent-card="${a}"] [data-live-class]`)].map(
          (td) => [
            (td.parentElement as HTMLElement).innerText.split("\n")[0],
            (td as HTMLElement).dataset.liveClass,
          ],
        ),
      AGENT,
    )) as [string, string][];
    const classOf = (t: string) => classes.find(([title]) => title === t)?.[1];

    // fakeagent mirrors claude: spinner glyph = busy, ✳ = idle.
    expect(classOf("⠋ demo")).toBe("busy");
    expect(classOf("⠙ demo")).toBe("busy");
    expect(classOf("✳ demo")).toBe("idle");
    // A title matching neither. These are the rows worth patterning.
    expect(classOf("Compiling project")).toBe("none");
    expect(text).toContain("unmatched");
  });

  it("writes an ESCAPED pattern into the agent when a row is added", async () => {
    // A title full of regex metacharacters: inserting it raw would either fail
    // to compile or match something else entirely.
    await feed(["Working (2/3)... [x]"]);
    await browser.waitUntil(async () => (await cardText()).includes("Working (2/3)"), {
      timeout: 8_000,
      timeoutMsg: "metachar title never rendered",
    });
    await clickInCard("Busy");

    const busy = await browser.waitUntil(
      async () =>
        (await browser.execute(
          (a) =>
            window.__termic!.useApp
              .getState()
              .agents.find((ag: any) => ag.id === a)?.capabilities?.signals?.busy,
          AGENT,
        )) as string[] | undefined,
      { timeout: 8_000, timeoutMsg: "pattern never reached the agent" },
    );
    const added = "Working \\(2/3\\)\\.\\.\\. \\[x\\]";
    // APPENDED, not replacing: fakeagent ships with a busy pattern, and
    // clobbering a user's existing rules would be a real bug. Asserting the
    // whole array equals just the new entry is what hid this — it only held
    // because a prior teardown had emptied the list.
    expect(busy).toContain(added);
    expect(busy!.length).toBeGreaterThan(1);
    expect(busy![busy!.length - 1]).toBe(added);
    // It compiles, and it matches the exact title it came from.
    expect(new RegExp(added).test("Working (2/3)... [x]")).toBe(true);
  });

  it("proposes a generalized pattern from a captured turn", async () => {
    // Drive a full labelled turn through the same entry points TerminalPane
    // uses: start → submit → spinner frames → done with a resting title.
    await browser.execute((a) => {
      const m = window.__termic!.signalLog;
      m.resetSignalLog(a);
      m.startCapture(a);
      m.recordTitle(a, "✳ demo", null); // at rest, BEFORE the prompt
      m.noteSubmit(a);
      for (const g of ["⠋", "⠙", "⠹", "⠸"]) m.recordTitle(a, `${g} demo`, null);
      m.recordTitle(a, "✳ demo", null);
      m.noteDone(a, "✳ demo");
    }, AGENT);

    await browser.waitUntil(
      async () => (await cardText()).includes("Suggested from that turn"),
      { timeout: 8_000, timeoutMsg: "proposals never rendered" },
    );
    const text = await cardText();
    // The spinner class, not four literals.
    expect(text).toContain("covers the spinner");
    // And it explains what it threw away: the busy titles share "demo" with the
    // idle title, and busy > idle means saving that would wedge the agent as
    // permanently working. A silently missing suggestion reads as a bug.
    expect(text).toContain("Skipped");
    await snap("signal-inspector.png");
  });
});
