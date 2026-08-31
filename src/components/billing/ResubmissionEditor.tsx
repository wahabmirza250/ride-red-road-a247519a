import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MODIFIER_OPTIONS } from "@/lib/claimModifiers";
import { ResubmissionAttachment } from "@/components/billing/ResubmissionAttachment";
import {
  diffSnapshots,
  effectiveMiles,
  isValidModifier,
  legMilesOf,
  normalizeModifier,
  normalizeSnapshot,
  odometerMiles,
  validateDraft,
  type DraftLeg,
  type DraftServiceLine,
  type DraftSnapshot,
} from "@/lib/resubmissionDraft";
import {
  discardResubmission,
  getResubmission,
  queueResubmission,
  reviewResubmission,
  saveResubmissionDraft,
} from "@/lib/resubmission.functions";

const emptyLeg = (index: number, date: string | null): DraftLeg => ({
  leg_index: index,
  leg_date: date,
  pickup_time: null,
  pickup_address: "",
  pickup_odometer: null,
  dropoff_time: null,
  dropoff_address: "",
  dropoff_odometer: null,
});

const emptyLine = (index: number, date: string | null): DraftServiceLine => ({
  line_index: index,
  service_date: date,
  procedure_code: null,
  place_of_service: null,
  diagnosis_code: null,
  units: 1,
  miles: null,
  amount: null,
  modifiers: [],
});

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const show = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

/**
 * FULL RESUBMISSION EDITOR.
 *
 * Every field here belongs to the DRAFT only. The original denied claim, its
 * claim ID, its denial reason and the original trip rows are never written to.
 */
