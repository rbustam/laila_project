# Laila — Full Core MVP (Render PostgreSQL)

Laila is a minimal music companion built around **“The right song for any moment.”** This package keeps the existing web experience and uses Render PostgreSQL for accounts and cross-device profile sync. Supabase is no longer used by the app.

## Run locally

Requirements: Node.js 18 or newer and PostgreSQL.

```bash
npm install
DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/laila' npm start
```

Open http://localhost:3000. The server creates the required tables on first use. Set `NODE_ENV=production` only when running behind HTTPS; production sessions use Secure cookies.

## Render configuration

1. In Render, open the **Laila web service → Environment**.
2. Add `DATABASE_URL` using the **Internal Database URL** from the existing `db_laila` PostgreSQL database. Prefer the internal URL when the service and database are in the same region. Do not paste the URL into source files or commit it.
3. Set `NODE_ENV` to `production`.
4. Keep Build Command `npm install`, Start Command `npm start`, and Health Check Path `/api/health`.
5. Deploy and test `https://YOUR-LAILA-DOMAIN/api/ready`. A successful response is `{"ok":true,"database":"connected"}`. A 503 means the database URL, network access, database status, or schema initialization needs attention.

`render.yaml` declares `DATABASE_URL` as a secret environment variable (`sync: false`), so set its value in the Render dashboard. Do not expose it to browser code.

## Account and profile APIs

- `POST /api/auth/signup` — `{ "email": "...", "password": "..." }`; creates an account and signs in.
- `POST /api/auth/login` — checks credentials and creates a session.
- `POST /api/auth/logout` — revokes the current session.
- `GET /api/auth/me` — returns the current user or `{"user":null}`.
- `GET /api/profile` — returns the signed-in user's profile.
- `PUT /api/profile` — saves the signed-in user's profile JSON.
- `GET /api/health` — basic process health.
- `GET /api/ready` — verifies database connectivity and schema readiness.

Passwords are hashed using Node.js scrypt. Session tokens are random, stored only as SHA-256 digests in PostgreSQL, and sent to the browser using HttpOnly, SameSite=Lax cookies (Secure in production). API responses do not include password hashes or session tokens. Each profile is associated with the authenticated account by the server; user IDs are never accepted from the browser for profile writes.

The schema is created automatically on server startup when `DATABASE_URL` is available. Tables are `laila_users`, `laila_sessions`, and `laila_profiles`. User and profile data persists across deployments because it is stored in PostgreSQL.

## Existing features retained

- Welcome and optional profile setup.
- Mood check-in, free-text search, quick moments and iTunes preview search.
- Audio preview playback, artwork, store links and playback controls.
- Mood Lift, session timer, swap song and Surprise Me.
- Personal and business/venue profiles.
- Light/dark themes, weather backgrounds, responsive navigation.
- Local profile storage remains as a fallback; signed-in profiles sync through the Render backend.

## Important limitations

This remains a functional core MVP, not a production music-streaming service. iTunes supplies short previews where available. Recommendation logic is lightweight rules plus search. Business profiles do not provide commercial music licensing, guaranteed clean lyrics, uninterrupted playback, staff accounts, multi-zone controls or scheduling. Wearables and Apple Health are not connected.

## Production hardening still recommended

Before broad public launch, add account email verification and password-reset flows, stronger distributed rate limiting, session rotation/cleanup scheduling, database backup/restore testing, a documented privacy/deletion process, and a security review. The initial implementation intentionally does not migrate existing Supabase accounts or data; do not delete the old Supabase project until any needed data has been exported and migration is decided.


## v40 mobile implementation pass

This version adds CSS-only mobile layout refinements for narrow screens, safe-area spacing, touch target sizing, search/results, playback controls, profile inputs, and bottom navigation. The Render PostgreSQL/account implementation from v39 is unchanged.
