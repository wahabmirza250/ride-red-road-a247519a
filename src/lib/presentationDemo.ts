/** Fictional presentation state. No API, credentials, or production records. */
export type DemoTrip = {
  id: string;
  passenger: string;
  time: string;
  from: string;
  to: string;
  miles: number;
  cents: number;
  status: "requested" | "assigned" | "driving" | "completed";
  driver: string | null;
  batchId: string | null;
};
export type DemoBatch = {
  id: string;
  method: "EDI" | "Robot";
  tripIds: string[];
  cents: number;
  status: "created" | "sent" | "paid";
};
export type DemoState = { trips: DemoTrip[]; batches: DemoBatch[] };
export type DemoAction =
  | { type: "reset" | "request" }
  | { type: "assign" | "start" | "complete"; id: string }
  | { type: "batch"; ids: string[]; method: DemoBatch["method"] }
  | { type: "send" | "pay"; id: string };
export function initialDemo(): DemoState {
  return {
    trips: [
      {
        id: "D-101",
        passenger: "Alex Morgan",
        time: "8:30 AM",
        from: "12 Meadow Lane",
        to: "Northside Clinic",
        miles: 12,
        cents: 7800,
        status: "completed",
        driver: "Jordan Lee",
        batchId: null,
      },
      {
        id: "D-102",
        passenger: "Sam Taylor",
        time: "9:15 AM",
        from: "48 Oak Street",
        to: "Valley Medical Center",
        miles: 8,
        cents: 6200,
        status: "completed",
        driver: "Casey Reed",
        batchId: null,
      },
    ],
    batches: [],
  };
}
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return initialDemo();
  if (action.type === "request") {
    if (state.trips.some((t) => t.id === "D-103")) return state;
    return {
      ...state,
      trips: [
        ...state.trips,
        {
          id: "D-103",
          passenger: "Jamie Parker",
          time: "10:30 AM",
          from: "25 Cedar Avenue",
          to: "Riverside Medical Center",
          miles: 10,
          cents: 7000,
          status: "requested",
          driver: null,
          batchId: null,
        },
      ],
    };
  }
  if (action.type === "batch") {
    const trips = state.trips.filter(
      (t) => action.ids.includes(t.id) && t.status === "completed" && !t.batchId,
    );
    if (!trips.length) return state;
    const id = `DEMO-${String(state.batches.length + 1).padStart(3, "0")}`;
    return {
      trips: state.trips.map((t) => (trips.some((x) => x.id === t.id) ? { ...t, batchId: id } : t)),
      batches: [
        ...state.batches,
        {
          id,
          method: action.method,
          tripIds: trips.map((t) => t.id),
          cents: trips.reduce((n, t) => n + t.cents, 0),
          status: "created",
        },
      ],
    };
  }
  if (action.type === "send" || action.type === "pay") {
    return {
      ...state,
      batches: state.batches.map((b) =>
        b.id === action.id && b.status === (action.type === "send" ? "created" : "sent")
          ? { ...b, status: action.type === "send" ? "sent" : "paid" }
          : b,
      ),
    };
  }
  if (action.type === "assign" || action.type === "start" || action.type === "complete") {
    const expected = { assign: "requested", start: "assigned", complete: "driving" };
    const next = { assign: "assigned", start: "driving", complete: "completed" } as const;
    return {
      ...state,
      trips: state.trips.map((t) =>
        t.id === action.id && t.status === expected[action.type]
          ? { ...t, status: next[action.type], driver: t.driver ?? "Jordan Lee" }
          : t,
      ),
    };
  }
  return state;
}
