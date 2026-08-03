import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, Fuel } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitGasReceipt, listMyGasReceipts } from "@/lib/gasReceipts.functions";

export const Route = createFileRoute("/driver/expenses")({
  component: ExpensesPage,
});

type Row = {
  id: string;
  amount: number;
  gallons: number | null;
  photo_path: string;
  notes: string | null;
  submitted_at: string;
};

function ExpensesPage() {
  const { user } = useAuth();
  const submit = useServerFn(submitGasReceipt);
  const list = useServerFn(listMyGasReceipts);
  const [rows, setRows] = useState<Row[]>([]);
  const [amount, setAmount] = useState("");
  const [gallons, setGallons] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await list();
    setRows((r as Row[]) ?? []);
  }, [list]);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmit() {
    if (!user) return;
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount");
    if (!file) return toast.error("Attach the receipt photo");
    setSaving(true);
    try {
      const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.]+/g, "_")}`;
      const up = await supabase.storage.from("gas-receipts").upload(path, file, {
        contentType: file.type || "image/jpeg", upsert: false,
      });
      if (up.error) throw up.error;
      await submit({ data: {
        amount: Number(amount),
        gallons: gallons ? Number(gallons) : null,
        notes: notes || null,
        photo_path: path,
      } });
      setAmount(""); setGallons(""); setNotes(""); setFile(null);
      toast.success("Receipt submitted");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-3 flex items-center gap-2">
          <Fuel className="h-5 w-5 text-primary" />
          <div className="text-lg font-semibold">Submit gas receipt</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Amount ($)</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label>Gallons (optional)</Label>
            <Input inputMode="decimal" value={gallons} onChange={(e) => setGallons(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Station, purpose…" />
        </div>
        <div className="mt-3">
          <input
            id="receipt-photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label htmlFor="receipt-photo"
            className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-dashed border-border p-3 text-sm">
            <Camera className="h-4 w-4" />
            {file ? file.name : "Attach receipt photo"}
          </label>
        </div>
        <Button className="mt-4 w-full rounded-full" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit receipt"}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-sm font-semibold">My receipts</div>
        {rows.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">No receipts yet.</div>
        )}
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium">${Number(r.amount).toFixed(2)}
                  {r.gallons ? ` · ${Number(r.gallons).toFixed(2)} gal` : ""}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.submitted_at).toLocaleString()}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
