/**
 * Super EDI — the high-volume electronic billing workspace.
 *
 * This is deliberately NOT a single-claim flow: a biller imports or picks
 * dozens of bills, validates them in one pass against the EDI backend, builds
 * one submission batch and generates ONE 837P file for all ready claims.
 *
 * Everything authoritative (readiness, long-distance/document rules, claim and
 * acknowledgement status) comes from the EDI backend through the secure
 * bridge. Nothing here submits by itself, and the legacy HCPF/robot flow is
 * untouched.
 */
import { useAuth } from "@/lib/auth";
import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ClipboardList, Loader2, Send, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppLink } from "@/lib/appLink";
import { cn } from "@/lib/utils";
import { probeEdiConnection } from "@/lib/edi.functions";
import { describeEdiConnection, ediActionsBlocked, ediBlockedReason } from "@/lib/ediConnection";
import { canSubmitProduction, environmentLabel, evaluateEdiSetup } from "@/lib/ediSetup";
import { getEdiCompanySettings, listEdiCompanies } from "@/lib/ediSetup.functions";
import { listEdiWorkbench } from "@/lib/ediRecords.functions";
import type { EdiWorkRow } from "@/lib/ediTypes";

import { EdiBatchReviewTab } from "./EdiBatchReviewTab";
import { EdiProviderSetupTab } from "./EdiProviderSetupTab";
import { EdiRowDetailSheet } from "./EdiRowDetailSheet";
import { EdiStatusTab } from "./EdiStatusTab";
import { EdiSubmissionTab } from "./EdiSubmissionTab";
import { EdiUploadTab } from "./EdiUploadTab";

const TABS = [
  { key: "review", label: "1. Trips to bill", icon: ClipboardList },
  { key: "submit", label: "2. Make a batch", icon: Send },
  { key: "status", label: "3. Track payments", icon: Activity },
] as const;

type TabKey = (typeof TABS)[number]["key"] | "setup" | "upload";

const PAGE_SIZE = 100;

