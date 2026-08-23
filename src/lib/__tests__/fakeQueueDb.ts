/**
 * In-memory stand-in for the billing tables used by the submission queue.
 * `rpc("lease_submission_jobs")` mirrors the SQL: per-company cap, global cap,
 * round-robin fairness, and a conditional lock so two dispatchers can never
 * lease the same row.
 */
export type FakeRecord = {
  id: string;
  status: string;
  company_id: string | null;
  trip_id: string;
  updated_at: string;
  created_at: string;
  submitted_at?: string | null;
  submit_locked_until?: string | null;
  submit_lease_started_at?: string | null;
  submit_worker?: string | null;
  submit_attempt_count?: number;
  submit_next_attempt_at?: string | null;
  submit_last_error?: string | null;
  submit_last_ms?: number | null;
  submission_error?: string | null;
  fix_notes?: string | null;
  requires_human_step?: boolean;
  medicaid_trips: any;
};

export function makeRecord(
  id: string,
  opts: Partial<FakeRecord> & { riderId?: string; jobId?: string | null; company?: string } = {},
): FakeRecord {
  const company = opts.company ?? "co1";
  return {
    id,
    status: opts.status ?? "queued",
    company_id: company,
    trip_id: `t${id}`,
    updated_at: opts.updated_at ?? `2026-08-19T00:00:${id.padStart(2, "0")}Z`,
    created_at: opts.created_at ?? `2026-08-19T00:00:${id.padStart(2, "0")}Z`,
    submit_attempt_count: opts.submit_attempt_count ?? 0,
    submit_locked_until: opts.submit_locked_until ?? null,
    submit_next_attempt_at: opts.submit_next_attempt_at ?? null,
    submit_worker: null,
    medicaid_trips: {
      id: `t${id}`,
      company_id: company,
      rider_id: opts.riderId ?? `rider${id}`,
      riders: { medicaid_id: opts.riderId ?? `rider${id}` },
      robot_job_id: opts.jobId ?? null,
      robot_job_started_at: opts.jobId ? new Date().toISOString() : null,
      robot_last_status: null,
      created_by: "creator",
    },
  };
}

type QueueState = {
  paused: boolean;
  pause_reason: string | null;
  last_run_at: string | null;
  last_result: any;
};

