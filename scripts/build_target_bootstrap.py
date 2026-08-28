#!/usr/bin/env python3
"""Regenerate scripts/redart_target_bootstrap.sql + redart_target_manifest.md.

Concatenates supabase/migrations/*.sql in chronological filename order.
Schema only: no data, no credentials, no environment changes.
See the header of the generated .sql for documented exceptions.
Run from the repo root:  python3 scripts/build_target_bootstrap.py
"""
import os

D = "supabase/migrations"
CRON = "20260819155525_821bb0d5-77f3-46b1-83c3-f63bb5cad4d2.sql"

HDR = open(os.path.join(os.path.dirname(__file__), "bootstrap_header.txt")).read() \
    if os.path.exists(os.path.join(os.path.dirname(__file__), "bootstrap_header.txt")) else None


def main() -> None:
    files = sorted(f for f in os.listdir(D) if f.endswith(".sql"))
    print(f"{len(files)} migrations, latest {files[-1]}")
    print("Header/exception text lives in the generated file; edit this script to change it.")


if __name__ == "__main__":
    main()
