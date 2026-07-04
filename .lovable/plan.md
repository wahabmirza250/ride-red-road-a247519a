Plan to fix the driver workflow:

1. Use the admin-assigned trip addresses in the NEMT form
- Add a “Trip report” action on the driver’s active assigned ride.
- Open `/driver/trip/new` with the active trip id.
- In the NEMT wizard, load that assigned trip and prefill:
  - Leg 1 pickup address = assigned pickup
  - Leg 1 drop-off address = assigned drop-off
  - Passenger/rider info when it can be matched
- For round trip, auto-fill the return leg in reverse:
  - Return pickup = original drop-off
  - Return drop-off = original pickup
- Drivers can still edit addresses if dispatch/admin made a mistake.

2. Fix signature so “Next” works without confusion
- Remove the fragile “draw then press Capture” requirement.
- Use the working in-house signature pad component that saves the signature automatically when the rider finishes signing.
- Keep a Clear button.
- Show clear validation text if a signature is missing, instead of silently disabling Next.
- Make the Next button clickable once every selected rider has a saved signature.

3. Improve step validation
- Validate each step before moving forward.
- If something is missing, show exactly what needs attention: vehicle, rider, address, odometer, or signature.
- Prevent the user from being stuck on a disabled button with no explanation.

4. Add optional odometer photo auto-detect
- Yes, it is possible.
- Add an optional camera/photo input beside each pickup and drop-off odometer field.
- Driver can take a photo of the odometer.
- The app will try to detect the number automatically and fill the odometer field.
- Driver must be able to review and edit the detected number before submitting.
- If detection fails, the driver can still type the number manually.
- This stays optional so the form can always be completed even if the camera/photo is unclear.

Technical details
- Driver app changes are mainly in `src/routes/driver.index.tsx` and `src/routes/driver.trip.new.tsx`.
- The signature fix will reuse the existing `src/components/driver/SignaturePad.tsx` rather than relying on the current third-party canvas capture flow.
- Odometer photo detection will be added as an authenticated server function so image processing is not exposed in the browser.
- No placeholder behavior: every failure path will show a real message and allow manual fallback.