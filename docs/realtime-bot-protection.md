# Live updates and abuse protection

Realtime uses private `finance:admin`, `finance:user:<auth uid>` and `finance:shared` Broadcast topics. Events contain only resource names, never record contents. All data is reloaded through the authenticated finance-api gateway. Presence-only writes are excluded. Updates wait while a dialog is open or a field is focused. The existing 60-second refresh remains a fallback.

Account access endpoints are limited to 120 requests/minute per hashed proxy IP. Sensitive registration/recovery actions allow 12 requests/15 minutes per hashed IP and student/invitation. Authenticated finance-api allows 300 requests/minute per profile. Counters expire and are cleaned hourly. Supabase Auth retains its own rate limits for direct password login.

## Turnstile activation (requires project owner's Cloudflare keys)

1. Create a Cloudflare Turnstile Managed widget allowing `choxknn.github.io`.
2. Configure Supabase Edge Function secrets `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in the project dashboard. Never place the secret key in web/config.js or GitHub.
3. In Supabase Authentication → Bot and Abuse Protection, enable CAPTCHA, choose Cloudflare Turnstile, and set the same secret key. This protects direct password login as well as the website login; the website sends `gotrue_meta_security.captcha_token`.
4. The public `account-access` action `security-config` exposes only enabled/site_key. Custom registration and LINE recovery requests verify the token server-side and validate the hostname against ALLOWED_ORIGINS.
5. Refresh pages after enabling. Verify normal login, registration, expiry/retry and recovery. Until both Edge secrets are present, Turnstile is disabled; rate limiting still works. Do not enable Supabase Auth CAPTCHA before the matching Edge secrets/site key are ready.

The app never stores CAPTCHA tokens or passwords in logs. No LINE messages are sent during deployment verification.
