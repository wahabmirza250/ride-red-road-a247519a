import { describe, expect, it } from "vitest";
import { demoReducer, initialDemo } from "../presentationDemo";
describe("presentation demo workflow", () => {
  it("connects request, assignment, driver completion and billing", () => {
    let s = demoReducer(initialDemo(), { type: "request" });
    expect(demoReducer(s, { type: "complete", id: "D-103" }).trips[2].status).toBe("requested");
    s = demoReducer(s, { type: "assign", id: "D-103" });
    s = demoReducer(s, { type: "start", id: "D-103" });
    s = demoReducer(s, { type: "complete", id: "D-103" });
    s = demoReducer(s, { type: "batch", ids: ["D-103"], method: "EDI" });
    expect(s.batches[0]).toMatchObject({
      cents: 7000,
      tripIds: ["D-103"],
      method: "EDI",
      status: "created",
    });
    expect(demoReducer(s, { type: "pay", id: "DEMO-001" }).batches[0].status).toBe("created");
    s = demoReducer(s, { type: "send", id: "DEMO-001" });
    s = demoReducer(s, { type: "pay", id: "DEMO-001" });
    expect(s.batches[0].status).toBe("paid");
  });
  it("prevents incomplete trips and duplicate trips entering batches", () => {
    let s = demoReducer(initialDemo(), { type: "request" });
    s = demoReducer(s, { type: "batch", ids: ["D-101", "D-101", "D-103"], method: "Robot" });
    expect(s.batches[0]).toMatchObject({ cents: 7800, tripIds: ["D-101"], method: "Robot" });
    expect(demoReducer(s, { type: "batch", ids: ["D-101"], method: "EDI" }).batches).toHaveLength(
      1,
    );
  });
  it("supports separate EDI and Robot batches and a repeatable reset", () => {
    let s = demoReducer(initialDemo(), { type: "batch", ids: ["D-101"], method: "EDI" });
    s = demoReducer(s, { type: "batch", ids: ["D-102"], method: "Robot" });
    expect(s.batches.map((b) => b.method)).toEqual(["EDI", "Robot"]);
    expect(demoReducer(s, { type: "reset" })).toEqual(initialDemo());
  });
  it("does not duplicate a request on repeated clicks or mutate initial records", () => {
    const initial = initialDemo();
    const s = demoReducer(initial, { type: "request" });
    expect(demoReducer(s, { type: "request" }).trips).toHaveLength(3);
    expect(initial.trips).toHaveLength(2);
  });
});
