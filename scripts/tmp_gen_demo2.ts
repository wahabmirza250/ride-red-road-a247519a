import { readFileSync, writeFileSync } from "node:fs";
import { generateStateFormPdf, type FormArgs } from "../src/lib/medicaidPdf";

const templateBytes = readFileSync("/tmp/template.pdf");
const fontBytes = readFileSync("/tmp/hw.ttf");
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("nemt_trip_report_template")) return new Response(templateBytes) as any;
  if (url.includes("JustAnotherHand")) return new Response(fontBytes) as any;
  return origFetch(input, init);
}) as any;

const BASE = "http://localhost:8080/";

const rider = {
  full_name: "Wahab Mirza",
  medicaid_id: "7654321",
  dob: null,
  phone: null,
  address: "8210 Lexington Dr, Colorado Springs, CO 80920",
};
const driverName = "Aariz Mirza";
const vehiclePlate = "CPQ-Q53";

const outbound: FormArgs = {
  rider,
  driverName,
  vehiclePlate,
  vehicleVin: null,
  vehicleType: null,
  escortName: null,
  tripKind: "one_way",
  legs: [
    {
      leg_index: 1,
      leg_date: "2026-07-21",
      pickup_time: "09:00",
      pickup_odometer: 45210,
      pickup_address: "8210 Lexington Dr, Colorado Springs, CO 80920",
      dropoff_time: "09:20",
      dropoff_odometer: 45218,
      dropoff_address: "Hayat Adult Daycare & Community Center, Colorado Springs, CO",
    },
  ],
  signatureName: "Aariz Mirza",
  signatureUrl: null,
  signedByEscort: false,
};

const ret: FormArgs = {
  ...outbound,
  legs: [
    {
      leg_index: 1,
      leg_date: "2026-07-21",
      pickup_time: "15:30",
      pickup_odometer: 45230,
      pickup_address: "Hayat Adult Daycare & Community Center, Colorado Springs, CO",
      dropoff_time: "15:50",
      dropoff_odometer: 45238,
      dropoff_address: "8210 Lexington Dr, Colorado Springs, CO 80920",
    },
  ],
};

for (const [name, args] of [["outbound", outbound], ["return", ret]] as const) {
  const bytes = await generateStateFormPdf(args, { templateBaseUrl: BASE });
  writeFileSync(`/tmp/demo2_${name}.pdf`, bytes);
  console.log("wrote", name, bytes.length);
}
