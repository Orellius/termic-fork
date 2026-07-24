// Task settings: what happens when a task is created (branch naming, base
// refresh, worktree config) and how tasks behave once they exist (tab close
// confirmation, queued-message pacing).
//
// Split out of General, where "Fetch base before creating a task" and
// "Worktree config symlinks" sat fifteen rows apart despite both being
// new-task settings.

import { useEffect, useRef, useState } from "react";
import { settingsSave } from "@/lib/ipc";
import type { Settings } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { usePrefs } from "@/store/prefs";
import { Block, ListField, SectionTitle, Toggle, useBackendSettings } from "./Controls";
import { cleanLines } from "@/lib/utils";

export function TasksSection() {
  const { settings, store, patch } = useBackendSettings();
  const [busy, setBusy] = useState(false);
  // Pre-create base fetch (GH #79). Backend Settings field; saved immediately
  // on toggle. Absent in settings = on.
  const [fetchBeforeCreate, setFetchBeforeCreate] = useState(true);
  // Worktree config-dir symlinks (personal). One path per line, cleaned on
  // save. Empty disables the linking; absent in settings means the pre-filled
  // agent-dir defaults.
  const [symlinkPaths, setSymlinkPaths] = useState("");
  const [symlinkPathsOriginal, setSymlinkPathsOriginal] = useState("");

  const branchPrefix = usePrefs(s => s.branchPrefix);
  const setBranchPrefix = usePrefs(s => s.setBranchPrefix);
  const queueMinIntervalMs = usePrefs(s => s.queueMinIntervalMs);
  const setQueueMinIntervalMs = usePrefs(s => s.setQueueMinIntervalMs);
  const confirmBeforeCloseAgentTab = usePrefs(s => s.confirmBeforeCloseAgentTab);
  const setConfirmBeforeCloseAgentTab = usePrefs(s => s.setConfirmBeforeCloseAgentTab);

  const hydrated = useRef(false);
  useEffect(() => {
    if (!settings || hydrated.current) return;
    hydrated.current = true;
    setFetchBeforeCreate(settings.fetch_before_create !== false);
    const links = (settings.worktree_symlink_paths ?? []).join("\n");
    setSymlinkPaths(links);
    setSymlinkPathsOriginal(links);
  }, [settings]);

  const symlinkDirty = symlinkPaths !== symlinkPathsOriginal;

  async function saveFetchBeforeCreate(v: boolean) {
    setFetchBeforeCreate(v);
    if (!(await patch({ fetch_before_create: v }))) setFetchBeforeCreate(!v);
  }

  async function saveSymlinkPaths() {
    if (!settings) return;
    setBusy(true);
    try {
      const cleaned = cleanLines(symlinkPaths);
      const next: Settings = { ...settings, worktree_symlink_paths: cleaned };
      await settingsSave(next);
      store(next);
      setSymlinkPaths(cleaned.join("\n"));
      setSymlinkPathsOriginal(cleaned.join("\n"));
    } finally { setBusy(false); }
  }

  const prefixPreview = (() => {
    const p = branchPrefix.trim().replace(/^\/+|\/+$/g, "");
    return p ? `${p}/my-task` : "my-task";
  })();

  return (
    <div className="flex flex-col gap-7">
      <SectionTitle title="Tasks" />

      <Block first>
        <div className="text-[14px] font-medium">Branch prefix</div>
        <div className="mt-0.5 text-[12.5px] text-[var(--color-fg-dim)]">
          Prepended to auto-generated branch names for new tasks (<code className="font-mono">{prefixPreview}</code>). Leave empty for no prefix. You can still edit the branch per task.
        </div>
        <div className="mt-2 max-w-xs">
          <Input value={branchPrefix} onChange={(e) => setBranchPrefix(e.target.value)} placeholder="feature" className="font-mono" />
        </div>
      </Block>

      <Block>
        <Toggle
          label="Fetch base before creating a task"
          hint="Refresh the base branch from its remote (a quick, single-ref git fetch) right before a new task's branch is cut, so it starts from the latest commit instead of a stale local copy. Best-effort: if the remote is offline or unreachable, the task still creates from your local ref. Turn off on flaky networks."
          value={fetchBeforeCreate}
          onChange={saveFetchBeforeCreate}
        />
      </Block>

      {/* Worktree config symlinks (personal). A project's agent config
          (.claude/ etc.) is often gitignored, so a plain worktree checkout
          omits it and agents there lose their project subagents/skills. These
          repo-root dirs get symlinked into each new worktree task. Only ones
          that exist in the repo are linked; clear the list to disable. */}
      <Block>
        <div className="text-[14px] font-medium">Worktree config symlinks</div>
        <div className="mt-0.5 text-[12.5px] text-[var(--color-fg-dim)]">
          Repo-root dirs symlinked into each new worktree task, one per line, so agents keep project config (subagents, skills, commands) that is gitignored out of a plain checkout. Only dirs that exist in the repo are linked. Clear the list to turn this off.
        </div>
        <div className="mt-3">
          <ListField label="Paths to symlink" placeholder={".claude\n.gemini\n.codex"} value={symlinkPaths} onChange={setSymlinkPaths} />
        </div>
        <div className="mt-3">
          <Button variant="primary" disabled={!symlinkDirty || busy} onClick={saveSymlinkPaths}>
            {busy ? "Saving…" : "Save symlink paths"}
          </Button>
        </div>
      </Block>

      <Block>
        <div className="text-[14px] font-medium">Queue send interval</div>
        <div className="mt-0.5 text-[12.5px] text-[var(--color-fg-dim)]">
          Minimum delay between consecutive queued messages sent to an agent (the "ralph loop"). Even if the agent finishes faster, or a false "done" fires, the next message waits this long. Set to 0 to disable. "Send now" ignores this and sends immediately.
        </div>
        <div className="mt-2 flex max-w-xs items-center gap-2">
          <Input
            type="number"
            min={0}
            max={120}
            value={Math.round(queueMinIntervalMs / 1000)}
            onChange={(e) => setQueueMinIntervalMs((Number(e.target.value) || 0) * 1000)}
            className="w-24 font-mono"
          />
          <span className="text-[12.5px] text-[var(--color-fg-dim)]">seconds</span>
        </div>
      </Block>

      <Block>
        <Toggle
          label="Confirm before closing an agent tab"
          hint="Ask before closing a non-shell terminal or agent tab. Turning this off (or unchecking it once from the close dialog) closes tabs immediately; a toast then points back to the '+' menu's Resume section to bring one back."
          value={confirmBeforeCloseAgentTab}
          onChange={setConfirmBeforeCloseAgentTab}
        />
      </Block>
    </div>
  );
}
