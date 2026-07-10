## Reset admin password for wahabmirza250@gmail.com

You'll pick a new password in a secure form (nothing typed in chat). I'll then run a one-time server-side reset using the Auth Admin API.

### Steps

1. Prompt you via secure form to enter a new password for `wahabmirza250@gmail.com` (min 6 chars; 10+ recommended). Stored temporarily as secret `ADMIN_RESET_NEW_PASSWORD`.
2. Create a one-time server function `resetAdminPasswordOnce` (in `src/lib/admin.functions.ts`) that:
   - Loads `supabaseAdmin` inside the handler.
   - Verifies the target email is `wahabmirza250@gmail.com` AND has the `admin` role in `user_roles` (safety guard).
   - Calls `supabaseAdmin.auth.admin.updateUserById(userId, { password: process.env.ADMIN_RESET_NEW_PASSWORD, email_confirm: true })`.
   - Returns `{ ok: true }`.
3. Invoke it once via the server-function tool to perform the reset.
4. Delete the `ADMIN_RESET_NEW_PASSWORD` secret and remove the one-time server function file so the endpoint can't be reused.
5. You sign in at `/auth` with the new password.

### Notes

- No email delivery required, no changes to existing auth UI.
- The function is admin-only (guarded by email + role check) and is removed immediately after use.
- If you'd rather I keep a reusable "reset any user's password" admin tool in the dashboard instead of a one-shot, say the word and I'll build that instead.
