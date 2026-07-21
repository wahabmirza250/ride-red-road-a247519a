import { writeFileSync } from "node:fs";
import { generateStateFormPdf } from "../src/lib/medicaidPdf";

const BASE = "http://localhost:8080/";

const bytes = await generateStateFormPdf(
  {
    rider: {
      full_name: "Fariha Naeem",
      medicaid_id: "1234567",
      dob: null,
      phone: null,
      address: "4537 Lamplighter Cir, Colorado Springs, CO 80916",
    },
    driverName: "Aariz Mirza",
    vehiclePlate: "CPQ-Q53",
    vehicleVin: null,
    vehicleType: null,
    escortName: null,
    identityVerified: undefined,
    tripKind: null,
    legs: [
      {
        leg_index: 1,
        leg_date: "2026-07-20",
        pickup_time: "08:15",
        pickup_odometer: 78210,
        pickup_address: "4537 Lamplighter Cir, Colorado Springs, CO 80916",
        dropoff_time: "08:31",
        dropoff_odometer: 78216,
        dropoff_address: "Walgreens, 6150 N Union Blvd, Colorado Springs, CO 80918",
      },
      {
        leg_index: 2,
        leg_date: "2026-07-20",
        pickup_time: "08:40",
        pickup_odometer: 78216,
        pickup_address: "Walgreens, 6150 N Union Blvd, Colorado Springs, CO 80918",
        dropoff_time: "08:58",
        dropoff_odometer: 78224,
        dropoff_address: "UCHealth Memorial Hospital North, 4750 Briargate Pkwy, Colorado Springs, CO 80923",
      },
    ],
    signatureName: "Aariz Mirza",
    signatureUrl: null,
    signedByEscort: false,
  },
  { templateBaseUrl: BASE },
);

writeFileSync("/tmp/demo1_stop.pdf", bytes);
console.log("wrote /tmp/demo1_stop.pdf", bytes.length);
