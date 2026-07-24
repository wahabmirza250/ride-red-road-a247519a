## Plan

1. **Restore the full driver trip-report form**
   - Replace the small odometer-only “Fill form” dialog with a full HCPF-style trip report dialog available immediately after the driver accepts a trip.
   - Pre-fill the form from the ride: passenger/member info, pickup/drop-off addresses, automatic date, automatic pickup/drop-off times when available, driver name, plate/VIN, and odometer values.
   - Keep the official form options visible and editable: identity verification, vehicle type, trip type, escort signer, leg 1/leg 2 details.
   - Keep odometer photo optional; manual odometer entry remains allowed.

2. **Persist the driver’s editable form before completion**
   - Add a small backend-backed draft record for the dispatch trip report so the driver can review/change fields without losing them on refresh.
   - Secure it so only the assigned driver and admins can access it.
   - Use the draft as the source of truth when the trip is completed.

3. **Fix finalization and PDF generation**
   - Update `finalizeMedicaidFromDispatchTrip` so it uses the saved driver-reviewed form values instead of only the raw dispatch trip fields.
   - Ensure `medicaid_trip_legs` are updated every time finalization runs, not only on first insert, so retries/regeneration don’t keep stale or blank leg data.
   - Generate and upload the HCPF PDF after signature completion, then save `state_pdf_path` and `state_pdf_generated_at`.
   - Preserve the official PDF template exactly; the app will fill the official fields/options based on the driver-reviewed form.

4. **Make PDFs visible and downloadable in admin/billing**
   - In Admin Trips detail, keep a clear **View / Download HCPF PDF** action for completed trips.
   - In Medicaid Billing, show a real action even when `state_pdf_path` is missing: **Generate PDF** / **View PDF**, instead of just `—`.
   - In the billing detail sheet, make PDF regeneration prominent whenever a signature exists.

5. **Prevent the HTML error-page PDF problem**
   - Validate that any preview/download response is actually a PDF before showing it.
   - If the URL returns an app error page or missing-file response, show a clear “Regenerate PDF” action instead of rendering the HTML text.

6. **Test the full flow**
   - Complete one trip as a driver using manual odometer entry only.
   - Confirm the completed trip creates/updates `medicaid_trips`, creates a `billing_records` row, generates a stored PDF, and displays it in Admin Trips and Medicaid Billing.
   - Open/download the PDF and verify the official form layout, filled addresses, automatic date/time, editable driver choices, and signature are present.