export function makeFakeDb(records: FakeRecord[], state?: Partial<QueueState>) {
  const queueState: QueueState = {
    paused: false,
    pause_reason: null,
    last_run_at: null,
    last_result: {},
    ...state,
  };
  const audits: Array<{ id: string; action: string; note?: string }> = [];

  function table(name: string) {
    const st: any = { op: "select", filters: {}, ins: null, lt: null, updates: null };
    const builder: any = {
      select: () => builder,
      update: (u: any) => {
        st.op = "update";
        st.updates = u;
        return builder;
      },
      insert: (rows: any) => {
        st.op = "insert";
        st.updates = rows;
        return builder;
      },
      eq: (c: string, v: any) => {
        st.filters[c] = v;
        return builder;
      },
      in: (c: string, v: any[]) => {
        st.ins = { c, v };
        return builder;
      },
      lt: (c: string, v: any) => {
        st.lt = { c, v };
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        st.limit = n;
        return builder;
      },
      maybeSingle: () => Promise.resolve(run(true)),
      single: () => Promise.resolve(run(true)),
      then: (resolve: any, reject?: any) => Promise.resolve(run(false)).then(resolve, reject),
    };

    function matches(r: any) {
      for (const [k, v] of Object.entries(st.filters)) if (r[k] !== v) return false;
      if (st.ins && !st.ins.v.includes(r[st.ins.c])) return false;
      if (st.lt && !(String(r[st.lt.c]) < String(st.lt.v))) return false;
      return true;
    }

    function run(single: boolean) {
      if (name === "submission_queue_state") {
        if (st.op === "update") {
          Object.assign(queueState, st.updates);
          return { data: null, error: null };
        }
        return { data: { ...queueState }, error: null };
      }
      if (name === "billing_audit_log") {
        audits.push({
          id: st.updates?.billing_record_id ?? "?",
          action: st.updates?.action ?? "?",
          note: st.updates?.note,
        });
        return { data: null, error: null };
      }
      if (name === "medicaid_trips") return { data: null, error: null };

      const hits = records.filter(matches);
      if (st.op === "update") {
        for (const r of hits) Object.assign(r, st.updates);
        return { data: hits.map((r) => ({ id: r.id })), error: null };
      }
      const out = st.limit ? hits.slice(0, st.limit) : hits;
      return { data: single ? (out[0] ?? null) : out, error: null };
    }

    return builder;
  }

  const rpc = async (fn: string, args: any = {}) => {
    const now = Date.now();
    if (fn === "release_stale_submission_locks") {
      const grace = Math.max(args._grace_seconds ?? 300, 60) * 1000;
      let n = 0;
      for (const r of records) {
        if (
          r.status === "queued" &&
          r.submit_locked_until &&
          new Date(r.submit_locked_until).getTime() < now - grace
        ) {
          r.submit_locked_until = null;
          r.submit_worker = null;
          n++;
        }
      }
      return { data: n, error: null };
    }
    if (fn === "lease_submission_jobs") {
      const g = Math.min(Math.max(args._global_limit ?? 20, 1), 200);
      const pc = Math.min(Math.max(args._per_company_limit ?? 4, 1), 50);
      const ls = Math.min(Math.max(args._lease_seconds ?? 300, 30), 3600);
      const scope = args._company_id ?? null;

      const active = new Map<string, number>();
      for (const r of records) {
        if (r.status !== "submitting" || !r.medicaid_trips?.robot_job_id) continue;
        const k = String(r.company_id);
        active.set(k, (active.get(k) ?? 0) + 1);
      }
      const totalActive = [...active.values()].reduce((a, b) => a + b, 0);

      const due = records
        .filter(
          (r) =>
            r.status === "queued" &&
            (!r.submit_locked_until || new Date(r.submit_locked_until).getTime() < now) &&
            (!r.submit_next_attempt_at || new Date(r.submit_next_attempt_at).getTime() <= now) &&
            (scope == null || r.company_id === scope) &&
            (args._record_ids == null || args._record_ids.includes(r.id)),
        )
        .sort((a, b) =>
          (a.submit_next_attempt_at ?? a.updated_at).localeCompare(
            b.submit_next_attempt_at ?? b.updated_at,
          ),
        );

      const rn = new Map<string, number>();
      const ranked = due.map((r) => {
        const k = String(r.company_id);
        const n = (rn.get(k) ?? 0) + 1;
        rn.set(k, n);
        return { r, rn: n };
      });

      const picked = ranked
        .filter((x) => x.rn <= Math.max(pc - (active.get(String(x.r.company_id)) ?? 0), 0))
        .sort((a, b) => a.rn - b.rn || String(a.r.company_id).localeCompare(String(b.r.company_id)))
        .slice(0, Math.max(g - totalActive, 0));

      const leased: any[] = [];
      for (const { r } of picked) {
        // conditional lock — mirrors the SQL re-check under the row lock
        if (r.status !== "queued") continue;
        if (r.submit_locked_until && new Date(r.submit_locked_until).getTime() >= now) continue;
        r.submit_locked_until = new Date(now + ls * 1000).toISOString();
        r.submit_lease_started_at = new Date(now).toISOString();
        r.submit_worker = args._worker ?? null;
        leased.push({
          id: r.id,
          trip_id: r.trip_id,
          company_id: r.company_id,
          attempt: r.submit_attempt_count ?? 0,
        });
      }
      return { data: leased, error: null };
    }
    return { data: null, error: null };
  };

  return { supabase: { from: table, rpc } as any, records, audits, queueState };
}
