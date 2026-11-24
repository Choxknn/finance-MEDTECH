# LINE Login and LIFF setup

1. LINE Login Channel and the Messaging API channel must be under the same Provider so LINE user IDs match.
2. Use two separate LIFF apps:
   - Login, signup and friend verification: `2011933909-4qXo3pGn`.
   - Website entry from Flex messages only: `2011933909-n2La8PPV`.
3. Set the LIFF app Endpoint URL to:
   `https://choxknn.github.io/finance-MEDTECH/line-liff.html`
4. In the login LIFF app (`2011933909-4qXo3pGn`), enable both the `openid` and `profile` scopes and set Add friend option to `On (aggressive)`.
5. Keep the website-entry LIFF app (`2011933909-n2La8PPV`) separate, with Endpoint URL `https://choxknn.github.io/finance-MEDTECH/`. It is for opening the website from Flex links, not for login.
6. Publish both LIFF apps and the LINE Login channel. A Developing channel only permits authorized testers.
7. The matching LINE Login Channel ID must be `2011933909`; the server validates that the LIFF ID belongs to this channel. Supabase Edge Function secrets remain:
   - `LINE_LOGIN_CHANNEL_ID`
   - `LINE_LOGIN_CHANNEL_SECRET`
8. The signup flow opens LIFF, checks `liff.getFriendship()`, invokes `liff.requestFriendship()` if needed, obtains the LIFF ID token, checks the friend flag in LIFF, and verifies friendship again through the LINE Messaging API before allowing password setup.
9. Test with a LINE account that has not added the OA yet. Existing OA friends will pass the friendship check without being prompted again.

Never put LINE Login channel secrets, Messaging API access tokens, or Supabase service-role keys in frontend files.
