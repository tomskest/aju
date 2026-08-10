/**
 * Tests for the DOM-free half of BPMN version diffing: pulling ```bpmn
 * fences out of a markdown document, and flattening a bpmn-js-differ
 * result into the list the diff view renders.
 */
import { describe, it, expect } from "vitest";
import {
  countByKind,
  extractBpmnFences,
  findElementsWithoutDi,
  formatAttrValue,
  hasBpmnFence,
  isLayoutOnlyDiff,
  summarizeChanges,
  type BpmnChanges,
} from "./diff";

const FENCE = "```";

describe("extractBpmnFences", () => {
  it("returns nothing for a document with no diagram", () => {
    expect(extractBpmnFences("# Title\n\nJust prose.\n")).toEqual([]);
    expect(hasBpmnFence("# Title\n\nJust prose.\n")).toBe(false);
  });

  it("extracts a single fence body without the delimiters", () => {
    const md = `intro\n\n${FENCE}bpmn\n<definitions />\n${FENCE}\n\nouttro\n`;
    expect(extractBpmnFences(md)).toEqual(["<definitions />"]);
    expect(hasBpmnFence(md)).toBe(true);
  });

  it("extracts multiple fences in document order", () => {
    const md = [
      `${FENCE}bpmn`,
      "<first />",
      FENCE,
      "prose in between",
      `${FENCE}bpmn`,
      "<second />",
      FENCE,
    ].join("\n");
    expect(extractBpmnFences(md)).toEqual(["<first />", "<second />"]);
  });

  it("ignores fences of other languages", () => {
    const md = `${FENCE}xml\n<not-a-diagram />\n${FENCE}\n${FENCE}mermaid\nflowchart LR\n${FENCE}\n`;
    expect(extractBpmnFences(md)).toEqual([]);
  });

  it("does not treat a bpmn opener nested in another fence as a diagram", () => {
    // How the KB documents the format: a bpmn fence shown inside a
    // longer markdown fence. The inner one is content, not a diagram.
    const md = ["````markdown", `${FENCE}bpmn`, "<illustrative />", FENCE, "````"].join("\n");
    expect(extractBpmnFences(md)).toEqual([]);
  });

  it("keeps interior blank lines and indentation intact", () => {
    const md = `${FENCE}bpmn\n<a>\n\n  <b />\n</a>\n${FENCE}\n`;
    expect(extractBpmnFences(md)).toEqual(["<a>\n\n  <b />\n</a>"]);
  });

  it("tolerates an unterminated fence at end of file", () => {
    const md = `${FENCE}bpmn\n<definitions />\n`;
    expect(extractBpmnFences(md)).toEqual(["<definitions />"]);
  });

  it("handles CRLF line endings", () => {
    const md = `${FENCE}bpmn\r\n<definitions />\r\n${FENCE}\r\n`;
    expect(extractBpmnFences(md)).toEqual(["<definitions />"]);
  });
});

