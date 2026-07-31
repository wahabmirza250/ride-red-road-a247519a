import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

/**
 * Labelled address input with Google Places suggestions.
 * Drop-in replacement for a plain <Input>/<Textarea> bound to an address string.
 */
export function AddressField({
  label,
  value,
  onChange,
  placeholder = "Start typing an address…",
  className,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      {label && <Label>{label}</Label>}
      <AddressAutocomplete
        value={value}
        onChange={onChange}
        onResolve={(p) => onChange(p.address)}
        placeholder={placeholder}
      />
    </div>
  );
}
