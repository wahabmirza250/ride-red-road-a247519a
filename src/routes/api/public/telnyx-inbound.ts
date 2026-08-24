import { createFileRoute } from "@tanstack/react-router";

/**
 * Telnyx messaging webhook (inbound SMS + delivery receipts).
 *
 * Configure this URL on the Telnyx Messaging Profile:
 *   https://<your-domain>/api/public/telnyx-inbound
 *
 * Security: every request must carry a valid Ed25519 `telnyx-signature-ed25519`
 * header verified against TELNYX_PUBLIC_KEY, with a 5 minute replay window.
 * Unsigned or unverifiable requests are rejected with 401 and nothing is written.
 *
 * Behaviour: the message is routed to the company that owns the receiving
 * number, linked to a passenger when the sender is recognised, and always landed
 * in the dispatch inbox. An unknown sender creates a `needs_review` thread —
 * a webhook never creates a trip.
 */
export const Route = createFileRoute("/api/public/telnyx-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        const { verifyTelnyxSignature } = await import("@/lib/comms/telnyx.server");
        const verified = await verifyTelnyxSignature({
          rawBody,
          signature: request.headers.get("telnyx-signature-ed25519"),
          timestamp: request.headers.get("telnyx-timestamp"),
        });
        if (!verified.ok) {
          console.warn(`[telnyx-inbound] rejected: ${verified.reason}`);
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { parseTelnyxInbound, parseTelnyxStatus } = await import("@/lib/comms/core");
        const { createCommsDeps } = await import("@/lib/comms/store.server");
        const deps = createCommsDeps();

        // Delivery receipt for one of our outbound messages.
        const receipt = parseTelnyxStatus(payload);
        if (receipt) {
          const existing = await deps.findMessageByProviderId("telnyx", receipt.providerMessageId);
          if (existing) {
            await deps.updateMessage(existing.id, {
              status: receipt.status,
              error_message: receipt.error ?? null,
              ...(receipt.status === "delivered"
                ? { delivered_at: new Date().toISOString() }
                : {}),
            });
          }
          return Response.json({ ok: true, handled: "status" });
        }

        const inbound = parseTelnyxInbound(payload);
        if (!inbound) return Response.json({ ok: true, handled: "ignored" });

        const { recordInboundSms } = await import("@/lib/comms/engine");
        const result = await recordInboundSms(deps, inbound);

        if (result.status === "recorded" && result.companyId) {
          try {
            const { notifyDispatchers } = await import("@/lib/notifyStaff.server");
            await notifyDispatchers({
              kind: "sms_inbound",
              title: result.known ? "New text from a passenger" : "New text — unknown number",
              body: `${inbound.from}: ${inbound.body.slice(0, 160)}`,
              url: "/dispatch",
              companyId: result.companyId,
              data: {
                conversation_id: result.conversationId,
                phone: result.known ? inbound.from : inbound.from,
                needs_review: !result.known,
              },
            });
          } catch (e) {
            console.warn("[telnyx-inbound] staff alert failed", e);
          }
        }

        if (result.status === "unrouted") {
          console.warn(`[telnyx-inbound] no company owns ${inbound.to}`);
        }

        // Always 200 for verified webhooks so Telnyx does not hot-retry;
        // routing problems are logged and visible in the dispatch inbox.
        return Response.json({ ok: result.ok, handled: result.status });
      },
    },
  },
});
