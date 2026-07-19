import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { autocompletePlaces, getPlaceDetails } from "@/lib/places.functions";

export type ResolvedPlace = {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
};

type Suggestion = {
  placeId: string;
  primary: string;
  secondary: string;
};

// Generate a client-side session token (uuid-ish) so all autocomplete
// requests for a single lookup are billed as one Places session.
function newSessionToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AddressAutocomplete({
  value,
  onChange,
  onResolve,
  onSubmit,
  placeholder,
  className,
  autoFocus,
  biasLat,
  biasLng,
  regionCode = "us",
}: {
  value: string;
  onChange: (v: string) => void;
  onResolve: (p: ResolvedPlace) => void;
  onSubmit?: (raw: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  biasLat?: number;
  biasLng?: number;
  regionCode?: string;
}) {

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const skipNextFetchRef = useRef(false);
  const reqIdRef = useRef(0);

  const runAutocomplete = useServerFn(autocompletePlaces);
  const runPlaceDetails = useServerFn(getPlaceDetails);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    if (!value || value.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        setLoading(true);
        if (!sessionRef.current) sessionRef.current = newSessionToken();
        const result = await runAutocomplete({
          data: { input: value.trim(), sessionToken: sessionRef.current },
        });
        if (myReq !== reqIdRef.current) return; // stale
        setSuggestions(result);
        setOpen(result.length > 0);
      } catch (e) {
        if (myReq === reqIdRef.current) {
          console.error("Autocomplete failed", e);
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, runAutocomplete]);

  async function selectSuggestion(s: Suggestion) {
    try {
      const details = await runPlaceDetails({
        data: { placeId: s.placeId, sessionToken: sessionRef.current ?? undefined },
      });
      const full = details?.address ?? `${s.primary}${s.secondary ? `, ${s.secondary}` : ""}`;
      skipNextFetchRef.current = true;
      onChange(full);
      if (details) {
        onResolve({
          address: full,
          lat: details.lat,
          lng: details.lng,
          placeId: details.placeId,
        });
      } else if (onSubmit) {
        onSubmit(full);
      }
      setOpen(false);
      setSuggestions([]);
      sessionRef.current = null;
    } catch (e) {
      console.error("Place details failed", e);
      // Fall back to raw text submit so the user is never stuck.
      if (onSubmit) onSubmit(`${s.primary}${s.secondary ? `, ${s.secondary}` : ""}`);
    }
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Start typing an address…"}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        autoFocus={autoFocus}
        enterKeyHint="search"
        inputMode="search"
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (suggestions[0]) {
            void selectSuggestion(suggestions[0]);
          } else if (onSubmit && value.trim()) {
            onSubmit(value.trim());
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
            >
              <div className="font-medium">{s.primary}</div>
              {s.secondary && (
                <div className="text-xs text-muted-foreground">{s.secondary}</div>
              )}
            </button>
          ))}
        </div>
      )}
      {loading && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          …
        </div>
      )}
    </div>
  );
}
