const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  screen: "home",
  tracks: [],
  currentIndex: 0,
  currentPrompt: "",
  audio: $("#audioPlayer"),
  appleMusic: null, appleMusicConfigured: false, appleMusicAuthorized: false, appleMusicActive: false, appleMusicQueue: [],
  genres: [],
  discovery: "A mix",
  vibe: "A mix",
  profile: {},
  toastTimer: null,
  mood: "",
  feedback: JSON.parse(localStorage.getItem("laila-feedback") || "{}"),
  sessionElapsed: 0, sessionTimer: null, sessionDuration: 30, sessionEnded: false,
  usedTrackIds: [], moodLift: 55, suggestedArtists: []
};

const ARTISTS_BY_GENRE = {
  "Pop": ["Taylor Swift", "Dua Lipa", "Chappell Roan", "Sabrina Carpenter", "The Weeknd", "Ariana Grande", "Olivia Rodrigo"],
  "R&B": ["SZA", "H.E.R.", "Daniel Caesar", "Summer Walker", "Frank Ocean", "Alicia Keys", "The Weeknd"],
  "Indie": ["Laufey", "Clairo", "Mitski", "The Marías", "Phoebe Bridgers", "Tame Impala", "beabadoobee"],
  "Hip-hop": ["Kendrick Lamar", "Drake", "Tyler, The Creator", "J. Cole", "Travis Scott", "Doja Cat", "Little Simz"],
  "Electronic": ["Fred again..", "Calvin Harris", "Disclosure", "ODESZA", "Daft Punk", "Flume", "Peggy Gou"],
  "Rock": ["Arctic Monkeys", "Paramore", "Foo Fighters", "The Killers", "Fleetwood Mac", "Green Day", "The Strokes"],
  "Jazz": ["Miles Davis", "Norah Jones", "Chet Baker", "Ella Fitzgerald", "Nina Simone", "Diana Krall", "Louis Armstrong"],
  "Classical": ["Ludovico Einaudi", "Max Richter", "Ólafur Arnalds", "Yiruma", "Yo-Yo Ma", "Hania Rani", "Claude Debussy"]
};

const reasons = {
  "commute home": "A steady soundtrack to help you leave the day behind.",
  "morning commute": "A little momentum for the day ahead.",
  "gym": "A pulse to help you find your next gear.",
  "feeling sad": "No need to rush the feeling. Let the music sit with you.",
  "celebrating": "For the little wins and the big ones, too.",
  "focus": "Less distraction, more room to get into your flow.",
  "calm": "A softer place to land for a while.",
  "unwind": "Let the edges of the day soften.",
  "sleep": "Something gentle to slow the world down."
};

