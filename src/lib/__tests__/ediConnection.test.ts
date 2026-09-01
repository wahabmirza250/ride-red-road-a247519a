import { describe, expect, it } from "vitest";
import {
  describeEdiConnection,
  ediActionsBlocked,
  ediBlockedReason,
} from "@/lib/ediConnection";

describe("describeEdiConnection", () => {
  it("shows a neutral checking state while the probe is in flight", () => {
    const view = describeEdiConnection(null, true);
    expect(view.state).toBe("checking");
    expect(view.steps).toEqual([]);
    expect(ediActionsBlocked(view)).toBe(false);
    expect(ediBlockedReason(view)).toBeNull();
  });

  it("reports online with the backend's own status and version", () => {
    const view = describeEdiConnection({ ok: true, status_text: "ok", version: "1.4.0" });
    expect(view.state).toBe("online");
    expect(view.tone).toBe("ready");
    expect(view.pill).toContain("v1.4.0");
    expect(view.title).toBeNull();
    expect(ediActionsBlocked(view)).toBe(false);
  });

  it("treats a missing bridge (404 / no transport) as onboarding, not a crash", () => {
    const view = describeEdiConnection({
      ok: false,
      transport: "none",
      status: 404,
      direct_configured: false,
      error: "Function not found",
    });
    expect(view.state).toBe("not_connected");
    expect(view.pill).toBe("Backend not connected");
    expect(view.steps.length).toBeGreaterThan(1);
    expect(view.steps.join(" ")).toContain("redart-edi-bridge");
    expect(ediBlockedReason(view)).toMatch(/not connected/i);
  });

  it("keeps a real backend refusal distinct from missing setup", () => {
    const view = describeEdiConnection({
      ok: false,
      transport: "bridge",
      status: 401,
      direct_configured: true,
      error: "Invalid EDI credentials for this environment",
    });
    expect(view.state).toBe("error");
    expect(view.detail).toContain("Invalid EDI credentials");
    expect(ediActionsBlocked(view)).toBe(true);
    expect(ediBlockedReason(view)).toContain("Invalid EDI credentials");
  });

  it("never leaks a multi-line stack into the banner", () => {
    const stack = `Error: connect ECONNREFUSED 10.0.0.1:443\n    at TCPConnectWrap.afterConnect\n${"x".repeat(500)}`;
    const view = describeEdiConnection({
      ok: false,
      transport: "direct",
      direct_configured: true,
      status: 500,
      error: stack,
    });
    expect(view.detail).not.toContain("\n");
    expect((view.detail ?? "").length).toBeLessThanOrEqual(220);
    expect(view.pill).toBe("Backend error");
  });
});

describe("configured-but-failing transports", () => {
  it("does not tell the user to connect a backend that is already configured", () => {
    const view = describeEdiConnection({
      ok: false,
      transport: "bridge_url",
      bridge_url_configured: true,
      status: 502,
      error: "EDI backend is unreachable",
    });
    expect(view.state).toBe("error");
    expect(view.steps.join(" ")).not.toContain("Deploy the secure");
  });

  it("still offers onboarding when nothing is configured at all", () => {
    const view = describeEdiConnection({
      ok: false,
      transport: "none",
      direct_configured: false,
      bridge_url_configured: false,
      error: "EDI bridge is unreachable",
    });
    expect(view.state).toBe("not_connected");
    expect(view.steps.join(" ")).toContain("EDI_BRIDGE_URL");
  });
});
