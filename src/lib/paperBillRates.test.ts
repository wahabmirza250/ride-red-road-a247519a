import { expect, test } from "vitest";
import { loadRateRows } from "./billingRates.server";
import { calcClaim } from "./claimCalc";
function db(rows: any[]) {
  return { from: () => {
    const filters: Array<[string, unknown]> = [];
    const q: any = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k,v]); return q; }, is: (k: string, v: unknown) => { filters.push([k,v]); return q; }, then: (resolve: any) => Promise.resolve({ data: rows.filter(r => filters.every(([k,v]) => r[k] === v)), error: null }).then(resolve) };
    return q;
  } };
}
const pair = (company_id: string | null, trip: number, mile: number) => [
  { company_id, vehicle_type: "ambulatory", unit_type: "trip", charge_amount: trip, procedure_code: "A0120", place_of_service: "41" },
  { company_id, vehicle_type: "ambulatory", unit_type: "mile", charge_amount: mile, procedure_code: "S0215", place_of_service: "41" },
];
test("company settings replace legacy rates in paper calculations", async () => {
  const { rows, scope } = await loadRateRows(db([...pair(null,12.15,2.74), ...pair("company-a",36.4,3), ...pair("company-b",99,9)]), { companyId: "company-a" });
  expect(scope).toBe("company");
  expect(rows.map(r => r.charge_amount)).toEqual([36.4,3]);
  expect(calcClaim({ rates: rows, vehicleType: "ambulatory", legs: [{ pickup_odometer: 1000, dropoff_odometer: 1005 }] }).total).toBe(51.4);
});
test("a later settings change is read on the next server calculation", async () => {
  const rows = pair("company-a",36.4,3);
  const client = db(rows);
  await loadRateRows(client, { companyId: "company-a" });
  rows[1].charge_amount = 4;
  expect((await loadRateRows(client, { companyId: "company-a" })).rows[1].charge_amount).toBe(4);
});
