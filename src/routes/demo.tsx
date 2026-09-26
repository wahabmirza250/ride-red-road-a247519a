import { createFileRoute } from "@tanstack/react-router";
import { useReducer, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Car,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  Play,
  Radio,
  RotateCcw,
  Users,
} from "lucide-react";
import { BrandWordmark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { demoReducer, initialDemo, type DemoTrip } from "@/lib/presentationDemo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "NEMT Solutions — interactive company demo" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PresentationDemo,
});
const views = [
  { id: "overview", label: "Company", icon: LayoutDashboard },
  { id: "passenger", label: "Passenger", icon: Users },
  { id: "dispatch", label: "Dispatch", icon: MapPin },
  { id: "driver", label: "Driver", icon: Car },
  { id: "billing", label: "Billing", icon: ClipboardList },
] as const;
type View = (typeof views)[number]["id"];
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const notes: Record<View, string> = {
  overview:
    "Start here: one company workspace connects passenger requests, dispatch, drivers, and billing. All names, amounts, and results in this presentation are fictional.",
  passenger:
    "Click Request demo ride. The same request will appear in Dispatch. Explain that passengers use their company’s access code in the real app.",
  dispatch:
    "Assign Jamie’s request to Jordan. The driver view and passenger status update together in this presentation.",
  driver:
    "Start and complete Jamie’s trip. Completion makes it available to company billing. In the real app the driver also records trip details and signatures.",
  billing:
    "Select completed trips, choose EDI or Robot, and create a demo batch. Simulate sending it and receiving a payment response. Real billing requires provider and payer setup; demo responses are illustrative.",
};

