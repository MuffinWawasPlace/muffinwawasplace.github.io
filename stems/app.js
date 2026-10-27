/* Stem Studio (website build): import → download models once → separate in a Web Worker → synced stem mixer.
   Same models, checksums and chunk math as the Termux app; nothing is uploaded anywhere. */
"use strict";
const $ = (s) => document.querySelector(s);
const SR = 44100;
const MAX_SECONDS = 15 * 60;
const MODEL_CACHE = "stem-models-v1";
const HF = "https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/";

const MODELS = {
  kuielab_a_vocals: { file: "kuielab_a_vocals.onnx", size: 29703204, sha256: "daba83c2ee1afee9139766ad64c9b6808d6b6f092fff04bed3338be50baac721", stem: "vocals", params: { nFft: 6144, dimF: 2048, dimTPow: 9, compensate: 1.035 } },
  kuielab_a_drums: { file: "kuielab_a_drums.onnx", size: 29703204, sha256: "40f586b7091934dd6f5563f0cba8f14bad57ce88440da1098bf388ea716c2901", stem: "drums", params: { nFft: 4096, dimF: 2048, dimTPow: 9, compensate: 1.035 } },
  kuielab_a_bass: { file: "kuielab_a_bass.onnx", size: 29703204, sha256: "0c3e77b9963185b1ea6bb46a4b8924137d9370fc1ccdefec7b1b416ef550dcaa", stem: "bass", params: { nFft: 16384, dimF: 2048, dimTPow: 9, compensate: 1.035 } },
  kuielab_a_other: { file: "kuielab_a_other.onnx", size: 29703204, sha256: "7b67a1dcb5f232153528c59960b4c7bf8dc736b8114de360af0e719633f53358", stem: "other", params: { nFft: 8192, dimF: 2048, dimTPow: 9, compensate: 1.035 } },
  kim_vocal_2: { file: "Kim_Vocal_2.onnx", size: 66759214, sha256: "ce74ef3b6a6024ce44211a07be9cf8bc6d87728cc852a68ab34eb8e58cde9c8b", stem: "vocals", params: { nFft: 7680, dimF: 3072, dimTPow: 8, compensate: 1.009 } },
};
for (const [id, m] of Object.entries(MODELS)) { m.id = id; m.url = HF + m.file; }

const MODES = [
  { id: "vocals_fast", label: "Vocals + Accompaniment (fast)", description: "Smallest model (30 MB). Good for karaoke and quick previews.",
    models: ["kuielab_a_vocals"], stems: ["vocals", "accompaniment"] },
  { id: "vocals_hq", label: "Vocals + Accompaniment (high quality)", description: "Kim Vocal 2 (67 MB). Cleanest vocals in testing.",
    models: ["kim_vocal_2"], stems: ["vocals", "accompaniment"] },
  { id: "four_stem", label: "4 stems: vocals, drums, bass, other", description: "Four KUIELab models (119 MB total). About 4× slower than fast mode.",
    models: ["kuielab_a_vocals", "kuielab_a_drums", "kuielab_a_bass", "kuielab_a_other"], stems: ["vocals", "drums", "bass", "other", "accompaniment"] },
  { id: "four_stem_hq", label: "4 stems with HQ vocals", description: "Kim Vocal 2 for vocals + KUIELab drums/bass/other (156 MB).",
    models: ["kim_vocal_2", "kuielab_a_drums", "kuielab_a_bass", "kuielab_a_other"], stems: ["vocals", "drums", "bass", "other", "accompaniment"] },
];
const STEM_LABEL = { vocals: "Vocals", drums: "Drums", bass: "Bass", other: "Other", accompaniment: "Accompaniment" };

const state = { mode: lsGet("mode") || "vocals_fast", have: {}, dl: {}, song: null, worker: null, stems: null, mixer: null, wake: null };

