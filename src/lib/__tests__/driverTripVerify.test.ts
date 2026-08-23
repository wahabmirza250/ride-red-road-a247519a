import { describe, expect, it, vi } from "vitest";
import {
  beginVerify,
  completeVerify,
  failVerify,
  syncVerifyMapToRiders,
  verificationBlocksSubmit,
  verificationLabel,
  verificationWarnings,
  type VerifyMap,
} from "@/lib/driverTripVerify";

/** Mirrors the wizard's manual verify handler. */
function makeController(request: (id: string) => Promise<any>) {
  let map: VerifyMap = {};
  return {
    get map() {
      return map;
    },
    selectRider(ids: string[]) {
      map = syncVerifyMapToRiders(map, ids);
    },
    async verify(id: string) {
      const { next, shouldRequest } = beginVerify(map, id);
      map = next;
      if (!shouldRequest) return;
      try {
        map = completeVerify(map, id, await request(id));
      } catch (e) {
        map = failVerify(map, id, e instanceof Error ? e.message : "Verification failed");
      }
    },
  };
}

describe("driver trip Medicaid verification (manual, optional)", () => {
  it("selecting a passenger does NOT trigger verification", () => {
    const request = vi.fn();
    const c = makeController(request);
    c.selectRider(["r1"]);
    c.selectRider(["r1", "r2"]);
    expect(request).not.toHaveBeenCalled();
    expect(verificationLabel(c.map["r1"])).toBe("Not checked");
  });

  it("manual verify triggers exactly one verification request", async () => {
    const request = vi.fn().mockResolvedValue({ status: "matched", message: "Name matches" });
    const c = makeController(request);
    c.selectRider(["r1"]);
    await c.verify("r1");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("r1");
    expect(verificationLabel(c.map["r1"])).toBe("Verified");
  });

  it("double tap while running does not fire a second request", async () => {
    let resolve!: (v: any) => void;
    const request = vi.fn(() => new Promise<any>((r) => (resolve = r)));
    const c = makeController(request);
    const first = c.verify("r1");
    await c.verify("r1");
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ status: "matched", message: "ok" });
    await first;
  });

  it("submission stays allowed when verification is Not checked", () => {
    expect(verificationBlocksSubmit({}, ["r1", "r2"])).toBe(false);
  });

  it("mismatch and unavailable are shown but non-blocking", async () => {
    const c = makeController(async (id) =>
      id === "r1"
        ? { status: "mismatch", message: "Portal shows Jane Doe" }
        : Promise.reject(new Error("Portal timed out")),
    );
    c.selectRider(["r1", "r2"]);
    await c.verify("r1");
    await c.verify("r2");

    expect(verificationLabel(c.map["r1"])).toBe("Mismatch");
    expect(verificationLabel(c.map["r2"])).toBe("Unavailable");
    expect(
      verificationWarnings(c.map, [
        { id: "r1", name: "A" },
        { id: "r2", name: "B" },
      ]),
    ).toEqual(["Portal shows Jane Doe", "Portal timed out"]);
    expect(verificationBlocksSubmit(c.map, ["r1", "r2"])).toBe(false);
  });

  it("drops state for removed riders only", async () => {
    const c = makeController(async () => ({ status: "matched", message: "ok" }));
    c.selectRider(["r1", "r2"]);
    await c.verify("r1");
    c.selectRider(["r1"]);
    expect(Object.keys(c.map)).toEqual(["r1"]);
    expect(verificationLabel(c.map["r1"])).toBe("Verified");
  });

  it("verified riders produce no warnings", async () => {
    const c = makeController(async () => ({ status: "matched", message: "Name matches" }));
    await c.verify("r1");
    expect(verificationWarnings(c.map, [{ id: "r1", name: "A" }])).toEqual([]);
  });
});
