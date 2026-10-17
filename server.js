const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const { Pool } = require("pg");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
// Load local .env without an external dependency; real environment variables take precedence.
try {
  const envText = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#") || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch {}

const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = isProduction ? "__Host-laila_session" : "laila_session";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's managed Postgres supports TLS. Local development can use a local database without TLS.
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;
let dbInitPromise = null;
const rateBuckets = new Map();

async function initDatabase() {
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!dbInitPromise) dbInitPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS laila_users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS laila_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES laila_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS laila_sessions_user_id_idx ON laila_sessions(user_id);
      CREATE INDEX IF NOT EXISTS laila_sessions_expires_at_idx ON laila_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS laila_profiles (
        user_id BIGINT PRIMARY KEY REFERENCES laila_users(id) ON DELETE CASCADE,
        profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query("DELETE FROM laila_sessions WHERE expires_at <= NOW()");
  })().catch((error) => { dbInitPromise = null; throw error; });
  return dbInitPromise;
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body));
}
function readJson(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) { reject(Object.assign(new Error("Request body too large."), { status: 413 })); req.destroy(); }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error("Invalid JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
function getCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf("="); return i < 0 ? [part, ""] : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
  }));
}
function cookieHeader(value, maxAgeSeconds) {
  const parts = [`${sessionCookieName}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}
function tokenDigest(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO laila_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenDigest(token), userId, new Date(Date.now() + sessionTtlMs)]);
  return token;
}
async function authenticatedUser(req) {
  if (!pool) return null;
  const token = getCookies(req)[sessionCookieName];
  if (!token) return null;
  const result = await pool.query(`SELECT u.id, u.email FROM laila_sessions s JOIN laila_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > NOW()`, [tokenDigest(token)]);
  return result.rows[0] || null;
}
function allowOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  try {
    const parsed = new URL(origin);
    if (parsed.host === host) return true;
  } catch {}
  sendJson(res, 403, { error: "Origin not allowed." });
  return false;
}
function rateLimit(req, res, key, max = 12, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
  const bucketKey = `${key}:${ip}`;
  const old = rateBuckets.get(bucketKey);
  const bucket = !old || old.resetAt <= now ? { count: 0, resetAt: now + windowMs } : old;
  bucket.count += 1; rateBuckets.set(bucketKey, bucket);
  if (rateBuckets.size > 2000) for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
  if (bucket.count > max) { sendJson(res, 429, { error: "Too many attempts. Please wait and try again." }, { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) }); return false; }
  return true;
}
async function handleAccountApi(req, res, url) {
  const route = url.pathname;
  if (!["/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/profile"].includes(route)) return false;
  if (!pool) { sendJson(res, 503, { error: "Database is not configured. Set DATABASE_URL in Render environment variables." }); return true; }
  try { await initDatabase(); } catch (error) { console.error("Database initialization failed:", error.message); sendJson(res, 503, { error: "The database is temporarily unavailable. Check DATABASE_URL and the Render database status." }); return true; }
  if (route === "/api/auth/me" && req.method === "GET") {
    const user = await authenticatedUser(req);
    sendJson(res, 200, { user: user ? { id: String(user.id), email: user.email } : null }); return true;
  }
  if (!["POST", "GET", "PUT"].includes(req.method)) { sendJson(res, 405, { error: "Method not allowed." }, { Allow: route === "/api/profile" || route === "/api/auth/me" ? "GET, PUT, POST" : "POST" }); return true; }
  if ((req.method === "POST" || req.method === "PUT") && !allowOrigin(req, res)) return true;
  if (route === "/api/auth/signup" || route === "/api/auth/login") {
    if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed." }, { Allow: "POST" }); return true; }
    if (!rateLimit(req, res, route, 8)) return true;
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) { sendJson(res, 400, { error: "Enter a valid email address." }); return true; }
    if (password.length < 10 || Buffer.byteLength(password) > 1024) { sendJson(res, 400, { error: "Use a password between 10 and 1024 bytes." }); return true; }
    if (route.endsWith("signup")) {
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
      let result;
      try { result = await pool.query("INSERT INTO laila_users (email, password_hash) VALUES ($1, $2) RETURNING id, email", [email, `${salt}:${hash.toString("hex")}`]); }
      catch (error) {
        if (error.code === "23505") { sendJson(res, 409, { error: "An account with this email already exists. Try signing in." }); return true; }
        throw error;
      }
      const user = result.rows[0];
      const token = await createSession(user.id);
      sendJson(res, 201, { user: { id: String(user.id), email: user.email } }, { "Set-Cookie": cookieHeader(token, Math.floor(sessionTtlMs / 1000)) });
      return true;
    }
    const result = await pool.query("SELECT id, email, password_hash FROM laila_users WHERE email=$1", [email]);
    const row = result.rows[0];
    let valid = false;
    if (row) {
      const [salt, stored] = row.password_hash.split(":");
      const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
      const expected = Buffer.from(stored, "hex");
      valid = expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
    }
    if (!valid) { sendJson(res, 401, { error: "Email or password is incorrect." }); return true; }
    const token = await createSession(row.id);
    sendJson(res, 200, { user: { id: String(row.id), email: row.email } }, { "Set-Cookie": cookieHeader(token, Math.floor(sessionTtlMs / 1000)) });
    return true;
  }
  if (route === "/api/auth/logout") {
    if (req.method !== "POST") { sendJson(res, 405, { error: "Method not allowed." }, { Allow: "POST" }); return true; }
    const token = getCookies(req)[sessionCookieName];
    if (token) await pool.query("DELETE FROM laila_sessions WHERE token_hash=$1", [tokenDigest(token)]);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": cookieHeader("", 0) }); return true;
  }
  if (route === "/api/profile") {
    if (req.method === "GET") {
      const user = await authenticatedUser(req);
      if (!user) { sendJson(res, 401, { error: "Sign in to sync your profile." }); return true; }
      const result = await pool.query("SELECT profile, updated_at FROM laila_profiles WHERE user_id=$1", [user.id]);
      sendJson(res, 200, { profile: result.rows[0]?.profile || null, updatedAt: result.rows[0]?.updated_at || null }); return true;
    }
    if (req.method !== "PUT") { sendJson(res, 405, { error: "Method not allowed." }, { Allow: "GET, PUT" }); return true; }
    const user = await authenticatedUser(req);
    if (!user) { sendJson(res, 401, { error: "Sign in to sync your profile." }); return true; }
    const body = await readJson(req, 64 * 1024);
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) { sendJson(res, 400, { error: "A valid profile object is required." }); return true; }
    await pool.query(`INSERT INTO laila_profiles (user_id, profile, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (user_id) DO UPDATE SET profile=EXCLUDED.profile, updated_at=NOW()`, [user.id, JSON.stringify(body.profile)]);
    sendJson(res, 200, { ok: true }); return true;
  }
  return false;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};


function createAppleMusicDeveloperToken() {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  let privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  if (!privateKey && process.env.APPLE_MUSIC_PRIVATE_KEY_PATH) {
    privateKey = fs.readFileSync(process.env.APPLE_MUSIC_PRIVATE_KEY_PATH, "utf8");
  }
  if (!teamId || !keyId || !privateKey) return null;
  privateKey = privateKey.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({ iss: teamId, iat: now, exp: now + 60 * 60 * 24 * 30 })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function searchTracks(term) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "25");
  url.searchParams.set("media", "music");

  const response = await fetch(url, {
    headers: { "User-Agent": "LailaPrototype/0.1" },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`Music search returned ${response.status}`);

  const data = await response.json();
  return (data.results || []).map((track) => ({
    id: String(track.trackId || `${track.artistName}-${track.trackName}`),
    title: track.trackName || "Unknown track",
    artist: track.artistName || "Unknown artist",
    album: track.collectionName || "",
    artwork: (track.artworkUrl100 || "").replace("100x100", "600x600"),
    previewUrl: track.previewUrl || "",
    storeUrl: track.trackViewUrl || "",
    durationMs: track.trackTimeMillis || null,
    source: "iTunes"
  })).filter((track) => track.title && track.artist);
}

const server = http.createServer(async (req, res) => {
  // Baseline browser hardening. CSP is intentionally omitted until external scripts/styles
  // are consolidated; an incomplete CSP would break the current app.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try { if (await handleAccountApi(req, res, url)) return; }
    catch (error) {
      console.error("Account API request failed:", error.message);
      if (!res.headersSent) return sendJson(res, 500, { error: "The request could not be completed. Please try again." });
      res.destroy(); return;
    }
  }
  if (url.pathname.startsWith("/api/") && req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed." }, { Allow: "GET" });
  }
  if (url.pathname === "/api/ready") {
    try { await initDatabase(); await pool.query("SELECT 1"); return sendJson(res, 200, { ok: true, database: "connected" }); }
    catch (error) { return sendJson(res, 503, { ok: false, database: pool ? "unavailable" : "not_configured" }); }
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, app: "Laila", databaseConfigured: Boolean(pool) }));
  }
  if (url.pathname === "/api/apple-music-config") {
    try {
      const developerToken = createAppleMusicDeveloperToken();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ configured: Boolean(developerToken), developerToken }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ configured: false, error: "Apple Music credentials could not be loaded. Check the server environment settings." }));
    }
  }
  if (url.pathname === "/api/search") {
    const term = (url.searchParams.get("q") || "").trim();
    if (!term) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Enter a song, artist, or search term." }));
    }
    try {
      const tracks = await searchTracks(term);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ tracks, count: tracks.length }));
    } catch (error) {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Music search is temporarily unavailable. Please try again." }));
    }
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bad request");
  }
  if (pathname === "/") pathname = "/index.html";
  const target = path.resolve(ROOT, `.${pathname}`);
  const relativeTarget = path.relative(ROOT, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  fs.readFile(target, (error, contents) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(contents);
  });
});

server.listen(PORT, () => {
  console.log(`Laila is running at http://localhost:${PORT}`);
  if (!pool) console.warn("DATABASE_URL is missing; account and cloud profile endpoints will return 503.");
});

process.on("SIGTERM", async () => { try { await pool?.end(); } finally { server.close(() => process.exit(0)); } });
process.on("SIGINT", async () => { try { await pool?.end(); } finally { server.close(() => process.exit(0)); } });
