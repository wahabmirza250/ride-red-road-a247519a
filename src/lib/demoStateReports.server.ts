import { demoId } from './demoPresentation.server';
import { generateStateFormPdf, type Leg } from './medicaidPdf';

export const demoStateReportsKey = (companyId: string) => `company:${companyId}:state_reports_v1`;
async function read(query: any): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(`Demo state reports: ${error.message}`);
  return data;
}

/** Upgrade only the six known fictional reports, preserving all presentation actions. */
export async function upgradeDemoStateReports(db: any, companyId: string) {
  const company = await read(db.from('companies').select('is_demo,demo_owner_id').eq('id', companyId).single());
  if (!company?.is_demo || !company.demo_owner_id) throw new Error('Verified demo company required.');
  if (await read(db.from('app_settings').select('value').eq('key', demoStateReportsKey(companyId)).maybeSingle())) return false;
  for (let i = 0; i < 6; i++) {
    const id = demoId(companyId, `medical-${i}`);
    const trip = await read(db.from('medicaid_trips').select('*,riders(full_name,medicaid_id),medicaid_trip_legs(*)').eq('company_id', companyId).eq('id', id).single());
    // Never replace a report completed by the user through the real driver flow.
    if (!trip.state_pdf_path?.endsWith('/sample-report.pdf') && !trip.state_pdf_path?.endsWith('/state-report-v1.pdf')) continue;
    const profile = await read(db.from('profiles').select('first_name,last_name').eq('company_id', companyId).eq('id', trip.driver_id).single());
    const legs: Leg[] = trip.medicaid_trip_legs.map((leg: any) => ({
      leg_index: leg.leg_index, leg_date: leg.leg_date,
      pickup_time: leg.pickup_time, dropoff_time: leg.dropoff_time,
      pickup_odometer: leg.pickup_odometer, dropoff_odometer: leg.dropoff_odometer,
      pickup_address: leg.leg_index === 1 ? trip.pickup_address : leg.pickup_address,
      dropoff_address: leg.leg_index === 1 ? trip.dropoff_address : leg.dropoff_address,
    }));
    if (!legs.length) throw new Error('Sample trip legs are missing.');
    const bytes = await generateStateFormPdf({
      rider: trip.riders, driverName: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      vehiclePlate: trip.vehicle_plate, vehicleType: trip.vehicle_type, identityVerified: true,
      tripKind: trip.trip_kind, legs, signatureName: 'SAMPLE SIGNATURE', signatureUrl: null,
    }, { templateBaseUrl: 'https://nemtsolutions.co', demoSample: true });
    const path = trip.state_pdf_path.replace(/(?:sample-report|state-report-v1)\.pdf$/, 'state-report-v1.pdf');
    await read(db.storage.from('state-pdfs').upload(path, bytes, { contentType: 'application/pdf', upsert: true }));
    await read(db.from('medicaid_trips').update({ state_pdf_path: path, state_pdf_generated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('id', id));
  }
  await read(db.from('app_settings').upsert({ key: demoStateReportsKey(companyId), value: '1' }, { onConflict: 'key' }));
  return true;
}
