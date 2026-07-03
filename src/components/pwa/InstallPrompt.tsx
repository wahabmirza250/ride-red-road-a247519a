import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (!evt || hidden) return null;
  return (
    <div className="fixed inset-x-3 bottom-20 z-40 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lift backdrop-blur md:left-auto md:right-4 md:w-96">
      <div className="text-sm">
        <div className="font-semibold">Install app</div>
        <div className="text-xs text-muted-foreground">Add to home screen for a native feel.</div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="rounded-full"
          onClick={async () => {
            await evt.prompt();
            setEvt(null);
          }}
        >
          <Download className="mr-1 h-3.5 w-3.5" /> Install
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
          Later
        </Button>
      </div>
    </div>
  );
}
