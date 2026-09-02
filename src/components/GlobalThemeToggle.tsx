import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function GlobalThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="global-theme-toggle fixed bottom-4 right-4 z-[70] grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-soft backdrop-blur transition hover:bg-accent"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
