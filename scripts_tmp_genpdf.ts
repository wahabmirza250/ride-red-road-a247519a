import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const projectRoot = '/dev-server';
const origFetch = globalThis.fetch;

async function ensureAsset(jsonPath: string, outPath: string) {
  const j = JSON.parse(await readFile(jsonPath, 'utf8'));
  try { await readFile(outPath); return; } catch {}
  const hosts = [
    'https://id-preview--1c3c174b-6cbe-4b49-974e-a1f94a0d4813.lovable.app',
    'https://redartdigital.com',
  ];
  for (const h of hosts) {
    const r = await origFetch(h + j.url).catch(() => null);
    if (r && r.ok) { await writeFile(outPath, Buffer.from(await r.arrayBuffer())); return; }
  }
  throw new Error('cannot fetch ' + j.url);
}
await ensureAsset(path.join(projectRoot, 'src/assets/nemt_trip_report_template.pdf.asset.json'), '/tmp/tpl.pdf');
await ensureAsset(path.join(projectRoot, 'src/assets/JustAnotherHand-Regular.ttf.asset.json'), '/tmp/hand.ttf');

// fake signature PNG
const png = new PNG({ width: 400, height: 80 });
for (let y=0;y<80;y++) for (let x=0;x<400;x++) {
  const idx = (y*400+x)*4;
  png.data[idx+3]=0;
}
for (let x=10;x<390;x++){
  const y = 40 + Math.sin(x/18)*10;
  for (let dy=-1;dy<=1;dy++){
    const yy = Math.round(y+dy);
    const idx = (yy*400+x)*4;
    png.data[idx]=23; png.data[idx+1]=38; png.data[idx+2]=140; png.data[idx+3]=255;
  }
}
await writeFile('/tmp/sig.png', PNG.sync.write(png));

globalThis.fetch = async (url: any, opts?: any) => {
  const s = String(url);
  if (s.includes('nemt_trip_report_template.pdf')) return new Response(await readFile('/tmp/tpl.pdf'), { status: 200 });
  if (s.includes('JustAnotherHand-Regular.ttf')) return new Response(await readFile('/tmp/hand.ttf'), { status: 200 });
  if (s.includes('sig.png') || s.startsWith('data:') || s.includes('signature')) return new Response(await readFile('/tmp/sig.png'), { status: 200 });
  return origFetch(url, opts);
};

const { generateStateFormPdf } = await import(path.join(projectRoot, 'src/lib/medicaidPdf.ts'));

const bytes = await generateStateFormPdf({
  rider: { full_name: 'Jane Q. Patient', medicaid_id: 'M964077', dob: null, phone: null, address: '123 Main St, Colorado Springs CO 80903' },
  driverName: 'John Driver',
  vehiclePlate: 'ABC-1234',
  vehicleVin: '1FTFW1EF5DKF00443',
  vehicleType: null,
  escortName: null,
  identityVerified: true,
  tripKind: 'one_way',
  legs: [
    // Leg 1: Home -> Pharmacy (mid-trip stop on the way to the clinic)
    { leg_index: 1, leg_date: '2026-07-15', pickup_time: '08:30', pickup_odometer: 45210, pickup_address: '123 Main St, Colorado Springs CO 80903', dropoff_time: '08:52', dropoff_odometer: 45218, dropoff_address: 'Kings Soopers Pharmacy, 1750 W Uintah St, Colorado Springs CO 80904' },
    // Leg 2: Pharmacy -> Clinic (final destination)
    { leg_index: 2, leg_date: '2026-07-15', pickup_time: '09:05', pickup_odometer: 45218, pickup_address: 'Kings Soopers Pharmacy, 1750 W Uintah St, Colorado Springs CO 80904', dropoff_time: '09:22', dropoff_odometer: 45225, dropoff_address: 'UCHealth Primary Care Clinic, 175 S Union Blvd, Colorado Springs CO 80910' },
  ],
  signatureName: 'Jane Q. Patient',
  signatureUrl: 'http://local/sig.png',
  signedByEscort: false,
});
await writeFile('/mnt/documents/one_stop_trip_filled_v5.pdf', bytes);
console.log('wrote', bytes.length);
