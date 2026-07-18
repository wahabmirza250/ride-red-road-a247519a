import { useSignedUrl } from "@/lib/signedUrl";
import { cn } from "@/lib/utils";

export function Avatar({
  path,
  bucket = "avatars",
  fallbackPath,
  fallbackBucket = "avatars",
  name,
  size = 40,
  className,
}: {
  path?: string | null;
  bucket?: string;
  fallbackPath?: string | null;
  fallbackBucket?: string;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const primaryUrl = useSignedUrl(bucket, path ?? null);
  const fallbackUrl = useSignedUrl(fallbackBucket, fallbackPath ?? null);
  const url = primaryUrl ?? fallbackUrl;
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
