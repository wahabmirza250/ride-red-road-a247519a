import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldCheck,
  Loader2,
  Search,
  Keyboard,
  UserRound,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VerifyMedicaidButton, VerifyResultCard } from "@/components/VerifyMedicaidButton";
import {
  listVerifiablePassengers,
  verifyMedicaidIdAdHoc,
  type KnownPassenger,
  type VerifyResult,
} from "@/lib/medicaidVerify.functions";

type Mode = "saved" | "manual";

/**
 * Standalone READ-ONLY Medicaid check for the driver home screen — usable any
 * time, with or without an assigned trip. Reuses the exact same verification
 * server function as the in-trip button; nothing here blocks any workflow.
 */
export function VerifyMedicaidCard() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("saved");

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">Verify Medicaid ID</span>
          <span className="block text-xs text-muted-foreground">
            Read-only check — anytime, no trip needed
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <div className="flex gap-2">
            <ModeTab active={mode === "saved"} onClick={() => setMode("saved")} icon={UserRound}>
              My passengers
            </ModeTab>
            <ModeTab active={mode === "manual"} onClick={() => setMode("manual")} icon={Keyboard}>
              Enter manually
            </ModeTab>
          </div>
          {mode === "saved" ? <SavedPassengerPicker /> : <ManualEntry />}
        </div>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof UserRound;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-surface-muted text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function SavedPassengerPicker() {
  const list = useServerFn(listVerifiablePassengers);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<KnownPassenger[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<KnownPassenger | null>(null);

  async function run(search: string) {
    setLoading(true);
    setSelected(null);
    try {
      setRows((await list({ data: { search } })) as KnownPassenger[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(term);
        }}
      >
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name or Medicaid ID"
          className="h-9"
        />
        <Button type="submit" size="sm" variant="outline" className="rounded-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>

      {rows === null && !loading && (
        <p className="text-xs text-muted-foreground">
          Search, or press the button to list your recent passengers.
        </p>
      )}
      {rows?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No passengers found. Use “Enter manually” instead.
        </p>
      )}

      {!selected &&
        rows?.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelected(p)}
            className="flex w-full items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-left transition hover:bg-accent"
          >
            <span>
              <span className="block text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">
                {p.medicaid_id || "no HFC ID"}
              </span>
            </span>
            <span className="text-xs font-medium text-primary">Select</span>
          </button>
        ))}

      {selected && (
        <div className="space-y-2 rounded-xl bg-surface-muted px-3 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{selected.name}</div>
              <div className="text-xs text-muted-foreground">
                {selected.medicaid_id || "no HFC ID"}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Change
            </Button>
          </div>
          <VerifyMedicaidButton passengerId={selected.id} />
        </div>
      )}
    </div>
  );
}

function ManualEntry() {
  const verify = useServerFn(verifyMedicaidIdAdHoc);
  const [medicaidId, setMedicaidId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      setResult(
        (await verify({
          data: { medicaid_id: medicaidId, expected_name: name },
        })) as VerifyResult,
      );
    } catch (e) {
      setResult({
        status: "error",
        message: e instanceof Error ? e.message : "Verification failed",
        used_identifier: "none",
      });
    } finally {
      setLoading(false);
    }
  }

  const ready = medicaidId.trim().length > 0 && name.trim().length > 0;

  return (
    <div className="space-y-2">
      <Input
        value={medicaidId}
        onChange={(e) => setMedicaidId(e.target.value)}
        placeholder="Medicaid ID (e.g. M964077)"
        className="h-9"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Expected name (first last)"
        className="h-9"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={!ready || loading}
        onClick={run}
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1.5 h-4 w-4" />
        )}
        Verify Medicaid ID
      </Button>
      {result && <VerifyResultCard result={result} />}
    </div>
  );
}
