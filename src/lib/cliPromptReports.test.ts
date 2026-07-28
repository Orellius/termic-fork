// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be declared before the module under test is imported.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { invoke } from "@tauri-apps/api/core";
import {
  failCliQueuedPrompts,
  failCliQueuedPromptsInTabs,
  reportCliPromptDelivery,
} from "@/lib/cliPromptReports";
import type { QueueItem, Tab, TerminalTab } from "@/lib/types";

const item = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: crypto.randomUUID(),
  text: "run it",
  repeat: 1,
  remaining: 1,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(invoke).mockClear();
});

describe("reportCliPromptDelivery", () => {
  it("reports through cli_prompt_report and swallows failures", async () => {
    await reportCliPromptDelivery("p1", true);
    expect(invoke).toHaveBeenCalledWith("cli_prompt_report", { id: "p1", ok: true, error: null });
    await reportCliPromptDelivery("p2", false, "pty died");
    expect(invoke).toHaveBeenCalledWith("cli_prompt_report", { id: "p2", ok: false, error: "pty died" });
    // A rejected invoke must not propagate (the server may have
    // forgotten the id; reports are best-effort by contract).
    vi.mocked(invoke).mockRejectedValueOnce(new Error("gone"));
    await expect(reportCliPromptDelivery("p3", true)).resolves.toBeUndefined();
  });
});

describe("failCliQueuedPrompts", () => {
  it("returns the INPUT IDENTITY when nothing is CLI-tracked", () => {
    const queue = [item(), item({ repeat: 5, remaining: 3 })];
    expect(failCliQueuedPrompts(queue, "why")).toBe(queue);
    expect(failCliQueuedPrompts(undefined, "why")).toBeUndefined();
    expect(failCliQueuedPrompts([], "why")).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports and strips ONLY the CLI-tracked items, keeping the user's own loop", () => {
    const user = item();
    const cli1 = item({ promptId: "p1" });
    const cli2 = item({ promptId: "p2" });
    const out = failCliQueuedPrompts([user, cli1, cli2], "the agent restarted");
    expect(out).toEqual([user]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("cli_prompt_report", {
      id: "p1",
      ok: false,
      error: "the agent restarted",
    });
    expect(invoke).toHaveBeenCalledWith("cli_prompt_report", {
      id: "p2",
      ok: false,
      error: "the agent restarted",
    });
  });
});

describe("failCliQueuedPromptsInTabs", () => {
  const term = (queue?: QueueItem[]): TerminalTab =>
    ({ id: crypto.randomUUID(), type: "terminal", cli: "claude", title: "t", queue }) as TerminalTab;

  it("returns the INPUT IDENTITY when no tab holds a CLI-tracked item", () => {
    const tabs: Tab[] = [term(), term([item()])];
    expect(failCliQueuedPromptsInTabs(tabs, "why")).toBe(tabs);
    expect(failCliQueuedPromptsInTabs(undefined, "why")).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rewrites only the affected tabs and leaves the others by reference", () => {
    const clean = term([item()]);
    const dirty = term([item({ promptId: "p9" }), item()]);
    const out = failCliQueuedPromptsInTabs([clean, dirty], "the task was stopped")!;
    expect(out[0]).toBe(clean);
    expect(out[1]).not.toBe(dirty);
    expect((out[1] as TerminalTab).queue).toHaveLength(1);
    expect((out[1] as TerminalTab).queue![0].promptId).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("cli_prompt_report", {
      id: "p9",
      ok: false,
      error: "the task was stopped",
    });
  });
});
