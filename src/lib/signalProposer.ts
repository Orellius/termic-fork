// Turn observed agent titles into regex patterns a user can save as an
// agent's work-done signals.
//
// The hard part is NOT collecting titles (agentSignalLog does that). It's that
// a capture yields near-duplicates:
//
//   busy: "⠋ Working…"  "⠙ Working…"  "⠹ Working…"  …
//   idle: "✳ Ready"
//
// Ten literals is the wrong answer. So we generate a few candidate
// generalizations, then REJECT any that also match a sample from another
// class — which is the whole ballgame, because the obvious generalization is
// often the broken one. For claude, whose titles are "<spinner> <task name>"
// while working and "✳ <task name>" at rest, the longest common substring of
// the busy samples is the task name, which matches the idle title too. Since
// precedence is busy > idle, saving that pattern means the agent never reports
// done. That candidate has to die, and the leading-glyph character class is
// what survives.
//
// Pure and dependency-free so it can be unit-tested without a terminal.

/** A proposed pattern plus why we're proposing it. The UI shows `evidence`
 *  next to the pattern: a proposer that writes regexes without showing what it
 *  saw gets distrusted the first time it's wrong. */
export interface Proposal {
  /** Regex source, ready to drop into an agent's `signals` list. */
  pattern: string;
  /** How it was derived, for the UI's short explanation + ranking. */
  kind: "glyph-class" | "common-text" | "literal";
  /** The observed titles this pattern was built from (capped for display). */
  evidence: string[];
}

/** Escape a literal so it can sit inside a regex source unchanged. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape a literal for use INSIDE a `[...]` character class.
 *
 *  `-` needs no escape in open regex source, so `escapeRegex` leaves it alone
 *  — but inside a class it means "range", and the glyphs we splice in come
 *  from whatever the agent printed. `["|", "-", "/"]` would build `[\|-/]`,
 *  a reversed range that throws at compile time; `["!", "-", "9"]` would build
 *  `[!-9]`, which silently matches 25 characters nobody asked for. */
function escapeCharClass(s: string): string {
  return s.replace(/[\]\\^-]/g, "\\$&");
}

/** Compile without throwing: a candidate we can't compile is simply dropped
 *  (and a user's existing bad pattern must never break the proposer). */
