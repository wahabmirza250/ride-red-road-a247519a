import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { verifyPassengerIdentity, type VerifyResult } from "@/lib/medicaidVerify.functions";

type Props = {
  passengerId: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
  label?: string;
};

/**
 * READ-ONLY Medicaid ID verification. Available to drivers (for their
 * current passenger) and admins/dispatchers (any passenger). Never triggers
 * a billing claim submission.
 */
export function VerifyMedicaidButton({
  passengerId,
  variant = "outline",
  size = "sm",
  className,
  label = "Verify Medicaid ID",
}: Props) {
  const verify = useServerFn(verifyPassengerIdentity);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const r = await verify({ data: { passenger_id: passengerId } });
      setResult(r);
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

  return (
    <div className={cn("space-y-2", className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={run}
        disabled={loading || !passengerId}
        className="rounded-full"
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1.5 h-4 w-4" />
        )}
        {label}
      </Button>
      {loading && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
        >
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <div className="space-y-0.5">
            <div className="font-medium">Checking with Colorado Medicaid…</div>
            <div className="text-[11px] text-muted-foreground">
              This usually takes 1–3 minutes. Keep this screen open — it's working.
            </div>
          </div>
        </div>
      )}
      {result && <VerifyResultCard result={result} />}
    </div>
  );
}

/**
 * Shared result presentation, so every verification entry point (in-trip
 * button, home-screen tool, manual entry) renders an identical outcome.
 */
export function VerifyResultCard({ result }: { result: VerifyResult }) {
  const tone =
    result.status === "matched" || result.status === "found"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : result.status === "fuzzy"
        ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : result.status === "no_match" || result.status === "not_found"
          ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
          : result.status === "unconfigured"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";

  const Icon =
    result.status === "matched" || result.status === "found"
      ? CheckCircle2
      : result.status === "no_match" || result.status === "not_found"
        ? XCircle
        : AlertTriangle;

  return (
    <div
      role="status"
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", tone)}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="space-y-0.5">
        <div className="font-medium">{result.message}</div>
        {result.medicaid_id && (
          <div className="text-[11px] opacity-80">HFC ID: {result.medicaid_id}</div>
        )}
        <div className="text-[11px] opacity-70">
          {result.source === "local"
            ? "Matched instantly from our own records. "
            : result.source === "portal"
              ? "Checked live with the state portal. "
              : ""}
          Checked using{" "}
          {result.used_identifier === "medicaid_id"
            ? "Medicaid ID"
            : result.used_identifier === "ssn_dob"
              ? "SSN + DOB"
              : "no identifier"}
          . Read-only — no claim submitted.
        </div>
      </div>
    </div>
  );
}

