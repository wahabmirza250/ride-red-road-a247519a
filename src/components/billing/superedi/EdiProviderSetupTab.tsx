/**
 * Provider / company onboarding for Super EDI.
 *
 * Routine onboarding happens here, in the app — never in a backend deploy.
 * A platform owner can administer any onboarded company; a normal tenant user
 * only ever sees their own. Secrets are never rendered, never typed here and
 * never stored client-side: company-specific transport shows a masked status
 * only, and says "Secure credential setup required" when none is installed.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppLink } from "@/lib/appLink";
import { cn } from "@/lib/utils";
import {
  EMPTY_EDI_SETTINGS,
  SECRET_SETUP_REQUIRED,
  SHARED_TRANSPORT_LABEL,
  ediProviderIssues,
  ediTradingPartnerIssues,
  ediTransportIssues,
  evaluateEdiSetup,
  type EdiCompanySettings,
  type EdiEnvironment,
  type EdiTransportMode,
} from "@/lib/ediSetup";
import { getEdiCompanySettings, saveEdiCompanySettings } from "@/lib/ediSetup.functions";
import { EdiBackendSyncCard } from "./EdiBackendSyncCard";
import { Panel, Pill } from "./ediUi";

type Draft = EdiCompanySettings;

export function EdiProviderSetupTab({
  companyId,
  isOwner,
  onSaved,
}: {
  companyId: string | null;
  isOwner: boolean;
  onSaved: () => void;
}) {
  const getFn = useServerFn(getEdiCompanySettings);
  const saveFn = useServerFn(saveEdiCompanySettings);
  const [draft, setDraft] = useState<Draft | null>(null);

  const settings = useQuery({
    queryKey: ["edi", "settings", companyId],
    queryFn: () => getFn({ data: { company_id: companyId } }),
  });

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (value: Draft) =>
      saveFn({
        data: {
          company_id: value.company_id,
          billing_name: value.billing_name,
          npi: value.npi,
          taxonomy_code: value.taxonomy_code,
          tax_id: value.tax_id,
          address_line1: value.address_line1,
          address_line2: value.address_line2,
          city: value.city,
          state: value.state,
          postal_code: value.postal_code,
          phone: value.phone,
          contact_name: value.contact_name,
          contact_email: value.contact_email,
          sender_id: value.sender_id,
          receiver_id: value.receiver_id,
          environment: value.environment,
          transport_mode: value.transport_mode,
          production_enabled: value.production_enabled,
          sftp_host: value.sftp_host,
          sftp_port: value.sftp_port,
          sftp_username: value.sftp_username,
          sftp_directory: value.sftp_directory,
          notes: value.notes,
        },
      }),
    onSuccess: (saved) => {
      setDraft(saved);
      onSaved();
      toast.success("EDI setup saved for this company.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save setup"),
  });

  const value: Draft = draft ??
    (settings.data as Draft) ?? { company_id: companyId ?? "", ...EMPTY_EDI_SETTINGS };
  const status = useMemo(() => evaluateEdiSetup(value), [value]);
  const providerIssues = useMemo(() => ediProviderIssues(value), [value]);
  const partnerIssues = useMemo(() => ediTradingPartnerIssues(value), [value]);
  const transportIssues = useMemo(() => ediTransportIssues(value), [value]);

  function set<K extends keyof Draft>(key: K, v: Draft[K]) {
    setDraft({ ...value, [key]: v });
  }

  if (settings.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading EDI setup…
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {settings.error instanceof Error ? settings.error.message : "Could not load EDI setup"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusFlag ok={status.providerReady} label="Provider profile" />
        <StatusFlag ok={status.tradingPartnerReady} label="Trading partner" />
        <StatusFlag ok={status.transportReady} label="Transport" />
        <Pill tone={value.environment === "production" ? "error" : "info"}>
          {value.environment === "production" ? "PRODUCTION" : "TEST"}
        </Pill>
        <div className="ml-auto flex items-center gap-2">
          {isOwner && (
            <AppLink
              to="/owner"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <Building2 className="h-3.5 w-3.5" /> Add / manage companies
            </AppLink>
          )}
          <Button
            size="sm"
            className="rounded-full"
            disabled={save.isPending}
            onClick={() => save.mutate(value)}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-2 h-3.5 w-3.5" />
            )}
            Save setup
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Billing provider">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Legal / billing name"
              value={value.billing_name}
              onChange={(v) => set("billing_name", v)}
              className="sm:col-span-2"
            />
            <Field label="Billing NPI" value={value.npi} onChange={(v) => set("npi", v)} />
            <Field
              label="Taxonomy code"
              value={value.taxonomy_code}
              onChange={(v) => set("taxonomy_code", v)}
            />
            <Field label="Tax ID (EIN)" value={value.tax_id} onChange={(v) => set("tax_id", v)} />
            <Field label="Phone" value={value.phone} onChange={(v) => set("phone", v)} />
            <Field
              label="Address line 1"
              value={value.address_line1}
              onChange={(v) => set("address_line1", v)}
              className="sm:col-span-2"
            />
            <Field
              label="Address line 2"
              value={value.address_line2}
              onChange={(v) => set("address_line2", v)}
              className="sm:col-span-2"
            />
            <Field label="City" value={value.city} onChange={(v) => set("city", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" value={value.state} onChange={(v) => set("state", v)} />
              <Field label="ZIP" value={value.postal_code} onChange={(v) => set("postal_code", v)} />
            </div>
            <Field
              label="Contact name"
              value={value.contact_name}
              onChange={(v) => set("contact_name", v)}
            />
            <Field
              label="Contact email"
              value={value.contact_email}
              onChange={(v) => set("contact_email", v)}
            />
          </div>
          <IssueList issues={providerIssues} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Trading partner">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sender ID (ISA06/GS02)" value={value.sender_id} onChange={(v) => set("sender_id", v)} />
              <Field
                label="Receiver ID (ISA08/GS03)"
                value={value.receiver_id}
                onChange={(v) => set("receiver_id", v)}
              />
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Environment</Label>
                <Select
                  value={value.environment}
                  onValueChange={(v) => set("environment", v as EdiEnvironment)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">TEST — safe, no live claims</SelectItem>
                    <SelectItem value="production">PRODUCTION — live claims</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Production enabled</div>
                  <p className="text-xs text-muted-foreground">
                    Both this switch and the PRODUCTION environment are required before a live
                    upload is even offered.
                  </p>
                </div>
                <Switch
                  checked={value.production_enabled}
                  onCheckedChange={(v) => set("production_enabled", v)}
                />
              </div>
            </div>
            <IssueList issues={partnerIssues} />
          </Panel>

          <Panel title="Transport">
            <div className="grid gap-2 sm:grid-cols-2">
              <TransportChoice
                active={value.transport_mode === "shared"}
                title="RedArt shared connection"
                description="Files are exchanged through RedArt's own trading-partner connection. No company credentials needed."
                onClick={() => set("transport_mode", "shared" as EdiTransportMode)}
              />
              <TransportChoice
                active={value.transport_mode === "company"}
                title="Company-specific connection"
                description="This company files through its own connection. Host and user are configuration; the secret is installed server-side."
                onClick={() => set("transport_mode", "company" as EdiTransportMode)}
              />
            </div>

            {value.transport_mode === "shared" ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
                Connection credentials: <strong className="text-foreground">{SHARED_TRANSPORT_LABEL}</strong>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Host" value={value.sftp_host} onChange={(v) => set("sftp_host", v)} />
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Port</Label>
                    <Input
                      className="h-9"
                      inputMode="numeric"
                      value={value.sftp_port === null ? "" : String(value.sftp_port)}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(/\D/g, ""));
                        set("sftp_port", Number.isFinite(n) && n > 0 ? n : null);
                      }}
                    />
                  </div>
                  <Field
                    label="User"
                    value={value.sftp_username}
                    onChange={(v) => set("sftp_username", v)}
                  />
                  <Field
                    label="Directory"
                    value={value.sftp_directory}
                    onChange={(v) => set("sftp_directory", v)}
                  />
                </div>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-3 text-sm",
                    value.sftp_secret_configured
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/40 bg-warning/10 text-warning",
                  )}
                >
                  {value.sftp_secret_configured ? (
                    <Lock className="h-4 w-4 shrink-0" />
                  ) : (
                    <KeyRound className="h-4 w-4 shrink-0" />
                  )}
                  {value.sftp_secret_configured
                    ? "Secure credential installed (••••••••) — never shown in the app."
                    : SECRET_SETUP_REQUIRED}
                </div>
              </div>
            )}
            <IssueList issues={transportIssues} />
          </Panel>

          <Panel title="Notes">
            <Textarea
              rows={3}
              value={value.notes ?? ""}
              placeholder="Payer contacts, enrollment reference, anything the billing team should know."
              onChange={(e) => set("notes", e.target.value || null)}
            />
          </Panel>
        </div>
      </div>

      <EdiBackendSyncCard companyId={companyId} onSynced={onSaved} />
    </div>
  );
}

function StatusFlag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Pill tone={ok ? "ready" : "warn"}>
      {ok ? (
        <CheckCircle2 className="mr-1 h-3 w-3" />
      ) : (
        <AlertTriangle className="mr-1 h-3 w-3" />
      )}
      {label}
    </Pill>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="h-9"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
    </div>
  );
}

function TransportChoice({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border hover:border-primary/40",
      )}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

function IssueList({ issues }: { issues: { field: string; message: string }[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-xs text-warning">
      {issues.map((issue) => (
        <li key={issue.field} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