export function ResubmissionEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getResubmission);
  const saveFn = useServerFn(saveResubmissionDraft);
  const reviewFn = useServerFn(reviewResubmission);
  const queueFn = useServerFn(queueResubmission);
  const discardFn = useServerFn(discardResubmission);

  const [snap, setSnap] = useState<DraftSnapshot | null>(null);
  const [tab, setTab] = useState("trip");
  const [confirmQueue, setConfirmQueue] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [customMod, setCustomMod] = useState<Record<number, string>>({});

  const q = useQuery({
    queryKey: ["resubmission", id],
    queryFn: () => getFn({ data: { id: id! } }) as Promise<any>,
    enabled: !!id,
  });

  useEffect(() => {
    if (!q.data) return;
    setSnap(normalizeSnapshot(q.data.draft_snapshot ?? q.data.original_snapshot ?? {}));
    setTab("trip");
  }, [q.data]);

  const original = q.data?.original_snapshot ? normalizeSnapshot(q.data.original_snapshot) : null;
  const driverOptions = (q.data?.drivers ?? []) as { id: string; name: string }[];
  const isDraft = q.data?.resubmission?.status === "draft";
  const validation = useMemo(() => (snap ? validateDraft(snap) : { ok: false, issues: [] }), [snap]);
  const changes = useMemo(
    () => (snap && original ? diffSnapshots(original, snap) : []),
    [snap, original],
  );

  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const focusPreview = () => {
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    previewRef.current?.focus({ preventScroll: true });
  };


  const patch = (p: Partial<DraftSnapshot>) => setSnap((s) => (s ? { ...s, ...p } : s));
  const patchLeg = (i: number, p: Partial<DraftLeg>) =>
    setSnap((s) =>
      s ? { ...s, legs: s.legs.map((l, idx) => (idx === i ? { ...l, ...p } : l)) } : s,
    );
  const patchLine = (i: number, p: Partial<DraftServiceLine>) =>
    setSnap((s) =>
      s ? { ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)) } : s,
    );

  const toggleMod = (i: number, code: string) =>
    setSnap((s) => {
      if (!s) return s;
      const c = normalizeModifier(code);
      return {
        ...s,
        lines: s.lines.map((l, idx) => {
          if (idx !== i) return l;
          const has = l.modifiers.includes(c);
          if (!has && l.modifiers.length >= 4) {
            toast.error("A service line supports at most 4 modifiers.");
            return l;
          }
          return { ...l, modifiers: has ? l.modifiers.filter((m) => m !== c) : [...l.modifiers, c] };
        }),
      };
    });

  const save = useMutation({
    mutationFn: () => saveFn({ data: { id: id!, snapshot: snap as any } }) as Promise<any>,
    onSuccess: (res) => {
      toast.success(
        res.changes?.length ? `Draft saved (${res.changes.length} change(s) audited)` : "Draft saved",
      );
      void qc.invalidateQueries({ queryKey: ["resubmission", id] });
      void qc.invalidateQueries({ queryKey: ["denied_claims"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the draft"),
  });

  const review = useMutation({
    mutationFn: () => reviewFn({ data: { id: id! } }) as Promise<any>,
    onSuccess: () => setTab("review"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not review the draft"),
  });

  const queue = useMutation({
    mutationFn: () => queueFn({ data: { id: id!, confirm: true } }) as Promise<any>,
    onSuccess: (res) => {
      if (res.queued) {
        toast.success("Corrected claim queued for HCPF");
        void qc.invalidateQueries({ queryKey: ["denied_claims"] });
        onClose();
      } else {
        toast.info(res.reason ?? "Nothing to queue");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not queue the resubmission"),
  });

  const discard = useMutation({
    mutationFn: () => discardFn({ data: { id: id! } }) as Promise<any>,
    onSuccess: () => {
      toast.success("Draft discarded — the original denied claim is unchanged");
      void qc.invalidateQueries({ queryKey: ["denied_claims"] });
      onClose();
    },
  });

  const sub = q.data?.resubmission;
  const computedMiles = snap ? odometerMiles(snap.legs) : 0;
  const billed = snap ? effectiveMiles(snap) : 0;

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[98vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 bg-muted/30 px-4 py-3 sm:px-6">
          <DialogTitle className="text-base sm:text-lg">Correct &amp; resubmit claim</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            You are editing a corrected COPY. The original denied claim, its claim ID, its denial
            reason and the original trip record stay exactly as they are.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading || !snap ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs sm:px-6">
              <Badge variant="destructive">Original: {sub?.original_status ?? "denied"}</Badge>
              <span className="font-mono">{sub?.original_claim_number ?? "no claim ID"}</span>
              <Badge variant="secondary">Draft v{sub?.draft_version ?? 1}</Badge>
              <Badge variant={isDraft ? "outline" : "default"}>{sub?.status}</Badge>
              {sub?.original_denial_reason ? (
                <span className="truncate text-muted-foreground">
                  Denial: {sub.original_denial_reason}
                </span>
              ) : null}
            </div>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2 sm:mx-6 sm:grid-cols-5">
                <TabsTrigger value="trip">Trip</TabsTrigger>
                <TabsTrigger value="legs">Legs ({snap.legs.length})</TabsTrigger>
                <TabsTrigger value="lines">Service lines ({snap.lines.length})</TabsTrigger>
                <TabsTrigger value="review">
                  Review {changes.length ? `(${changes.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {/* ---------------- TRIP ---------------- */}
                <TabsContent value="trip" className="mt-0 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Service / trip date">
                      <Input
                        type="date"
                        value={snap.service_date ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ service_date: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Passenger">
                      <Input
                        value={snap.passenger_name ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ passenger_name: e.target.value || null })}
                      />
                    </Field>
                    <Field label="Medicaid ID">
                      <Input
                        value={snap.medicaid_id ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ medicaid_id: e.target.value.toUpperCase() || null })}
                      />
                    </Field>
                    <Field label="Driver">
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={snap.driver_id ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => {
                          const picked = driverOptions.find((d) => d.id === e.target.value);
                          patch({
                            driver_id: picked?.id ?? null,
                            driver_name: picked?.name ?? snap.driver_name ?? null,
                          });
                        }}
                      >
                        <option value="">
                          {snap.driver_name ? `${snap.driver_name} (current)` : "Select a driver…"}
                        </option>
                        {driverOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Vehicle type">
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={snap.vehicle_type ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ vehicle_type: e.target.value || null })}
                      >
                        <option value="">Select…</option>
                        {["ambulatory", "wheelchair_van", "stretcher_van", "taxi", "ground_ambulance"].map(
                          (v) => (
                            <option key={v} value={v}>
                              {v.replace(/_/g, " ")}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                    <Field label="Trip kind">
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={snap.trip_kind ?? "one_way"}
                        disabled={!isDraft}
                        onChange={(e) => {
                          const kind = e.target.value;
                          setSnap((s) => {
                            if (!s) return s;
                            let legs = s.legs;
                            if (kind === "round_trip" && legs.length < 2)
                              legs = [...legs, emptyLeg(legs.length + 1, s.service_date)];
                            return { ...s, trip_kind: kind, legs };
                          });
                        }}
                      >
                        <option value="one_way">One way</option>
                        <option value="round_trip">Round trip</option>
                      </select>
                    </Field>
                    <Field label="Vehicle plate">
                      <Input
                        value={snap.vehicle_plate ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ vehicle_plate: e.target.value.toUpperCase() || null })}
                      />
                    </Field>
                    <Field label="Vehicle VIN">
                      <Input
                        value={snap.vehicle_vin ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ vehicle_vin: e.target.value.toUpperCase() || null })}
                      />
                    </Field>
                    <Field label="Escort name">
                      <Input
                        value={snap.escort_name ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ escort_name: e.target.value || null })}
                      />
                    </Field>
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Toggle
                      label="Signature on file"
                      checked={snap.signature_on_file}
                      disabled={!isDraft}
                      onChange={(v) => patch({ signature_on_file: v })}
                    />
                    <Toggle
                      label="Identity verified"
                      checked={snap.identity_verified}
                      disabled={!isDraft}
                      onChange={(v) => patch({ identity_verified: v })}
                    />
                    <Toggle
                      label="Signed by escort"
                      checked={snap.signed_by_escort}
                      disabled={!isDraft}
                      onChange={(v) => patch({ signed_by_escort: v })}
                    />
                  </div>

                  <Field label="Supporting trip report">
                    <ResubmissionAttachment
                      resubmissionId={id!}
                      path={snap.state_pdf_path}
                      originalPath={original?.state_pdf_path ?? null}
                      disabled={!isDraft}
                      onChange={(p) => {
                        patch({ state_pdf_path: p });
                        setPreviewVersion((v) => v + 1);
                        focusPreview();
                      }}
                      onViewInline={focusPreview}
                    />
                  </Field>


                  <Field label="Correction reason / notes (audited)">
                    <Textarea
                      rows={3}
                      value={snap.correction_reason ?? ""}
                      disabled={!isDraft}
                      onChange={(e) => patch({ correction_reason: e.target.value || null })}
                    />
                  </Field>
                </TabsContent>

                {/* ---------------- LEGS ---------------- */}
                <TabsContent value="legs" className="mt-0 space-y-4">
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
                    <span>
                      Odometer miles: <strong>{computedMiles}</strong>
                    </span>
                    <span>
                      Billed miles: <strong>{billed}</strong>
                    </span>
                    {snap.miles_override != null && (
                      <Badge variant="secondary">Manual override</Badge>
                    )}
                  </div>

                  {snap.legs.map((leg, i) => (
                    <div key={i} className="rounded-2xl border p-3 sm:p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold">Leg {i + 1}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {legMilesOf(leg)} mi
                          {isDraft && snap.legs.length > 1 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setSnap((s) =>
                                  s
                                    ? {
                                        ...s,
                                        legs: s.legs
                                          .filter((_, idx) => idx !== i)
                                          .map((l, idx) => ({ ...l, leg_index: idx + 1 })),
                                      }
                                    : s,
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Pickup date">
                          <Input
                            type="date"
                            value={leg.leg_date ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLeg(i, { leg_date: e.target.value || null })}
                          />
                        </Field>
                        <Field label="Pickup time">
                          <Input
                            type="time"
                            value={leg.pickup_time ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLeg(i, { pickup_time: e.target.value || null })}
                          />
                        </Field>
                        <Field label="Pickup odometer">
                          <Input
                            inputMode="decimal"
                            value={leg.pickup_odometer ?? ""}
                            disabled={!isDraft}
                            onChange={(e) =>
                              patchLeg(i, { pickup_odometer: numOrNull(e.target.value) })
                            }
                          />
                        </Field>
                        <Field label="Drop-off odometer">
                          <Input
                            inputMode="decimal"
                            value={leg.dropoff_odometer ?? ""}
                            disabled={!isDraft}
                            onChange={(e) =>
                              patchLeg(i, { dropoff_odometer: numOrNull(e.target.value) })
                            }
                          />
                        </Field>
                        <Field label="Pickup address" className="lg:col-span-2">
                          <Input
                            value={leg.pickup_address}
                            disabled={!isDraft}
                            onChange={(e) => patchLeg(i, { pickup_address: e.target.value })}
                          />
                        </Field>
                        <Field label="Drop-off time">
                          <Input
                            type="time"
                            value={leg.dropoff_time ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLeg(i, { dropoff_time: e.target.value || null })}
                          />
                        </Field>
                        <Field label="Drop-off address">
                          <Input
                            value={leg.dropoff_address}
                            disabled={!isDraft}
                            onChange={(e) => patchLeg(i, { dropoff_address: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>
                  ))}

                  {isDraft && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setSnap((s) =>
                          s ? { ...s, legs: [...s.legs, emptyLeg(s.legs.length + 1, s.service_date)] } : s,
                        )
                      }
                    >
                      <Plus className="mr-1.5 h-4 w-4" /> Add leg
                    </Button>
                  )}

                  <Separator />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Manual total-miles override (optional)">
                      <Input
                        inputMode="decimal"
                        value={snap.miles_override ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ miles_override: numOrNull(e.target.value) })}
                      />
                    </Field>
                    <Field label="Override reason (required when overriding)">
                      <Input
                        value={snap.miles_override_reason ?? ""}
                        disabled={!isDraft}
                        onChange={(e) => patch({ miles_override_reason: e.target.value || null })}
                      />
                    </Field>
                  </div>
                </TabsContent>

                {/* ---------------- SERVICE LINES ---------------- */}
                <TabsContent value="lines" className="mt-0 space-y-4">
                  {snap.lines.map((line, i) => (
                    <div key={i} className="rounded-2xl border p-3 sm:p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold">Service line {line.line_index}</div>
                        {isDraft && snap.lines.length > 1 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setSnap((s) =>
                                s
                                  ? {
                                      ...s,
                                      lines: s.lines
                                        .filter((_, idx) => idx !== i)
                                        .map((l, idx) => ({ ...l, line_index: idx + 1 })),
                                    }
                                  : s,
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Service date">
                          <Input
                            type="date"
                            value={line.service_date ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLine(i, { service_date: e.target.value || null })}
                          />
                        </Field>
                        <Field label="Procedure code">
                          <Input
                            value={line.procedure_code ?? ""}
                            disabled={!isDraft}
                            onChange={(e) =>
                              patchLine(i, { procedure_code: e.target.value.toUpperCase() || null })
                            }
                          />
                        </Field>
                        <Field label="Place of service">
                          <Input
                            value={line.place_of_service ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLine(i, { place_of_service: e.target.value || null })}
                          />
                        </Field>
                        <Field label="Diagnosis code / pointer">
                          <Input
                            value={line.diagnosis_code ?? ""}
                            disabled={!isDraft}
                            onChange={(e) =>
                              patchLine(i, { diagnosis_code: e.target.value.toUpperCase() || null })
                            }
                          />
                        </Field>
                        <Field label="Units">
                          <Input
                            inputMode="decimal"
                            value={line.units ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLine(i, { units: numOrNull(e.target.value) })}
                          />
                        </Field>
                        <Field label="Miles">
                          <Input
                            inputMode="decimal"
                            value={line.miles ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLine(i, { miles: numOrNull(e.target.value) })}
                          />
                        </Field>
                        <Field label="Amount">
                          <Input
                            inputMode="decimal"
                            value={line.amount ?? ""}
                            disabled={!isDraft}
                            onChange={(e) => patchLine(i, { amount: numOrNull(e.target.value) })}
                          />
                        </Field>
                      </div>

                      <div className="mt-3">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Modifiers (manual choice — never auto-applied)
                        </Label>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {MODIFIER_OPTIONS.map((m) => (
                            <Button
                              key={m.code}
                              type="button"
                              size="sm"
                              variant={line.modifiers.includes(m.code) ? "default" : "outline"}
                              disabled={!isDraft}
                              title={m.label}
                              onClick={() => toggleMod(i, m.code)}
                            >
                              {m.code}
                            </Button>
                          ))}
                          {line.modifiers
                            .filter((m) => !MODIFIER_OPTIONS.some((o) => o.code === m))
                            .map((m) => (
                              <Button
                                key={m}
                                size="sm"
                                variant="default"
                                disabled={!isDraft}
                                onClick={() => toggleMod(i, m)}
                              >
                                {m}
                              </Button>
                            ))}
                          <Input
                            className="h-9 w-24"
                            placeholder="Custom"
                            maxLength={2}
                            disabled={!isDraft}
                            value={customMod[i] ?? ""}
                            onChange={(e) =>
                              setCustomMod((c) => ({ ...c, [i]: e.target.value.toUpperCase() }))
                            }
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!isDraft}
                            onClick={() => {
                              const code = normalizeModifier(customMod[i] ?? "");
                              if (!isValidModifier(code)) {
                                toast.error("A modifier must be exactly two letters or digits.");
                                return;
                              }
                              toggleMod(i, code);
                              setCustomMod((c) => ({ ...c, [i]: "" }));
                            }}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {isDraft && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setSnap((s) =>
                          s
                            ? { ...s, lines: [...s.lines, emptyLine(s.lines.length + 1, s.service_date)] }
                            : s,
                        )
                      }
                    >
                      <Plus className="mr-1.5 h-4 w-4" /> Add service line
                    </Button>
                  )}
                </TabsContent>

                {/* ---------------- REVIEW ---------------- */}
                <TabsContent value="review" className="mt-0 space-y-4">
                  {!validation.ok && (
                    <div className="space-y-1 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" /> Fix before queueing
                      </div>
                      <ul className="list-disc pl-5">
                        {validation.issues.map((iss, k) => (
                          <li key={k}>{iss.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {validation.ok && (
                    <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-600 dark:text-emerald-400">
                      <Check className="h-4 w-4" /> The corrected claim passes every validation check.
                    </div>
                  )}

                  <div className="overflow-hidden rounded-2xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left font-medium">Field</th>
                          <th className="p-3 text-left font-medium">Original</th>
                          <th className="p-3 text-left font-medium">Corrected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.length ? (
                          changes.map((c) => (
                            <tr key={c.field} className="border-t border-border/70">
                              <td className="p-3 font-medium">{c.label}</td>
                              <td className="p-3 text-muted-foreground line-through">{show(c.before)}</td>
                              <td className="p-3 font-semibold">{show(c.after)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="p-6 text-center text-muted-foreground">
                              No changes yet — the draft still matches the original claim.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                {/* ---------------- HISTORY ---------------- */}
                <TabsContent value="history" className="mt-0 space-y-2">
                  {((q.data?.events ?? []) as any[]).length ? (
                    (q.data.events as any[]).map((e) => (
                      <div key={e.id} className="rounded-xl border p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(e.created_at).toLocaleString()}
                          </span>
                        </div>
                        {e.notes && <p className="mt-1 text-xs text-muted-foreground">{e.notes}</p>}
                        {Array.isArray(e.changes) && e.changes.length ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {e.changes.length} field(s) changed
                          </p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="p-6 text-center text-sm text-muted-foreground">No events yet.</p>
                  )}
                </TabsContent>
              </div>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-6">
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={!isDraft || discard.isPending}
                onClick={() => setConfirmDiscard(true)}
              >
                Discard draft
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                <Button
                  variant="secondary"
                  disabled={!isDraft || save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Save draft
                </Button>
                <Button
                  variant="outline"
                  disabled={!isDraft || review.isPending}
                  onClick={() => review.mutate()}
                >
                  Review changes
                </Button>
                <Button
                  disabled={!isDraft || tab !== "review" || !validation.ok || queue.isPending}
                  onClick={() => setConfirmQueue(true)}
                  title={
                    tab !== "review" ? "Open Review changes first" : "Queue this corrected claim"
                  }
                >
                  Queue corrected claim for HCPF
                </Button>
              </div>
            </div>
          </>
        )}

        <AlertDialog open={confirmQueue} onOpenChange={setConfirmQueue}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Queue this corrected claim for HCPF?</AlertDialogTitle>
              <AlertDialogDescription>
                A brand-new claim attempt is created with its own idempotency key. The original
                claim ID is never reused and the original denied claim stays untouched. Nothing is
                sent until the queue picks it up.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmQueue(false);
                  queue.mutate();
                }}
              >
                Yes, queue it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
              <AlertDialogDescription>
                All corrections in this draft are dropped. The original denied claim, its claim ID
                and its history are unchanged, and you can prepare a new draft later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmDiscard(false);
                  discard.mutate();
                }}
              >
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
