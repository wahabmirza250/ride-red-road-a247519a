import { createFileRoute } from "@tanstack/react-router";
import { useCompanySlug } from "@/lib/appLink";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Loader2, Shield, Car, User, ExternalLink, Copy, Radio, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/nemt/PageHeader";
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
  createAdmin,
  listAdmins,
  createDispatcher,
  listDispatchers,
  deleteDispatcher,
} from "@/lib/admin.functions";
import { PortalCredentialsCard } from "@/components/billing/PortalCredentialsCard";
import { RobotApiKeyCard } from "@/components/team/RobotApiKeyCard";

export const Route = createFileRoute("/$companySlug/_authenticated/team")({
  component: TeamPage,
});

function TeamPage() {
  const fetchAdmins = useServerFn(listAdmins);
  const admins = useQuery({ queryKey: ["admins"], queryFn: () => fetchAdmins() });
  const [openNew, setOpenNew] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = useCompanySlug() ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team & apps"
        description="Manage admin accounts and open the driver / passenger apps."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <AppCard
          href={`${origin}/`}
          title="Landing"
          desc="Home page — pick which app to open"
          icon={<Shield className="h-5 w-5" />}
          tone="amber"
        />
        <AppCard
          href={`${origin}/driver/signin`}
          title="Driver app"
          desc="Sign in with driver credentials"
          icon={<Car className="h-5 w-5" />}
          tone="primary"
        />
        <AppCard
          href={`${origin}/${slug}/passenger`}
          title="Passenger app"
          desc="Open — no sign-up required"
          icon={<User className="h-5 w-5" />}
          tone="emerald"
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Admins</h2>
            <p className="text-xs text-muted-foreground">Anyone here can access this dashboard.</p>
          </div>
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild>
              <Button size="sm" className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> Add admin
              </Button>
            </DialogTrigger>
            <NewAdminDialog onClose={() => setOpenNew(false)} />
          </Dialog>
        </div>

        {admins.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {(admins.data ?? []).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">
                    {a.first_name} {a.last_name}
                  </div>
                  <div className="text-xs text-muted-foreground">{a.email}</div>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  Admin
                </span>
              </div>
            ))}
            {admins.data?.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No admins yet.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Drivers</h2>
            <p className="text-xs text-muted-foreground">
              Create driver logins and manage vehicle info.
            </p>
          </div>
          <Button asChild size="sm" className="rounded-full">
            <a href="/drivers">
              <Plus className="mr-1 h-4 w-4" /> Create driver
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: on the Drivers page, click <span className="font-medium text-foreground">Add driver</span> to
          issue an email + password. The driver then signs in at <code className="rounded bg-muted px-1">/driver/signin</code>.
        </p>
      </div>

      <DispatchersCard />

      <RobotApiKeyCard />

      <PortalCredentialsCard />

    </div>
  );
}

function AppCard({
  href,
  title,
  desc,
  icon,
  tone,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  tone: "amber" | "primary" | "emerald";
}) {
  const toneMap = {
    amber: "bg-amber-500/15 text-amber-500",
    primary: "bg-primary/15 text-primary",
    emerald: "bg-emerald-500/15 text-emerald-500",
  };
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneMap[tone]}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button asChild size="sm" variant="outline" className="flex-1 rounded-full">
          <a href={href} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
          </a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() => {
            navigator.clipboard.writeText(href);
            toast.success("Link copied");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function NewAdminDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createAdmin);
  const [form, setForm] = useState({ email: "", password: "", first_name: "", last_name: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!form.email || !form.password || form.password.length < 6)
      return toast.error("Email and password (min 6 chars) required");
    setSubmitting(true);
    try {
      await create({ data: form });
      toast.success("Admin created");
      qc.invalidateQueries({ queryKey: ["admins"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Add admin</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>First name</Label>
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Last name</Label>
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Password</Label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DispatchersCard() {
  const qc = useQueryClient();
  const fetchDispatchers = useServerFn(listDispatchers);
  const removeDispatcher = useServerFn(deleteDispatcher);
  const dispatchers = useQuery({
    queryKey: ["dispatchers"],
    queryFn: () => fetchDispatchers(),
  });
  const [openNew, setOpenNew] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function remove(userId: string, name: string) {
    if (!window.confirm(`Remove dispatcher ${name}? Their login will be deleted.`)) return;
    setRemovingId(userId);
    try {
      await removeDispatcher({ data: { user_id: userId } });
      toast.success("Dispatcher removed");
      qc.invalidateQueries({ queryKey: ["dispatchers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove dispatcher");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Dispatchers</h2>
          <p className="text-xs text-muted-foreground">
            Dispatch-only logins for <code className="rounded bg-muted px-1">/dispatch/signin</code>. No
            access to billing, payroll or this dashboard.
          </p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-full">
              <Plus className="mr-2 h-4 w-4" /> Create dispatcher
            </Button>
          </DialogTrigger>
          <NewDispatcherDialog onClose={() => setOpenNew(false)} />
        </Dialog>
      </div>

      {dispatchers.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : dispatchers.isError ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Couldn’t load dispatchers.
        </div>
      ) : (
        <div className="space-y-2">
          {(dispatchers.data ?? []).map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-xl border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {[d.first_name, d.last_name].filter(Boolean).join(" ") || "Dispatcher"}
                </div>
                <div className="truncate text-xs text-muted-foreground">{d.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-500">
                  <Radio className="mr-1 inline h-3 w-3" />
                  Dispatch
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                  disabled={removingId === d.id}
                  onClick={() =>
                    remove(d.id, [d.first_name, d.last_name].filter(Boolean).join(" ") || d.email || "")
                  }
                >
                  {removingId === d.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
          {dispatchers.data?.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No dispatchers yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewDispatcherDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createDispatcher);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!form.email.trim() || form.password.length < 6) {
      toast.error("Email and password (min 6 chars) required");
      return;
    }
    setSubmitting(true);
    try {
      await create({ data: form });
      toast.success("Dispatcher created — they sign in at /dispatch/signin");
      qc.invalidateQueries({ queryKey: ["dispatchers"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create dispatcher");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Create dispatcher</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>First name</Label>
          <Input
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Last name</Label>
          <Input
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Password</Label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
