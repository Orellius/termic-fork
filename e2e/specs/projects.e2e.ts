import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clickByText, requireTermicApi, snap, waitForAppShell, waitVisible } from "../helpers";

// P1: adding/removing a project. Cases: a git repo can be added as a project
// (shows in the store); removing it drops it. Uses a throwaway temp repo and
// cleans it up.
describe("project add/remove", () => {
  let dir = "";
  let projectId: string | null = null;

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "e2e-proj-"));
    execSync(
      `git -C "${dir}" init -q && git -C "${dir}" -c user.email=e2e@termic.dev -c user.name=e2e commit -q --allow-empty -m init`,
    );
  });
  after(async () => {
    if (projectId) {
      await browser.execute(async (id) => {
        await window.__termic!.ipc.projectRemove(id);
        await window.__termic!.useApp.getState().loadAll();
      }, projectId);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a git repo as a project", async () => {
    await waitForAppShell();
    await requireTermicApi();
    const proj = await browser.execute(
      async (d) => await window.__termic!.ipc.projectAdd(d),
      dir,
    );
    projectId = (proj as any).id;
    await browser.execute(() => window.__termic!.useApp.getState().loadAll());
    await browser.waitUntil(
      () =>
        browser.execute(
          (id) =>
            window.__termic!.useApp.getState().projects.some((p: any) => p.id === id),
          projectId,
        ),
      { timeout: 8_000, timeoutMsg: "added project never appeared" },
    );
  });

  it("reorders projects", async () => {
    // Put the newly-added project first, then restore original order.
    const ids = await browser.execute(
      () => window.__termic!.useApp.getState().projects.map((p: any) => p.id),
      );
    const reordered = [
      projectId!,
      ...(ids as string[]).filter((i) => i !== projectId),
    ];
    await browser.execute(async (order) => {
      await window.__termic!.ipc.projectReorder(order);
      await window.__termic!.useApp.getState().loadAll();
    }, reordered);
    await browser.waitUntil(
      () =>
        browser.execute(
          (first) => window.__termic!.useApp.getState().projects[0]?.id === first,
          projectId,
        ),
      { timeout: 8_000, timeoutMsg: "project order never changed" },
    );
  });

  it("assigns the project to a group", async () => {
    const id = projectId!;
    await browser.execute(async (i) => {
      await window.__termic!.ipc.projectSetGroup([i], "e2e-group");
      await window.__termic!.useApp.getState().loadAll();
    }, id);
    await browser.waitUntil(
      () =>
        browser.execute(
          (i) =>
            window.__termic!.useApp
              .getState()
              .projects.find((p: any) => p.id === i)?.group === "e2e-group",
          id,
        ),
      { timeout: 8_000, timeoutMsg: "project group never applied" },
    );
  });

  it("renames the project", async () => {
    const id = projectId!;
    await browser.execute(async (i) => {
      await window.__termic!.ipc.projectRename(i, "e2e-renamed-proj");
      await window.__termic!.useApp.getState().loadAll();
    }, id);
    await browser.waitUntil(
      () =>
        browser.execute(
          (i) =>
            window.__termic!.useApp
              .getState()
              .projects.find((p: any) => p.id === i)?.name === "e2e-renamed-proj",
          id,
        ),
      { timeout: 8_000, timeoutMsg: "project name never updated" },
    );
  });

  it("removes the project", async () => {
    const id = projectId!;
    await browser.execute(async (i) => {
      await window.__termic!.ipc.projectRemove(i);
      await window.__termic!.useApp.getState().loadAll();
    }, id);
    await browser.waitUntil(
      () =>
        browser.execute(
          (i) =>
            !window.__termic!.useApp.getState().projects.some((p: any) => p.id === i),
          id,
        ),
      { timeout: 8_000, timeoutMsg: "removed project still present" },
    );
    projectId = null;
    await snap("project.png");
  });
});

// P2: repo discovery (Add Project → Discover). Scans a folder and returns the
// git repos in it.
describe("discover repos", () => {
  let dir = "";
  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "e2e-discover-"));
    const sub = path.join(dir, "sub-repo");
    mkdirSync(sub, { recursive: true });
    execSync(`git -C "${sub}" init -q`);
    execSync(
      `git -C "${sub}" -c user.email=e2e@termic.dev -c user.name=e2e commit -q --allow-empty -m init`,
    );
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("finds a git repo inside a folder", async () => {
    await waitForAppShell();
    await requireTermicApi();
    const repos = await browser.execute(
      async (d) => await window.__termic!.ipc.discoverRepos(d),
      dir,
    );
    expect(
      (repos as any[]).some((r) => JSON.stringify(r).includes("sub-repo")),
    ).toBe(true);
    await snap("discover.png");
  });
});

