# Laila — Full Core MVP

Laila is a minimal music companion built around the idea: **“The right song for any moment.”** This package implements the core listening journey as a runnable local web app.

## Run it

Requirements: Node.js 18 or newer.

```bash
npm start
```

Open http://localhost:3000. Keep the terminal open while using the app.

## Included and working

- Welcome and optional first-time profile setup.
- Mood check-in; selecting a mood immediately searches for music and opens the player when a playable preview is found.
- Free-text moment search and quick moments (Commute home, Morning commute, Gym, Feeling sad, Celebrating).
- iTunes Search API lookup through the Node server; preview-less tracks are excluded from playable results.
- Desktop-friendly responsive UI, monochrome light theme, optional dark theme, and lower-left settings gear.
- Audio preview playback, play/pause, previous/next, seek bar, artwork, store link and graceful preview errors.
- One-line recommendation reason and a lightweight 0–10 energy estimate.
- Mood-lift control, 10–90 minute session timer that counts active playback, swap song and Surprise Me.
- Local profile preferences and feedback saved in the browser; preferences influence subsequent search queries.
- Health endpoint at `/api/health`.

## Important limitations

This is a functional **core MVP**, not a production music-streaming service. iTunes supplies short previews where available, not guaranteed full-song playback. The recommendation logic is lightweight rules plus search, not a trained AI model. Wearables are not connected; no health data is accessed. Profile and feedback are saved in this browser only, with no accounts, cloud sync or multi-device persistence. Production use would require a licensed full-track provider, real AI/recommendation service, account backend, privacy/security review and real device integrations.

## Troubleshooting

- If port 3000 is busy: `PORT=3001 npm start`, then open http://localhost:3001.
- If music search fails, check internet access; the server calls the public iTunes Search API.
- If a preview cannot play, try another result. Preview availability varies by song and region.

## Enable full-song playback with Apple Music (recommended first provider)

Laila now includes an optional MusicKit on the Web integration. Without credentials, it continues to work with iTunes preview clips. Once configured, a user can connect their Apple Music account in **Settings → Full-song playback**, and Laila will search Apple Music's catalogue and request playback for full tracks. Full catalogue playback requires the user's eligible Apple Music subscription and authorization.

### Why Apple Music instead of Spotify first?

- **Apple Music / MusicKit:** Apple officially supports streaming Apple Music catalog content directly in a website with a custom JavaScript player. This matches Laila's goal of keeping the user inside Laila. You need an Apple Developer Program membership, a MusicKit-enabled key, and the user's authorization; users need an eligible Apple Music subscription for full-song playback. See [MusicKit](https://developer.apple.com/musickit/) and [MusicKit on the Web](https://js-cdn.music.apple.com/musickit/v3/docs/).
- **Spotify:** The Spotify Web Playback SDK can also play full tracks inside a browser, but it requires Spotify Premium for the playback user and Spotify developer app credentials; app access and platform policies apply. See [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) and [Spotify compliance tips](https://developer.spotify.com/compliance-tips).

For this existing vanilla-JS web app, Apple Music is the most direct first integration because MusicKit is designed for web playback. Spotify remains a possible later provider.

### Apple developer setup

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/) if you haven't already. Check Apple's current regional pricing before enrolling.
2. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/), create a **Media ID** and enable MusicKit for it.
3. Create a **MusicKit key** with MusicKit enabled. Download the `.p8` private key and save it securely. Apple only offers the private key download once, so keep a protected backup.
4. Note the **Key ID** and your **Team ID** from the developer account.
5. Copy `.env.example` to `.env`, then fill in `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, and `APPLE_MUSIC_PRIVATE_KEY_PATH` with your values. Use the absolute path to your `.p8` file. Do not commit `.env` or the private key to GitHub or share it in chat.
6. Restart the server with `npm start`, open Laila, go to the gear/settings, and choose **Connect Apple Music**.
7. Test on `http://localhost:3000` first. Before deploying, configure your real HTTPS domain and verify Apple's current MusicKit origin/token requirements for that domain.

The server signs the Apple Music developer token locally from the private key and serves the short-lived token to the browser. The private key itself is never sent to the browser. The token endpoint returns `configured: false` until credentials are present.

### Current integration notes

- Apple Music catalogue search is used after the user connects their account; iTunes previews remain the fallback when Apple Music is not connected or the catalogue lookup fails.
- A user must explicitly connect/authorize Apple Music. Laila cannot bypass subscription eligibility, regional catalogue availability, or browser playback restrictions.
- This is an initial integration, not yet a production-certified player. End-to-end testing with real Apple developer credentials and an eligible subscription is still required. Playback controls, progress timing, subscription edge cases, and deployed-domain authorization should be tested before public release.

### Configuration file

Create a `.env` file from `.env.example`. The project intentionally does not include any real credentials.
