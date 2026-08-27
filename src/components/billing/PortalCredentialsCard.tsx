import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Loader2, KeyRound, Star, Trash2 } from "lucide-react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deletePortalCredential,
  getBillingSettings,
  getPortalCredentialFingerprint,
  listPortalCredentials,
  setDefaultBillingPortal,
  upsertPortalCredential,
} from "@/lib/billing.functions";
import { PORTALS, getPortal } from "@/lib/portals";
import { formatDateTime } from "@/lib/format";
import { friendlyErrorMessage } from "@/lib/errorMessage";
import { supabase } from "@/lib/supabaseBrowser";

export function PortalCredentialsCard() {
  const list = useServerFn(listPortalCredentials);
  const settingsFn = useServerFn(getBillingSettings);
  const setDefaultFn = useServerFn(setDefaultBillingPortal);
  const qc = useQueryClient();

  const creds = useQuery({
    queryKey: ["portal_credentials"],
    retry: 1,
    queryFn: async () => {
      try {
        return await list();
      } catch {
        // Edge deployments can reject server-function calls; RLS-scoped read works fine.
        const { data, error } = await supabase
          .from("state_portal_credentials")
          .select(
            "id, portal_id, portal_name, state, login_email, password_last4, last_used_at, updated_at, company_id",
          )
          .order("portal_name");
        if (error) throw new Error(error.message);
        return data ?? [];
      }
    },
  });
  const settings = useQuery({
    queryKey: ["billing_settings"],
    retry: 1,
    queryFn: async () => {
      try {
        return await settingsFn();
      } catch {
        const { data } = await supabase
          .from("billing_settings")
          .select("*")
          .limit(1)
          .maybeSingle();
        return data ?? null;
      }
    },
  });


  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [pendingDelete, setPendingDelete] = useState<any>(null);
  const deleteFn = useServerFn(deletePortalCredential);

  const setDefault = useMutation({
    mutationFn: (portal_id: string) => setDefaultFn({ data: { portal_id } }),
    onSuccess: () => {
      toast.success("Default portal updated");
      qc.invalidateQueries({ queryKey: ["billing_settings"] });
    },
    onError: (e: unknown) => toast.error(friendlyErrorMessage(e, "Could not update the default portal")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      try {
        return await deleteFn({ data: { id } });
      } catch (serverError) {
        // Custom-domain edge deployments can reject server-function requests.
        // Deleting directly is safe: RLS only allows admins to touch this table.
        const { error } = await supabase
          .from("state_portal_credentials")
          .delete()
          .eq("id", id);
        if (error) throw serverError;
        return { ok: true };
      }
    },
    onSuccess: () => {
      toast.success("Portal credential deleted");
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["portal_credentials"] });
      qc.invalidateQueries({ queryKey: ["billing_settings"] });
    },
    onError: (e: unknown) =>
      toast.error(friendlyErrorMessage(e, "Could not delete the portal credential")),
  });

  const savedPortalIds = useMemo(
    () => new Set((creds.data ?? []).map((c: any) => c.portal_id)),
    [creds.data],
  );


  return (
    <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Billing portal</h2>
          <p className="text-xs text-muted-foreground">
            Pick the state portal to bill through, then save its login.
            Passwords are encrypted at rest and never returned to the browser.
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

      {/* Default portal selector */}
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-surface-muted/40 p-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Star className="h-4 w-4 text-amber-500" /> Default portal for this
          account
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Select
            value={settings.data?.default_portal_id ?? ""}
            onValueChange={(v) => setDefault.mutate(v)}
            disabled={setDefault.isPending || settings.isLoading}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Select a portal…" />
            </SelectTrigger>
            <SelectContent>
              {PORTALS.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  disabled={!savedPortalIds.has(p.id)}
                >
                  {p.name} · {p.state}
                  {!savedPortalIds.has(p.id) ? " (no login saved)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {creds.isPending ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : creds.isError ? (
        <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
          <span>{friendlyErrorMessage(creds.error, "Could not load saved logins")}</span>
          <Button size="sm" variant="outline" onClick={() => creds.refetch()}>
            Retry
          </Button>
        </div>
      ) : (

        <div className="space-y-2">
          {(creds.data ?? []).map((c: any) => {
            const def = getPortal(c.portal_id);
            const isDefault =
              settings.data?.default_portal_id === c.portal_id;
            return (
              <div
                key={c.id}
                className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-left transition hover:border-primary/40"
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditing(c);
                    setOpen(true);
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                      {def?.name ?? c.portal_name}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {def?.state ?? c.state}
                      </span>
                      {isDefault && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                          default
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.login_email} · password ••••
                      {c.password_last4 ?? "····"}
                    </div>
                    {c.last_used_at && (
                      <div className="text-[10px] text-muted-foreground">
                        Last used {formatDateTime(c.last_used_at)}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">Edit</span>
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${def?.name ?? c.portal_name} credential`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setPendingDelete(c)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {creds.data?.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No portal credentials saved yet.
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this portal credential?</AlertDialogTitle>
            <AlertDialogDescription>
              {getPortal(pendingDelete?.portal_id)?.name ??
                pendingDelete?.portal_name}{" "}
              ({pendingDelete?.login_email}) will be removed permanently. Any
              billing automation using this portal will stop working until a new
              login is saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
            >
              {remove.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const initialPortal = initial?.portal_id ?? PORTALS[0].id;
  const [portalId, setPortalId] = useState<string>(initialPortal);
  const [loginEmail, setLoginEmail] = useState<string>(initial?.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState<string>("");

  const def = getPortal(portalId);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        portal_id: portalId,
        portal_name: def?.name ?? portalId,
        state: def?.state ?? "",
        login_email: loginEmail.trim(),
        login_password: loginPassword,
      };
      try {
        return await upsertFn({ data: payload });
      } catch (serverError) {
        // Custom-domain edge deployments can reject server-function requests.
        // This RPC remains safe to call from the browser: the database function
        // verifies the caller is an admin and encrypts the password in Vault.
        const { data, error } = await supabase.rpc("upsert_portal_credential", {
          _portal_id: payload.portal_id,
          _portal_name: payload.portal_name,
          _state: payload.state,
          _login_email: payload.login_email,
          _login_password: payload.login_password,
        });
        if (error) throw error;
        if (!data) throw serverError;
        return { id: data };
      }
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["portal_credentials"] });
      qc.invalidateQueries({ queryKey: ["billing_settings"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(friendlyErrorMessage(e, "Could not save the portal credential")),
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {initial ? "Update credential" : "Add credential"}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Portal</Label>
          <Select
            value={portalId}
            onValueChange={setPortalId}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PORTALS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Login username</Label>
          <Input
            type="text"
            autoComplete="username"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
          />

        </div>
        <div className="space-y-1.5">
          <Label>
            {initial ? "New password (leave blank to keep)" : "Password"}
          </Label>
          <Input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
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
            !portalId ||
            !loginEmail ||
            (!initial && !loginPassword)
          }
        >
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
