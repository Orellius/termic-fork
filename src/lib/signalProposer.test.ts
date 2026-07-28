import { describe, expect, it } from "vitest";
import {
  candidatesFor,
  escapeRegex,
  leadingGlyphs,
  longestCommonSubstring,
  proposeSignals,
} from "./signalProposer";

// Real captures, so the tests fail when the proposer stops handling the agents
// people actually run. Both shapes are "<varying glyph> <stable text>", which
// is precisely the case where the obvious generalization is wrong.
const CLAUDE_BUSY = ["⠋ termic", "⠙ termic", "⠹ termic", "⠸ termic"];
const CLAUDE_IDLE = ["✳ termic"];
const CODEX_BUSY = ["⠋ Working", "⠙ Working", "⠹ Working"];
const CODEX_IDLE = ["Ready"];

describe("longestCommonSubstring", () => {
  it("returns the longest run shared by every input", () => {
    expect(longestCommonSubstring(["⠋ Working…", "⠙ Working…"])).toBe(" Working…");
    expect(longestCommonSubstring(["abcdef", "zzcdezz", "cde"])).toBe("cde");
  });

  it("handles the degenerate inputs", () => {
    expect(longestCommonSubstring([])).toBe("");
    expect(longestCommonSubstring(["solo"])).toBe("solo");
    expect(longestCommonSubstring(["abc", "xyz"])).toBe("");
  });
});

describe("leadingGlyphs", () => {
  it("detects the spinner shape: one varying char, identical tail", () => {
    expect(leadingGlyphs(CLAUDE_BUSY)).toEqual(["⠋", "⠙", "⠹", "⠸"]);
  });

  it("is not fooled by variation anywhere else", () => {
    // Differing tails: not a glyph class, even though the heads differ.
    expect(leadingGlyphs(["⠋ one", "⠙ two"])).toEqual([]);
    // Identical heads are a prefix, not a class.
    expect(leadingGlyphs(["⠋ a", "⠋ a"])).toEqual([]);
    // A single observation can't establish what varies.
    expect(leadingGlyphs(["⠋ termic"])).toEqual([]);
  });
});

describe("candidatesFor", () => {
  it("offers the glyph class before the common text before literals", () => {
    const kinds = candidatesFor(CLAUDE_BUSY).map(c => c.kind);
    expect(kinds[0]).toBe("glyph-class");
    expect(kinds[1]).toBe("common-text");
    expect(kinds.slice(2).every(k => k === "literal")).toBe(true);
  });

  it("proposes only a literal from a single observation", () => {
    expect(candidatesFor(["Ready"])).toEqual([
      { pattern: "Ready", kind: "literal", evidence: ["Ready"] },
    ]);
  });

  it("escapes regex metacharacters in observed titles", () => {
    const [first] = candidatesFor(["Working (2/3)..."]);
    expect(first.pattern).toBe("Working \\(2/3\\)\\.\\.\\.");
    expect(new RegExp(first.pattern).test("Working (2/3)...")).toBe(true);
  });

  it("ignores blank and whitespace-only samples", () => {
    expect(candidatesFor(["", "   ", "\t"])).toEqual([]);
  });
});

