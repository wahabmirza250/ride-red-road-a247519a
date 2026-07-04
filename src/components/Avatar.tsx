import { useSignedUrl } from "@/lib/signedUrl";
import { cn } from "@/lib/utils";

export function Avatar({
  path,
  name,
  size = 40,
  className,
}: {
  path?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const url = useSignedUrl("avatars", path ?? null);
  const initials =
    (name ?? "")
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0]!.toUpperCase())
      .slice(0, 2)
      .join("") || "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt={name ?? ""} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
