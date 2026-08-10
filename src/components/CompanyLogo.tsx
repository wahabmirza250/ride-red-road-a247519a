import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCompanyBranding } from "@/lib/companyBranding.functions";
import { cn } from "@/lib/utils";

/**
 * Tenant logo shown beside the RedArt mark in staff app headers. Renders
 * nothing until a logo exists, so companies without one look unchanged.
 */
export function CompanyLogo({ className }: { className?: string }) {
  const fetchBranding = useServerFn(getMyCompanyBranding);
  const { data } = useQuery({
    queryKey: ["company_branding"],
    queryFn: () => fetchBranding(),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  if (!data?.logo_url) return null;

  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="h-5 w-px bg-border" />
      <img
        src={data.logo_url}
        alt={`${data.name ?? "Company"} logo`}
        className={cn("h-8 w-auto max-w-[120px] object-contain", className)}
      />
    </span>
  );
}
