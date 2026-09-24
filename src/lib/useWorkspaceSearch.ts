import { useLocation, useNavigate } from "@tanstack/react-router";
/** Router-owned search keeps refresh, deep links and Back/Forward in sync. */
export function useWorkspaceSearch(key: string, fallback: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search as Record<string, unknown>;
  const value = typeof search[key] === "string" ? (search[key] as string) : fallback;
  const set = (next: string) =>
    void navigate({ to: location.pathname, search: { ...search, [key]: next } } as never);
  return [value, set] as const;
}
