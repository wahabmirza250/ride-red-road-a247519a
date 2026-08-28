# RedArt target schema export - manifest

Final **current schema** export of the live `public` schema (catalog introspection, read-only). This is NOT a historical migration replay - see `scripts/redart_target_manifest.md` for that.

Regenerate with `python3 scripts/build_target_schema_export.py`.

## Execution order

Run every part in strict filename order against the empty target:

```bash
for f in scripts/target_schema_parts/*.sql; do
  psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

| # | File | Contents | Objects | Size |
|---|------|----------|---------|------|
| 01 | `01_extensions_types.sql` | extensions, enums and domains | extensions: 2, enums: 11, domains: 0 | 1 KB |
| 02 | `02_tables.sql` | tables, columns and defaults (no constraints yet) | tables: 76 | 33 KB |
| 03 | `03_constraints.sql` | primary keys, unique, check, then foreign keys | constraints: 258 | 34 KB |
| 04 | `04_indexes.sql` | non-constraint indexes | indexes: 109 | 12 KB |
| 05 | `05_functions_part1.sql` | functions / RPCs (1 of 2) | functions: 29 | 17 KB |
| 06 | `06_functions_part2.sql` | functions / RPCs (2 of 2) | functions: 29 | 24 KB |
| 07 | `07_triggers.sql` | triggers on public tables | triggers: 97 | 13 KB |
| 08 | `08_views.sql` | views | views: 2 | 3 KB |
| 09 | `09_grants_rls.sql` | Data API grants and RLS enablement | grant_statements+rls: 76 | 5 KB |
| 10 | `10_policies.sql` | RLS policies (public, then storage.objects) and realtime | public_policies: 212, storage_policies: 37, realtime_tables: 14 | 64 KB |

## Excluded on purpose

- All table data, all secrets, all vault contents.
- Supabase-managed schemas (`auth`, `storage` base objects, `realtime`, `vault`, `graphql`) - only RedArt-created policies on `storage.objects` are included, in part 10.
- `pg_cron` jobs and `pg_net` HTTP callbacks, and the `pg_cron`/`pg_net` extensions themselves: the mirror must never run production schedules or post to production endpoints.
- Storage buckets (Supabase rejects SQL writes to `storage.buckets`); create the 15 private buckets through the Storage API/UI before running part 10.
- `auth.users` rows and any auth configuration.

## Notes

- Parts 1-4 are pure DDL and must run before functions, because several functions reference tables and enum types.
- Part 10 assumes the helper functions from parts 5-6 exist: most policies call `has_role()`, `current_user_company_id()` and friends.
- Realtime publication membership is applied with `ALTER PUBLICATION supabase_realtime ADD TABLE`; the publication itself already exists on any Supabase project.
