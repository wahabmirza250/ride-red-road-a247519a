import { createFileRoute } from "@tanstack/react-router";
import { CommunicationsSettingsCard } from "@/components/comms/CommunicationsSettingsCard";

export const Route = createFileRoute("/$companySlug/_authenticated/communications")({
  head: () => ({
    meta: [
      { title: "Communications — RedArt Dispatch" },
      {
        name: "description",
        content:
          "Configure your company's dispatch text number, messaging provider status, and automatic rider notifications.",
      },
      { property: "og:title", content: "Communications — RedArt Dispatch" },
      {
        property: "og:description",
        content: "Dispatch texting setup and rider notification controls for your company.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommunicationsPage,
});

function CommunicationsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Communications</h1>
        <p className="text-sm text-muted-foreground">
          Your dispatch text number, provider status, and the events that automatically text riders.
        </p>
      </header>
      <CommunicationsSettingsCard />
    </div>
  );
}
