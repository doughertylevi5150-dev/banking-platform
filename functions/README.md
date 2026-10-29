# bankingAuth

Single endpoint behind the sign-in screen. POST `{ "action": "status" | "setup" | "login" | "me" | "logout" }`.

Hosted builds call it at `https://base44.app/api/apps/<app-id>/functions/bankingAuth` and the
`VITE_API_URL` in `client/.env.production` points there. Rules enforced server side: one owner
account, a one-time setup key (`OWNER_SETUP_KEY`), PBKDF2 password hashes (100k iterations, the
runtime ceiling), 7-day sessions that are revocable, and a 15-minute lockout after five failures.
