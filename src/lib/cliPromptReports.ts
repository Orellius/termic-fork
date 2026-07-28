// Delivery-confirmation plumbing for CLI-injected prompts
// (cli_server.rs PromptReports). Split out of cliRpc.ts because
// store/app.ts and TerminalPane need it too and anything heavier would
// cycle (the unattendedSpawns precedent).

import { invoke } from "@tauri-apps/api/core";
import type { QueueItem, Tab, TerminalTab } from "@/lib/types";

/** Report a CLI-injected prompt's delivery outcome to the server. The
 *  server's `send --wait` blocks on this; failures are swallowed (a
 *  server that timed out and forgot the id discards reports anyway). */
export function reportCliPromptDelivery(promptId: string, ok: boolean, error?: string): Promise<void> {
  return invoke("cli_prompt_report", { id: promptId, ok, error: error ?? null })
    .catch(() => {})
    .then(() => {});
}

/** Fail-fast for CLI-queued prompts that can no longer deliver: the
 *  drain only advances on a live agent's work-done, so a respawn or a
 *  task stop strands them and the server's `--wait` would sit on a
 *  queue that never drains. Reports each stranded prompt as failed and
 *  returns the queue without them (non-CLI items are kept; they are
 *  the user's own loop). Returns the input untouched when nothing to do. */
export function failCliQueuedPrompts(queue: QueueItem[] | undefined, reason: string): QueueItem[] | undefined {
  if (!queue?.some(q => q.promptId)) return queue;
  for (const item of queue) {
    if (item.promptId) void reportCliPromptDelivery(item.promptId, false, reason);
  }
  return queue.filter(q => !q.promptId);
}

/** `failCliQueuedPrompts` over every terminal tab of a task's tab list;
 *  returns the (possibly unchanged) list. */
export function failCliQueuedPromptsInTabs(tabs: Tab[] | undefined, reason: string): Tab[] | undefined {
  if (!tabs?.some(t => t.type === "terminal" && (t as TerminalTab).queue?.some(q => q.promptId))) {
    return tabs;
  }
  return tabs.map(t => {
    if (t.type !== "terminal") return t;
    const queue = failCliQueuedPrompts(t.queue, reason);
    return queue === t.queue ? t : ({ ...t, queue } as Tab);
  });
}