function setPlayIcon(isPlaying) {
  $("#playButton").classList.toggle("is-playing", isPlaying);
  $("#playerScreen")?.classList.toggle("is-playing", isPlaying);
  $("#playButton").setAttribute("aria-label", isPlaying ? "Pause" : "Play preview");
}

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, pct))}%`);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function switchScreen(screen) {
  if (screen === "profile") { openProfile(); return; }
  state.screen = screen;
  $$(".screen").forEach((el) => el.classList.toggle("active", el.id === `${screen}Screen`));
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.screen === screen));
  closeProfile();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openProfile() {
  loadProfile();
  const panel = $("#profileScreen");
  // Open as an overlay only: preserve the current screen behind the blurred backdrop.
  $("#profileBackdrop").hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("profile-open");
  });
  $("#youButton").classList.add("active");
  $("#closeProfile").focus({ preventScroll: true });
}

function closeProfile() {
  const panel = $("#profileScreen");
  if (!panel) return;
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("profile-open");
  $("#profileBackdrop").hidden = true;
  $("#youButton")?.classList.remove("active");
}

function beginSession() {
  state.mood = "";
  if (state.sessionEnded) { state.sessionElapsed = 0; state.sessionEnded = false; updateSessionDisplay(); }
  $$(".mood-choice").forEach((button) => button.classList.remove("selected"));
  $("#moodNote").value = "";
  switchScreen("mood");
}

function renderQueue() {
  const list = $("#queueList");
  if (!list) return;
  const playable = getPlayableTracks();
  list.innerHTML = "";
  playable.forEach((track, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "queue-row" + (index === state.currentIndex ? " current" : "");
    if (index === state.currentIndex) row.setAttribute("aria-current", "true");
    const thumb = document.createElement("img");
    thumb.className = "queue-thumb"; thumb.alt = ""; thumb.src = track.artwork || "";
    thumb.onerror = () => { thumb.style.visibility = "hidden"; };
    const info = document.createElement("span");
    info.className = "queue-info";
    const title = document.createElement("strong"); title.textContent = track.title;
    const artist = document.createElement("small"); artist.textContent = track.artist;
    info.append(title, artist);
    const mark = document.createElement("span");
    mark.className = "queue-mark";
    if (index === state.currentIndex) mark.innerHTML = '<i></i><i></i><i></i>'; else mark.textContent = String(index + 1);
    row.append(thumb, info, mark);
    row.addEventListener("click", () => selectTrack(index, true));
    list.append(row);
  });
  const total = playable.length;
  $("#queueCount").textContent = total ? `${state.currentIndex + 1} of ${total}` : "";
  $("#queueMeta").textContent = total ? `${total} songs` : "";
  list.querySelector(".queue-row.current")?.scrollIntoView({ block: "nearest" });
}

function updatePlayerContext(track) {
  const prompt = (state.momentLabel || state.currentPrompt || "").trim();
  $("#playerMoment").textContent = prompt ? `For ${prompt.toLowerCase()}` : "Now playing";
  renderQueue();
  if ("mediaSession" in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.artist, album: track.album || "Laila",
      artwork: track.artwork ? [{ src: track.artwork, sizes: "600x600" }] : []
    });
  }
}

function setFinding(on) {
  state.finding = on;
  const status = $("#moodStatus");
  if (status) status.textContent = on ? "Finding your music…" : "";
  $$(".mood-choice, #continueMood").forEach((el) => { el.disabled = on; });
  $(".mood-screen")?.classList.toggle("is-finding", on);
}

function startMomentSearch(prompt, autoplay = true) {
  if (state.finding) return;
  const mood = state.mood ? ` ${state.mood.toLowerCase()} mood` : "";
  const note = $("#moodNote").value.trim();
  const combined = [prompt, mood, note].filter(Boolean).join(" ");
  $("#momentInput").value = prompt;
  findMusic(combined || prompt, { autoplay, label: prompt });
}

function getReason(prompt, track, index) {
  const lower = prompt.toLowerCase();
  const key = Object.keys(reasons).find((candidate) => lower.includes(candidate));
  if (key) return reasons[key];
  const variants = [
    "A little space to feel what you feel.",
    "A fresh sound for wherever your mind is.",
    "No need to explain it. Just press play."
  ];
  return variants[index % variants.length];
}

function titleCase(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlayable(track) {
  return track.source === "Apple Music" ? Boolean(track.id) : Boolean(track.previewUrl);
}

async function initializeAppleMusic() {
  try {
    const response = await fetch("/api/apple-music-config", { cache: "no-store" });
    const config = await response.json();
    if (!config.configured || !config.developerToken) {
      $("#appleMusicStatus").textContent = "Add Apple Music developer credentials to enable full-song playback.";
      return;
    }
    state.appleMusicConfigured = true;
    const configure = async () => {
      if (!window.MusicKit || state.appleMusic) return;
      try {
        await MusicKit.configure({ developerToken: config.developerToken, app: { name: "Laila", build: "1.0.0" } });
        state.appleMusic = MusicKit.getInstance();
        state.appleMusic.addEventListener("playbackStateDidChange", (event) => {
          const playing = Boolean(state.appleMusic?.isPlaying);
          setPlayIcon(playing);
          if (playing && !state.sessionEnded) startSessionClock();
        });
        $("#appleMusicStatus").textContent = "Connect your Apple Music account to play full songs.";
        $("#appleMusicConnect").disabled = false;
      } catch (error) {
        $("#appleMusicStatus").textContent = "Apple Music setup failed. Check your developer token and allowed domain.";
      }
    };
    if (window.MusicKit) await configure();
    else document.addEventListener("musickitloaded", configure, { once: true });
  } catch {
    $("#appleMusicStatus").textContent = "Apple Music setup is unavailable. You can still use previews.";
  }
}

async function connectAppleMusic() {
  if (!state.appleMusicConfigured) {
    showToast("Apple Music isn't configured yet. Follow the setup guide in README.md.");
    return;
  }
  if (!state.appleMusic) { showToast("Apple Music is still loading. Try again in a moment."); return; }
  try {
    await state.appleMusic.authorize();
    state.appleMusicAuthorized = true;
    $("#appleMusicStatus").textContent = "Connected. Laila can search Apple Music's catalogue.";
    $("#appleMusicConnect").textContent = "Connected";
    showToast("Apple Music connected.");
  } catch (error) {
    showToast("Apple Music sign-in was cancelled or couldn't complete.");
  }
}

async function searchAppleMusic(term) {
  if (!state.appleMusic || !state.appleMusicAuthorized) return [];
  const storefront = state.appleMusic.storefrontId || "au";
  const response = await state.appleMusic.api.music(`/v1/catalog/${storefront}/search`, { term, types: "songs", limit: 25 });
  const songs = response?.results?.songs?.data || [];
  return songs.map(song => ({
    id: song.id, title: song.attributes?.name || "Unknown track",
    artist: song.attributes?.artistName || "Unknown artist",
    album: song.attributes?.albumName || "",
    artwork: (song.attributes?.artwork?.url || "").replace("{w}", "600").replace("{h}", "600"),
    previewUrl: "", storeUrl: song.attributes?.url || "",
    durationMs: song.attributes?.durationInMillis || null, source: "Apple Music"
  }));
}

async function findMusic(prompt, options = {}) {
  const cleanPrompt = (prompt || "").trim();
  if (!cleanPrompt) {
    showToast("Tell Laila a little about your moment.");
    return;
  }
  const profile = state.profile || {};
  const genres = (profile.genres || []).slice(0, 2).join(" ");
  const artists = (profile.artists || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 2).join(" ");
  const lift = Number(state.moodLift ?? Number($("#moodSlider")?.value || 55));
  const liftQuery = lift < 34 ? "mellow acoustic" : lift < 68 ? "melodic pop" : "upbeat pop";
  const discovery = profile.discovery === "Familiar favourites" ? "hits" : profile.discovery === "Discover new music" ? "alternative" : "popular";
  const feedbackQuery = state.feedback.preference === "notquite" ? "different artist" : state.feedback.preference === "more" ? (artists || genres || "similar music") : "";
  const lower = cleanPrompt.toLowerCase();
  const momentQueries = [
    ["not sure", "popular chill feel good songs"],
    ["gym", "workout energetic pop rock"],
    ["commute home", "feel good pop indie"],
    ["morning commute", "upbeat morning pop"],
    ["feeling sad", "comforting mellow songs"],
    ["low", "comforting mellow songs"],
    ["sad", "comforting mellow songs"],
    ["happy", "feel good happy pop hits"],
    ["energised", "high energy dance pop rock"],
    ["stressed", "calm soothing mellow music"],
    ["celebrat", "feel good party hits"],
    ["calm", "calm acoustic piano"],
    ["stress", "calm mellow music"],
    ["focus", "instrumental focus music"],
    ["sleep", "soft piano ambient"],
    ["surprise", "popular alternative hits"]
  ];
  const momentSeed = (momentQueries.find(([needle]) => lower.includes(needle)) || ["", cleanPrompt])[1];
  const favouriteArtistList = (profile.artists || "").split(",").map(x => x.trim()).filter(Boolean);
  const genreArtists = (profile.genres || []).flatMap(genre => ARTISTS_BY_GENRE[genre] || []);
  const preferredArtists = [...new Set([...favouriteArtistList, ...genreArtists])];
  // Gather complementary searches into one playable queue instead of showing a menu of playlists.
  const candidates = [
    [momentSeed, genres, artists, liftQuery, discovery, feedbackQuery].filter(Boolean).join(" "),
    [momentSeed, genres, liftQuery].filter(Boolean).join(" "),
    ...preferredArtists.slice(0, 5).map(artist => [momentSeed, artist, genres, liftQuery].filter(Boolean).join(" ")),
    [artists, genres, liftQuery].filter(Boolean).join(" "),
    momentSeed,
    cleanPrompt
  ].filter((q, i, arr) => q && arr.indexOf(q) === i).slice(0, 7);
  state.currentPrompt = cleanPrompt;
  state.momentLabel = options.label || cleanPrompt;
  state.currentSearchQuery = candidates[0];
  if (!options.autoplay) {
    $("#resultsSection").classList.remove("hidden");
    $("#resultsTitle").textContent = "Finding your sound…";
    $("#resultsNote").textContent = "Looking for songs that fit your moment.";
    $("#trackList").innerHTML = "";
    switchScreen("home");
  } else {
    $("#resultsSection").classList.add("hidden");
    setFinding(true);
  }
  let lastError = null;
  let found = [];
  try {
    if (state.appleMusic && state.appleMusicAuthorized) {
      for (const query of candidates) {
        try {
          const appleTracks = await searchAppleMusic(query);
          if (appleTracks.length) { found = appleTracks; state.currentSearchQuery = query; break; }
        } catch (appleError) {
          console.warn("Apple Music catalogue search failed; trying preview fallback.", appleError);
        }
      }
    }
    if (!found.length) {
      const collected = [];
      const seen = new Set();
      for (const query of candidates) {
        try {
          const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Search failed");
          for (const track of (payload.tracks || []).filter(isPlayable)) {
            const key = track.trackId || track.id || track.previewUrl;
            if (key && !seen.has(key)) { seen.add(key); collected.push(track); }
          }
          if (collected.length >= 18) break;
        } catch (searchError) { lastError = searchError; }
      }
      found = collected;
      if (found.length) state.currentSearchQuery = candidates[0];
    }
    const fresh = found.filter(track => !state.usedTrackIds.includes(track.trackId || track.id || track.previewUrl));
    state.tracks = (fresh.length ? fresh : found).slice(0, 18);
    if (options.autoplay) {
      const playable = getPlayableTracks();
      if (playable.length) {
        state.currentIndex = 0;
        selectTrack(0, true);
      } else {
        switchScreen("home");
        showToast("No playable preview was available. Try another moment.");
      }
    } else {
      renderResults();
    }
  } catch (error) {
    lastError = error;
    $("#resultsTitle").textContent = "We couldn't reach the music library";
    $("#resultsNote").textContent = lastError.message || "Please try again in a moment.";
    showToast("Music search didn't connect. Check your connection and try again.");
  }
  setFinding(false);
  if (!found.length && !lastError) {
    state.tracks = [];
    if (options.autoplay) switchScreen("home");
    $("#resultsTitle").textContent = "No preview found just yet";
    $("#resultsNote").textContent = "Try another moment or a favourite artist. Preview availability varies by song and region.";
    if (options.autoplay) showToast("No playable preview came back for that moment. Try another feeling.");
    else renderResults();
  }
}

function energyFor(track, prompt, index = 0) {
  const text = `${prompt || ""} ${track?.title || ""} ${track?.artist || ""}`.toLowerCase();
  let energy = 5;
  if (/gym|workout|celebrat|party|energ|upbeat|happy|morning/.test(text)) energy += 3;
  if (/sad|comfort|calm|sleep|mellow|stress|piano|acoustic/.test(text)) energy -= 2;
  energy += Math.round((Number(state.moodLift ?? 55) - 50) / 25);
  return Math.max(0, Math.min(10, energy + (index % 3 === 0 ? 1 : index % 3 === 2 ? -1 : 0)));
}

function renderResults() {
  const all = state.tracks;
  const playable = all.filter(isPlayable);
  $("#resultsTitle").textContent = state.currentPrompt ? `For ${state.currentPrompt.toLowerCase()}` : "Your mix";
  $("#resultsNote").textContent = playable.length
    ? `${playable.length} tracks have playable previews. Choose one to listen.`
    : all.length
      ? "We found songs, but none had a playable preview. Try another search."
      : "No tracks found for that moment. Try a song, artist, or different phrase.";
  const list = $("#trackList");
  list.innerHTML = "";
  playable.slice(0, 10).forEach((track, index) => {
    const row = document.createElement("article");
    row.className = "track-row";
    const img = document.createElement("img");
    img.className = "track-thumb";
    img.alt = "";
    img.src = track.artwork || "";
    img.onerror = () => { img.style.visibility = "hidden"; };
    const info = document.createElement("div");
    info.className = "track-info";
    const title = document.createElement("h3");
    title.textContent = track.title;
    const artist = document.createElement("p");
    artist.textContent = track.artist;
    const reason = document.createElement("p");
    reason.className = "reason";
    reason.textContent = getReason(state.currentPrompt, track, index);
    const energy = document.createElement("span");
    energy.className = "energy-score";
    energy.textContent = `Energy ${energyFor(track, state.currentPrompt, index)}/10`;
    const play = document.createElement("button");
    play.className = "track-play";
    play.type = "button";
    play.textContent = "▶";
    play.setAttribute("aria-label", `Play ${track.title}`);
    play.addEventListener("click", () => selectTrack(index, true));
    info.append(title, artist, reason, energy);
    row.append(img, info, play);
    list.append(row);
  });
  if (!playable.length && all.length) {
    const store = document.createElement("p");
    store.className = "results-note";
    store.textContent = "Preview availability varies by song and region.";
    list.append(store);
  }
}

function getPlayableTracks() {
  return state.tracks.filter(isPlayable);
}

function selectTrack(index, autoplay = false, navigate = true) {
  const playable = getPlayableTracks();
  if (!playable.length) {
    showToast("Search for a song or moment to find playable previews.");
    return;
  }
  state.currentIndex = ((index % playable.length) + playable.length) % playable.length;
  const track = playable[state.currentIndex];
  const trackId = track.trackId || track.id || track.previewUrl;
  if (trackId && !state.usedTrackIds.includes(trackId)) state.usedTrackIds.push(trackId);
  state.usedTrackIds = state.usedTrackIds.slice(-20);
  localStorage.setItem("laila-recent-tracks", JSON.stringify(state.usedTrackIds));
  state.audio.pause();
  state.appleMusicActive = track.source === "Apple Music";
  if (state.appleMusicActive) {
    state.audio.removeAttribute("src"); state.audio.load();
  } else {
    state.audio.src = track.previewUrl; state.audio.load();
  }
  $("#playerTitle").textContent = track.title;
  $("#playerArtist").textContent = track.artist;
  $("#trackReason").textContent = `${getReason(state.currentPrompt, track, state.currentIndex)}  ·  Energy ${energyFor(track, state.currentPrompt, state.currentIndex)}/10`;
  $("#playerArtwork").innerHTML = "";
  $("#playerArtwork").classList.remove("placeholder-art");
  if (track.artwork) {
    const img = document.createElement("img");
    img.src = track.artwork;
    img.alt = `${track.title} album artwork`;
    $("#playerArtwork").append(img);
  } else {
    $("#playerArtwork").classList.add("placeholder-art");
    $("#playerArtwork").innerHTML = "<span>☾</span>";
  }
  const store = $("#storeLink");
  if (track.storeUrl) {
    store.href = track.storeUrl;
    store.classList.remove("hidden");
  } else {
    store.classList.add("hidden");
  }
  $("#seekSlider").value = 0;
  updateRangeFill($("#seekSlider"));
  $("#currentTime").textContent = "0:00";
  $("#duration").textContent = state.appleMusicActive ? "Full track" : "Preview";
  setPlayIcon(false);
  $("#playbackNotice").textContent = state.appleMusicActive ? "Full-track playback via Apple Music." : "A short music preview. Connect Apple Music for full-track playback.";
  updatePlayerContext(track);
  if (navigate) switchScreen("player");
  updateSessionDisplay();
  if (autoplay) playAudio();
}

async function playAudio() {
  if (state.appleMusicActive && state.appleMusic && state.appleMusicAuthorized) {
    try {
      const track = getPlayableTracks()[state.currentIndex];
      if (!track) throw new Error("No track selected");
      await state.appleMusic.setQueue({ song: track.id });
      await state.appleMusic.play();
      if (!state.sessionEnded) startSessionClock();
      setPlayIcon(true);
      $("#playbackNotice").textContent = "Playing the full track through Apple Music.";
    } catch (error) {
      showToast("Apple Music couldn't start playback. Check your subscription and try again.");
      $("#playbackNotice").textContent = "Full playback requires an eligible Apple Music subscription.";
    }
    return;
  }
  if (!state.audio.src) {
    showToast("Choose a song first.");
    return;
  }
  try {
    await state.audio.play();
    if (!state.sessionEnded) startSessionClock();
    setPlayIcon(true);
  } catch (error) {
    setPlayIcon(false);
    showToast("Playback was blocked. Tap play again to start the preview.");
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function renderArtistSuggestions() {
  const artists = [...new Set(state.genres.flatMap(genre => ARTISTS_BY_GENRE[genre] || []))].slice(0, 12);
  state.suggestedArtists = artists;
  const list = $("#artistSuggestionList");
  const addButton = $("#addSuggestedArtists");
  list.innerHTML = "";
  const current = new Set(($("#favoriteArtists").value || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
  artists.forEach(artist => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `option-chip ${current.has(artist.toLowerCase()) ? "selected" : ""}`;
    chip.textContent = artist;
    chip.dataset.artist = artist;
    chip.setAttribute("aria-pressed", String(current.has(artist.toLowerCase())));
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      chip.setAttribute("aria-pressed", String(chip.classList.contains("selected")));
      addButton.classList.toggle("hidden", !list.querySelector(".option-chip.selected"));
    });
    list.append(chip);
  });
  $("#artistSuggestions").classList.toggle("hidden", !artists.length);
  addButton.classList.toggle("hidden", !artists.length || !list.querySelector(".option-chip.selected"));
  $("#artistSuggestions .suggestion-note").textContent = state.genres.length
    ? `Suggestions based on ${state.genres.join(", ")}. Select artists to add them to your favourites and future mood mixes.`
    : "Choose a genre to discover at least five artists. Their songs can be included in your mood mixes.";
}

function addSelectedSuggestedArtists() {
  const selected = $$("#artistSuggestionList .option-chip.selected").map(chip => chip.dataset.artist);
  const existing = $("#favoriteArtists").value.split(",").map(x => x.trim()).filter(Boolean);
  const merged = [...new Map([...existing, ...selected].map(name => [name.toLowerCase(), name])).values()];
  $("#favoriteArtists").value = merged.join(", ");
  showToast(`${selected.length} artist${selected.length === 1 ? "" : "s"} added to your favourites.`);
}

function loadProfile() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("laila-profile") || "{}"); } catch {}
  state.profile = saved;
  $("#displayName").value = saved.name || "";
  $("#favoriteArtists").value = saved.artists || "";
  state.genres = saved.genres || [];
  state.discovery = saved.discovery || "A mix";
  state.vibe = saved.vibe || "A mix";
  syncOptionGroup("#genreOptions", state.genres);
  renderArtistSuggestions();
  syncOptionGroup("#discoveryOptions", [state.discovery], true);
  syncOptionGroup("#vibeOptions", [state.vibe], true);
}

function syncOptionGroup(selector, values, single = false) {
  $(`${selector}`).querySelectorAll(".option-chip").forEach((chip) => {
    chip.classList.toggle("selected", values.includes(chip.dataset.value));
  });
}

function saveProfile() {
  const profile = {
    name: $("#displayName").value.trim(),
    genres: state.genres,
    artists: $("#favoriteArtists").value.trim(),
    discovery: state.discovery,
    vibe: state.vibe
  };
  try {
    localStorage.setItem("laila-profile", JSON.stringify(profile));
    state.profile = profile;
    const avatar = $("#avatarLetter"); if (avatar) avatar.textContent = (profile.name || "L").slice(0, 1).toUpperCase();
    localStorage.setItem("laila-visited", "yes");
    showToast("Your profile is saved on this device.");
    closeProfile();
    beginSession();
  } catch {
    showToast("We couldn't save your profile in this browser.");
  }
}

// First-time welcome is shown once. Returning listeners go straight to a mood check-in.
const hasVisited = localStorage.getItem("laila-visited") === "yes";
if (hasVisited) switchScreen("mood");
else switchScreen("welcome");

$("#getStarted").addEventListener("click", () => {
  localStorage.setItem("laila-visited", "yes");
  switchScreen("home");
  openProfile();
});
$("#welcomeSkip").addEventListener("click", () => {
  localStorage.setItem("laila-visited", "yes");
  beginSession();
});
$$(".mood-choice").forEach((button) => button.addEventListener("click", () => {
  state.mood = button.dataset.mood;
  $$(".mood-choice").forEach((choice) => choice.classList.toggle("selected", choice === button));
  localStorage.setItem("laila-last-mood", state.mood);
  // A mood choice immediately starts a music search and opens the player when a preview is available.
  startMomentSearch(state.mood, true);
}));
$("#continueMood").addEventListener("click", () => {
  localStorage.setItem("laila-last-mood", state.mood);
  if (state.mood || $("#moodNote").value.trim()) {
    startMomentSearch($("#moodNote").value.trim() || state.mood || "music for this moment", true);
  } else {
    switchScreen("home");
    $("#momentInput").focus();
  }
});
$("#skipMood").addEventListener("click", () => switchScreen("home"));
$("#wearableToggle").addEventListener("click", () => showToast("Wearable sync isn't connected in this build yet. You can continue without it; no health data is being accessed."));
$("#addSuggestedArtists").addEventListener("click", addSelectedSuggestedArtists);
$$(".feedback-button").forEach((button) => button.addEventListener("click", () => {
  const kind = button.dataset.feedback;
  state.feedback = { ...state.feedback, preference: kind, lastPrompt: state.currentPrompt, lastMood: state.mood, timestamp: Date.now(), counts: { ...(state.feedback.counts || {}), [kind]: ((state.feedback.counts || {})[kind] || 0) + 1 } };
  localStorage.setItem("laila-feedback", JSON.stringify(state.feedback));
  $$(".feedback-button").forEach((item) => item.classList.toggle("selected", item === button));
  $("#feedbackNote").textContent = kind === "spot"
    ? "Got it. Laila will keep this vibe in mind for your next mix."
    : kind === "notquite"
      ? "Thanks. Try adjusting your mood lift or adding a little more detail next time."
      : "Got it. Laila will lean into similar sounds in future searches.";
  showToast(kind === "notquite" ? "Thanks — next picks will try a different direction." : "Thanks — Laila will use this feedback for future picks.");
}));

$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  findMusic($("#momentInput").value, { autoplay: true });
});
$$("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    $("#momentInput").value = button.dataset.prompt;
    startMomentSearch(button.dataset.prompt);
  });
});
$$(".nav-item").forEach((button) => button.addEventListener("click", () => {
  // "You" opens the profile overlay (its own handler); it must not switch or clear the current screen.
  if (!button.dataset.screen) return;
  if (button.dataset.screen === "player" && !state.audio.src) {
    showToast("Choose a song first, then your player will be here.");
    return;
  }
  switchScreen(button.dataset.screen);
}));
$("#youButton").addEventListener("click", openProfile);
$("#closeProfile").addEventListener("click", closeProfile);
$("#profileBackdrop").addEventListener("click", closeProfile);
document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && state.screen === "player" && !/^(INPUT|TEXTAREA|BUTTON|A|SELECT)$/.test(document.activeElement?.tagName || "")) {
    event.preventDefault();
    $("#playButton").click();
  }
});
if ("mediaSession" in navigator) {
  const media = navigator.mediaSession;
  try {
    media.setActionHandler("play", () => $("#playButton").click());
    media.setActionHandler("pause", () => $("#playButton").click());
    media.setActionHandler("previoustrack", () => $("#previousButton").click());
    media.setActionHandler("nexttrack", () => $("#nextButton").click());
  } catch {}
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#profileScreen").classList.contains("open")) closeProfile();
});
$$(".brand, .nav-brand").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  switchScreen("home");
}));
$("#backHome").addEventListener("click", () => switchScreen("home"));
$("#clearResults").addEventListener("click", () => {
  $("#resultsSection").classList.add("hidden");
  state.tracks = [];
});
$("#playButton").addEventListener("click", () => {
  if (state.appleMusicActive && state.appleMusic) {
    if (state.appleMusic.isPlaying) state.appleMusic.pause(); else playAudio();
  } else if (state.audio.paused) playAudio();
  else state.audio.pause();
});
$("#appleMusicConnect").addEventListener("click", connectAppleMusic);
$("#previousButton").addEventListener("click", () => selectTrack(state.currentIndex - 1, true, state.screen === "player"));
$("#nextButton").addEventListener("click", () => selectTrack(state.currentIndex + 1, true, state.screen === "player"));
$("#swapButton").addEventListener("click", () => {
  const playable = getPlayableTracks();
  if (playable.length > 1) selectTrack(state.currentIndex + 1, true);
  else findMusic(`${state.currentPrompt} different song`, { autoplay: true, label: state.momentLabel });
});
$("#surpriseButton").addEventListener("click", () => {
  const playable = getPlayableTracks();
  if (!playable.length) {
    $("#momentInput").value = "surprise me";
    findMusic("surprise me unexpected discovery", { autoplay: true, label: "a surprise" });
    return;
  }
  const freshIndexes = playable.map((track, index) => ({ track, index })).filter(({ track }) => !state.usedTrackIds.includes(track.trackId || track.id || track.previewUrl));
  const candidates = freshIndexes.length ? freshIndexes : playable.map((track, index) => ({ track, index }));
  selectTrack(candidates[Math.floor(Math.random() * candidates.length)].index, true);
});
$("#moodSlider").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  state.moodLift = value;
  $("#moodValue").textContent = value < 34 ? "Stay with me" : value < 68 ? "A little lift" : "Lift me up";
  updateRangeFill(event.target);
  localStorage.setItem("laila-mood-lift", String(value));
  $("#trackReason").textContent = value < 34 ? "Keeping things gentle and close to how you feel." : value < 68 ? "A balanced sound, following your pace." : "Leaning toward brighter, more uplifting sounds.";
});
$("#listenSlider").addEventListener("input", (event) => {
  state.sessionDuration = Number(event.target.value);
  $("#listenValue").textContent = `${event.target.value} min`;
  updateRangeFill(event.target);
  localStorage.setItem("laila-listen-duration", String(state.sessionDuration));
  updateSessionDisplay();
});
state.audio.addEventListener("play", () => { setPlayIcon(true); });
state.audio.addEventListener("pause", () => { setPlayIcon(false); });
state.audio.addEventListener("timeupdate", () => {
  const duration = state.audio.duration || 30;
  $("#seekSlider").max = duration;
  $("#seekSlider").value = state.audio.currentTime || 0;
  updateRangeFill($("#seekSlider"));
  $("#currentTime").textContent = formatTime(state.audio.currentTime);
  $("#duration").textContent = `${formatTime(duration)} preview`;
});
state.audio.addEventListener("ended", () => {
  setPlayIcon(false);
  if (!state.sessionEnded && getPlayableTracks().length > 1) {
    $("#playbackNotice").textContent = "Moving to the next preview in your mix…";
    selectTrack(state.currentIndex + 1, true, false); // auto-advance stays on the current page
  } else {
    $("#playbackNotice").textContent = "Preview ended. Choose another song or replay this preview.";
  }
});
state.audio.addEventListener("error", () => {
  $("#playbackNotice").textContent = "This preview couldn't be played. Try another track.";
});
$("#seekSlider").addEventListener("input", (event) => {
  if (Number.isFinite(state.audio.duration)) state.audio.currentTime = Number(event.target.value);
  updateRangeFill(event.target);
});
$("#profileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveProfile();
});
$("#skipProfile").addEventListener("click", () => {
  localStorage.setItem("laila-visited", "yes");
  beginSession();
});
$("#genreOptions").querySelectorAll(".option-chip").forEach((chip) => chip.addEventListener("click", () => {
  const value = chip.dataset.value;
  state.genres = state.genres.includes(value) ? state.genres.filter((x) => x !== value) : [...state.genres, value];
  syncOptionGroup("#genreOptions", state.genres);
  renderArtistSuggestions();
}));
$("#discoveryOptions").querySelectorAll(".option-chip").forEach((chip) => chip.addEventListener("click", () => {
  state.discovery = chip.dataset.value;
  syncOptionGroup("#discoveryOptions", [state.discovery], true);
}));
$("#vibeOptions").querySelectorAll(".option-chip").forEach((chip) => chip.addEventListener("click", () => {
  state.vibe = chip.dataset.value;
  syncOptionGroup("#vibeOptions", [state.vibe], true);
}));

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("laila-theme", selected);
  $$("[data-theme-choice]").forEach((button) => button.classList.toggle("selected", button.dataset.themeChoice === selected));
  document.querySelector('meta[name="theme-color"]').setAttribute("content", selected === "dark" ? "#090909" : "#ffffff");
}
$$("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.themeChoice)));
applyTheme(localStorage.getItem("laila-theme") || "light");
loadProfile();


// Session duration counts actual playback time (not paused time).
function updateSessionDisplay() {
  const duration = Number(state.sessionDuration || $("#listenSlider")?.value || 30);
  const remaining = Math.max(0, duration * 60 - state.sessionElapsed);
  const note = $("#sessionStatus");
  if (note) note.textContent = state.sessionEnded ? "Session complete — start another whenever you're ready." : `Listening session · ${Math.ceil(remaining / 60)} min left`;
}
function startSessionClock() {
  if (state.sessionTimer || state.sessionEnded) return;
  state.sessionTimer = setInterval(() => {
    if (!state.audio.paused && !state.sessionEnded) {
      state.sessionElapsed += 1;
      updateSessionDisplay();
      if (state.sessionElapsed >= Number(state.sessionDuration || $("#listenSlider")?.value || 30) * 60) {
        state.sessionEnded = true;
        state.audio.pause(); state.audio.currentTime = 0;
        clearInterval(state.sessionTimer); state.sessionTimer = null;
        $("#playbackNotice").textContent = "Your listening session is complete. Take a breath, or start another session whenever you're ready.";
        showToast("Your listening session is complete."); updateSessionDisplay();
      }
    }
  }, 1000);
}
const savedLiftRaw = localStorage.getItem("laila-mood-lift");
const savedLift = savedLiftRaw === null ? NaN : Number(savedLiftRaw);
if (Number.isFinite(savedLift) && savedLift >= 0 && savedLift <= 100) { state.moodLift = savedLift; $("#moodSlider").value = String(savedLift); $("#moodValue").textContent = savedLift < 34 ? "Stay with me" : savedLift < 68 ? "A little lift" : "Lift me up"; }
const savedDuration = Number(localStorage.getItem("laila-listen-duration"));
if (Number.isFinite(savedDuration) && savedDuration >= 10 && savedDuration <= 90) { state.sessionDuration = savedDuration; $("#listenSlider").value = String(savedDuration); $("#listenValue").textContent = `${savedDuration} min`; }
try { state.usedTrackIds = JSON.parse(localStorage.getItem("laila-recent-tracks") || "[]"); } catch { state.usedTrackIds = []; }
updateSessionDisplay();
updateRangeFill($("#seekSlider"));
updateRangeFill($("#moodSlider"));
updateRangeFill($("#listenSlider"));

initializeAppleMusic();
