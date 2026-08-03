import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Trophy, Save, Dices, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminGetRewards,
  adminUpdateSettings,
  adminDrawWinners,
  adminMarkDelivered,
} from "@/lib/rewards.functions";

export const Route = createFileRoute("/$companySlug/_authenticated/rewards-settings")({
  component: RewardsAdmin,
});

function RewardsAdmin() {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetRewards);
  const updateFn = useServerFn(adminUpdateSettings);
  const drawFn = useServerFn(adminDrawWinners);
  const deliverFn = useServerFn(adminMarkDelivered);

  const q = useQuery({ queryKey: ["admin-rewards"], queryFn: () => getFn() });

  const [form, setForm] = useState<{
    enabled: boolean;
    rides_required: number;
    period_type: "weekly" | "monthly";
    prize_description: string;
    winners_per_period: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const settings = form ?? q.data?.settings ?? null;

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await updateFn({ data: settings });
      toast.success("Saved");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function draw() {
    setDrawing(true);
    try {
      const r = await drawFn();
      toast.success(`Drew ${r.drawn} winner${r.drawn === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draw failed");
    } finally {
      setDrawing(false);
    }
  }

  async function markDelivered(winner_id: string) {
    try {
      await deliverFn({ data: { winner_id } });
      toast.success("Marked delivered");
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  if (q.isLoading || !settings) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cp = q.data?.current_period;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rewards Program"
        description="Configure the passenger ride contest, draw winners, and track prize delivery."
      />

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Program enabled</div>
            <div className="text-xs text-muted-foreground">
              Turn off to instantly hide rewards from passengers.
            </div>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(v) => setForm({ ...settings, enabled: v })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Rides required to qualify</Label>
            <Input
              type="number"
              min={1}
              value={settings.rides_required}
              onChange={(e) =>
                setForm({ ...settings, rides_required: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contest period</Label>
            <Select
              value={settings.period_type}
              onValueChange={(v) => setForm({ ...settings, period_type: v as any })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Prize description</Label>
            <Input
              value={settings.prize_description}
              onChange={(e) => setForm({ ...settings, prize_description: e.target.value })}
              placeholder="e.g. $25 Gift Card"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Winners per period</Label>
            <Input
              type="number"
              min={1}
              value={settings.winners_per_period}
              onChange={(e) =>
                setForm({ ...settings, winners_per_period: Number(e.target.value) || 1 })
              }
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !form}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save settings
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Trophy className="h-4 w-4 text-primary" />
              Current period
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {cp?.period_start} – {cp?.period_end} · {cp?.entrants ?? 0} qualified entrants
            </div>
          </div>
          <Button onClick={draw} disabled={drawing || !cp?.entrants}>
            {drawing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Dices className="mr-2 h-4 w-4" />
            )}
            Draw winners
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-sm font-semibold">Past winners</h2>
        {(q.data?.winners ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No winners drawn yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {q.data!.winners.map((w: any) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {w.passenger?.first_name ?? "—"} {w.passenger?.last_name ?? ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {w.passenger?.email ?? "no email"} · {w.passenger?.phone ?? ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {w.period_start} – {w.period_end} · {w.prize_description}
                  </div>
                </div>
                {w.delivered_at ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Delivered{" "}
                    {new Date(w.delivered_at).toLocaleDateString()}
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => markDelivered(w.id)}>
                    Mark delivered
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
