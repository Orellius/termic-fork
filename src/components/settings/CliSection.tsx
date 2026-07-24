// termic CLI control plane. Off by default: the socket always binds and
// answers hello, but every verb stays refused until this is on. Enabling
// auto-installs the command (no prompt) into ~/.local/bin; the button
// upgrades it to a system-wide /usr/local/bin install.
//
// Marked EXPERIMENTAL in the rail and the title. It qualifies under the rule
// in docs/ui.md: off by default because the surface is still settling (the
// wire protocol is versioned and Phase 2+ verbs are unbuilt), not off for
// safety or taste. It graduates by dropping the badge, not by moving page.

import { useEffect, useState } from "react";
import { cliInstallSymlink, cliInstallStatus } from "@/lib/ipc";
import type { CliInstallStatus } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Block, SectionTitle, Toggle, useBackendSettings } from "./Controls";
import { cn } from "@/lib/utils";

export function CliSection() {
  const { settings, patch } = useBackendSettings();
  // "Enable CLI": backend Settings field, saved immediately on toggle.
  // Absent = off. Gates every authenticated verb of the `termic` control
  // socket (docs/plans/cli.md).
  const [cliEnabled, setCliEnabled] = useState(false);
  // Install state (path / command name / PATH-awareness), plus the
  // in-flight flag + last result line of an install action.
  const [cliInstall, setCliInstall] = useState<CliInstallStatus | null>(null);
  const [cliInstalling, setCliInstalling] = useState(false);
  const [cliInstallMsg, setCliInstallMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setCliEnabled(settings.cli_enabled === true);
  }, [settings]);

  useEffect(() => {
    cliInstallStatus().then(setCliInstall).catch(() => {});
  }, []);

  async function saveCliEnabled(v: boolean) {
    // Ignore clicks until settings have loaded, so the toggle never flips
    // visually without persisting.
    if (!settings) return;
    setCliEnabled(v);
    if (!(await patch({ cli_enabled: v }))) {
      // Persist failed: revert rather than show a state we did not save.
      setCliEnabled(!v);
      return;
    }
    // Enabling should hand you a working command with no extra step: do a
    // no-prompt install into ~/.local/bin, then reflect whether it landed
    // on PATH. Only auto-install when not already installed so re-enabling
    // never resurrects a link the user removed on purpose.
    if (v) {
      const cur = await cliInstallStatus().catch(() => null);
      if (!cur?.path) await installCli(false);
      else setCliInstall(cur);
    }
  }

  async function installCli(system: boolean) {
    setCliInstalling(true);
    setCliInstallMsg(null);
    try {
      const msg = await cliInstallSymlink(system);
      setCliInstallMsg(msg);
      setCliInstall(await cliInstallStatus());
    } catch (e) {
      setCliInstallMsg(String(e));
    } finally {
      setCliInstalling(false);
    }
  }

  const name = cliInstall?.name ?? "termic";

  return (
    <div className="flex flex-col gap-7">
      <SectionTitle title="Termic CLI" badge="Experimental" />

      <Block first>
        <Toggle
          label="Enable CLI"
          hint={`Let the ${name} command drive this app from any shell: create tasks and stream their setup, wait for an agent to go quiet, list and check tasks, archive them, and add or remove projects. Off by default. Agents in an enforced sandbox never get access. Turning this off refuses every command immediately (the command stays installed).`}
          value={cliEnabled}
          onChange={saveCliEnabled}
        />
        <div className={cn("mt-3", !cliEnabled && "pointer-events-none opacity-50 select-none")}>
          {cliInstall?.path ? (
            <p className="text-[12.5px] text-[var(--color-fg-dim)]">
              <code className="font-mono">{cliInstall.name}</code> is installed at{" "}
              <code className="font-mono">{cliInstall.path}</code>.{" "}
              {cliInstall.on_path
                ? <>Run <code className="font-mono">{cliInstall.name} list</code> from any shell.</>
                : <span className="text-[var(--color-warn,inherit)]">That location is not on your PATH, so use Install system-wide below, or add <code className="font-mono">~/.local/bin</code> to your PATH.</span>}
            </p>
          ) : (
            <p className="text-[12.5px] text-[var(--color-fg-dim)]">
              Enabling installs <code className="font-mono">{name}</code> into <code className="font-mono">~/.local/bin</code> automatically.
            </p>
          )}
          {/* The system-wide install is only a REQUIRED step when the
              auto-install did not land on PATH. When it did (the common
              case), keep it as a de-emphasized optional action so it does
              not read as "you still need to do this". */}
          {cliInstall?.path && cliInstall.on_path ? (
            <button
              type="button"
              disabled={cliInstalling}
              onClick={() => installCli(true)}
              className="mt-2 text-[12px] text-[var(--color-fg-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-fg-dim)] disabled:opacity-50"
            >
              {cliInstalling ? "Installing…" : "Install system-wide instead (optional, uses /usr/local/bin)"}
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <Button variant="secondary" size="md" disabled={cliInstalling} onClick={() => installCli(true)}>
                {cliInstalling ? "Installing…" : "Install system-wide"}
              </Button>
              <span className="text-[12px] text-[var(--color-fg-faint)]">
                symlinks into <code className="font-mono">/usr/local/bin</code> (asks for your password)
              </span>
            </div>
          )}
          {cliInstallMsg && (
            <p className="mt-2 text-[12px] text-[var(--color-fg-faint)]">{cliInstallMsg}</p>
          )}
        </div>
      </Block>

      <Block>
        <div className="text-[14px] font-medium">Getting started</div>
        <div className="mt-0.5 text-[12.5px] text-[var(--color-fg-dim)]">
          Run these from inside a registered repo. <code className="font-mono">{name} help</code> lists the full surface.
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg)] px-3 py-2.5 font-mono text-[12.5px] text-[var(--color-fg-dim)]">
          <div><span className="text-[var(--color-fg)]">{name} new fix-auth -p "fix the login redirect"</span></div>
          <div><span className="text-[var(--color-fg)]">{name} list</span></div>
          <div><span className="text-[var(--color-fg)]">{name} wait fix-auth</span></div>
        </div>
        <p className="mt-2.5 text-[12px] text-[var(--color-fg-faint)]">
          Experimental: the commands and their output can still change between releases.
        </p>
      </Block>
    </div>
  );
}
