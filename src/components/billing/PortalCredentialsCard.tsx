import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listPortalCredentials,
  upsertPortalCredential,
} from "@/lib/billing.functions";
import { formatDateTime } from "@/lib/format";

export function PortalCredentialsCard() {
  const list = useServerFn(listPortalCredentials);
  const creds = useQuery({
    queryKey: ["portal_credentials"],
    queryFn: () => list(),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">State portal credentials</h2>
          <p className="text-xs text-muted-foreground">
            Encrypted in Supabase Vault. Only the automation runner can decrypt.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => setEditing(null)}
            >
              <Plus className="mr-2 h-4 w-4" /> Add credential
            </Button>
          </DialogTrigger>
          <CredentialDialog
            initial={editing}
            onClose={() => {
              setOpen(false);
              setEditing(null);
            }}
          />
        </Dialog>
      </div>

      {creds.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {(creds.data ?? []).map((c: any) => (
            <button
              key={c.id}
              onClick={() => {
                setEditing(c);
                setOpen(true);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2 text-left hover:border-primary/40"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                  {c.portal_name}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {c.state}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.login_email} · password ••••{c.password_last4 ?? "····"}
                </div>
                {c.last_used_at && (
                  <div className="text-[10px] text-muted-foreground">
                    Last used {formatDateTime(c.last_used_at)}
                  </div>
                )}
              </div>
              <span className="text-xs text-muted-foreground">Edit</span>
            </button>
          ))}
          {creds.data?.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No portal credentials saved yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CredentialDialog({
  initial,
  onClose,
}: {
  initial: any;
  onClose: () => void;
}) {
  const upsertFn = useServerFn(upsertPortalCredential);
  const qc = useQueryClient();
  const [f, setF] = useState({
    portal_name: initial?.portal_name ?? "Colorado Health First",
    state: initial?.state ?? "CO",
    login_email: initial?.login_email ?? "",
    login_password: "",
  });

  const save = useMutation({
    mutationFn: () => upsertFn({ data: f }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["portal_credentials"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {initial ? "Update credential" : "Add credential"}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Portal name</Label>
          <Input
            value={f.portal_name}
            onChange={(e) => setF({ ...f, portal_name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>State</Label>
          <Input
            value={f.state}
            onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })}
            maxLength={2}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Login email</Label>
          <Input
            type="email"
            value={f.login_email}
            onChange={(e) => setF({ ...f, login_email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{initial ? "New password (leave blank to keep)" : "Password"}</Label>
          <Input
            type="password"
            value={f.login_password}
            onChange={(e) => setF({ ...f, login_password: e.target.value })}
            placeholder={initial ? "••••••••" : ""}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={
            save.isPending ||
            !f.portal_name ||
            !f.state ||
            !f.login_email ||
            (!initial && !f.login_password)
          }
        >
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