function PresentationDemo() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [view, setView] = useState<View>("overview");
  const [showNotes, setShowNotes] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [method, setMethod] = useState<"EDI" | "Robot">("EDI");
  const request = state.trips.find((t) => t.id === "D-103");
  const ready = state.trips.filter((t) => t.status === "completed" && !t.batchId);
  const picked = ready.filter((t) => selected.includes(t.id));
  const reset = () => {
    dispatch({ type: "reset" });
    setSelected([]);
    setMethod("EDI");
    setView("overview");
  };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="bg-[#071b3a] px-4 py-2 text-center text-xs font-medium text-white">
        PRESENTATION DEMO · Fictional data · No real rides, messages, camera access, or claims
      </div>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <a href="/" aria-label="NEMT Solutions home">
            <BrandWordmark className="h-9" />
          </a>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowNotes(!showNotes)}>
              {showNotes ? "Hide" : "Show"} presenter notes
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset demo
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Evergreen Transport · Demo company
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              One trip. One connected workflow.
            </h1>
            <p className="mt-2 text-muted-foreground">
              From the passenger’s request to your company’s billing desk.
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            Company code: DEMO
          </span>
        </div>
        <nav aria-label="Demo app" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? "page" : undefined}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium",
                view === v.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface",
              )}
            >
              <v.icon className="h-4 w-4" />
              {v.label}
            </button>
          ))}
        </nav>
        {showNotes && (
          <aside className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <strong>Presenter notes</strong>
            <p className="mt-1 text-muted-foreground">{notes[view]}</p>
          </aside>
        )}
        {view === "overview" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Demo trips" value={String(state.trips.length)} />
              <Metric
                label="Completed"
                value={String(state.trips.filter((t) => t.status === "completed").length)}
              />
              <Metric label="Ready to bill" value={money(ready.reduce((n, t) => n + t.cents, 0))} />
              <Metric
                label="Demo payments"
                value={money(
                  state.batches.filter((b) => b.status === "paid").reduce((n, b) => n + b.cents, 0),
                )}
              />
            </div>
            <section className="grid gap-5 lg:grid-cols-2">
              <Panel title="Show the complete journey">
                <p className="text-muted-foreground">
                  A guided, five-minute walkthrough for transport company owners. Switch between
                  roles to follow the same trip.
                </p>
                <ol className="my-5 space-y-3 text-sm">
                  {[
                    "Passenger requests a ride",
                    "Dispatcher assigns a driver",
                    "Driver completes the trip",
                    "Company creates a billing batch",
                    "Staff track the billing response",
                  ].map((step, i) => (
                    <li key={step} className="flex items-center gap-3">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 font-semibold text-primary">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
                <Button onClick={() => setView("passenger")}>
                  <Play className="mr-2 h-4 w-4" />
                  Start walkthrough
                </Button>
              </Panel>
              <Panel title="Designed around your company">
                <div className="space-y-5">
                  {[
                    [
                      "Your team, one workspace",
                      "Company access for office staff, drivers, and passengers.",
                    ],
                    [
                      "Trips flow into billing",
                      "Completed trip forms become work for the company billing team.",
                    ],
                    [
                      "Two billing methods",
                      "EDI claim batches and a separate state-portal robot workflow.",
                    ],
                  ].map(([title, detail]) => (
                    <div key={title}>
                      <h3 className="font-medium">{title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
                  This is a presentation simulation. Production integrations and payer approvals are
                  configured separately.
                </p>
              </Panel>
            </section>
          </>
        )}
        {view === "passenger" && (
          <section className="grid gap-5 lg:grid-cols-2">
            <Panel title="Passenger app">
              <p className="text-sm text-muted-foreground">
                Welcome, Jamie Parker · fictional passenger
              </p>
              <div className="my-5 space-y-4 rounded-xl bg-surface-muted p-4">
                <p>
                  <span className="block text-xs text-muted-foreground">Pickup · 10:30 AM</span>25
                  Cedar Avenue
                </p>
                <p>
                  <span className="block text-xs text-muted-foreground">Destination</span>Riverside
                  Medical Center
                </p>
              </div>
              {!request ? (
                <Button onClick={() => dispatch({ type: "request" })}>Request demo ride</Button>
              ) : (
                <div role="status" className="space-y-3">
                  <Status trip={request} />
                  <p className="text-sm">
                    {request.driver
                      ? `Your driver: ${request.driver} · Vehicle 12`
                      : "Your request is waiting for dispatch."}
                  </p>
                  <Button onClick={() => setView("dispatch")}>
                    Open dispatch <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </Panel>
            <Panel title="What the owner sees">
              <p className="text-muted-foreground">
                A request becomes part of the company’s trip workflow. Follow this ride through
                dispatch, driver operations, and billing using the tabs above.
              </p>
            </Panel>
          </section>
        )}
        {view === "dispatch" && (
          <Panel title="Dispatch board">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                2 demo drivers · Jordan Lee and Casey Reed
              </p>
              <Button variant="outline" onClick={() => setView(request ? "driver" : "passenger")}>
                {request ? "Open driver app" : "Create a passenger request"}
              </Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {state.trips.map((t) => (
                <TripCard key={t.id} trip={t}>
                  {t.status === "requested" && (
                    <Button
                      className="mt-4 w-full"
                      onClick={() => dispatch({ type: "assign", id: t.id })}
                    >
                      Assign Jordan Lee
                    </Button>
                  )}
                </TripCard>
              ))}
            </div>
          </Panel>
        )}
        {view === "driver" && (
          <section className="grid gap-5 lg:grid-cols-2">
            <Panel title="Driver app · Jordan Lee">
              {!request || request.status === "requested" ? (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    No new assigned trip. Create a passenger request and assign Jordan in Dispatch.
                  </p>
                  <Button onClick={() => setView(request ? "dispatch" : "passenger")}>
                    {request ? "Open dispatch" : "Request a ride"}
                  </Button>
                </div>
              ) : (
                <TripCard trip={request}>
                  {request.status === "assigned" && (
                    <Button
                      className="mt-4 w-full"
                      onClick={() => dispatch({ type: "start", id: request.id })}
                    >
                      Start demo trip
                    </Button>
                  )}
                  {request.status === "driving" && (
                    <Button
                      className="mt-4 w-full"
                      onClick={() => dispatch({ type: "complete", id: request.id })}
                    >
                      Complete demo trip
                    </Button>
                  )}
                  {request.status === "completed" && (
                    <div className="mt-4 space-y-3">
                      <p role="status" className="text-sm text-green-700 dark:text-green-400">
                        Completed. This demo trip is now available in company billing.
                      </p>
                      <Button onClick={() => setView("billing")}>Open company billing</Button>
                    </div>
                  )}
                </TripCard>
              )}
            </Panel>
            <Panel title="A clearer handoff to the office">
              <p className="text-muted-foreground">
                Drivers complete the trip and its paperwork. Billing staff review the trip, check
                missing details, and group ready trips into a batch.
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Navigation, signatures, recording, and notifications are not operated by this
                presentation.
              </p>
            </Panel>
          </section>
        )}
        {view === "billing" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {(["EDI", "Robot"] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-xl border p-4 text-left",
                    method === m ? "border-primary bg-primary/10" : "border-border bg-surface",
                  )}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    {m === "EDI" ? <Radio className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    {m} billing
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {m === "EDI" ? "Electronic claim batches" : "State-portal automation"}
                  </span>
                </button>
              ))}
            </div>
            <Panel title="Completed trips → make a batch">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {picked.length} selected · {money(picked.reduce((n, t) => n + t.cents, 0))} ·
                  Illustrative amounts
                </p>
                <Button
                  disabled={!picked.length}
                  onClick={() => {
                    dispatch({ type: "batch", ids: picked.map((t) => t.id), method });
                    setSelected([]);
                  }}
                >
                  Create {method} demo batch
                </Button>
              </div>
              {ready.length ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  {ready.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4"
                    >
                      <input
                        className="mt-1 h-4 w-4"
                        type="checkbox"
                        checked={selected.includes(t.id)}
                        onChange={() =>
                          setSelected((ids) =>
                            ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id],
                          )
                        }
                        aria-label={`Select ${t.passenger}`}
                      />
                      <span>
                        <strong className="block text-sm">{t.passenger}</strong>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t.id} · {t.miles} miles · {t.driver}
                        </span>
                        <span className="mt-2 block font-semibold">{money(t.cents)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  All completed demo trips are in a batch.
                </p>
              )}
            </Panel>
            <Panel title="Demo batches and responses">
              {!state.batches.length ? (
                <p className="text-sm text-muted-foreground">
                  Select completed trips above to create your first batch.
                </p>
              ) : (
                <div className="space-y-3">
                  {state.batches.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
                    >
                      <div>
                        <h3 className="font-semibold">
                          {b.id} · {b.method} billing
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {b.tripIds.length} trips · {money(b.cents)} ·{" "}
                          {b.status === "created"
                            ? "Ready to send (demo)"
                            : b.status === "sent"
                              ? "Sent (simulated)"
                              : "Paid (simulated)"}
                        </p>
                      </div>
                      {b.status === "created" && (
                        <Button onClick={() => dispatch({ type: "send", id: b.id })}>
                          Simulate sending {b.id}
                        </Button>
                      )}
                      {b.status === "sent" && (
                        <Button
                          variant="outline"
                          onClick={() => dispatch({ type: "pay", id: b.id })}
                        >
                          Simulate payment for {b.id}
                        </Button>
                      )}
                      {b.status === "paid" && (
                        <CheckCircle2
                          aria-label="Demo payment recorded"
                          className="h-6 w-6 text-green-600"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                No payer is contacted. Submission and payment responses are simulated, not
                guarantees of claim acceptance or payment.
              </p>
            </Panel>
          </>
        )}
        <footer className="flex flex-wrap justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
          <span>NEMT Solutions · Transport company owner walkthrough</span>
          <a href="/access" className="font-medium text-primary underline">
            Open the real company app
          </a>
        </footer>
      </main>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-soft sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
function Status({ trip }: { trip: DemoTrip }) {
  return (
    <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
      {
        {
          requested: "Requested",
          assigned: "Driver assigned",
          driving: "Trip in progress",
          completed: "Completed",
        }[trip.status]
      }
    </span>
  );
}
function TripCard({ trip, children }: { trip: DemoTrip; children?: ReactNode }) {
  return (
    <article className="rounded-xl border border-border p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{trip.passenger}</h3>
          <p className="text-xs text-muted-foreground">
            {trip.id} · {trip.time}
          </p>
        </div>
        <Status trip={trip} />
      </div>
      <p className="text-sm">{trip.from}</p>
      <p className="mt-1 text-sm text-muted-foreground">→ {trip.to}</p>
      <p className="mt-3 text-xs text-muted-foreground">
        {trip.driver ?? "Unassigned"} · {trip.miles} miles
      </p>
      {children}
    </article>
  );
}
