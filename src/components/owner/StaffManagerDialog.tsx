import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Trash2, UserCog, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createCompanyStaff,
  listCompanyStaff,
  removeCompanyStaff,
  resetStaffPassword,
  type CompanyStaff,
  type StaffRole,
} from "@/lib/owner.functions";

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Admin",
  dispatch: "Dispatch",
  billing: "Billing",
  driver: "Driver",
};

/**
 * Platform-owner staff console for one company: create, remove and reset
 * passwords for admin / dispatch / billing / driver accounts. Every action
 * runs through owner-gated server functions — nothing here trusts the client.
 */
export function StaffManagerDialog({
  companyId,
  companyName,
  onChanged,
}: {
  companyId: string;
  companyName: string;
  onChanged?: () => void | Promise<void>;
}) {
  const list = useServerFn(listCompanyStaff);
  const create = useServerFn(createCompanyStaff);
  const remove = useServerFn(removeCompanyStaff);
  const resetPw = useServerFn(resetStaffPassword);

  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<CompanyStaff[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [role, setRole] = useState<StaffRole>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [resetFor, setResetFor] = useState<CompanyStaff | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const reload = useCallback(async () => {
    const res = await list({ data: { company_id: companyId } });
    setStaff(res.staff);
  }, [list, companyId]);

  useEffect(() => {
    if (!open) return;
    setStaff(null);
    void reload().catch(() => setStaff([]));
  }, [open, reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await create({
        data: {
          company_id: companyId,
          role,
          email,
          password,
          first_name: firstName,
          last_name: lastName,
        },
      });
      toast.success(`${ROLE_LABEL[role]} account created for ${companyName}`);
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      await reload();
      await onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(member: CompanyStaff) {
    if (!window.confirm(`Permanently remove ${member.name} (${member.email ?? "no email"})?`)) return;
    setBusy(true);
    try {
      await remove({ data: { user_id: member.id } });
      toast.success(`${member.name} removed`);
      await reload();
      await onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that account");
    } finally {
      setBusy(false);
    }
  }

  async function onResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resetFor) return;
    setBusy(true);
    try {
      await resetPw({ data: { user_id: resetFor.id, password: newPassword } });
      toast.success(`Password updated for ${resetFor.name}`);
      setResetFor(null);
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setOpen(true)}>
          <UserCog className="mr-1 h-3.5 w-3.5" /> Manage staff
        </Button>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Staff — {companyName}</DialogTitle>
            <DialogDescription>
              Add or remove admin, dispatch, billing and driver accounts, and reset their passwords.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {staff === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : staff.length === 0 ? (
              <p className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
                No staff accounts yet for this company.
              </p>
            ) : (
              staff.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email ?? "no email"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                        >
                          {ROLE_LABEL[r] ?? r}
                        </span>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      disabled={busy}
                      onClick={() => {
                        setResetFor(m);
                        setNewPassword("");
                      }}
                    >
                      <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset password
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-destructive"
                      disabled={busy}
                      onClick={() => onRemove(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={onCreate} className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="h-4 w-4" /> Add a staff account
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-email">Email</Label>
                <Input
                  id="st-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-first">First name</Label>
                <Input id="st-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-last">Last name</Label>
                <Input id="st-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="st-pass">Temporary password</Label>
                <div className="flex gap-2">
                  <Input
                    id="st-pass"
                    type="text"
                    value={password}
                    minLength={12}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setPassword(generateStrongPassword())}
                  >
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Must be unique and not found in known breach lists — 12+ characters recommended.
                </p>
              </div>

            </div>
            <Button type="submit" className="rounded-full" disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create {ROLE_LABEL[role].toLowerCase()}
            </Button>
          </form>

          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetFor)} onOpenChange={(v) => !v && setResetFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetFor?.name} ({resetFor?.email ?? "no email"}). They can sign in with it
              immediately.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onResetSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="st-newpass">New password</Label>
              <Input
                id="st-newpass"
                type="text"
                value={newPassword}
                minLength={8}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="rounded-full" disabled={busy}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Update password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
