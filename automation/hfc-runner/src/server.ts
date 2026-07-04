import Fastify from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { submitToPortal } from "./portal.js";

const PORT = Number(process.env.PORT ?? 3000);
const HMAC_SECRET = process.env.HFC_RUNNER_HMAC_SECRET;
if (!HMAC_SECRET) throw new Error("HFC_RUNNER_HMAC_SECRET is required");

const SubmitSchema = z.object({
  run_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  callback_url: z.string().url(),
  member: z.object({
    health_first_id: z.string(),
    full_name: z.string(),
    dob: z.string().nullable().optional(),
  }),
  trip: z.object({
    date: z.string(),
    pickup_address: z.string(),
    dropoff_address: z.string(),
    odometer_start: z.number(),
    odometer_end: z.number(),
    miles: z.number(),
  }),
  signature_url: z.string().url().nullable(),
  evidence_prefix: z.string(),
});
export type SubmitPayload = z.infer<typeof SubmitSchema>;

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

// Parse body as raw text so we can HMAC-verify, then JSON-parse
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  done(null, body);
});

app.get("/health", async () => ({ ok: true }));

app.post("/submit", async (req, reply) => {
  const raw = req.body as string;
  const sigHeader = req.headers["x-hfc-signature"] as string | undefined;
  if (!sigHeader) return reply.code(401).send("missing signature");

  const expected = createHmac("sha256", HMAC_SECRET!).update(raw).digest("hex");
  const a = Buffer.from(sigHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return reply.code(401).send("invalid signature");
  }

  let payload: SubmitPayload;
  try {
    payload = SubmitSchema.parse(JSON.parse(raw));
  } catch (e: any) {
    return reply.code(400).send(`bad payload: ${e.message}`);
  }

  // Kick off async — respond immediately
  reply.code(202).send({ accepted: true, run_id: payload.run_id });

  (async () => {
    try {
      const result = await submitToPortal(payload);
      await postCallback(payload.callback_url, { ...result, run_id: payload.run_id, submission_id: payload.submission_id, evidence_prefix: payload.evidence_prefix });
    } catch (err: any) {
      req.log.error({ err }, "submission failed");
      await postCallback(payload.callback_url, {
        run_id: payload.run_id,
        submission_id: payload.submission_id,
        status: "failed",
        error: err?.message ?? "unknown error",
        evidence_prefix: payload.evidence_prefix,
      });
    }
  })();
});

async function postCallback(url: string, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", HMAC_SECRET!).update(raw).digest("hex");
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hfc-signature": sig },
    body: raw,
  });
}

app.listen({ host: "0.0.0.0", port: PORT }).then(() => {
  app.log.info(`HFC runner listening on :${PORT}`);
});