// P2: importing an existing worktree (issue #5). Guards the discovery half:
// listing worktrees that exist on disk but aren't open as tasks. The fixture
// repo has a pre-seeded `sbcheck` worktree. (We only assert discovery — doing
// the import + archive would rm the shared worktree.)
describe("import worktree", () => {
  it("lists importable worktrees for the project", async () => {
    await waitForAppShell();
    await requireTermicApi();
    const list = await browser.execute(async () => {
      const proj = window.__termic!.useApp
        .getState()
        .projects.find((p: any) => p.name === "fixture-repo");
      return await window.__termic!.ipc.taskImportableWorktrees(proj.id);
    });
    expect(Array.isArray(list)).toBe(true);
    expect(
      (list as any[]).some((w) => JSON.stringify(w).includes("sbcheck")),
    ).toBe(true);
    await snap("import-worktree.png");
  });
});

// P2: per-repo config (.termic.yaml). Save a config field and read it back.
// Git-cleans the written .termic.yaml on teardown.
const fixture = process.env.E2E_FIXTURE ?? path.join(process.cwd(), ".e2e", "fixture-repo");

describe("repo config", () => {
  after(() => {
    try {
      execSync(`git -C "${fixture}" clean -fd`);
      execSync(`git -C "${fixture}" checkout -- .termic.yaml`, { stdio: "ignore" });
    } catch {
      /* nothing to restore */
    }
  });

  it("saves a repo config and reads it back", async () => {
    await waitForAppShell();
    await requireTermicApi();
    const loaded = await browser.execute(async () => {
      const proj = window.__termic!.useApp
        .getState()
        .projects.find((p: any) => p.name === "fixture-repo");
      // Load returns null when there's no .termic.yaml yet; scaffold a default.
      let cfg = await window.__termic!.ipc.repoConfigLoad(proj.id);
      if (!cfg) {
        await window.__termic!.ipc.repoConfigScaffold(proj.id);
        cfg = await window.__termic!.ipc.repoConfigLoad(proj.id);
      }
      cfg.scripts.setup = "echo e2e-setup";
      await window.__termic!.ipc.repoConfigSave(proj.id, cfg);
      return await window.__termic!.ipc.repoConfigLoad(proj.id);
    });
    expect((loaded as any).scripts.setup).toBe("echo e2e-setup");
    await snap("repo-config.png");
  });
});

