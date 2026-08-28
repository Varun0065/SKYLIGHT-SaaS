# SKYLIGHT SaaS v5 — Frontend → Node/Express → PostgreSQL

This build uses the architecture:

**Frontend (public/) → Node.js + Express (server.js) → PostgreSQL (pg)**

## Local development

1. Install Node.js.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
4. Run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

If `DATABASE_URL` is not set, the app intentionally falls back to `data/db.json` so the frontend can still be tested locally.

## Render + PostgreSQL

Create a Render PostgreSQL database and connect its internal/external `DATABASE_URL` to the Web Service. Set these environment variables on the Web Service:

- `DATABASE_URL` = your Render PostgreSQL connection string
- `JWT_SECRET` = a long random secret
- `NODE_ENV` = `production`

Build command: `npm install`
Start command: `npm start`

The backend automatically creates the required tables on startup. `db/schema.sql` is also included for manual inspection/setup.

## Authentication

Email/password accounts are stored in PostgreSQL with bcrypt password hashes. JWT sessions last 30 days. Google and Microsoft buttons are present, but real OAuth requires provider credentials and callback implementation/configuration before production use.


## Google / Microsoft sign-in

The social-login flow is now fully wired into the backend. Add the provider credentials to `.env`.

### Local Google
```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```
Create a Google OAuth Web application and add the redirect URI above.

### Local Microsoft
```env
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret
MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
```
Create a Microsoft Entra ID Web application and add the redirect URI above.

For production/Render, replace each redirect URI with the public HTTPS URL of the deployed app, for example:
`https://YOUR-DOMAIN/auth/google/callback`
and
`https://YOUR-DOMAIN/auth/microsoft/callback`.

Do not commit `.env` or provider secrets to GitHub.


## Production security notes
- Set a strong `JWT_SECRET` (32+ random characters) in the hosting provider's environment variables. The server refuses to start in production without it.
- Set `DATABASE_URL` in production. The local JSON fallback is intended for development only.
- Authentication now uses an HttpOnly, SameSite cookie; OAuth JWTs are no longer placed in the URL or localStorage.
- Google/Microsoft OAuth callbacks use a short-lived HttpOnly state cookie to reduce OAuth login-CSRF risk.
- Login/register and OAuth initiation endpoints have basic per-IP rate limiting.
- Security response headers are enabled. HSTS is enabled in production.
- The payment-request activation endpoint no longer self-verifies payment. A real Razorpay server-side signature/webhook verification flow must be connected before automatically granting paid plans.
- For production OAuth, register the exact HTTPS callback URLs with Google/Microsoft and set the matching environment variables.
