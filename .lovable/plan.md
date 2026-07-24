## Plan

1. **Stop the PDF font failure**
   - The current handwriting font asset pointer is returning `content_type: text/html`, which explains the runtime error `Unknown font format` when `pdf-lib` tries to embed it.
   - Update the PDF generator to avoid the broken custom font dependency and use a safe built-in PDF font for the blue handwritten-style filled values, so PDF creation does not fail because of an asset/font fetch.

2. **Keep the official HCPF PDF form exactly as the base**
   - Continue loading the existing official Colorado HCPF Trip Report template.
   - Keep the previous requirement: do **not** auto-select/fill these official options:
     - Driver verified identity
     - Type of Vehicle
     - Type of Trip
   - Continue auto-filling all other supported official fields and stamping the passenger signature.

3. **Restore the form-fill button immediately after accepting a trip**
   - After a driver accepts a trip, show the trip-report/form action area right away instead of hiding it behind too many status transitions.
   - Keep navigation/arrived actions available, but make the driver able to open the trip form/options as soon as there is an active accepted trip.

4. **Allow manual odometer entry without requiring a photo**
   - Change pickup and drop-off odometer dialogs so the driver can type and save the odometer reading without taking a picture.
   - Keep the camera button next to the odometer field as optional OCR/documentation.
   - If a photo is taken, still upload it and auto-read when possible; if no photo is taken, save only the manual reading.

5. **Make trip completion generate the PDF reliably**
   - Update the completion flow so the saved manual odometer readings are passed into the Medicaid/HCPF finalization.
   - If PDF generation fails, surface a clear operational error, but the implementation should remove the current `Unknown font format` failure path.

6. **Verify**
   - Run the focused PDF generation script/flow to confirm the HCPF PDF renders after removing the broken font path.
   - Inspect the resulting PDF output enough to confirm it is not blank and that filled values/signature placement still appear.