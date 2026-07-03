import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Pricing } from "@/lib/rideMath";

const DEFAULT: Pricing = { base_fare: 3, per_km: 1.5, per_minute: 0.25, currency: "USD" };

export function usePricing(): Pricing {
  const [p, setP] = useState<Pricing>(DEFAULT);
  useEffect(() => {
    let cancel = false;
    supabase
      .from("pricing_config")
      .select("base_fare,per_km,per_minute,currency")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancel && data)
          setP({
            base_fare: Number(data.base_fare),
            per_km: Number(data.per_km),
            per_minute: Number(data.per_minute),
            currency: data.currency,
          });
      });
    return () => {
      cancel = true;
    };
  }, []);
  return p;
}
