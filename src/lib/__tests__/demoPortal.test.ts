import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ demo: true }));
vi.mock("@/lib/demoCompany.server", () => ({ isDemoCompany: vi.fn(async () => fixture.demo) }));
vi.mock("@/lib/company.server", () => ({ requireCompanyId: vi.fn(async () => "demo") }));
import { runDemoPortal } from "@/lib/demoPortal.server";
import { checkOneClaim } from "@/lib/claimStatusSync.server";
import { demoPlaceSuggestions, resolveDemoPlace } from "@/lib/demoPlaces";
function database(rows: any[]) {
  const writes: any[] = [];
  const db = { from: vi.fn(() => {
    let patch: any = null;
    const filters: Array<[string, any]> = [];
    const q: any = {
      select: () => q, update: (p: any) => { patch=p; return q; },
      eq: (k: string,v: any) => { filters.push([k,v]); return q; },
      in: () => q,
      then: (resolve: any) => { if (patch) { writes.push({patch,filters}); const row=rows.find(r=>r.id===filters.find(([k])=>k==="id")?.[1]); Object.assign(row,patch); } return Promise.resolve({data: rows,error: null}).then(resolve); },
    }; return q;
  }) };
  return {db,writes};
}
describe("presentation billing", () => {
  beforeEach(() => { fixture.demo=true; });
  it("never allows live company simulation", async () => {fixture.demo=false;const {db}=database([]);await expect(runDemoPortal(db,"live",["x"],"submit")).rejects.toThrow("restricted");expect(db.from).not.toHaveBeenCalled();});
  it("rejects a foreign selection before any write", async () => {const {db,writes}=database([]);await expect(runDemoPortal(db,"demo",["foreign"],"submit")).rejects.toThrow("belong");expect(writes).toEqual([]);});
  it("submits and pays a sample, scoped to its company, without external calls", async () => {
    const fetch=vi.spyOn(globalThis,"fetch"); const row={id:"12345678-test",status:"approved"};const {db,writes}=database([row]);
    await runDemoPortal(db,"demo",[row.id],"submit");
    expect(row).toMatchObject({status:"submitted",state_confirmation_number:"DEMO-12345678"});
    await runDemoPortal(db,"demo",[row.id],"submit");expect(writes).toHaveLength(1);
    await runDemoPortal(db,"demo",[row.id],"payment");expect(row).toMatchObject({edi_status:"paid"});
    expect(writes.every(w=>w.filters.some(([k,v]:any[])=>k==="company_id"&&v==="demo"))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
  });
  it("does not send demo confirmations to the real status checker",async()=>{const transport=vi.fn();expect((await checkOneClaim("demo","DEMO-12345678",transport)).ok).toBe(true);expect(transport).not.toHaveBeenCalled();});
  it("resolves demo searches to explicit sample locations",()=>{expect(demoPlaceSuggestions("2030")[0].placeId).toBe("demo-clinic");expect(resolveDemoPlace("12 Example Lane").placeId).toBe("demo-home");expect(demoPlaceSuggestions("unknown").every(p=>p.secondary.includes("Sample"))).toBe(true);});
});
