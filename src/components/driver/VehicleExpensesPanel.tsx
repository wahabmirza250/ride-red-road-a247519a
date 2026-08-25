import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/claimReview";
import { EXPENSE_CATEGORIES, expenseCategoryLabel, expenseTotal } from "@/lib/compliance";
import { createVehicleExpense, listVehicleExpenses } from "@/lib/compliance.functions";

/** Driver-facing vehicle maintenance and expense receipts. */
export function VehicleExpensesPanel({ driverId }: { driverId?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listVehicleExpenses);
  const createFn = useServerFn(createVehicleExpense);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>("maintenance");
  const [amount, setAmount] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [odometer, setOdometer] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["vehicle_expenses", driverId ?? "me"],
    queryFn: () =>
      listFn({ data: driverId ? { driver_id: driverId } : {} }) as Promise<{
        rows: any[];
        total: number;
      }>,
  });

  const rows = q.data?.rows ?? [];

  const save = useMutation({
    mutationFn: async () => {
      let path: string | null = null;
      if (file && user) {
        const key = `${user.id}/vehicle-${Date.now()}-${file.name.replace(/[^\w.]+/g, "_")}`;
        const up = await supabase.storage.from("driver-docs").upload(key, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (up.error) throw up.error;
        path = key;
      }
      return createFn({
        data: {
          driver_id: driverId,
          expense_date: date,
          category: category as never,
          amount: Number(amount),
          vehicle_label: vehicle || null,
          odometer: odometer ? Number(odometer) : null,
          vendor: vendor || null,
          notes: notes || null,
          receipt_path: path,
        },
      }) as Promise<{ id: string }>;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      toast.success("Expense saved");
      setAmount("");
      setVendor("");
      setNotes("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["vehicle_expenses"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save expense"),
  });

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Vehicle Expenses & Maintenance</h2>
        </div>
        <div className="text-xs text-muted-foreground">
          Total {formatMoney(expenseTotal(rows.map((r) => ({ category: r.category, amount: Number(r.amount) }))))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Amount ($)</Label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Vehicle</Label>
          <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Van 1" />
        </div>
        <div className="grid gap-1.5">
          <Label>Odometer (optional)</Label>
          <Input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Vendor</Label>
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Receipt (photo or PDF)</Label>
          <Input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <Button className="w-full" disabled={busy || !amount} onClick={() => save.mutate()}>
        <Camera className="mr-2 h-4 w-4" />
        {busy ? "Saving…" : "Save expense"}
      </Button>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border p-3 text-sm">
            <div>
              <div className="font-medium">{expenseCategoryLabel(r.category)}</div>
              <div className="text-xs text-muted-foreground">
                {formatDate(r.expense_date)}
                {r.vehicle_label ? ` · ${r.vehicle_label}` : ""}
                {r.vendor ? ` · ${r.vendor}` : ""}
              </div>
            </div>
            <div className="tabular-nums font-semibold">{formatMoney(Number(r.amount))}</div>
          </div>
        ))}
        {!q.isLoading && !rows.length && (
          <p className="text-xs text-muted-foreground">No vehicle expenses yet.</p>
        )}
      </div>
    </div>
  );
}
