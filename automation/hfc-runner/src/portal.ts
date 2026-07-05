import { chromium, type Page } from "playwright";
import type { SubmitPayload } from "./server.js";

const PORTAL_URL = process.env.HFC_PORTAL_URL!;
const USERNAME = process.env.HFC_PORTAL_USERNAME!;
const PASSWORD = process.env.HFC_PORTAL_PASSWORD!;

/**
 * Drives the Health First Colorado provider portal to submit one NEMT claim.
 *
 * The exact selectors below are placeholders — calibrate them against the
 * real portal once, then this function stays stable across trips. When the
 * state changes their UI, only this file needs a patch + redeploy.
 */
export async function submitToPortal(p: SubmitPayload): Promise<{
  status: "submitted" | "failed" | "needs_mfa";
  confirmation?: string | null;
  error?: string | null;
  mfa_prompt?: string | null;
}> {
  if (!PORTAL_URL) throw new Error("HFC_PORTAL_URL not set");
  if (!USERNAME || !PASSWORD) throw new Error("HFC_PORTAL_USERNAME/PASSWORD not set");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  const shots: Buffer[] = [];
  const snap = async (label: string) => {
    const buf = await page.screenshot({ fullPage: false });
    shots.push(buf);
    console.log(`[${p.run_id}] ${label} — ${page.url()}`);
  };

  try {
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });
    await snap("login page");

    // --- LOGIN --- (calibrate selectors)
    await page.fill('input[name="username"], input[type="email"]', USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    await Promise.all([
      page.click('button[type="submit"], input[type="submit"]'),
      page.waitForLoadState("domcontentloaded"),
    ]);
    await snap("after login");

    // --- MFA DETECTION ---
    const mfaLocator = page.locator('input[name="mfa"], input[name="otp"], [data-testid="mfa"]');
    if (await mfaLocator.first().isVisible().catch(() => false)) {
      const prompt = (await page.locator("body").innerText()).slice(0, 200);
      await browser.close();
      return { status: "needs_mfa", mfa_prompt: prompt };
    }

    // --- NAVIGATE TO NEMT CLAIM ENTRY --- (calibrate)
    await page.getByRole("link", { name: /nemt|trip log/i }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await snap("nemt entry");

    // --- FILL CLAIM FIELDS --- (calibrate)
    await page.fill('input[name="memberId"]', p.member.health_first_id);
    await page.fill('input[name="memberName"]', p.member.full_name);
    await page.fill('input[name="tripDate"]', new Date(p.trip.date).toISOString().slice(0, 10));
    await page.fill('input[name="pickupAddress"]', p.trip.pickup_address);
    await page.fill('input[name="dropoffAddress"]', p.trip.dropoff_address);
    await page.fill('input[name="odometerStart"]', String(p.trip.odometer_start));
    await page.fill('input[name="odometerEnd"]', String(p.trip.odometer_end));
    await page.fill('input[name="miles"]', String(p.trip.miles));

    // Attach the pre-filled state PDF (required by the portal). Falls back to
    // signature-only if the portal exposes a separate signature file input.
    const pdfBuf = Buffer.from(await (await fetch(p.pdf_url)).arrayBuffer());
    const pdfInput = page
      .locator('input[type="file"][name*="trip"], input[type="file"][name*="pdf"], input[type="file"][accept*="pdf"], input[type="file"]')
      .first();
    if (await pdfInput.count()) {
      await pdfInput.setInputFiles({
        name: "nemt-trip-log.pdf",
        mimeType: "application/pdf",
        buffer: pdfBuf,
      });
    }

    if (p.signature_url) {
      const sigBuf = Buffer.from(await (await fetch(p.signature_url)).arrayBuffer());
      const sigInput = page.locator('input[type="file"][name*="signature"]').first();
      if (await sigInput.count()) {
        await sigInput.setInputFiles({
          name: "signature.png",
          mimeType: "image/png",
          buffer: sigBuf,
        });
      }
    }
    await snap("form filled");

    // --- SUBMIT ---
    await Promise.all([
      page.click('button[type="submit"], button:has-text("Submit")'),
      page.waitForLoadState("networkidle"),
    ]);
    await snap("after submit");

    // --- CAPTURE CONFIRMATION --- (calibrate)
    const confirmation = await extractConfirmation(page);
    await browser.close();
    if (!confirmation) return { status: "failed", error: "No confirmation number found on submit page" };
    return { status: "submitted", confirmation };
  } catch (err: any) {
    await snap("error").catch(() => {});
    await browser.close().catch(() => {});
    return { status: "failed", error: err?.message ?? String(err) };
  }
}

async function extractConfirmation(page: Page): Promise<string | null> {
  // Try common patterns; adapt to real portal
  const text = await page.locator("body").innerText();
  const m = text.match(/confirmation[^\w]*([A-Z0-9-]{6,})/i);
  return m?.[1] ?? null;
}