/* ---------------------------------------------------------------- helpers */
function lsGet(k) { try { return localStorage.getItem("stemweb." + k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem("stemweb." + k, v); } catch (e) { /* private mode */ } }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function fmtMB(b) { return (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + " MB"; }
function fmtEta(s) { if (!isFinite(s) || s <= 0) return ""; return s < 60 ? `~${Math.ceil(s)} s left` : `~${Math.ceil(s / 60)} min left`; }
function toast(msg, isErr = false) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), isErr ? 7000 : 3500);
}
function show(view) { for (const v of ["home", "job", "studio"]) $("#view-" + v).classList.toggle("hidden", v !== view); window.scrollTo(0, 0); }
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/* ---------------------------------------------------------------- model downloads (Cache Storage, checksum verified) */
async function refreshHave() {
  if (!("caches" in self)) { state.noCache = true; return; }
  const cache = await caches.open(MODEL_CACHE);
  for (const m of Object.values(MODELS)) state.have[m.id] = !!(await cache.match(m.url));
}
async function downloadModel(m) {
  const d = state.dl[m.id] = { got: 0, status: "downloading" };
  renderModes();
  const r = await fetch(m.url);
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status}).`);
  const reader = r.body.getReader(), parts = [];
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); d.got += value.length;
    if (Date.now() - last > 250) { last = Date.now(); renderModes(); }
  }
  d.status = "verifying"; renderModes();
  const blob = new Blob(parts);
  if (blob.size !== m.size) throw new Error(`Download stopped at ${fmtMB(blob.size)} of ${fmtMB(m.size)}. Try again.`);
  const digest = hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  if (digest !== m.sha256) throw new Error("Downloaded model failed its checksum and was discarded. Try again.");
  const cache = await caches.open(MODEL_CACHE);
  await cache.put(m.url, new Response(blob, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(m.size) } }));
  state.have[m.id] = true;
  delete state.dl[m.id];
}
async function downloadMode(mode) {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* optional */ }
  try {
    for (const id of mode.models) if (!state.have[id]) await downloadModel(MODELS[id]);
    toast(`${mode.label}: ready.`);
  } catch (e) {
    for (const id of mode.models) if (state.dl[id]) state.dl[id] = { status: "error", error: e.message };
    toast(e.message, true);
  }
  renderModes();
}

/* ---------------------------------------------------------------- modes UI */
function modeReady(mode) { return mode.models.every((id) => state.have[id]); }
function renderModes() {
  const box = $("#modes");
  box.innerHTML = MODES.map((m) => {
    const total = m.models.reduce((a, id) => a + MODELS[id].size, 0);
    const need = m.models.filter((id) => !state.have[id]).reduce((a, id) => a + MODELS[id].size, 0);
    const active = m.models.map((id) => state.dl[id]).filter((d) => d && d.status !== "error");
    const failed = m.models.map((id) => state.dl[id]).find((d) => d && d.status === "error");
    let dl = "";
    if (active.length) {
      const got = m.models.reduce((a, id) => a + (state.have[id] ? MODELS[id].size : (state.dl[id] && state.dl[id].got) || 0), 0);
      const pct = Math.min(100, (100 * got) / total);
      dl = `<div class="dl"><div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div><span class="small muted">${active.some((d) => d.status === "verifying") ? "verifying" : pct.toFixed(0) + "%"}</span></div>`;
    } else if (!modeReady(m)) {
      dl = `<div class="dl"><button class="small" data-dl="${m.id}">Download ${fmtMB(need)}</button>${failed ? `<span class="small" style="color:var(--danger)">${esc(failed.error)}</span>` : ""}</div>`;
    }
    const ready = modeReady(m);
    return `<label class="mode ${m.id === state.mode ? "selected" : ""}">
      <input type="radio" name="mode" value="${m.id}" ${m.id === state.mode ? "checked" : ""}>
      <div class="mode-top"><span class="mode-title">${esc(m.label)}</span>
        <span class="badge ${ready ? "ok" : "need"}">${ready ? "Ready" : "Not downloaded"}</span></div>
      <p>${esc(m.description)}</p>
      <div class="stemdots">${m.stems.map((s) => `<span style="--c:var(--${s})">${STEM_LABEL[s]}</span>`).join("")}</div>
      ${dl}
    </label>`;
  }).join("");
  box.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", () => { state.mode = r.value; lsSet("mode", r.value); renderModes(); }));
  box.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", (ev) => {
    ev.preventDefault(); b.disabled = true; downloadMode(MODES.find((x) => x.id === b.dataset.dl));
  }));
  updateSeparateBtn();
}
function updateSeparateBtn() {
  const mode = MODES.find((m) => m.id === state.mode);
  const ok = state.song && mode && modeReady(mode);
  $("#separateBtn").disabled = !ok;
  $("#separateHint").textContent = state.noCache ? "This browser can't store the models (private mode?). Try a normal tab." :
    !state.song ? "Import a song first." : !modeReady(mode) ? "Download this mode's models first (one time)." : `Ready: ${state.song.name} with ${mode.label}.`;
}

/* ---------------------------------------------------------------- import (decoded and resampled to 44.1 kHz stereo) */
async function importFile(file) {
  $("#dropText").textContent = "Decoding…";
  try {
    const buf = await file.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const audio = await new Ctx(2, SR, SR).decodeAudioData(buf);
    if (audio.duration > MAX_SECONDS) throw new Error(`That song is ${fmtTime(audio.duration)} long. The web version handles up to ${MAX_SECONDS / 60} minutes.`);
    let L, R;
    if (audio.sampleRate === SR) {
      L = audio.getChannelData(0).slice(); R = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice();
    } else {                                   // some browsers decode at the file's rate: resample here
      const off = new Ctx(2, Math.ceil(audio.duration * SR), SR);
      const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
      const rs = await off.startRendering();
      L = rs.getChannelData(0).slice(); R = rs.getChannelData(audio.numberOfChannels > 1 ? 1 : 0).slice();
    }
    state.song = { name: file.name.replace(/\.[^.]+$/, ""), L, R, seconds: L.length / SR };
    $("#loadedBox").innerHTML = `<b>${esc(file.name)}</b><br><span class="muted small">${fmtTime(state.song.seconds)} · ${audio.numberOfChannels === 1 ? "mono (copied to both sides)" : "stereo"}</span>`;
    $("#loadedBox").classList.remove("hidden");
    $("#dropText").textContent = "Tap to choose a different song";
  } catch (e) {
    state.song = null;
    $("#dropText").textContent = "Tap to choose a song";
    toast(e && e.name === "EncodingError" ? "This browser can't decode that file. Try MP3, WAV or M4A." : (e.message || String(e)), true);
  }
  updateSeparateBtn();
}

/* ---------------------------------------------------------------- separation */
async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock && !state.wake) state.wake = await navigator.wakeLock.request("screen");
    if (!on && state.wake) { await state.wake.release(); state.wake = null; }
  } catch (e) { /* not supported or denied */ }
}
function startSeparation() {
  const mode = MODES.find((m) => m.id === state.mode), song = state.song;
  show("job");
  $("#jobTitle").textContent = song.name; $("#jobMode").textContent = mode.label;
  $("#jobBar").style.width = "0%"; $("#jobPct").textContent = "0%"; $("#jobEta").textContent = ""; $("#jobMsg").textContent = "Starting…";
  $("#cancelBtn").classList.remove("hidden"); $("#jobBackBtn").classList.add("hidden");
  keepAwake(true);
  const stems = {};
  const w = new Worker("sep-worker.js");
  state.worker = w;
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "status") $("#jobMsg").textContent = m.text;
    else if (m.type === "progress") {
      const pct = (100 * m.done) / m.total;
      $("#jobBar").style.width = pct.toFixed(1) + "%"; $("#jobPct").textContent = pct.toFixed(0) + "%";
      $("#jobMsg").textContent = `Separating ${m.stem}: chunk ${m.chunk} of ${m.chunks}`;
      $("#jobEta").textContent = fmtEta((m.elapsed / m.done) * (m.total - m.done));
    } else if (m.type === "stem") stems[m.name] = [m.L, m.R];
    else if (m.type === "done") { finish(mode, song, stems); }
    else if (m.type === "stopped") fail("Stopped.");
    else if (m.type === "error") { console.error(m.detail); fail(m.message); }
  };
  w.onerror = (e) => { e.preventDefault(); fail("The separator crashed: " + (e.message || "unknown error") + ". Your connection may have blocked the AI runtime download; reload and try again."); };
  // copies, so the imported song stays available for another run
  const L = song.L.slice(), R = song.R.slice();
  w.postMessage({ type: "run", wantAccompaniment: mode.stems.includes("accompaniment"),
    models: mode.models.map((id) => ({ id, url: MODELS[id].url, stem: MODELS[id].stem, params: MODELS[id].params })), L, R }, [L.buffer, R.buffer]);
}
function endWorker() { if (state.worker) { state.worker.terminate(); state.worker = null; } keepAwake(false); }
function fail(msg) {
  endWorker();
  $("#jobMsg").textContent = msg; $("#jobEta").textContent = "";
  $("#cancelBtn").classList.add("hidden"); $("#jobBackBtn").classList.remove("hidden");
}
function finish(mode, song, stems) {
  endWorker();
  const order = mode.stems.filter((s) => stems[s]);
  state.stems = order.map((name) => {
    const [L, R] = stems[name], pcm = toInt16(L, R);
    const blob = wavBlob(pcm, L.length);
    return { name, pcm, frames: L.length, blob, url: URL.createObjectURL(blob), size: blob.size };
  });
  openStudio(song, mode);
}

/* ---------------------------------------------------------------- WAV / ZIP / mix */
function toInt16(L, R) {             // interleaved 16-bit, like the Termux app's exports
  const n = L.length, out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
    out[2 * i] = Math.round(l * 32767); out[2 * i + 1] = Math.round(r * 32767);
  }
  return out;
}
function wavBlob(pcm, frames) {
  const h = new DataView(new ArrayBuffer(44)), bytes = frames * 4;
  const s = (o, t) => { for (let i = 0; i < t.length; i++) h.setUint8(o + i, t.charCodeAt(i)); };
  s(0, "RIFF"); h.setUint32(4, 36 + bytes, true); s(8, "WAVE"); s(12, "fmt "); h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); h.setUint16(22, 2, true); h.setUint32(24, SR, true); h.setUint32(28, SR * 4, true);
  h.setUint16(32, 4, true); h.setUint16(34, 16, true); s(36, "data"); h.setUint32(40, bytes, true);
  return new Blob([h.buffer, pcm.buffer], { type: "audio/wav" });
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8, c = 0xffffffff) { for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; }
async function zipBlob(files) {      // stored (no compression): WAV barely compresses and this stays fast
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), data = new Uint8Array(await f.blob.arrayBuffer());
    const crc = (crc32(data) ^ 0xffffffff) >>> 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
function saveBlob(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function renderMix(tracks, normalize) {
  const anySolo = tracks.some((t) => t.solo);
  const active = tracks.filter((t) => !(t.muted || (anySolo && !t.solo)) && t.gain > 0);
  if (!active.length) throw new Error("Every stem is muted. Unmute at least one.");
  const n = active[0].pcm.length, acc = new Float32Array(n);
  for (const t of active) { const g = t.gain / 32767, p = t.pcm; for (let i = 0; i < n; i++) acc[i] += p[i] * g; }
  let peak = 0; for (let i = 0; i < n; i++) { const a = Math.abs(acc[i]); if (a > peak) peak = a; }
  const scale = normalize && peak > 0.98 ? 0.98 / peak : 1;
  const out = new Int16Array(n); let clipped = 0;
  for (let i = 0; i < n; i++) { let v = acc[i] * scale; if (v > 1 || v < -1) { clipped++; v = Math.max(-1, Math.min(1, v)); } out[i] = Math.round(v * 32767); }
  return { blob: wavBlob(out, n / 2), stems: active.map((t) => t.name), scale, clipped };
}

/* ---------------------------------------------------------------- synced multi-stem player (from the Termux app) */
class Mixer {
  constructor(stems, onTick) {
    this.onTick = onTick;
    this.tracks = stems.map((s) => { const el = new Audio(); el.preload = "auto"; el.src = s.url; el.preservesPitch = true; return { ...s, el, gain: 1, muted: false, solo: false }; });
    this.master = this.tracks[0].el; this.playing = false; this.buffering = false;
    this.timer = setInterval(() => this.sync(), 200);
    this.master.addEventListener("ended", () => this.stop());
    this.master.addEventListener("loadedmetadata", () => this.onTick());
  }
  get duration() { return this.master.duration || 0; }
  get position() { return this.master.currentTime || 0; }
  async play() {
    const t = this.position;
    for (const tr of this.tracks) { tr.el.currentTime = t; tr.el.playbackRate = 1; }
    this.playing = true;
    try { await Promise.all(this.tracks.map((tr) => tr.el.play())); } catch (e) { this.pause(); toast("Playback failed: " + e.message, true); }
  }
  pause() { this.playing = false; for (const tr of this.tracks) tr.el.pause(); }
  stop() { this.pause(); this.seek(0); }
  seek(t) { for (const tr of this.tracks) { tr.el.currentTime = t; tr.el.playbackRate = 1; } }
  applyGains() {
    const anySolo = this.tracks.some((t) => t.solo);
    for (const t of this.tracks) { t.silent = t.muted || (anySolo && !t.solo); t.el.volume = t.silent ? 0 : Math.max(0, Math.min(1, t.gain)); }
  }
  sync() {
    if (this.playing) {
      const starved = this.tracks.some((t) => t.el.readyState < 3);
      if (starved && !this.buffering) { this.buffering = true; for (const tr of this.tracks) tr.el.pause(); }
      else if (!starved && this.buffering) { this.buffering = false; const t = this.position; for (const tr of this.tracks) { tr.el.currentTime = t; tr.el.play().catch(() => {}); } }
      else if (!this.buffering) {
        const m = this.master.currentTime;
        for (const tr of this.tracks.slice(1)) {
          const d = tr.el.currentTime - m;
          if (Math.abs(d) > 0.25) { tr.el.currentTime = m; tr.el.playbackRate = 1; }
          else if (Math.abs(d) > 0.012) tr.el.playbackRate = Math.max(0.95, Math.min(1.05, 1 - d * 2));
          else tr.el.playbackRate = 1;
        }
      }
    }
    this.onTick();
  }
  destroy() { clearInterval(this.timer); for (const t of this.tracks) { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); } }
}

function openStudio(song, mode) {
  show("studio");
  $("#studioTitle").textContent = song.name; $("#studioMode").textContent = mode.label;
  $("#mixResult").classList.add("hidden");
  if (state.mixer) state.mixer.destroy();
  const seek = $("#seek");
  let dragging = false;
  const mixer = new Mixer(state.stems, () => {
    if (!dragging) seek.value = mixer.duration ? Math.round((1000 * mixer.position) / mixer.duration) : 0;
    $("#tNow").textContent = fmtTime(mixer.position); $("#tDur").textContent = fmtTime(mixer.duration);
    $("#tBuf").textContent = mixer.buffering ? "buffering…" : "";
    $("#playBtn").textContent = mixer.playing ? "❚❚" : "▶"; $("#playBtn").setAttribute("aria-label", mixer.playing ? "Pause" : "Play");
  });
  state.mixer = mixer; window.__mixer = mixer;
  seek.oninput = () => { dragging = true; $("#tNow").textContent = fmtTime((seek.value / 1000) * mixer.duration); };
  seek.onchange = () => { mixer.seek((seek.value / 1000) * mixer.duration); dragging = false; };
  $("#playBtn").onclick = () => (mixer.playing ? mixer.pause() : mixer.play());
  const base = song.name.replace(/[^\w\- ]+/g, "_").trim() || "song";
  const box = $("#tracks");
  box.innerHTML = mixer.tracks.map((t, i) => `
    <div class="track" style="--c:var(--${t.name}, var(--accent))" data-i="${i}">
      <div class="track-top">
        <span class="track-name">${STEM_LABEL[t.name] || t.name}</span>
        <button class="toggle m" aria-pressed="false" data-act="mute" aria-label="Mute ${t.name}">M</button>
        <button class="toggle s" aria-pressed="false" data-act="solo" aria-label="Solo ${t.name}">S</button>
      </div>
      <div class="vol"><input type="range" min="0" max="100" value="100" data-act="vol" aria-label="${t.name} volume"><output>100%</output></div>
      <div class="track-actions"><button class="ghost" data-act="save">Save WAV ${fmtMB(t.size)}</button></div>
    </div>`).join("");
  const refreshRows = () => box.querySelectorAll(".track").forEach((row) => row.classList.toggle("silent", !!mixer.tracks[+row.dataset.i].silent));
  box.querySelectorAll(".track").forEach((row) => {
    const t = mixer.tracks[+row.dataset.i];
    row.querySelector("[data-act=vol]").addEventListener("input", (e) => { t.gain = e.target.value / 100; row.querySelector("output").textContent = e.target.value + "%"; mixer.applyGains(); refreshRows(); });
    for (const act of ["mute", "solo"]) row.querySelector(`[data-act=${act}]`).addEventListener("click", (e) => {
      const key = act === "mute" ? "muted" : "solo"; t[key] = !t[key]; e.currentTarget.setAttribute("aria-pressed", String(t[key])); mixer.applyGains(); refreshRows();
    });
    row.querySelector("[data-act=save]").addEventListener("click", () => saveBlob(t.blob, `${base} - ${t.name}.wav`));
  });
  mixer.applyGains();
  $("#zipBtn").onclick = async () => {
    const b = $("#zipBtn"); b.disabled = true; b.textContent = "Packing…";
    try { saveBlob(await zipBlob(state.stems.map((s) => ({ name: `${base} - ${s.name}.wav`, blob: s.blob }))), `${base} - stems.zip`); }
    catch (e) { toast("Could not build the ZIP: " + e.message, true); }
    finally { b.disabled = false; b.textContent = "All stems (ZIP)"; }
  };
  $("#mixBtn").onclick = () => {
    try {
      const r = renderMix(mixer.tracks, $("#normalize").checked);
      const url = URL.createObjectURL(r.blob), res = $("#mixResult");
      res.innerHTML = `<b>${esc(base)} - my mix.wav</b><br><span class="muted small">Stems: ${r.stems.join(", ")}${r.scale < 1 ? ` · lowered ${(20 * Math.log10(r.scale)).toFixed(1)} dB to avoid clipping` : ""}${r.clipped ? ` · ${r.clipped} samples clipped` : ""}</span>
        <audio controls preload="none" src="${url}"></audio><div class="actions"><button class="primary" id="mixSave">Save mix</button></div>`;
      res.classList.remove("hidden");
      $("#mixSave").onclick = () => saveBlob(r.blob, `${base} - my mix.wav`);
    } catch (e) { toast(e.message, true); }
  };
}

function resetToHome() {
  if (state.mixer) { state.mixer.destroy(); state.mixer = null; }
  if (state.stems) { for (const s of state.stems) URL.revokeObjectURL(s.url); state.stems = null; }
  show("home"); renderModes();
}

/* ---------------------------------------------------------------- init */
async function init() {
  if (!window.Worker || !window.WebAssembly) { $("#separateHint").textContent = "This browser is too old for Stem Studio (needs Web Workers and WebAssembly)."; return; }
  await refreshHave();
  renderModes();
  $("#fileInput").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
  $("#separateBtn").addEventListener("click", startSeparation);
  $("#cancelBtn").addEventListener("click", () => { if (state.worker) state.worker.postMessage({ type: "stop" }); fail("Stopped."); });
  $("#jobBackBtn").addEventListener("click", () => show("home"));
  $("#newSongBtn").addEventListener("click", resetToHome);
  $("#homeBtn").addEventListener("click", () => { if (!state.worker) resetToHome(); });
  $("#clearModels").addEventListener("click", async () => {
    if (state.worker) return toast("Wait for the current separation to finish.", true);
    try { await caches.delete(MODEL_CACHE); } catch (e) { /* ignore */ }
    state.have = {}; await refreshHave(); renderModes(); toast("Downloaded models deleted.");
  });
}
init();
