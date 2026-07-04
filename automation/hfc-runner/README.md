# HFC Runner — Colorado Health First NEMT auto-billing

Standalone Node service that logs into the Health First Colorado provider
portal, uploads a signed NEMT Trip Report PDF, and returns the confirmation
number to the Lovable app.

**This runs OUTSIDE the Lovable Cloudflare Worker** because it needs
Chromium (via Playwright) and long-running requests. Deploy it to Fly.io,
Railway, Render, or any Node VPS with 1 GB+ RAM.

## Endpoints

### `POST /submit`

Called by the Lovable app after an admin clicks **Send to portal**.

Headers:
- `x-hfc-signature`: HMAC-SHA256 hex of the raw JSON body, using
  `HFC_RUNNER_HMAC_SECRET`.

Body (JSON):
```json
{
  "run_id": "uuid",
  "submission_id": "uuid",
  "callback_url": "https://<your-app>/api/public/hfc-callback",
  "member": { "health_first_id": "...", "full_name": "...", "dob": "YYYY-MM-DD" },
  "trip": {
    "date": "ISO8601",
    "pickup_address": "...", "dropoff_address": "...",
    "odometer_start": 12345, "odometer_end": 12360, "miles": 15
  },
  "signature_url": "https://... (signed URL to PNG, 15 min TTL)",
  "evidence_prefix": "<trip-id>/<run-id>"
}
```

Response: `202 Accepted` immediately. Actual submission happens async
and posts back to `callback_url`.

### Callback back to Lovable

`POST {callback_url}` with same HMAC signature and body:

```json
{
  "run_id": "uuid",
  "submission_id": "uuid",
  "status": "submitted" | "failed" | "needs_mfa",
  "confirmation": "STATE-CONF-12345",
  "mfa_prompt": "Enter code sent to ***-***-1234",
  "error": null,
  "evidence_prefix": "<trip-id>/<run-id>"
}
```

## Environment variables

| Name | Description |
| --- | --- |
| `HFC_RUNNER_HMAC_SECRET` | MUST match the Lovable secret of the same name. |
| `HFC_PORTAL_URL` | Login URL for the Health First provider portal. |
| `HFC_PORTAL_USERNAME` | Admin credential (never leaves the runner). |
| `HFC_PORTAL_PASSWORD` | Admin credential. |
| `PORT` | HTTP port, default 3000. |

## Deploy (Fly.io — fastest path)

```bash
cd automation/hfc-runner
fly launch --no-deploy         # creates fly.toml
fly secrets set HFC_RUNNER_HMAC_SECRET=... HFC_PORTAL_URL=... \
                HFC_PORTAL_USERNAME=... HFC_PORTAL_PASSWORD=...
fly deploy
# copy the resulting https://<app>.fly.dev URL into Lovable secret HFC_RUNNER_URL
```

## Safety

- Nothing is submitted without the Lovable admin clicking **Send to portal**
  (human review already happened at Approve).
- Every step is screenshotted; upload the screenshots to your evidence store
  in the callback for a full audit trail.
- Credentials never round-trip through the browser or the Lovable app.
- HMAC signature prevents forged requests in either direction.

## Calibrating for portal changes

Selectors in `src/portal.ts` are the only thing that changes when the state
tweaks their UI. Update them and redeploy; no Lovable app change needed.