export function SuperEdiWorkspace({ billingApp = false }: { billingApp?: boolean }) {
  const isDemo = useAuth().user?.app_metadata?.is_demo === true;
  const companiesFn = useServerFn(listEdiCompanies);
  const settingsFn = useServerFn(getEdiCompanySettings);
  const listFn = useServerFn(listEdiWorkbench);

  const [tab, setTab] = useState<TabKey>("review");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const [openRow, setOpenRow] = useState<string | null>(null);
  /** Rows patched by a validate/batch/upload call, merged over the fetched page. */
  const [patched, setPatched] = useState<Map<string, EdiWorkRow>>(new Map());

  const companies = useQuery({
    queryKey: ["edi", "companies"],
    queryFn: () => companiesFn(),
    staleTime: 60_000,
  });

  const activeCompanyId = companyId ?? companies.data?.ownCompanyId ?? null;
  const isOwner = companies.data?.isPlatformOwner ?? false;

  const settings = useQuery({
    queryKey: ["edi", "settings", activeCompanyId],
    queryFn: () => settingsFn({ data: { company_id: activeCompanyId } }),
    enabled: companies.isSuccess,
  });

  const connectionFn = useServerFn(probeEdiConnection);
  const health = useQuery({
    queryKey: ["edi", "connection"],
    queryFn: () => connectionFn(),
    refetchInterval: 120_000,
    retry: false,
  });

  const workbench = useInfiniteQuery({
    queryKey: ["edi", "workbench", "inbox", activeCompanyId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listFn({ data: { company_id: activeCompanyId, limit: PAGE_SIZE, offset: pageParam } }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.has_more ? pages.length * PAGE_SIZE : undefined,
    enabled: companies.isSuccess,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const rows = useMemo(() => {
    const base = workbench.data?.pages.flatMap((page) => page.rows) ?? [];
    if (!patched.size) return base;
    const seen = new Set(base.map((r) => r.record_id));
    const merged = base.map((r) => patched.get(r.record_id) ?? r);
    // A row selected on the Upload tab may not be in the current page yet.
    for (const [id, row] of patched) if (!seen.has(id)) merged.unshift(row);
    return merged;
  }, [workbench.data, patched]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? rows.filter((r) =>
          [r.member_name, r.medicaid_id, r.service_date, r.pickup_address, r.dropoff_address].some(
            (v) => v?.toLowerCase().includes(term),
          ),
        )
      : rows;
  }, [rows, search]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.record_id)),
    [rows, selected],
  );

  const setupStatus = useMemo(() => evaluateEdiSetup(settings.data ?? null), [settings.data]);
  const environment = settings.data?.environment ?? "test";
  const productionReady = useMemo(
    () => canSubmitProduction(settings.data ?? null),
    [settings.data],
  );

  const onRowsUpdated = useCallback((updated: EdiWorkRow[]) => {
    if (!updated.length) return;
    setPatched((prev) => {
      const next = new Map(prev);
      for (const row of updated) next.set(row.record_id, row);
      return next;
    });
  }, []);

  const toggle = useCallback((recordId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const selectMany = useCallback((recordIds: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = recordIds.length > 0 && recordIds.every((id) => next.has(id));
      for (const id of recordIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  function switchCompany(id: string) {
    setCompanyId(id);
    setSelected(new Set());
    setPatched(new Map());
    setSearch("");
    setOpenRow(null);
  }

  // The probe never throws: an unreachable backend is a successful query whose
  // payload says `ok: false`, so onboarding copy comes from one pure mapper.
  const connection = useMemo(
    () =>
      describeEdiConnection(
        health.isError
          ? {
              ok: false,
              transport: "direct",
              direct_configured: true,
              error: "Could not check the EDI connection. Please retry.",
            }
          : (health.data ?? null),
        health.isLoading,
      ),
    [health.data, health.isLoading, health.isError],
  );
  const backendBlocked = !isDemo && ediActionsBlocked(connection);
  const blockedReason = isDemo ? null : ediBlockedReason(connection);

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">EDI billing</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review completed trips, group them into a batch, and send the bill.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwner && (companies.data?.companies.length ?? 0) > 1 && (
              <Select value={activeCompanyId ?? ""} onValueChange={switchCompany}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.data?.companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="sm" onClick={() => setTab("upload")}>
              Import paper trips
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTab("setup")}>
              <Settings2 className="mr-1.5 h-4 w-4" />
              Billing settings
            </Button>
          </div>
        </div>
        <nav aria-label="Billing steps" className="mt-4 grid gap-2 sm:grid-cols-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-current={tab === t.key ? "step" : undefined}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-xl px-4 py-3 text-left text-sm font-medium transition",
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {tab === "setup" && (
        <details className="rounded-xl border border-border bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-medium">Connection details</summary>
          <p className="mt-3">
            {connection.pill} · {environmentLabel(environment)}
          </p>
          {!isDemo && connection.detail && <p className="mt-2 text-muted-foreground">{connection.detail}</p>}
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
          >
            Check connection
          </Button>
          <AppLink
            to={billingApp ? "/billing/portal" : "/medicaid-billing/hcpf"}
            className="ml-3 underline"
          >
            Open portal billing
          </AppLink>
        </details>
      )}
      {tab === "review" && workbench.isError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
        >
          Trips could not be loaded.{" "}
          <button className="underline" onClick={() => void workbench.refetch()}>
            Try again
          </button>
        </div>
      )}

      {companies.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…
        </div>
      ) : companies.isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {companies.error instanceof Error
            ? companies.error.message
            : "Could not load your EDI workspace"}
        </div>
      ) : (
        <>
          {tab === "upload" && (
            <EdiUploadTab
              companyId={activeCompanyId}
              selected={selected}
              onToggle={toggle}
              onSelectMany={selectMany}
              onOpenReview={() => {
                void workbench.refetch();
                setTab("review");
              }}
            />
          )}

          {tab === "review" && !workbench.isError && (
            <EdiBatchReviewTab
              companyId={activeCompanyId}
              rows={visibleRows}
              loading={workbench.isLoading}
              fetching={workbench.isFetching}
              total={workbench.data?.pages[0]?.total ?? rows.length}
              hasMore={workbench.hasNextPage}
              search={search}
              onSearch={(v) => {
                setSearch(v);
              }}
              onLoadMore={() => void workbench.fetchNextPage()}
              onRefresh={() => {
                setPatched(new Map());
                void workbench.refetch();
              }}
              selected={selected}
              onToggle={toggle}
              onSelectMany={selectMany}
              onRowsUpdated={onRowsUpdated}
              onOpenRow={setOpenRow}
              onOpenSubmission={() => setTab("submit")}
              claimReady={isDemo || (setupStatus.claimReady && !backendBlocked)}
              setupHint={
                (backendBlocked
                  ? "Billing is temporarily unavailable. You can still review trips; try again shortly."
                  : null) ??
                (setupStatus.claimReady
                  ? null
                  : "Your company’s billing settings need to be completed before checking trips.")
              }
            />
          )}

          {tab === "setup" && (
            <EdiProviderSetupTab
              companyId={activeCompanyId}
              isOwner={isOwner}
              onSaved={() => void settings.refetch()}
            />
          )}

          {tab === "submit" && (
            <EdiSubmissionTab
              companyId={activeCompanyId}
              selectedRows={selectedRows}
              environment={environment}
              productionReady={productionReady}
              blockedReason={blockedReason}
              onRowsUpdated={onRowsUpdated}
              onOpenReview={() => setTab("review")}
            />
          )}

          {tab === "status" && <EdiStatusTab companyId={activeCompanyId} />}
        </>
      )}

      <EdiRowDetailSheet
        companyId={activeCompanyId}
        recordId={openRow}
        onClose={() => setOpenRow(null)}
        onRowsUpdated={onRowsUpdated}
      />
    </div>
  );
}
