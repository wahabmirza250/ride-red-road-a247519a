import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { loadGoogleMaps } from "@/lib/googleMapsLoader";

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

export function AddressAutocomplete({
  value,
  onChange,
  onResolve,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onResolve: (p: ResolvedPlace) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<number | null>(null);
  const skipNextFetchRef = useRef(false);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    if (!value || value.length < 3) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        const g = await loadGoogleMaps();
        const { AutocompleteSuggestion, AutocompleteSessionToken } =
          (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary;
        if (!sessionRef.current) sessionRef.current = new AutocompleteSessionToken();
        const { suggestions: raw } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value,
          sessionToken: sessionRef.current,
        });
        const mapped: Suggestion[] = raw
          .map((s: google.maps.places.AutocompleteSuggestion) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => !!p)
          .map((p) => ({
            placeId: p.placeId,
            primary: p.mainText?.text ?? p.text.text,
            secondary: p.secondaryText?.text ?? "",
          }));
        setSuggestions(mapped);
        setOpen(true);
      } catch (e) {
        console.error("Autocomplete failed", e);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value]);

  async function selectSuggestion(s: Suggestion) {
    try {
      const g = await loadGoogleMaps();
      const { Place } = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary;
      const place = new Place({ id: s.placeId });
      await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
      const loc = place.location;
      if (!loc) throw new Error("No location");
      const full = place.formattedAddress ?? `${s.primary}, ${s.secondary}`;
      skipNextFetchRef.current = true;
      onChange(full);
      onResolve({
        address: full,
        lat: loc.lat(),
        lng: loc.lng(),
        placeId: s.placeId,
      });
      setOpen(false);
      setSuggestions([]);
      sessionRef.current = null;
    } catch (e) {
      console.error("Place details failed", e);
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
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              onMouseDown={(e) => e.preventDefault()}
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
