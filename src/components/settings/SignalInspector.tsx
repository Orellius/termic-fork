// "What is this agent actually emitting?" — the missing half of editing an
// agent's work-done signals.
//
// Writing a busy/done/needs-you pattern used to be guesswork: the strings you
// have to match are OSC titles, termic consumes them, and nothing ever showed
// them to you. Two views over the same ring buffer (lib/agentSignalLog):
//
//   Observed  — frequency table of every title seen, always on. The FIXING
//               path: why did this flip to done, what is it printing.
//   Capture   — labels one turn by its boundaries (you submit → titles →
//               quiescence) and proposes patterns. The AUTHORING path.
//
// Capture ends on quiescence rather than a timer. The bootstrap that makes it
// work on an agent with no signals: "done" then comes from the fallback
// heuristics (byte-quiet, scrollback-stable), which are too coarse to drive a
// live spinner but fine for labelling an offline sample.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  capturePhase,
  captureSamples,
  clearCapture,
  getSignalLogVersion,
  observationsFor,
  resetSignalLog,
  startCapture,
  stopCapture,
  subscribeSignalLog,
  type TitleObservation,
} from "@/lib/agentSignalLog";
import { compileSignals } from "@/lib/agents";
import { escapeRegex, proposeSignals, type SignalClass } from "@/lib/signalProposer";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { Circle, Plus, Trash2 } from "lucide-react";

/** Re-render on buffer changes. The buffer throttles its notifications, so
 *  this settles at ~4/s however fast the spinner repaints — and it holds NO
 *  listener while this panel is unmounted, so recording stays free. */
function useSignalLogVersion(): number {
  return useSyncExternalStore(
    subscribeSignalLog,
    getSignalLogVersion,
    getSignalLogVersion,
  );
}

const CLASS_LABEL: Record<SignalClass, string> = {
  busy: "Busy",
  idle: "Done",
  attention: "Needs you",
};

const CLASS_TONE: Record<SignalClass, string> = {
  busy: "text-[var(--color-warn)]",
  idle: "text-[var(--color-ok-fg)]",
  attention: "text-[var(--color-err)]",
};

export interface SignalInspectorProps {
  agentId: string;
  signals: { busy?: string[]; idle?: string[]; attention?: string[] } | undefined;
  /** Append a pattern to one of the three lists (deduped by the caller). */
  onAddPattern: (cls: SignalClass, pattern: string) => void;
}