function safeRegex(source: string): RegExp | null {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

/** Longest substring common to every input. Inputs here are terminal titles
 *  (tens of chars, a handful of samples), so the naive
 *  "every substring of the shortest, longest first" scan is fine and much
 *  easier to read than the suffix-automaton version. */
export function longestCommonSubstring(inputs: string[]): string {
  if (inputs.length === 0) return "";
  if (inputs.length === 1) return inputs[0];
  const shortest = inputs.reduce((a, b) => (a.length <= b.length ? a : b));
  const rest = inputs.filter(s => s !== shortest);
  for (let len = shortest.length; len > 0; len--) {
    for (let start = 0; start + len <= shortest.length; start++) {
      const candidate = shortest.slice(start, start + len);
      if (rest.every(s => s.includes(candidate))) return candidate;
    }
  }
  return "";
}

/** When every sample is "<one varying char><identical rest>", return the set of
 *  varying leading chars. That's the spinner-frame shape (Braille, ASCII
 *  spinners, brand glyphs) and it generalizes to frames we never observed,
 *  which is exactly what a 10-frame sample can't do by enumeration. */
export function leadingGlyphs(samples: string[]): string[] {
  const distinct = [...new Set(samples)].filter(s => s.length > 0);
  if (distinct.length < 2) return [];
  const tails = new Set(distinct.map(s => s.slice(1)));
  if (tails.size !== 1) return [];
  const glyphs = [...new Set(distinct.map(s => s[0]))];
  // All-identical first chars aren't a class, they're a prefix.
  return glyphs.length >= 2 ? glyphs : [];
}

/** Candidate patterns for one class, most-general first, before conflict
 *  filtering. Exported for tests; callers want `proposeSignals`. */
export function candidatesFor(samples: string[]): Proposal[] {
  const distinct = [...new Set(samples.map(s => s.trim()).filter(Boolean))];
  if (distinct.length === 0) return [];
  const out: Proposal[] = [];

  const glyphs = leadingGlyphs(distinct);
  if (glyphs.length > 0) {
    // A capture sees whichever frames happened to land on a title change, so
    // enumerating exactly those is fragile: miss ⠼ and the spinner reads as
    // "not busy" one frame in ten. When every observed glyph is Braille
    // (U+2800..U+28FF, where essentially every CLI spinner lives) widen to the
    // whole block, which covers the frames we never saw. Mixed or non-Braille
    // glyphs fall back to enumeration, since there's no safe range to infer.
    const braille = glyphs.every(g => g >= "⠀" && g <= "⣿");
    out.push({
      pattern: braille ? "^[\\u2800-\\u28FF]" : `^[${glyphs.map(escapeCharClass).join("")}]`,
      kind: "glyph-class",
      evidence: distinct.slice(0, 6),
    });
  }

  // Trim the common substring: a leading/trailing space is real in the title
  // but noise in a pattern, and keeping it makes the regex fail on the day the
  // agent adjusts its spacing.
  const lcs = longestCommonSubstring(distinct).trim();
  if (lcs.length >= 2 && distinct.length > 1) {
    out.push({
      pattern: escapeRegex(lcs),
      kind: "common-text",
      evidence: distinct.slice(0, 6),
    });
  }

  // Always offer the literals as a floor. For a single sample this is the only
  // honest proposal — one observation can't tell you what varies.
  for (const s of distinct.slice(0, 8)) {
    out.push({ pattern: escapeRegex(s), kind: "literal", evidence: [s] });
  }
  return out;
}

/** Samples grouped by the class a capture assigned them to. */
export interface SignalSamples {
  busy?: string[];
  idle?: string[];
  attention?: string[];
}

export type SignalClass = keyof SignalSamples;

export interface ProposalSet {
  busy: Proposal[];
  idle: Proposal[];
  attention: Proposal[];
  /** Candidates dropped because they also matched another class's samples,
   *  with the sample that killed them. Surfaced in the UI so a missing
   *  obvious-looking pattern is explained rather than mysteriously absent. */
  rejected: { cls: SignalClass; pattern: string; conflictsWith: string }[];
}

const CLASSES: SignalClass[] = ["attention", "busy", "idle"];

/**
 * Propose patterns per class, dropping any candidate that would misfire.
 *
 * A candidate is rejected when it matches a sample belonging to a DIFFERENT
 * class. Classification runs attention > busy > idle and stops at the first
 * hit, so an over-broad busy pattern permanently masks idle: the agent would
 * read as working forever and only the 10-minute absolute ceiling in
 * TerminalPane would clear it. Rejecting here is much cheaper than debugging
 * that later.
 *
 * Returns at most `limit` survivors per class, most-general first.
 */
export function proposeSignals(samples: SignalSamples, limit = 3): ProposalSet {
  const set: ProposalSet = { busy: [], idle: [], attention: [], rejected: [] };

  for (const cls of CLASSES) {
    const others = CLASSES.filter(c => c !== cls).flatMap(c => samples[c] ?? []);
    const otherDistinct = [...new Set(others.map(s => s.trim()).filter(Boolean))];

    for (const cand of candidatesFor(samples[cls] ?? [])) {
      if (set[cls].length >= limit) break;
      const re = safeRegex(cand.pattern);
      if (!re) continue;
      const clash = otherDistinct.find(o => re.test(o));
      if (clash !== undefined) {
        set.rejected.push({ cls, pattern: cand.pattern, conflictsWith: clash });
        continue;
      }
      // Don't offer the same source twice (a one-sample class produces the
      // same string as both common-text and literal).
      if (set[cls].some(p => p.pattern === cand.pattern)) continue;
      set[cls].push(cand);
    }
  }
  return set;
}
