import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getRobotApiKey,
  rotateRobotApiKey,
} from "@/lib/robotApiKey.functions";

function maskKey(key: string): string {
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 6)}${"•".repeat(Math.max(8, key.length - 10))}${key.slice(-4)}`;
}

export function RobotApiKeyCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getRobotApiKey);
  const rotateFn = useServerFn(rotateRobotApiKey);
  const [revealed, setRevealed] = useState(false);

  const query = useQuery({
    queryKey: ["robot_api_key"],
    queryFn: () => getFn(),
  });

  const rotate = useMutation({
    mutationFn: () => rotateFn(),
    onSuccess: () => {
      toast.success("New API key generated");
      setRevealed(true);
      qc.invalidateQueries({ queryKey: ["robot_api_key"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async () => {
    if (!query.data?.api_key) return;
    try {
      await navigator.clipboard.writeText(query.data.api_key);
      toast.success("API key copied to clipboard");
    } catch {
      toast.error("Could not copy — clipboard not available");
    }
  };

  const key = query.data?.api_key ?? "";
  const display = key ? (revealed ? key : maskKey(key)) : "";

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <KeyRound className="h-4 w-4" /> Robot API Key
          </h2>
          <p className="text-xs text-muted-foreground">
            Used by external systems to call{" "}
            <code className="rounded bg-muted px-1">/api/public/get-billing-rate</code>{" "}
            via the <code className="rounded bg-muted px-1">X-API-Key</code> header.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={rotate.isPending}
          onClick={() => {
            if (
              key &&
              !confirm("Generate a new key? The current key will stop working immediately.")
            )
              return;
            rotate.mutate();
          }}
        >
          {rotate.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          {key ? "Rotate key" : "Generate key"}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !key ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No API key yet. Click <span className="font-medium text-foreground">Generate key</span> to create one.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
            <code className="flex-1 truncate font-mono text-sm">{display}</code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? "Hide key" : "Reveal key"}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={copy}
              aria-label="Copy key"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Created {new Date(query.data!.created_at).toLocaleString()}. Store it securely — anyone with this key can call the billing rate endpoint.
          </p>
        </div>
      )}
    </div>
  );
}
