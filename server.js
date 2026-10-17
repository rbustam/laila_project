const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const crypto = require("node:crypto");

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
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, app: "Laila" }));
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

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(target, (error, contents) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream" });
    res.end(contents);
  });
});

server.listen(PORT, () => {
  console.log(`Laila is running at http://localhost:${PORT}`);
});
