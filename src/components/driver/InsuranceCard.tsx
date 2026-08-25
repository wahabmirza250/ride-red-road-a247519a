import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import {
  INSURANCE_STATE_LABEL,
  daysUntil,
  insuranceState,
  type InsuranceState,
} from "@/lib/compliance";
import { listInsuranceDocs, upsertInsuranceDoc } from "@/lib/compliance.functions";

function StateBadge({ state }: { state: InsuranceState }) {
  const variant =
    state === "valid" ? "default" : state === "expiring_soon" ? "secondary" : "destructive";
  return <Badge variant={state === "unknown" ? "outline" : variant}>{INSURANCE_STATE_LABEL[state]}</Badge>;
}

/** Documents & Compliance: vehicle insurance for the signed-in driver. */
export function InsuranceCard({ driverId }: { driverId?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listInsuranceDocs);
  const saveFn = useServerFn(upsertInsuranceDoc);

  const [insurer, setInsurer] = useState("");
  const [policy, setPolicy] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [effective, setEffective] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const docs = useQuery({
    queryKey: ["insurance_docs", driverId ?? "me"],
    queryFn: () => listFn({ data: driverId ? { driver_id: driverId } : {} }) as Promise<any[]>,
  });

  const save = useMutation({
    mutationFn: async () => {
      let path: string | null = null;
      if (file && user) {
        const key = `${user.id}/insurance-${Date.now()}-${file.name.replace(/[^\w.]+/g, "_")}`;
        const up = await supabase.storage.from("driver-docs").upload(key, file, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });
        if (up.error) throw up.error;
        path = key;
      }
      return saveFn({
        data: {
          driver_id: driverId,
          insurer,
          policy_number: policy,
          vehicle_label: vehicle || null,
          effective_date: effective || null,
          expiration_date: expires,
          document_path: path,
        },
      }) as Promise<{ id: string }>;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      toast.success("Insurance saved — pending verification");
      setInsurer("");
      setPolicy("");
      setVehicle("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["insurance_docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save insurance"),
  });

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Documents & Compliance</h2>
      </div>

      <div className="space-y-2">
        {(docs.data ?? []).map((d) => {
          const state = insuranceState(d.expiration_date);
          const days = daysUntil(d.expiration_date);
          return (
            <div key={d.id} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {d.insurer} · <span className="font-mono text-xs">{d.policy_number}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StateBadge state={state} />
                  <Badge variant="outline">{d.status}</Badge>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {d.vehicle_label ? `${d.vehicle_label} · ` : ""}
                Expires {d.expiration_date ? formatDate(d.expiration_date) : "—"}
                {days !== null && days >= 0 ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}
              </div>
            </div>
          );
        })}
        {!docs.isLoading && !(docs.data ?? []).length && (
          <p className="text-xs text-muted-foreground">No insurance on file yet.</p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Insurance company</Label>
          <Input value={insurer} onChange={(e) => setInsurer(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Policy number</Label>
          <Input value={policy} onChange={(e) => setPolicy(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Vehicle</Label>
          <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="2019 Toyota Sienna" />
        </div>
        <div className="grid gap-1.5">
          <Label>Effective date</Label>
          <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Expiration date</Label>
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Document (photo or PDF)</Label>
          <Input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <Button
        className="w-full"
        disabled={busy || !insurer || !policy || !expires}
        onClick={() => save.mutate()}
      >
        <Upload className="mr-2 h-4 w-4" />
        {busy ? "Saving…" : "Save insurance"}
      </Button>
    </div>
  );
}
