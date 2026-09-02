import { cn } from "@/lib/utils";

const MARK_LIGHT = "/brand/nemt-box-logo.png";
const MARK_DARK = "/brand/nemt-box-logo-dark.png";
const WORDMARK_LIGHT = "/brand/nemt-logo.png";
const WORDMARK_DARK = "/brand/nemt-logo-dark.png";

function ThemeLogo({
  light,
  dark,
  alt,
  className,
}: {
  light: string;
  dark: string;
  alt: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      <img src={light} alt={alt} className="h-full w-full object-contain dark:hidden" />
      <img src={dark} alt="" aria-hidden className="hidden h-full w-full object-contain dark:block" />
    </span>
  );
}

/** Compact boxed logo — favicons, app rails, mobile bars and tight in-app spaces. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <ThemeLogo
      light={MARK_LIGHT}
      dark={MARK_DARK}
      alt="NEMT Solutions"
      className={cn("h-9 w-9", className)}
    />
  );
}

/** Horizontal logo — marketing, sign-in and wide header surfaces. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <ThemeLogo
      light={WORDMARK_LIGHT}
      dark={WORDMARK_DARK}
      alt="NEMT Solutions"
      className={cn("h-9 aspect-[2015/464]", className)}
    />
  );
}
