import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const email = "qa.round.driver@example.com";
const pass = "QaRound!2345";
// driver user
let userId: string | null = null;
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
userId = list.users.find((u) => u.email === email)?.id ?? null;
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { first_name: "Qa", last_name: "RoundDriver" } });
  if (error) throw error;
  userId = data.user.id;
}
await admin.from("user_roles").insert({ user_id: userId, role: "driver" });
let { data: drv } = await admin.from("drivers").select("id").eq("user_id", userId).maybeSingle();
if (!drv) {
  const ins = await admin.from("drivers").insert({ user_id: userId, status: "available", default_plate: "QA-RT01", default_vehicle_type: "ambulatory" }).select("id").single();
  drv = ins.data!;
}
await admin.from("drivers").update({ status: "available", current_lat: 38.8339, current_lng: -104.8214, last_location_at: new Date().toISOString() }).eq("id", drv!.id);

const { data: req, error: rErr } = await admin.from("ride_requests").insert({
  contact_name: "Rita RoundTrip", contact_phone: "719-555-7788", contact_medicaid: "QA-RT-0001",
  pickup_address: "1234 N Tejon St, Colorado Springs, CO 80903", pickup_lat: 38.8455, pickup_lng: -104.8214,
  dropoff_address: "3205 N Academy Blvd, Colorado Springs, CO 80917", dropoff_lat: 38.8778, dropoff_lng: -104.7550,
  status: "pending", source: "dispatch", requested_pickup_time: new Date(Date.now() + 3600e3).toISOString(),
}).select("id").single();
if (rErr) throw rErr;

const { data: route } = await admin.from("routes").insert({ name: "QA Round Trip Route", status: "draft", scheduled_at: new Date(Date.now() + 3600e3).toISOString() }).select("id").single();
const stops = [
  { kind: "pickup", leg: "outbound", address: "1234 N Tejon St, Colorado Springs, CO 80903", lat: 38.8455, lng: -104.8214 },
  { kind: "dropoff", leg: "outbound", address: "3205 N Academy Blvd, Colorado Springs, CO 80917", lat: 38.8778, lng: -104.7550 },
  { kind: "pickup", leg: "return", address: "3205 N Academy Blvd, Colorado Springs, CO 80917", lat: 38.8778, lng: -104.7550 },
  { kind: "dropoff", leg: "return", address: "1234 N Tejon St, Colorado Springs, CO 80903", lat: 38.8455, lng: -104.8214 },
];
await admin.from("route_stops").insert(stops.map((s, i) => ({ route_id: route!.id, sequence: i + 1, passenger_name: "Rita RoundTrip", passenger_medicaid_id: "QA-RT-0001", request_id: req.id, ...s })));

console.log(JSON.stringify({ userId, driverId: drv!.id, requestId: req.id, routeId: route!.id, email, pass }));
