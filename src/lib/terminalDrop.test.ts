// Path handling for drops into a terminal (Finder drags + file-tree drags).
// The pointer gesture and the Tauri wiring are exercised by e2e; these cover
// the decisions that determine WHAT gets typed at the prompt.

import { describe, it, expect } from "vitest";
import { shellEscapePath, pathForTerminal, type DraggedPath } from "./terminalDrop";

const DRAG: DraggedPath = {
  taskId: "task-a",
  rel: "src/lib/terminalDrop.ts",
  abs: "/Users/x/tasks/task-a/src/lib/terminalDrop.ts",
};

describe("shellEscapePath", () => {
  it("leaves a plain path untouched", () => {
    expect(shellEscapePath("src/lib/a-b_c.ts")).toBe("src/lib/a-b_c.ts");
  });

  it("escapes spaces and shell metacharacters", () => {
    expect(shellEscapePath("/Downloads/Nextech 0098.jpg"))
      .toBe("/Downloads/Nextech\\ 0098.jpg");
    expect(shellEscapePath("a(1)&b$c'd\"e.txt"))
      .toBe("a\\(1\\)\\&b\\$c\\'d\\\"e.txt");
  });

  it("escapes non-ASCII so the byte stream stays literal", () => {
    expect(shellEscapePath("docs/설계.md")).toBe("docs/\\설\\계.md");
  });
});

describe("pathForTerminal", () => {
  it("types the relative path into a terminal of the same task", () => {
    expect(pathForTerminal(DRAG, "task-a")).toBe(DRAG.rel);
  });

  it("falls back to absolute for another task's terminal", () => {
    expect(pathForTerminal(DRAG, "task-b")).toBe(DRAG.abs);
  });

  it("falls back to absolute when either side has no task", () => {
    expect(pathForTerminal(DRAG, "")).toBe(DRAG.abs);
    expect(pathForTerminal({ ...DRAG, taskId: "" }, "task-a")).toBe(DRAG.abs);
  });
});
