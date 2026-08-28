#!/usr/bin/env python3
"""Regenerate scripts/redart_target_bootstrap.sql and scripts/redart_target_manifest.md.

Concatenates supabase/migrations/*.sql in chronological filename order.
Schema only: no data, no credentials, no environment changes.
Run from the repo root:  python3 scripts/build_target_bootstrap.py
"""
import os

D = "supabase/migrations"
CRON = "20260819155525_821bb0d5-77f3-46b1-83c3-f63bb5cad4d2.sql"
BUCKETS = ("avatars, company-logos, driver-docs, driver-photos, games,\n"
           "--       gas-receipts, incidents, inspections, odometers, profiles, receipts,\n"
           "--       signatures, state-pdfs, trip-media, vehicle-photos")

HDR = """-- =====================================================================
-- RedArt - TARGET BOOTSTRAP (schema only, generated, DO NOT EDIT BY HAND)
-- Generated from supabase/migrations/*.sql in chronological filename order.
-- Regenerate with: python3 scripts/build_target_bootstrap.py
--
-- PURPOSE
--   Replay the complete RedArt schema onto a FRESH, EMPTY Supabase project
--   (the migration mirror target). Contains NO data, NO credentials and NO
--   environment changes. Never run this against the production project.
--
-- HOW TO RUN (external execution, by a human with target DB access)
--   psql "<TARGET_DIRECT_CONNECTION_STRING>" -v ON_ERROR_STOP=1 \\
--        -f scripts/redart_target_bootstrap.sql
--   Run it exactly once on an empty project. It is NOT a full re-runnable
--   script: the historical migrations include ALTER/DROP steps that assume
--   the prior state, so a partial failure must be fixed forward, not retried
--   from the top.
--
-- PREREQUISITES ON THE TARGET
--   * Standard Supabase project (auth, storage, vault, graphql schemas present).
--   * Extensions used: pgcrypto, uuid-ossp, pg_net, pg_cron, supabase_vault.
--     pg_cron/pg_net are created by the migrations themselves; supabase_vault
--     and pgcrypto ship enabled on Supabase.
--   * Storage BUCKETS are NOT created here (Supabase rejects SQL writes to
--     storage.buckets). Create them on the target via the Storage API/UI
--     before running, or the storage.objects policies below will simply have
--     no buckets to apply to. Required buckets (all PRIVATE):
--       {buckets}
--
-- DOCUMENTED EXCEPTIONS / DEVIATIONS FROM THE RAW MIGRATIONS
--   1. {cron}
--      The cron.schedule + net.http_post block in that migration is COMMENTED
--      OUT here. Replaying it verbatim would make the MIRROR project post to
--      the PRODUCTION app endpoint using the PRODUCTION anon key, creating a
--      second live claim-status processor. Re-enable only at cutover, with the
--      target's own URL and anon key.
--   2. vault.create_secret / vault.decrypted_secrets are referenced inside
--      several SECURITY DEFINER functions (SSN + portal-credential storage).
--      Those function bodies compile fine on a fresh project, but the secrets
--      themselves are NOT migrated - vault contents must be re-entered on the
--      target by a human. No plaintext secret appears in this file.
--   3. Policies on storage.objects are included; they are inert until the
--      matching buckets exist (see PREREQUISITES).
--   4. Nothing here touches auth.users rows. Auth users are a separate
--      migration step (see scripts/redart_target_manifest.md).
-- =====================================================================

""".replace("{cron}", CRON).replace("{buckets}", BUCKETS)


def neutralize_cron(body: str) -> str:
    note = ("-- EXCEPTION 1: the following statements are intentionally commented out\n"
            "-- for the mirror target (see header). Extensions are kept active.\n")
    out = []
    for ln in body.split("\n"):
        if ln.strip().upper().startswith("CREATE EXTENSION"):
            out.append(ln)
        else:
            out.append(("-- " + ln) if ln.strip() else "--")
    return note + "\n".join(out)


def main() -> None:
    files = sorted(f for f in os.listdir(D) if f.endswith(".sql"))
    parts = [HDR]
    for i, f in enumerate(files, 1):
        body = open(os.path.join(D, f)).read().rstrip()
        if f == CRON:
            body = neutralize_cron(body)
        parts.append(
            "-- ---------------------------------------------------------------------\n"
            f"-- [{i:03d}/{len(files)}] {f}\n"
            "-- ---------------------------------------------------------------------\n"
            f"{body}\n"
        )
    with open("scripts/redart_target_bootstrap.sql", "w") as fh:
        fh.write("\n".join(parts) + "\n")

    man = [
        "# RedArt target bootstrap manifest\n",
        "Source project (production, read-only): `brabgfamhzeswlvihdhr`\n",
        "Target project (mirror, empty): `pycvnhjzfjdyegjmvchs`\n",
        f"- Migrations included: **{len(files)}**",
        f"- Latest migration mirrored: **{files[-1]}**",
        "- Combined file: `scripts/redart_target_bootstrap.sql`",
        "- Generator: `scripts/build_target_bootstrap.py`\n",
        "## Exceptions applied in the combined file",
        f"1. `{CRON}` - cron.schedule/net.http_post block commented out (would point the mirror at the production endpoint with the production anon key). Extensions `pg_cron`/`pg_net` are still created.",
        "2. Vault-backed secrets (SSN, portal credentials) are referenced by functions but their values are not migrated; re-enter on target.",
        "3. Storage buckets are not created by SQL - create the 15 private buckets on the target first.",
        "4. No auth.users rows, no application data, no credentials are included.\n",
        "## Migrations, in execution order\n",
    ]
    man += [f"{i}. `{f}`" for i, f in enumerate(files, 1)]
    with open("scripts/redart_target_manifest.md", "w") as fh:
        fh.write("\n".join(man) + "\n")
    print(f"wrote {len(files)} migrations, latest {files[-1]}")


if __name__ == "__main__":
    main()
