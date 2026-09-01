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
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileUp,
  Loader2,
  Radio,
  Send,
  Settings2,
  Upload,
} from "lucide-react";
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
import { describeEdiConnection } from "@/lib/ediConnection";
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
import { Pill } from "./ediUi";

const TABS = [
  { key: "upload", label: "Upload / Import", icon: Upload },
  { key: "review", label: "Batch Review", icon: ClipboardList },
  { key: "setup", label: "Provider Setup", icon: Settings2 },
  { key: "submit", label: "EDI Submission", icon: Send },
  { key: "status", label: "Claim Status / Remittance", icon: Activity },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const PAGE_SIZE = 100;

export function SuperEdiWorkspace() {
  const companiesFn = useServerFn(listEdiCompanies);
  const settingsFn = useServerFn(getEdiCompanySettings);
  const listFn = useServerFn(listEdiWorkbench);

  const [tab, setTab] = useState<TabKey>("upload");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
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
  const activeCompany = companies.data?.companies.find((c) => c.id === activeCompanyId) ?? null;

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


  const workbench = useQuery({
    queryKey: ["edi", "workbench", activeCompanyId, search, limit],
    queryFn: () =>
      listFn({
        data: {
          company_id: activeCompanyId,
          ...(search ? { search } : {}),
          limit,
          offset: 0,
        },
      }),
    enabled: companies.isSuccess,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => {
    const base = workbench.data?.rows ?? [];
    if (!patched.size) return base;
    const seen = new Set(base.map((r) => r.record_id));
    const merged = base.map((r) => patched.get(r.record_id) ?? r);
    // A row selected on the Upload tab may not be in the current page yet.
    for (const [id, row] of patched) if (!seen.has(id)) merged.unshift(row);
    return merged;
  }, [workbench.data, patched]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.record_id)),
    [rows, selected],
  );

  const setupStatus = useMemo(() => evaluateEdiSetup(settings.data ?? null), [settings.data]);
  const environment = settings.data?.environment ?? "test";
  const productionReady = useMemo(() => canSubmitProduction(settings.data ?? null), [settings.data]);

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
    setLimit(PAGE_SIZE);
  }

  // The probe never throws: an unreachable backend is a successful query whose
  // payload says `ok: false`, so onboarding copy comes from one pure mapper.
  const connection = useMemo(
    () => describeEdiConnection(health.data ?? null, health.isLoading),
    [health.data, health.isLoading],
  );


  return (
    <div className="space-y-5">
      <header className="rounded-3xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <AppLink
              to="/medicaid-billing"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to billing methods
            </AppLink>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
              Super EDI
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Electronic 837P billing — import in bulk, validate against the payer rules, submit one
              file.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (companies.data?.companies.length ?? 0) > 1 ? (
              <Select value={activeCompanyId ?? ""} onValueChange={switchCompany}>
                <SelectTrigger className="h-9 w-[240px]">
                  <Building2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.data?.companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.status !== "active" ? ` · ${c.status}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {activeCompany?.name ?? "Your company"}
              </span>
            )}

            <Pill tone={environment === "production" ? "error" : "info"}>
              <Radio className="mr-1 h-3 w-3" />
              {environmentLabel(environment)}
            </Pill>
            <Pill tone={connection.tone}>
              {connection.state === "checking" ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : connection.state === "online" ? (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              ) : (
                <AlertTriangle className="mr-1 h-3 w-3" />
              )}
              {connection.pill}
            </Pill>

            <Pill tone={setupStatus.ready ? "ready" : setupStatus.claimReady ? "warn" : "error"}>
              <FileUp className="mr-1 h-3 w-3" />
              {setupStatus.ready
                ? "Setup complete"
                : setupStatus.claimReady
                  ? "Transport not ready"
                  : "Provider setup required"}
            </Pill>
          </div>
        </div>

        {connection.title && (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <PlugZap className="h-4 w-4 shrink-0" />
                  {connection.title}
                </p>
                {connection.detail && (
                  <p className="mt-1 text-xs text-muted-foreground">{connection.detail}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void health.refetch()}
                disabled={health.isFetching}
              >
                {health.isFetching ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Test connection
              </Button>
            </div>
            {connection.steps.length > 0 && (
              <ol className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                {connection.steps.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-[10px] font-semibold text-destructive tabular-nums">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {!setupStatus.ready && (
          <button
            type="button"
            onClick={() => setTab("setup")}
            className="mt-4 flex w-full items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-left text-xs text-warning transition hover:bg-warning/15"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {setupStatus.issues
                .slice(0, 3)
                .map((i) => i.message)
                .join(" · ")}
              {setupStatus.issues.length > 3 ? ` · +${setupStatus.issues.length - 3} more` : ""} —
              open Provider Setup
            </span>
          </button>
        )}


        <nav className="mt-4 flex flex-wrap gap-1.5 rounded-2xl bg-surface-muted p-1.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            const badge =
              t.key === "review" || t.key === "submit" ? selected.size : t.key === "upload" ? 0 : 0;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                  active
                    ? "bg-surface text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {badge > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

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
              onOpenReview={() => setTab("review")}
            />
          )}

          {tab === "review" && (
            <EdiBatchReviewTab
              companyId={activeCompanyId}
              rows={rows}
              loading={workbench.isLoading}
              fetching={workbench.isFetching}
              total={workbench.data?.total ?? rows.length}
              hasMore={workbench.data?.has_more ?? false}
              search={search}
              onSearch={(v) => {
                setSearch(v);
                setLimit(PAGE_SIZE);
              }}
              onLoadMore={() => setLimit((n) => n + PAGE_SIZE)}
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
              claimReady={setupStatus.claimReady}
              setupHint={
                setupStatus.claimReady
                  ? null
                  : (setupStatus.issues[0]?.message ?? "Provider setup required")
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
