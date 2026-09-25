# Company access

Company code is the existing unique company `url_slug`. `/access` resolves an active company; `/<code>` is the app chooser. Existing deep links remain valid. The same account can use multiple apps only when assigned their corresponding roles. A code never grants access to another company's records.

The existing Walla admin account was assigned passenger, dispatch, billing and admin_biller roles in addition to admin and driver, all under the existing Walla company. A clearly labeled test passenger record was added without Medicaid or SSN data. No other company was enabled and no password was changed.

Public Supabase sign-ups and anonymous sign-ins are disabled. The old passenger signup link now renders sign-in only. Passenger account/profile access requires authentication; profiles are updated by authenticated user ID, never device ID. Administrators can optionally issue a passenger login when creating a passenger record.

Android 1.2 launchers use nemtsolutions.co and ask for the company code in both apps. CI builds debug APKs and runs startup/recovery tests.

Validation: company-code normalization and role/tenant rejection tests; full existing suite; TypeScript; production build; browser checks on deployed company chooser and app routes.

The Supabase advisor still reports pre-existing security-definer view/function advisories. No schema or policy changes were made in this release. Those findings require a separate database permissions review before onboarding outside companies: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