export function SignalInspector({ agentId, signals, onAddPattern }: SignalInspectorProps) {
  const version = useSignalLogVersion();
  const [open, setOpen] = useState(false);
  const observations = open ? observationsFor(agentId) : [];
  const phase = capturePhase(agentId);

  // Drop a stale capture when the panel closes, so reopening never shows a
  // half-finished session from ten minutes ago.
  useEffect(() => {
    if (!open && phase !== "off") clearCapture();
  }, [open, phase]);

  // Which of the agent's CURRENT patterns match each observed title. Answers
  // "does my regex work" without relaunching anything.
  const matchers = useMemo(() => ({
    attention: compileSignals(signals?.attention ?? []),
    busy: compileSignals(signals?.busy ?? []),
    idle: compileSignals(signals?.idle ?? []),
  }), [signals]);

  const liveClass = (title: string): SignalClass | null => {
    // Same precedence the classifier uses, so the preview can't disagree with
    // what will actually happen at runtime.
    if (matchers.attention.some(re => re.test(title))) return "attention";
    if (matchers.busy.some(re => re.test(title))) return "busy";
    if (matchers.idle.some(re => re.test(title))) return "idle";
    return null;
  };

  const proposals = useMemo(
    () => (phase === "done" ? proposeSignals(captureSamples(agentId)) : null),
    [phase, agentId, version],
  );

  if (!open) {
    return (
      <div className="border-t border-[var(--color-border-soft)] pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12.5px] text-[var(--color-accent)] hover:underline"
        >
          Show what this agent is emitting…
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-border-soft)] pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-[var(--color-fg)]">
          Observed titles
        </div>
        <div className="flex items-center gap-2">
          {phase === "off" && (
            <Button variant="ghost" onClick={() => startCapture(agentId)}>
              Capture a turn
            </Button>
          )}
          {(phase === "waiting-for-submit" || phase === "recording") && (
            <Button variant="ghost" onClick={() => stopCapture()}>Stop</Button>
          )}
          {phase === "done" && (
            <Button variant="ghost" onClick={() => startCapture(agentId)}>
              Capture again
            </Button>
          )}
          <Button variant="ghost" onClick={() => resetSignalLog(agentId)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[12px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            Hide
          </button>
        </div>
      </div>

      {phase === "waiting-for-submit" && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 px-2.5 py-2 text-[12px] text-[var(--color-fg-dim)]">
          <Circle className="h-2.5 w-2.5 shrink-0 animate-pulse fill-current text-[var(--color-accent)]" />
          Send one prompt to a task running this agent. Recording stops on its own
          when the turn finishes.
        </div>
      )}
      {phase === "recording" && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 px-2.5 py-2 text-[12px] text-[var(--color-fg-dim)]">
          <Circle className="h-2.5 w-2.5 shrink-0 animate-pulse fill-current text-[var(--color-warn)]" />
          Recording the turn…
        </div>
      )}

      {proposals && (
        <ProposalPanel proposals={proposals} onAddPattern={onAddPattern} />
      )}

      {observations.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-[12px] text-[var(--color-fg-dim)]">
          Nothing seen yet. Start a task with this agent and its terminal titles
          show up here.
        </div>
      ) : (
        <div className="max-h-[260px] overflow-y-auto rounded-md border border-[var(--color-border-soft)]">
          <table className="w-full text-[12px]">
            <tbody>
              {observations.map(o => (
                <ObservationRow
                  key={o.title}
                  o={o}
                  live={liveClass(o.title)}
                  onAddPattern={onAddPattern}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-1.5 text-[11.5px] text-[var(--color-fg-faint)]">
        Adding from here inserts the title as an exact match. A capture proposes
        patterns that cover a whole spinner instead.
      </div>
    </div>
  );
}

function ObservationRow({ o, live, onAddPattern }: {
  o: TitleObservation;
  live: SignalClass | null;
  onAddPattern: (cls: SignalClass, pattern: string) => void;
}) {
  return (
    <tr className="border-b border-[var(--color-border-soft)] last:border-0 align-middle">
      <td className="max-w-0 px-2.5 py-1.5">
        <div className="truncate font-mono text-[var(--color-fg)]" title={o.title}>
          {o.title}
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--color-fg-faint)]">
        {o.seen}
      </td>
      {/* data-live-class: the "+ Busy" / "+ Done" buttons in the next cell
          carry the SAME words, so text alone can't tell a real classification
          from a button label. Assertions need something unambiguous. */}
      <td className="whitespace-nowrap px-2 py-1.5" data-live-class={live ?? "none"}>
        {live ? (
          <span className={cn("text-[11.5px]", CLASS_TONE[live])}>{CLASS_LABEL[live]}</span>
        ) : (
          <span className="text-[11.5px] text-[var(--color-fg-faint)]">unmatched</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        {(["busy", "idle", "attention"] as SignalClass[]).map(cls => (
          <button
            key={cls}
            type="button"
            title={`Add as ${CLASS_LABEL[cls]}`}
            // Escape: these fields are regex sources, and a title like
            // "Working (2/3)" would otherwise become a pattern that matches
            // something else entirely (or fails to compile).
            onClick={() => onAddPattern(cls, escapeRegex(o.title))}
            className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
          >
            <Plus className="mr-0.5 inline h-3 w-3" />
            {CLASS_LABEL[cls]}
          </button>
        ))}
      </td>
    </tr>
  );
}

function ProposalPanel({ proposals, onAddPattern }: {
  proposals: ReturnType<typeof proposeSignals>;
  onAddPattern: (cls: SignalClass, pattern: string) => void;
}) {
  const groups: { cls: SignalClass; items: typeof proposals.busy }[] = [
    { cls: "busy", items: proposals.busy },
    { cls: "idle", items: proposals.idle },
  ];
  const any = groups.some(g => g.items.length > 0);

  return (
    <div className="mb-2 rounded-md border border-[var(--color-ok-fg)]/40 bg-[var(--color-ok-fg)]/5 p-2.5">
      <div className="mb-1.5 text-[12px] font-medium text-[var(--color-fg)]">
        Suggested from that turn
      </div>
      {!any && (
        <div className="text-[11.5px] text-[var(--color-fg-dim)]">
          Nothing usable. The agent may not set a terminal title at all, in which
          case turn on output matching below and try again.
        </div>
      )}
      {groups.map(({ cls, items }) => items.length > 0 && (
        <div key={cls} className="mb-1.5 last:mb-0">
          <div className={cn("text-[11px] uppercase tracking-wide", CLASS_TONE[cls])}>
            {CLASS_LABEL[cls]}
          </div>
          {items.map(p => (
            <div key={p.pattern} className="flex items-center gap-2 py-0.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-fg)]">
                {p.pattern}
              </code>
              {/* Show the evidence: a proposer that writes regexes without
                  saying what it saw gets distrusted the first time it's wrong. */}
              <span className="shrink-0 text-[11px] text-[var(--color-fg-faint)]" title={p.evidence.join("\n")}>
                {p.kind === "glyph-class" ? "covers the spinner"
                  : p.kind === "common-text" ? "shared text"
                  : "exact title"}
              </span>
              <Button variant="ghost" onClick={() => onAddPattern(cls, p.pattern)}>
                Use
              </Button>
            </div>
          ))}
        </div>
      ))}
      {proposals.rejected.length > 0 && (
        // Explain the absence. The obvious generalization is often the broken
        // one (claude's busy titles share the task name with its idle title),
        // and a silently missing suggestion looks like a bug.
        <div className="mt-1.5 border-t border-[var(--color-border-soft)] pt-1.5 text-[11px] text-[var(--color-fg-faint)]">
          Skipped {proposals.rejected.length} suggestion
          {proposals.rejected.length > 1 ? "s" : ""} that would also have matched
          another state (e.g. <code className="font-mono">{proposals.rejected[0].pattern}</code>{" "}
          matches <code className="font-mono">{proposals.rejected[0].conflictsWith}</code>).
        </div>
      )}
    </div>
  );
}
