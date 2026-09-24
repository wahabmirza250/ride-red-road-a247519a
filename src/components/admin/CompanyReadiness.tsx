import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBillingSetupStatus } from "@/lib/billingSetup.functions";
import { getCommSettings } from "@/lib/comms.functions";
import { AppLink } from "@/lib/appLink";
import { QueryNotice } from "./QueryNotice";
export function CompanyReadiness() {
  const billingFn = useServerFn(getBillingSetupStatus);
  const commFn = useServerFn(getCommSettings);
  const billing = useQuery({ queryKey: ["billing_setup_status"], queryFn: () => billingFn() });
  const comm = useQuery({ queryKey: ["comm_settings"], queryFn: () => commFn() });
  return (
    <section className="rounded-2xl border bg-surface p-5">
      <h2 className="text-lg font-semibold">Company readiness</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Set up each service before relying on it for daily work.
      </p>
      <QueryNotice query={billing} label="Billing readiness" />
      <QueryNotice query={comm} label="Messaging readiness" />
      <div className="grid gap-3 sm:grid-cols-2">
        {billing.data?.steps.map((step) => (
          <AppLink
            key={step.key}
            to="/medicaid-billing/hcpf"
            search={{ tab: "settings" }}
            className="rounded-xl border p-3"
          >
            <h3 className="font-medium">
              {step.title} · {step.done ? "Configured" : "Needs setup"}
            </h3>
            <p className="text-sm text-muted-foreground">{step.detail}</p>
          </AppLink>
        ))}
        <AppLink to="/communications" className="rounded-xl border p-3">
          <h3 className="font-medium">
            Text messaging ·{" "}
            {comm.isPending
              ? "Checking"
              : comm.isError
                ? "Unavailable"
                : comm.data?.credentials_ready &&
                    comm.data?.signing_ready &&
                    comm.data?.sms_from_number &&
                    comm.data?.sms_enabled
                  ? "Configured"
                  : "Needs setup"}
          </h3>
          <p className="text-sm text-muted-foreground">
            Provider credentials, webhook signing and a sending number are required. Open messaging
            settings.
          </p>
        </AppLink>
        <AppLink to="/drivers" className="rounded-xl border p-3">
          <h3 className="font-medium">Driver tablets and cameras</h3>
          <p className="text-sm text-muted-foreground">
            Review online status, permission and video connection for each vehicle.
          </p>
        </AppLink>
        <AppLink to="/live-ops" className="rounded-xl border p-3">
          <h3 className="font-medium">Maps and driver location</h3>
          <p className="text-sm text-muted-foreground">
            GPS is current for 90 seconds. If Google rejects this address, an alternate map is
            shown.
          </p>
        </AppLink>
        <AppLink to="/team" className="rounded-xl border p-3">
          <h3 className="font-medium">Team and app access</h3>
          <p className="text-sm text-muted-foreground">
            Manage company roles and driver/passenger app links.
          </p>
        </AppLink>
      </div>
    </section>
  );
}
