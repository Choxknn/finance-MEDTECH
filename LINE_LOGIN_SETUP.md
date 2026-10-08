# LINE Login setup

1. In LINE Developers Console, create a LINE Login channel (Web app) under the same Provider as the existing Messaging API channel. This is required to retain the same LINE user IDs for existing members.
2. Set Callback URL to:
   https://choxknn.github.io/finance-MEDTECH/line-callback.html
3. Link the existing LINE Official Account from the LINE Login channel settings (add-friend option), and publish the channel when ready for members. A Developing channel only allows authorized testers.
4. In Supabase project sdegiugcttarbsnqvusm → Edge Functions → Secrets, add:
   - LINE_LOGIN_CHANNEL_ID: Channel ID from the LINE Login channel.
   - LINE_LOGIN_CHANNEL_SECRET: Channel secret from the LINE Login channel.
   These are distinct from LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN used by the Messaging API. Never add the Login secret to frontend config.js or commit it.
5. Check the login page and profile linking using your own account. Existing linked users can log in through LINE when both channels share the same Provider. New users still require an admin-prepared registration entry.

The deployed line-login function reports only whether both settings exist. Existing code-based linking remains available until configuration is present. Credentials and real LINE authorization must be tested before treating LINE Login as operational.

Security: authorization-code flow with PKCE S256, signed expiring state, browser session state matching, nonce/audience/issuer validation through LINE ID-token verification, authenticated profile linking, and no automatic registration of unknown LINE users. Supabase sessions are issued only for existing active linked profiles. Callback tokens are never put in redirect URLs.
