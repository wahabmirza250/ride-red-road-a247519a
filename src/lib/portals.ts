// Known billing portals. Add new entries here as we onboard more states.
// `id` must be stable — it is stored on state_portal_credentials.portal_id
// and referenced by billing_settings.default_portal_id.

export type PortalDef = {
  id: string;
  name: string;
  state: string;
};

export const PORTALS: PortalDef[] = [
  { id: "intelliride-colorado", name: "IntelliRide", state: "CO" },
  { id: "hfc-colorado", name: "Colorado Health First", state: "CO" },
  { id: "modivcare-colorado", name: "ModivCare", state: "CO" },
  { id: "medtrans-texas", name: "MedTrans", state: "TX" },
];

export function getPortal(id: string | null | undefined): PortalDef | undefined {
  if (!id) return undefined;
  return PORTALS.find((p) => p.id === id);
}
