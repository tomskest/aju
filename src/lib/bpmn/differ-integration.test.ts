/**
 * Integration check against the real bpmn-js-differ.
 *
 * The unit tests in diff.test.ts feed summarizeChanges a hand-written
 * differ result. This one parses two real BPMN 2.0 documents and runs
 * the actual differ, which is the only way to catch the differ changing
 * the shape our types and summariser are written against.
 *
 * The browser path parses XML through a bpmn-js viewer (it needs a DOM);
 * here the same moddle parse happens headlessly via bpmn-moddle, which
 * is what bpmn-js uses internally and what the differ documents as its
 * input.
 */
import { describe, it, expect } from "vitest";
import { BpmnModdle } from "bpmn-moddle";
import { diff } from "bpmn-js-differ";
import { findElementsWithoutDi, summarizeChanges, type BpmnChanges } from "./diff";

/**
 * Two tasks in a row. `variant` applies the kind of edit this workflow
 * produces: a rename that keeps the element id, and an inserted task
 * with its own DI.
 */
function process(variant: "base" | "renamed" | "inserted" | "undrawn"): string {
  const renamed = variant === "renamed";
  const inserted = variant === "inserted";
  const undrawn = variant === "undrawn";

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Booking requested">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="${renamed ? "Re-check preconditions" : "Check preconditions"}">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    ${inserted || undrawn ? '<bpmn:task id="Task_visa" name="Check visa expiry" />' : ""}
    <bpmn:endEvent id="End_1" name="Party booked">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="240" y="80" width="180" height="80" />
      </bpmndi:BPMNShape>
      ${
        inserted
          ? `<bpmndi:BPMNShape id="Task_visa_di" bpmnElement="Task_visa">
        <dc:Bounds x="470" y="80" width="160" height="80" />
      </bpmndi:BPMNShape>`
          : ""
      }
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="692" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="240" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="420" y="120" />
        <di:waypoint x="692" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

async function parse(xml: string) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);
  return rootElement;
}

async function diffOf(a: string, b: string) {
  const [oldDefs, newDefs] = await Promise.all([parse(a), parse(b)]);
  return summarizeChanges(diff(oldDefs, newDefs) as BpmnChanges);
}

describe("bpmn-js-differ integration", () => {
  it("reports a kept id with a new name as one changed element", async () => {
    const entries = await diffOf(process("base"), process("renamed"));
    const task = entries.filter((e) => e.id === "Task_1");

    expect(task).toHaveLength(1);
    expect(task[0].kind).toBe("changed");
    expect(task[0].type).toBe("Task");
    expect(task[0].attrs).toContainEqual({
      key: "name",
      oldValue: "Check preconditions",
      newValue: "Re-check preconditions",
    });
    // The point of keeping ids stable: a rename must not read as churn.
    expect(entries.some((e) => e.kind === "added" || e.kind === "removed")).toBe(false);
  });

  it("reports an inserted task as added and leaves untouched elements alone", async () => {
    const entries = await diffOf(process("base"), process("inserted"));

    const added = entries.filter((e) => e.kind === "added");
    expect(added.map((e) => e.id)).toEqual(["Task_visa"]);
    expect(added[0].name).toBe("Check visa expiry");
    expect(entries.some((e) => e.id === "Start_1")).toBe(false);
    expect(entries.some((e) => e.id === "End_1")).toBe(false);
  });

  it("finds nothing between a document and itself", async () => {
    expect(await diffOf(process("base"), process("base"))).toEqual([]);
  });

  it("reads the diff in both directions, so a removal is the mirror of an add", async () => {
    const entries = await diffOf(process("inserted"), process("base"));
    expect(entries.filter((e) => e.kind === "removed").map((e) => e.id)).toEqual(["Task_visa"]);
  });

  it("flags an element that parses but has no DI to draw with", async () => {
    const withoutDi = await parse(process("undrawn"));
    expect(findElementsWithoutDi(withoutDi).map((e) => e.id)).toEqual(["Task_visa"]);

    const withDi = await parse(process("inserted"));
    expect(findElementsWithoutDi(withDi)).toEqual([]);
  });
});
