import mark from "@/assets/redart-mark.png.asset.json";
import wordmark from "@/assets/redart-wordmark.png.asset.json";
import { cn } from "@/lib/utils";

/** Square RedArt logo tile — use for favicons, avatars, collapsed sidebars, mobile bars. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={mark.url}
      alt="RedArt LLC"
      className={cn("h-9 w-9 rounded-xl object-contain shadow-soft", className)}
    />
  );
}

/** Horizontal RedArt wordmark — use in expanded sidebar headers and marketing surfaces. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <img
      src={wordmark.url}
      alt="RedArt LLC"
      className={cn("h-9 w-auto object-contain", className)}
    />
  );
}
