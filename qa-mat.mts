process.env.SUPABASE_URL ||= "";
const { materializeRouteTrips } = await import("./src/lib/routeTrips.server.ts");
console.log(await materializeRouteTrips("9f2d143f-43dc-40da-b078-98eed47752ee", "6f481151-52e4-49c2-9962-17e32a62836f"));