// P1: which branch a new worktree task is cut from (`Project.base_branch` + the
// "Branch from" picker in the project `+` menu). Before this, the quick path
// always used a base detected as origin/main at add time, with nothing on
// screen saying so, which is wrong for anyone whose features come off a
// long-lived `dev`. The model is deliberately ONE concept: pick a branch, it's
// remembered as the project's base.
//
// Uses its OWN temp repo, not the shared fixture: these cases move HEAD around,
// and the fixture's checked-out branch is load-bearing for other spec files.
//
// Every branch points at a DIFFERENT commit on purpose. If any two shared a
// tip, most of these cases would pass against a wrong implementation:
//   main = origin/main = <mainSha>   what add-time detection picks
//   dev  = <devSha>                  ahead of main; HEAD sits here throughout
//   feat = <featSha>                 off main; a third pin target
describe("branch new tasks from", () => {
  let dir = "";
  let projectId = "";
  let mainSha = "";
  let devSha = "";
  let featSha = "";
  const createdTaskIds: string[] = [];

  /** Tip of `ref` in the temp repo. The worktree branch a task creates lives
   *  here too, so this is how we prove where it was cut from. */
  const rev = (ref: string) =>
    execSync(`git -C "${dir}" rev-parse ${ref}`).toString().trim();

  /** Create a worktree task and return the sha its branch points at. */
  const createTaskAt = async (name: string, base: string | null) => {
    const task = await browser.execute(
      async (pid, n, b) => {
        const t = await window.__termic!.ipc.taskCreate({
          project_id: pid,
          name: n,
          cli: "fakeagent",
          base_branch: b,
          branch: n,
        });
        await window.__termic!.useApp.getState().loadAll();
        return t;
      },
      projectId,
      name,
      base,
    );
    createdTaskIds.push((task as any).id);
    return rev(name);
  };

  /** Pin a base on the project, exactly as the picker does. */
  const pinBase = async (branch: string) => {
    await browser.execute(
      async (id, b) => {
        const t = window.__termic!;
        const p = t.useApp.getState().projects.find((x: any) => x.id === id);
        await t.ipc.projectUpdate({ ...p, base_branch: b });
        await t.useApp.getState().loadAll();
      },
      projectId,
      branch,
    );
  };

  /** The project's stored base, read back from the store. */
  const storedBase = async () =>
    (await browser.execute(
      (id) =>
        window.__termic!.useApp.getState().projects.find((p: any) => p.id === id)
          ?.base_branch,
      projectId,
    )) as string;

  const checkout = (branch: string) => execSync(`git -C "${dir}" checkout -q ${branch}`);

  /** Alphabetical on purpose: "bitbucket" must sort before "origin". */
  const remotes = ["bitbucket", "origin"];
  const remotePath = (r: string) =>
    path.join(dir, "..", `${path.basename(dir)}-${r}.git`);

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "e2e-base-"));
    const g = (args: string) => execSync(`git -C "${dir}" ${args}`, { stdio: "ignore" });
    const commit = (msg: string) =>
      g(`-c user.email=e2e@termic.dev -c user.name=e2e commit -q --allow-empty -m ${msg}`);

    execSync(`git -C "${dir}" init -q -b main`);
    commit("base");
    // TWO remotes, and "bitbucket" sorts BEFORE "origin". `git remote` lists
    // alphabetically, so taking its first line pinned a stale remote as the
    // project base at add time. Real origins also matter on their own: without
    // one, resolve_base_ref falls back to local main and the policy-off case
    // would pass for the wrong reason.
    for (const r of remotes) {
      const bare = remotePath(r);
      execSync(`git init --bare -q -b main "${bare}"`);
      g(`remote add ${r} "${bare}"`);
      g(`push -q ${r} main`);
      // `push` does NOT write refs/remotes/<r>/HEAD; only clone or an explicit
      // set-head does. Needed so the alias-filtering assertion isn't vacuous.
      g(`remote set-head ${r} -a`);
    }
    mainSha = rev("main");

    // Move HEAD off the default onto a branch that is strictly AHEAD, so
    // "current branch" and "project default" can never be confused.
    g(`checkout -q -b dev`);
    commit("dev-work");
    devSha = rev("dev");

    // A third tip, so "re-read HEAD at create time" can be told apart from
    // "resolved once when the policy was switched on".
    g(`checkout -q -b feat main`);
    commit("feat-work");
    featSha = rev("feat");
    g(`checkout -q dev`);

    expect(new Set([mainSha, devSha, featSha]).size).toBe(3);
  });

  after(async () => {
    for (const id of createdTaskIds) {
      await browser
        .execute(async (i) => {
          await window.__termic!.ipc.taskDelete(i);
          await window.__termic!.useApp.getState().loadAll();
        }, id)
        .catch(() => {});
    }
    if (projectId) {
      await browser
        .execute(async (id) => {
          await window.__termic!.ipc.projectRemove(id);
          await window.__termic!.useApp.getState().loadAll();
        }, projectId)
        .catch(() => {});
    }
    for (const r of remotes) rmSync(remotePath(r), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds the repo and reports its branch context", async () => {
    await waitForAppShell();
    await requireTermicApi();
    const proj = await browser.execute(
      async (d) => {
        const p = await window.__termic!.ipc.projectAdd(d);
        await window.__termic!.useApp.getState().loadAll();
        return p;
      },
      dir,
    );
    projectId = (proj as any).id;
    // origin wins over the alphabetically-first "bitbucket", and the branch
    // comes from that remote's own HEAD alias.
    expect((proj as any).base_branch).toBe("origin/main");

    const ctx = await browser.execute(
      async (id) => await window.__termic!.ipc.projectBranchContext(id),
      projectId,
    );
    // The picker needs the live HEAD plus BOTH ref namespaces: the default it
    // has to render as selected ("origin/main") is remote-tracking, which
    // project_git_branches never returns.
    expect((ctx as any).head).toBe("dev");
    expect((ctx as any).local).toEqual(expect.arrayContaining(["main", "dev"]));
    expect((ctx as any).remote).toEqual(
      expect.arrayContaining(["origin/main", "bitbucket/main"]),
    );
    // The symbolic <remote>/HEAD aliases are filtered out. They shorten to a
    // BARE remote name ("origin"), not "origin/HEAD", so assert on that shape:
    // a bare entry here is an alias leaking into the picker as a fake branch.
    expect((ctx as any).remote.filter((r: string) => !r.includes("/"))).toEqual([]);
  });

  // HEAD sits on `dev` throughout these, so anything that wrongly cuts from
  // the checkout instead of the pin lands on devSha and fails.
  it("branches from the pinned base, not the checked-out branch", async () => {
    expect(await createTaskAt("e2e-base-pin", null)).toBe(mainSha);
  });

  it("treats a blank explicit base as absent, not as HEAD", async () => {
    // Regression guard: `unwrap_or_else` alone let Some("") through, and an
    // empty base resolves to "HEAD" in resolve_base_ref — a silent cut from
    // wherever the repo happened to be sitting.
    expect(await createTaskAt("e2e-base-blank", "   ")).toBe(mainSha);
  });

  it("lets an explicit per-task base outrank the pin", async () => {
    // The New Task dialog's "Branch from" field and the CLI's `base` arg.
    expect(await createTaskAt("e2e-base-explicit", "feat")).toBe(featSha);
    // ...without disturbing what the project remembers.
    expect(await storedBase()).toBe("origin/main");
  });

  it("remembers a newly picked base and uses it for the next task", async () => {
    // The whole model in one case: pick, it sticks, it's what you get.
    await pinBase("feat");
    expect(await storedBase()).toBe("feat");
    expect(await createTaskAt("e2e-base-repinned", null)).toBe(featSha);

    // Re-pinning replaces, it doesn't accumulate modes.
    await pinBase("dev");
    expect(await createTaskAt("e2e-base-repinned-2", null)).toBe(devSha);
  });

  it("keeps the pin fixed when the checkout moves", async () => {
    // The deliberate trade-off of dropping the follow-HEAD mode: the base is
    // yours, and moving the main checkout must NOT silently change it.
    await pinBase("main");
    checkout("feat");
    expect(await createTaskAt("e2e-base-stable", null)).toBe(mainSha);
    checkout("dev");
    expect(await storedBase()).toBe("main");
  });

  it("shows the base in the project menu, worktree mode only", async () => {
    const trigger = `[data-testid="project-new-task-${projectId}"]`;
    await waitVisible(trigger);
    // Radix opens on pointerdown, so a bare .click() isn't enough.
    await browser.execute((sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      const opts = { bubbles: true, pointerType: "mouse", button: 0 } as any;
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.click();
    }, trigger);
    await waitVisible('[role="menu"]');

    const menuText = async () =>
      (await browser.execute(() => {
        const m = document.querySelector('[role="menu"]') as HTMLElement | null;
        return m?.innerText ?? "";
      })) as string;

    // Mode is remembered app-wide, so don't assume where we start: drive it.
    // Main checkout runs on the live branch, so there's no base to pick.
    await clickByText("Main checkout");
    await browser.waitUntil(async () => !(await menuText()).includes("Branch from"), {
      timeout: 8_000,
      timeoutMsg: '"Branch from" row still shown in main-checkout mode',
    });

    await clickByText("Worktree");
    await browser.waitUntil(async () => (await menuText()).includes("Branch from"), {
      timeout: 8_000,
      timeoutMsg: '"Branch from" row never appeared in worktree mode',
    });
    // The row names the PINNED base ("main" from the previous case), which is
    // the disclosure the quick path never had. HEAD is on `dev`, so a row
    // reading "dev" would mean the base is following the checkout again.
    expect(await menuText()).toContain("main");
    await snap("branch-from.png");
    await browser.keys("Escape");
  });

  it("offers one flat branch list, pin checked and HEAD marked", async () => {
    // The pin lives IN the list rather than in a separate "Project default"
    // row, so there's one place to look. Reopen the menu: the previous case
    // closed it with Escape.
    const trigger = `[data-testid="project-new-task-${projectId}"]`;
    await waitVisible(trigger);
    await browser.execute((sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      const opts = { bubbles: true, pointerType: "mouse", button: 0 } as any;
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.click();
    }, trigger);
    await waitVisible('[role="menu"]');

    // Radix submenus open on hover; the trigger carries aria-haspopup.
    await browser.execute(() => {
      const t = [...document.querySelectorAll('[aria-haspopup="menu"]')].find((e) =>
        e.textContent?.includes("Branch from"),
      ) as HTMLElement | undefined;
      if (!t) throw new Error('no "Branch from" submenu trigger');
      const opts = { bubbles: true, pointerType: "mouse" } as any;
      t.dispatchEvent(new PointerEvent("pointerover", opts));
      t.dispatchEvent(new PointerEvent("pointermove", opts));
      t.click();
    });

    // Every ref is offered in ONE list, including the pinned one.
    const items = async () =>
      (await browser.execute(() =>
        [...document.querySelectorAll('[role="menuitem"]')]
          .map((e) => (e as HTMLElement).innerText.trim())
          .filter(Boolean),
      )) as string[];
    await browser.waitUntil(
      async () => (await items()).some((t) => t.startsWith("origin/main")),
      { timeout: 8_000, timeoutMsg: "branch list never rendered" },
    );

    const list = await items();
    for (const b of ["main", "dev", "origin/main", "bitbucket/main"]) {
      expect(list.some((t) => t.split("\n")[0] === b)).toBe(true);
    }
    // The current branch is a HINT on its row, not a separate mode/entry.
    expect(list.some((t) => t.startsWith("dev") && t.includes("current"))).toBe(true);
    expect(list.some((t) => t === "Current branch")).toBe(false);
    expect(list.some((t) => t.startsWith("Project default"))).toBe(false);
    await snap("branch-list.png");
    await browser.keys("Escape");
  });
});
