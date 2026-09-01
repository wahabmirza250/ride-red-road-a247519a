/**
 * "Linked to the EDI backend" card — the onboarding half that talks to the
 * backend itself.
 *
 * Saving provider setup stores the data in RedArt; THIS card pushes it to the
 * EDI backend and remembers the ids it returned (provider profile, trading
 * partner). Running it twice is safe: unchanged data is not re-sent and an
 * existing entity is updated, never duplicated.
 *
 * It also runs a read-only contract check — which documented endpoints the
 * backend advertises today — so a backend change is visible here instead of
 * failing later in the middle of a batch.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ediContractCheck, ediSyncCompany, getEdiMapping } from "@/lib/ediActions.functions";
import { DetailRow, Panel, Pill, dateTimeText } from "./ediUi";

export function EdiBackendSyncCard({
  companyId,
  onSynced,
}: {
  companyId: string | null;
  onSynced?: () => void;
}) {
  const mappingFn = useServerFn(getEdiMapping);
  const syncFn = useServerFn(ediSyncCompany);
  const contractFn = useServerFn(ediContractCheck);

  const mapping = useQuery({
    queryKey: ["edi", "mapping", companyId],
    queryFn: () => mappingFn({ data: { company_id: companyId } }),
  });

  const contract = useQuery({
    queryKey: ["edi", "contract", companyId],
    queryFn: () => contractFn({ data: { company_id: companyId } }),
    retry: false,
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { company_id: companyId } }),
    onSuccess: (report) => {
      if (report.ok) toast.success(report.message);
      else toast.error(report.message);
      void mapping.refetch();
      onSynced?.();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not sync this company to the EDI backend"),
  });

  const link = mapping.data?.mapping ?? null;
  const linked = Boolean(link?.edi_provider_profile_id && link?.edi_trading_partner_id);
  const batches = mapping.data?.batches ?? [];

  return (
    <div className="space-y-5">
      <Panel
        title="EDI backend link"
        action={
          <div className="flex items-center gap-2">
            <Pill tone={linked ? "ready" : "warn"}>
              {linked ? (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              ) : (
                <AlertTriangle className="mr-1 h-3 w-3" />
              )}
              {linked ? "Linked" : "Not linked yet"}
            </Pill>
            <Button
              size="sm"
              className="rounded-full"
              disabled={sync.isPending || !companyId}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ServerCog className="mr-2 h-3.5 w-3.5" />
              )}
              Sync to EDI backend
            </Button>
          </div>
        }
      >
        {mapping.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading backend link…
          </div>
        ) : (
          <>
            <dl className="space-y-2">
              <DetailRow
                label="Provider profile"
                value={link?.edi_provider_profile_id ? `#${link.edi_provider_profile_id}` : "—"}
              />
              <DetailRow
                label="Trading partner"
                value={
                  link?.edi_trading_partner_id ? (
                    <span className="inline-flex items-center gap-1.5">
                      #{link.edi_trading_partner_id}
                      <Pill tone={link.trading_partner_mode === "shared" ? "info" : "muted"}>
                        {link.trading_partner_mode === "shared" ? "RedArt shared" : "Company"}
                      </Pill>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <DetailRow
                label="Transport credential"
                value={
                  link?.edi_sftp_credentials_id
                    ? `#${link.edi_sftp_credentials_id} (installed server-side)`
                    : "Managed by RedArt"
                }
              />
              <DetailRow label="Environment" value={(link?.environment ?? "test").toUpperCase()} />
              <DetailRow label="Last synced" value={dateTimeText(link?.last_synced_at)} />
            </dl>

            {link?.last_sync_error && (
              <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                {link.last_sync_error}
              </p>
            )}

            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              Only non-secret setup is sent: name, NPI, tax id, address, contact and the
              sender/receiver identifiers. Connection secrets never leave the server.
            </p>

            {mapping.data?.shared_partner_configured && (
              <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A RedArt-wide approved trading partner is configured — companies in shared mode
                are linked to it instead of getting one of their own.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        title="Backend contract check"
        action={
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={contract.isFetching}
            onClick={() => void contract.refetch()}
          >
            {contract.isFetching ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Re-check
          </Button>
        }
      >
        {contract.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the backend catalog…
          </div>
        ) : contract.isError ? (
          <p className="text-sm text-destructive">
            {contract.error instanceof Error
              ? contract.error.message
              : "Could not read the backend catalog"}
          </p>
        ) : (
          <>
            <p
              className={`text-sm ${contract.data?.ok ? "text-success" : "text-warning"}`}
            >
              {contract.data?.message}
            </p>

            {(contract.data?.rows.length ?? 0) > 0 && (
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {contract.data!.rows.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate text-foreground">{row.key}</span>
                    {row.advertised || row.family ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-4 space-y-2">
              {Object.entries(contract.data?.entity_paths ?? {}).map(([kind, path]) => (
                <DetailRow
                  key={kind}
                  label={kind.replace(/_/g, " ")}
                  value={path ?? "Not advertised by the backend"}
                />
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Entity paths are read from the backend's own catalog — RedArt never guesses a URL.
              When an entity is not advertised, claims fall back to the documented
              <code className="mx-1 rounded bg-surface-muted px-1">/claims/</code> endpoint and
              the backend's own message is shown if it refuses.
            </p>
          </>
        )}
      </Panel>

      {batches.length > 0 && (
        <Panel title="Recent submission batches">
          <ul className="divide-y divide-border text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{b.batch_number}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {b.claim_count} claim{b.claim_count === 1 ? "" : "s"} ·{" "}
                    {b.environment.toUpperCase()} · {dateTimeText(b.created_at)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {b.edi_batch_id ? <Pill tone="info">batch #{b.edi_batch_id}</Pill> : null}
                  {b.edi_file_id ? <Pill tone="info">file #{b.edi_file_id}</Pill> : null}
                  <Pill
                    tone={
                      b.status === "uploaded"
                        ? "ready"
                        : b.status.endsWith("_failed")
                          ? "error"
                          : "muted"
                    }
                  >
                    {b.status.replace(/_/g, " ")}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
