import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ signInWithPassword: vi.fn(), getUser: vi.fn(), signOut: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabaseBrowser", () => ({ supabase: { auth: mock, from: mock.from } }));
import { signInAsRole } from "../roleGuardedSignIn";
function setup(roles: string[], slug = "walla", active = true) {
  mock.signInWithPassword.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  mock.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  mock.signOut.mockResolvedValue({ error: null });
  mock.from.mockImplementation((table: string) => {
    const result = { data: table === "user_roles" ? roles.map(role => ({role})) : table === "profiles" ? {company_id: "company"} : { url_slug: slug, name: "Company", status: active ? "active" : "suspended" }, error: null };
    const query: any = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve(result), then: (fn: any) => Promise.resolve(result).then(fn) };
    return query;
  });
}
beforeEach(() => vi.clearAllMocks());
describe("shared login keeps roles and company boundaries", () => {
  it.each(["admin", "driver", "passenger", "dispatch", "billing", "admin_biller"] as const)("opens the assigned %s app", async role => {
    setup(["admin", "driver", "passenger", "dispatch", "billing", "admin_biller"]);
    expect(await signInAsRole(" ADMIN@NEMT.COM ", "654321", role, "walla")).toEqual({ companySlug: "walla", isOwner: false });
    expect(mock.signInWithPassword).toHaveBeenCalledWith({email: "admin@nemt.com", password: "654321"});
  });
  it("denies an app without its assigned role", async () => { setup(["passenger"]); await expect(signInAsRole("x@y.com","password","admin","walla")).rejects.toThrow("not registered"); expect(mock.signOut).toHaveBeenCalled(); });
  it("denies another company's code", async () => { setup(["admin"],"other-company"); await expect(signInAsRole("x@y.com","password","admin","walla")).rejects.toThrow("different company"); expect(mock.signOut).toHaveBeenCalled(); });
  it("blocks a suspended company", async () => { setup(["driver"],"walla",false); await expect(signInAsRole("x@y.com","password","driver","walla")).rejects.toThrow("suspended"); expect(mock.signOut).toHaveBeenCalled(); });
});
