// Sandbox settings. Its own page because this is the one area of settings
// where a wrong value has a security consequence, and because the three
// controls used to sit scattered between "Completion sound" and "Hidden
// files" in General. See docs/sandbox.md for what the cage actually does.

import { useEffect, useRef, useState } from "react";
import { settingsSave } from "@/lib/ipc";
import type { Settings } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { usePrefs } from "@/store/prefs";
import { Block, ListField, SectionTitle, Toggle, useBackendSettings } from "./Controls";
import { cleanLines } from "@/lib/utils";

export function SandboxSection() {
  const { settings, store } = useBackendSettings();
  const [busy, setBusy] = useState(false);
  // Global sandbox defaults. Stored line-by-line as strings so the
  // user can edit mid-line without the array round-trip dropping
  // their cursor.
  const [sbRw, setSbRw]       = useState("");
  const [sbHosts, setSbHosts] = useState("");
  const [sbOriginal, setSbOriginal] = useState({ rw: "", hosts: "" });

  const globalDefaultSandbox = usePrefs(s => s.globalDefaultSandbox);
  const setGlobalDefaultSandbox = usePrefs(s => s.setGlobalDefaultSandbox);
  const sandboxBypassPermissions = usePrefs(s => s.sandboxBypassPermissions);
  const setSandboxBypassPermissions = usePrefs(s => s.setSandboxBypassPermissions);

  const hydrated = useRef(false);
  useEffect(() => {
    if (!settings || hydrated.current) return;
    hydrated.current = true;
    const rw    = (settings.sandbox_default_rw_paths      ?? []).join("\n");
    const hosts = (settings.sandbox_default_allowed_hosts ?? []).join("\n");
    setSbRw(rw); setSbHosts(hosts);
    setSbOriginal({ rw, hosts });
  }, [settings]);

  const sbDirty = sbRw !== sbOriginal.rw || sbHosts !== sbOriginal.hosts;

  async function saveSb() {
    if (!settings) return;
    setBusy(true);
    try {
      const next: Settings = {
        ...settings,
        sandbox_default_rw_paths:      cleanLines(sbRw),
        sandbox_default_allowed_hosts: cleanLines(sbHosts),
      };
      await settingsSave(next);
      store(next);
      setSbOriginal({ rw: sbRw, hosts: sbHosts });
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-7">
      <SectionTitle title="Sandbox" />

      {/* Global sandbox default. The New task dialog defaults its
          Sandbox toggle to this OR the project's own `default_sandbox`
          (whichever is true). One switch to start sandboxing across
          every project without per-project bookkeeping. */}
      <Block first>
        <Toggle
          label="Sandbox new tasks by default"
          hint="When on, the New task dialog pre-checks its Sandbox toggle for every project. Individual projects can still opt out (Settings → Projects). Already-created tasks aren't affected, their sandbox pin is captured at creation."
          value={globalDefaultSandbox}
          onChange={setGlobalDefaultSandbox}
        />
      </Block>

      {/* Bypass-permissions default for sandboxed agents. When on, a
          sandboxed agent spawns with its "auto-approve everything" flag
          regardless of the YOLO toggle — the seatbelt is the real
          boundary, the agent's own prompts are just friction. Affects
          new PTY spawns; respawn (⌘R / new tab) to pick up a change. */}
      <Block>
        <Toggle
          label="Bypass permissions in sandboxed tasks"
          hint="When on, agents in a sandboxed task skip their own permission prompts. The macOS seatbelt is the real boundary. Turn off to make sandboxed agents still ask. Applies to newly spawned terminals."
          value={sandboxBypassPermissions}
          onChange={setSandboxBypassPermissions}
        />
      </Block>

      {/* Global sandbox lists. Joined with each project's per-repo
          lists when a task gets created with sandbox enabled,
          and pre-filled into the Edit Sandbox dialog when the user
          enables the cage from scratch. Editing these only affects
          NEW tasks — existing ones froze a copy at creation. */}
      <Block>
        <div className="text-[14px] font-medium">Global sandbox defaults</div>
        <div className="mt-0.5 text-[12.5px] text-[var(--color-fg-dim)]">
          One per line. Wildcards (<code>*.example.com</code>) for hosts; <code>$HOME</code> + <code>~</code> expand for paths.
          Merged with each project's own lists when a task is created.
        </div>
        <div className="mt-3 flex flex-col gap-4">
          <ListField label="Allowed paths" placeholder={"~/Documents/notes\n~/scratch"} value={sbRw} onChange={setSbRw} />
          <ListField label="Allowed hosts" placeholder={"*.example.com\nbitbucket.org"} value={sbHosts} onChange={setSbHosts} />
        </div>
        <div className="mt-3">
          <Button variant="primary" disabled={!sbDirty || busy} onClick={saveSb}>
            {busy ? "Saving…" : "Save defaults"}
          </Button>
        </div>
      </Block>
    </div>
  );
}
