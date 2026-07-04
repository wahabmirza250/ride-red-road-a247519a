import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const cache = new Map<string, { url: string; expires: number }>();

export function useSignedUrl(bucket: string, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const key = `${bucket}/${path}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) {
      setUrl(hit.url);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (cancelled || !data?.signedUrl) return;
        cache.set(key, { url: data.signedUrl, expires: now + 3500_000 });
        setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);
  return url;
}

export async function getSignedUrl(bucket: string, path: string) {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
