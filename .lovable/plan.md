No code changes needed — this was a test-and-report task.

## Results

| URL | Status | Body |
|---|---|---|
| `https://redartdigital.com/...` | timeout (no response in 20s) | — |
| `https://www.redartdigital.com/...` | **400** | `{"error":"provider_id must be a UUID"}` |
| `https://ride-red-road.lovable.app/...` | **400** | `{"error":"provider_id must be a UUID"}` |

## Interpretation

- The API key `rbt_32e9…2a44f` is **valid and active** — the request passed the `X-API-Key` check and reached input validation.
- 400 is the correct response for `provider_id=test` (not a UUID).
- The apex domain `redartdigital.com` does not respond; only `www.redartdigital.com` is wired up. Separate DNS/custom-domain issue if you want the bare apex to work.

## Next step (optional)

Re-run with a real provider UUID to verify a live lookup, e.g.:
`curl -H "X-API-Key: rbt_…" "https://www.redartdigital.com/api/public/get-billing-rate?provider_id=<REAL-UUID>&vehicle_type=ambulatory"`

Approve if you'd like me to run that with a specific provider UUID; otherwise nothing to implement.