import { Button } from "@/components/ui/button";
export function QueryNotice({
  query,
  label,
}: {
  query: { isError: boolean; isPending?: boolean; dataUpdatedAt?: number; refetch: () => unknown };
  label: string;
}) {
  if (!query.isError) return null;
  return (
    <div
      role="alert"
      className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <span>
        {label} could not be refreshed.
        {query.dataUpdatedAt
          ? ` Showing the last update from ${new Date(query.dataUpdatedAt).toLocaleTimeString()}.`
          : " Data is unavailable."}
      </span>
      <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
        Retry
      </Button>
    </div>
  );
}
