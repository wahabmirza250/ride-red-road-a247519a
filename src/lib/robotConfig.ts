/**
 * Legacy single-service robot endpoint.
 *
 * Kept in its own leaf module (no imports) so the fleet layer can read it
 * without importing `billingHelpers`, which imports the fleet back. Value and
 * behaviour are byte-for-byte what `billingHelpers` exported before.
 */
export const ROBOT_BASE_URL =
  "https://redart-hcpf-automation-production.up.railway.app";
