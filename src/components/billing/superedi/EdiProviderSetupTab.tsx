/**
 * Provider / trading-partner setup for the CURRENT company.
 *
 * In-app tenant configuration — every onboarding company edits its own
 * billing profile here. Secrets (SFTP password / key) are never rendered or
 * stored client-side; the secret field shows a "Backend connection required"
 * state until a secure server-side write endpoint exists.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getEdiCompanySettings, saveEdiCompanySettings } from "@/lib/ediSetup.functions";
import { evaluateEdiSetup, type EdiCompanySettings } from "@/lib/ediSetup";

type Draft = Partial<EdiCompanySettings>;

const TEXT_FIELDS: { key: keyof EdiCompanySettings; label: string; placeholder?: string }[] = [
  { key: "billing_name", label: "Billing / legal name" },
  { key: "npi", label: "Billing NPI", placeholder: "10 digits" },
  { key: "taxonomy_code", label: "Taxonomy code", placeholder: "343900000X" },
  { key: "tax_id", label: "Tax ID (EIN)" },
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State", placeholder: "CO" },
  { key: "postal_code", label: "ZIP code" },
  { key: "phone", label: "Contact phone" },
  { key: "contact_email", label: "Contact email" },
];

export function EdiProviderSetupTab() {
  const getFn = useServerFn(getEdiCompanySettings);
  const saveFn = useServerFn(saveEdiCompanySettings);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});

  const settings = useQuery({ queryKey: ["edi_settings"], queryFn: () => getFn() });

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const status = useMemo(() => evaluateEdiSetup(draft), [draft]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const f of TEXT_FIELDS) payload[f.key] = (draft[f.key] as string) ?? null;
      payload["sender_id"] = draft.sender_id ?? null;
      payload["receiver_id"] = draft.receiver_id ?? null;
      payload["environment"] = draft.environment ?? "test";
      payload["sftp_host"] = draft.sftp_host ?? null;
      payload["sftp_port"] = draft.sftp_port ?? null;
      payload["sftp_username"] = draft.sftp_username ?? null;
      payload["sftp_directory"] = draft.sftp_directory ?? null;
      return saveFn({ data: payload as never });
    },
    onSuccess: () => {
      toast.success("EDI setup saved");
      void qc.invalidateQueries({ queryKey: ["edi_settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save setup"),
  });

  const set = (key: keyof EdiCompanySettings, value: string | number | null) =>
    setDraft((d) => ({ ...d, [key]: value }));

  if (settings.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SetupSection
        title="Provider billing profile"
        subtitle="Identifies your company on every 837P claim."
        ready={status.providerReady}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TEXT_FIELDS.map((f) => (
            <div key={String(f.key)} className="space-y-1.5">
              <Label htmlFor={String(f.key)}>{f.label}</Label>
              <Input
                id={String(f.key)}
                value={(draft[f.key] as string) ?? ""}
                placeholder={f.placeholder ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </SetupSection>

      <SetupSection
        title="Trading partner"
        subtitle="Interchange identifiers and the environment files are sent to."
        ready={status.tradingPartnerReady}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sender_id">Sender ID (ISA06)</Label>
            <Input
              id="sender_id"
              value={draft.sender_id ?? ""}
              onChange={(e) => set("sender_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="receiver_id">Receiver ID (ISA08)</Label>
            <Input
              id="receiver_id"
              value={draft.receiver_id ?? ""}
              onChange={(e) => set("receiver_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="environment">Environment</Label>
            <Select
              value={draft.environment ?? "test"}
              onValueChange={(v) => set("environment", v)}
            >
              <SelectTrigger id="environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">TEST</SelectItem>
                <SelectItem value="production">PRODUCTION</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SetupSection>

      <SetupSection
        title="File transport (SFTP / MFT)"
        subtitle="Where generated 837P files are delivered."
        ready={status.transportReady}
        optional
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="sftp_host">Host</Label>
            <Input
              id="sftp_host"
              value={draft.sftp_host ?? ""}
              onChange={(e) => set("sftp_host", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sftp_port">Port</Label>
            <Input
              id="sftp_port"
              inputMode="numeric"
              value={draft.sftp_port ?? ""}
              onChange={(e) =>
                set("sftp_port", e.target.value ? Number(e.target.value) : null)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sftp_username">Username</Label>
            <Input
              id="sftp_username"
              value={draft.sftp_username ?? ""}
              onChange={(e) => set("sftp_username", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sftp_directory">Directory</Label>
            <Input
              id="sftp_directory"
              value={draft.sftp_directory ?? ""}
              onChange={(e) => set("sftp_directory", e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">Password / private key</div>
            <p className="text-xs text-muted-foreground">
              {settings.data?.sftp_secret_configured
                ? "A credential is installed on the backend. It is never shown here."
                : "Backend connection required — secrets can only be installed through the secure backend, never from this screen."}
            </p>
          </div>
          <Badge variant={settings.data?.sftp_secret_configured ? "default" : "outline"}>
            {settings.data?.sftp_secret_configured ? "Configured" : "Not configured"}
          </Badge>
        </div>
      </SetupSection>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-full">
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save setup
        </Button>
        {status.issues.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            {status.issues.length} field{status.issues.length === 1 ? "" : "s"} still needed:{" "}
            {status.issues
              .slice(0, 3)
              .map((i) => i.message)
              .join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

function SetupSection({
  title,
  subtitle,
  ready,
  optional,
  children,
}: {
  title: string;
  subtitle: string;
  ready: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Badge variant={ready ? "default" : "outline"} className="gap-1">
          {ready ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {ready ? "Complete" : optional ? "Optional" : "Incomplete"}
        </Badge>
      </header>
      {children}
    </section>
  );
}
