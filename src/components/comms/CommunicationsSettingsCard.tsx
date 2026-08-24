import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCommSettings, updateCommSettings } from "@/lib/comms.functions";
import { NOTIFICATION_LABEL, type NotificationKind } from "@/lib/comms/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquare, ShieldCheck, TriangleAlert } from "lucide-react";

const TOGGLES: { key: NotificationKind; field: string }[] = [
  { key: "bill_approved", field: "notify_bill_approved" },
  { key: "bill_rejected", field: "notify_bill_rejected" },
  { key: "trip_assigned", field: "notify_trip_assigned" },
  { key: "driver_arriving", field: "notify_driver_arriving" },
  { key: "trip_reminder", field: "notify_trip_reminder" },
];

/**
 * Company communications settings. Shows provider status and the assigned
 * number; the provider credential is never sent to the browser — only a
 * boolean "credentials ready" flag.
 */
export function CommunicationsSettingsCard() {
  const qc = useQueryClient();
  const load = useServerFn(getCommSettings);
  const save = useServerFn(updateCommSettings);

  const settings = useQuery({ queryKey: ["comm-settings"], queryFn: () => load() });

  const [number, setNumber] = useState("");
  const [profileId, setProfileId] = useState("");

  useEffect(() => {
    if (settings.data) {
      setNumber(settings.data.sms_from_number ?? "");
      setProfileId(settings.data.messaging_profile_id ?? "");
    }
  }, [settings.data]);

  const mutate = useMutation({
    mutationFn: (patch: Record<string, unknown>) => save({ data: patch as never }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comm-settings"] });
      toast.success("Communications settings saved");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (settings.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading communications settings…
        </CardContent>
      </Card>
    );
  }

  const s = settings.data;
  if (!s) return null;

  const ready = s.credentials_ready && Boolean(s.sms_from_number) && s.sms_enabled;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Text messaging
            </CardTitle>
            <CardDescription>
              Your dispatch text number, provider status, and which events text your riders.
            </CardDescription>
          </div>
          <Badge variant={ready ? "default" : "secondary"}>
            {ready ? "Live" : "Setup incomplete"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm capitalize">
              {s.provider}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comm-number">Dispatch text number</Label>
            <Input
              id="comm-number"
              value={number}
              placeholder="+17205551234"
              onChange={(e) => setNumber(e.target.value)}
              onBlur={() => {
                if ((s.sms_from_number ?? "") !== number.trim()) {
                  mutate.mutate({ sms_from_number: number.trim() || null });
                }
              }}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="comm-profile">Messaging profile ID</Label>
            <Input
              id="comm-profile"
              value={profileId}
              placeholder="Provided by your messaging provider"
              onChange={(e) => setProfileId(e.target.value)}
              onBlur={() => {
                if ((s.messaging_profile_id ?? "") !== profileId.trim()) {
                  mutate.mutate({ messaging_profile_id: profileId.trim() || null });
                }
              }}
            />
          </div>
        </div>

        <div className="rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {s.credentials_ready ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <TriangleAlert className="h-4 w-4 text-amber-600" />
            )}
            Setup status
          </div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              Provider credentials:{" "}
              {s.credentials_ready ? "connected" : "waiting for provider credentials"}
            </li>
            <li>
              Incoming-message security:{" "}
              {s.signing_ready ? "verified signatures on" : "waiting for signing key"}
            </li>
            <li>Incoming messages webhook: {s.inbound_webhook_path}</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Keys are stored securely on the server and are never shown in the app.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Texting enabled</p>
            <p className="text-xs text-muted-foreground">
              Turn on once your number and credentials are in place.
            </p>
          </div>
          <Switch
            checked={s.sms_enabled}
            onCheckedChange={(v) => mutate.mutate({ sms_enabled: v })}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Automatic notifications</p>
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">{NOTIFICATION_LABEL[t.key]}</span>
              <Switch
                checked={Boolean((s as unknown as Record<string, boolean>)[t.field])}
                onCheckedChange={(v) => mutate.mutate({ [t.field]: v })}
              />
            </div>
          ))}
        </div>

        {mutate.isPending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}
        <Button variant="outline" size="sm" onClick={() => settings.refetch()}>
          Refresh status
        </Button>
      </CardContent>
    </Card>
  );
}