describe("summarizeChanges", () => {
  const changes: BpmnChanges = {
    _added: {
      Task_new: { $type: "bpmn:ServiceTask", id: "Task_new", name: "Check visa expiry" },
    },
    _removed: {
      Flow_old: { $type: "bpmn:SequenceFlow", id: "Flow_old" },
    },
    _changed: {
      Task_1: {
        model: { $type: "bpmn:Task", id: "Task_1", name: "Re-check preconditions" },
        // Inverted on purpose: bpmn-js-differ puts the newer value under
        // `oldValue`. See the swap in summarizeChanges and the guard in
        // differ-integration.test.ts.
        attrs: { name: { oldValue: "Re-check preconditions", newValue: "Check preconditions" } },
      },
    },
    _layoutChanged: {
      // Also in _changed, so it should be reported once, as "changed".
      Task_1: { $type: "bpmn:Task", id: "Task_1" },
      Gateway_2: { $type: "bpmn:ExclusiveGateway", id: "Gateway_2" },
    },
  };

  it("orders entries added, removed, changed, then layout-only", () => {
    expect(summarizeChanges(changes).map((e) => e.kind)).toEqual([
      "added",
      "removed",
      "changed",
      "layout",
    ]);
  });

  it("reports an element that both changed and moved only once", () => {
    const forTask1 = summarizeChanges(changes).filter((e) => e.id === "Task_1");
    expect(forTask1).toHaveLength(1);
    expect(forTask1[0].kind).toBe("changed");
  });

  it("strips the bpmn: prefix from element types", () => {
    const added = summarizeChanges(changes).find((e) => e.id === "Task_new");
    expect(added?.type).toBe("ServiceTask");
    expect(added?.name).toBe("Check visa expiry");
  });

  it("carries attribute deltas on changed elements", () => {
    const changed = summarizeChanges(changes).find((e) => e.id === "Task_1");
    expect(changed?.attrs).toEqual([
      { key: "name", oldValue: "Check preconditions", newValue: "Re-check preconditions" },
    ]);
  });

  it("leaves name null when an element has none", () => {
    expect(summarizeChanges(changes).find((e) => e.id === "Flow_old")?.name).toBeNull();
  });

  it("counts entries by kind", () => {
    expect(countByKind(summarizeChanges(changes))).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      layout: 1,
    });
  });

  it("survives a differ result with empty buckets", () => {
    const empty: BpmnChanges = { _added: {}, _removed: {}, _changed: {}, _layoutChanged: {} };
    expect(summarizeChanges(empty)).toEqual([]);
    expect(isLayoutOnlyDiff([])).toBe(false);
  });

  it("detects a pure re-layout", () => {
    const moved: BpmnChanges = {
      _added: {},
      _removed: {},
      _changed: {},
      _layoutChanged: { Task_1: { $type: "bpmn:Task", id: "Task_1" } },
    };
    expect(isLayoutOnlyDiff(summarizeChanges(moved))).toBe(true);
  });
});

describe("formatAttrValue", () => {
  it("renders empty-ish values as a placeholder", () => {
    expect(formatAttrValue(undefined)).toBe("(empty)");
    expect(formatAttrValue(null)).toBe("(empty)");
    expect(formatAttrValue("")).toBe("(empty)");
  });

  it("collapses whitespace in strings", () => {
    expect(formatAttrValue("two\n  lines")).toBe("two lines");
  });

  it("renders a moddle reference by id", () => {
    expect(formatAttrValue({ $type: "bpmn:Task", id: "Task_1" })).toBe("Task_1");
  });

  it("falls back to the type when a reference has no id", () => {
    expect(formatAttrValue({ $type: "bpmn:Task" })).toBe("Task");
  });

  it("summarises arrays by length", () => {
    expect(formatAttrValue([1, 2, 3])).toBe("3 items");
    expect(formatAttrValue([1])).toBe("1 item");
  });
});

describe("findElementsWithoutDi", () => {
  const withDi = (ids: string[]) => ({
    plane: { planeElement: ids.map((id) => ({ bpmnElement: { id } })) },
  });

  it("finds a flow element that would silently fail to draw", () => {
    const defs = {
      rootElements: [
        {
          $type: "bpmn:Process",
          flowElements: [
            { $type: "bpmn:Task", id: "Task_1" },
            { $type: "bpmn:Task", id: "Task_2", name: "Undrawn" },
          ],
        },
      ],
      diagrams: [withDi(["Task_1"])],
    };
    expect(findElementsWithoutDi(defs).map((e) => e.id)).toEqual(["Task_2"]);
  });

  it("returns nothing when every element is drawn", () => {
    const defs = {
      rootElements: [
        { $type: "bpmn:Process", flowElements: [{ $type: "bpmn:Task", id: "Task_1" }] },
      ],
      diagrams: [withDi(["Task_1"])],
    };
    expect(findElementsWithoutDi(defs)).toEqual([]);
  });

  it("stays quiet when there is no DI section at all", () => {
    // bpmn-js rejects that import outright; a per-element list would
    // just be noise on top of the real error.
    const defs = {
      rootElements: [
        { $type: "bpmn:Process", flowElements: [{ $type: "bpmn:Task", id: "Task_1" }] },
      ],
      diagrams: [],
    };
    expect(findElementsWithoutDi(defs)).toEqual([]);
  });

  it("handles null and malformed input", () => {
    expect(findElementsWithoutDi(null)).toEqual([]);
    expect(findElementsWithoutDi({})).toEqual([]);
  });
});