describe("proposeSignals", () => {
  // THE case this module exists for. Claude's busy titles are
  // "<spinner> <task>" and its idle title is "✳ <task>", so the longest common
  // substring of the busy samples is the task name — which matches the idle
  // title too. Precedence is busy > idle, so saving that would mean the agent
  // never reports done. It must be rejected in favour of the glyph class.
  it("rejects a busy candidate that also matches an idle title", () => {
    const out = proposeSignals({ busy: CLAUDE_BUSY, idle: CLAUDE_IDLE });

    expect(out.busy[0].pattern).toBe("^[\\u2800-\\u28FF]");
    // The task name is gone from every surviving busy proposal.
    for (const p of out.busy) {
      expect(new RegExp(p.pattern).test("✳ termic")).toBe(false);
    }
    // ...and the rejection is reported with the sample that caused it, so the
    // UI can explain the absence instead of silently dropping it.
    expect(out.rejected).toContainEqual({
      cls: "busy",
      pattern: "termic",
      conflictsWith: "✳ termic",
    });
  });

  it("keeps the common text when it does not collide", () => {
    const out = proposeSignals({ busy: CODEX_BUSY, idle: CODEX_IDLE });
    expect(out.busy.map(p => p.pattern)).toContain("Working");
    expect(out.idle[0].pattern).toBe("Ready");
  });

  it("survives the round trip: proposals classify their own samples", () => {
    // The point of the whole exercise — save these and the agent works.
    const out = proposeSignals({ busy: CLAUDE_BUSY, idle: CLAUDE_IDLE });
    const busyRes = out.busy.map(p => new RegExp(p.pattern));
    const idleRes = out.idle.map(p => new RegExp(p.pattern));

    for (const t of CLAUDE_BUSY) {
      expect(busyRes.some(re => re.test(t))).toBe(true);
      expect(idleRes.some(re => re.test(t))).toBe(false);
    }
    for (const t of CLAUDE_IDLE) {
      expect(idleRes.some(re => re.test(t))).toBe(true);
      expect(busyRes.some(re => re.test(t))).toBe(false);
    }
  });

  it("generalizes past the spinner frames it never saw", () => {
    // Four frames captured, but a capture only sees whichever frames landed on
    // a title change. Enumerating exactly those would misread the wheel one
    // frame in ten, so an all-Braille class widens to the whole block.
    const out = proposeSignals({ busy: ["⠋ x", "⠙ x", "⠹ x", "⠸ x"], idle: ["✳ x"] });
    const re = new RegExp(out.busy[0].pattern);
    expect(re.test("⠙ x")).toBe(true);   // observed
    expect(re.test("⠼ x")).toBe(true);   // never observed, still matched
    expect(re.test("⣿ x")).toBe(true);   // far end of the block
    expect(re.test("✳ x")).toBe(false);  // the idle glyph stays outside
  });

  it("enumerates instead of widening when the glyphs are not Braille", () => {
    // No safe range to infer from arbitrary glyphs, so don't invent one.
    const out = proposeSignals({ busy: ["| x", "/ x", "- x"], idle: ["✳ x"] });
    // `|` is literal inside a class, so it stays bare; only `] \ ^ -` need it.
    expect(out.busy[0].pattern).toBe("^[|/\\-]");
    expect(new RegExp(out.busy[0].pattern).test("\\ x")).toBe(false);
  });

  it("escapes a hyphen so it cannot become a character range", () => {
    // `-` needs no escape in open regex source, so the general escaper leaves
    // it alone. Inside a class it means "range": these glyphs would otherwise
    // build [!-9], silently matching 25 characters nobody asked for.
    const out = proposeSignals({ busy: ["! x", "- x", "9 x"], idle: ["✳ x"] });
    const re = new RegExp(out.busy[0].pattern);
    expect(re.test("! x")).toBe(true);
    expect(re.test("- x")).toBe(true);
    expect(re.test("5 x")).toBe(false); // inside [!-9] if the range leaked
    expect(re.test("+ x")).toBe(false);
  });

  it("does not build a reversed range that fails to compile", () => {
    // [\|-/] would throw: | is U+007C, / is U+002F.
    const out = proposeSignals({ busy: ["| x", "- x", "/ x"], idle: ["✳ x"] });
    expect(() => new RegExp(out.busy[0].pattern)).not.toThrow();
    expect(new RegExp(out.busy[0].pattern).test("| x")).toBe(true);
  });

  it("respects attention > busy > idle when filtering", () => {
    // "Waiting for approval" must not be swallowed by a busy pattern.
    const out = proposeSignals({
      attention: ["Waiting for approval"],
      busy: ["Waiting…", "Working…"],
    });
    for (const p of out.busy) {
      expect(new RegExp(p.pattern).test("Waiting for approval")).toBe(false);
    }
    expect(out.attention[0].pattern).toBe("Waiting for approval");
  });

  it("returns empty sets for an empty capture", () => {
    const out = proposeSignals({});
    expect(out).toEqual({ busy: [], idle: [], attention: [], rejected: [] });
  });

  it("caps each class at the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => `frame-${i}`);
    expect(proposeSignals({ busy: many }, 2).busy).toHaveLength(2);
  });
});

describe("escapeRegex", () => {
  it("neutralizes every metacharacter", () => {
    const raw = ".*+?^${}()|[]\\";
    expect(new RegExp(escapeRegex(raw)).test(raw)).toBe(true);
  });
});
