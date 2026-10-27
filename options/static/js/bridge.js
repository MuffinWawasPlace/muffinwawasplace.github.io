/* Website build: runs the Python engine in the browser with Pyodide and answers the app's /api/... calls locally.
   Loaded after util.js and before app.js, so app.js picks up this U.api. Nothing is sent to any server of yours. */
"use strict";
(() => {
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
  const CBOE_TEST = "https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json";
  const boot = document.getElementById("boot"), bootMsg = document.getElementById("bootMsg");
  const say = (t) => { if (bootMsg) bootMsg.textContent = t; };
  let live = false;

  async function probeLive() {
    try {
      const r = await fetch(CBOE_TEST, { method: "GET", cache: "no-store" });
      live = r.ok;
    } catch (e) { live = false; }
  }

  async function start() {
    const probe = probeLive();
    say("Loading Python (first visit downloads about 10 MB, then it's cached)…");
    if (typeof loadPyodide !== "function") throw new Error("Could not download Python from " + PYODIDE + ". Check your connection and reload.");
    const py = await loadPyodide({ indexURL: PYODIDE });
    say("Loading the suggester…");
    const res = await fetch("engine.zip", { cache: "no-cache" });
    if (!res.ok) throw new Error("engine.zip is missing from this folder (HTTP " + res.status + ").");
    py.unpackArchive(await res.arrayBuffer(), "zip", { extractDir: "/home/pyodide" });
    py.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')\n" +
      "from option_battle import webapi\nwebapi.install_shims()\nwebapi.call('GET', '/api/health')");
    await probe;
    return py.globals.get("webapi") || py.pyimport("option_battle.webapi");
  }

  const ready = start().then((w) => { if (boot) boot.classList.add("hidden"); return w; }).catch((e) => {
    say(String(e && e.message || e));
    if (boot) boot.classList.add("boot-error");
    throw e;
  });

  U.api = async function api(path, body) {
    let w;
    try { w = await ready; } catch (e) { throw { error: "The suggester could not start in this browser.", hint: String(e && e.message || e) }; }
    const [p, qs] = path.split("?");
    const q = {};
    new URLSearchParams(qs || "").forEach((v, k) => { q[k] = v; });
    if (body && body.provider === "cboe" && !live) {
      throw { error: "Live CBOE data couldn't be loaded on this page.", hint: "Pick MOCK here, or run the app in Termux for live quotes." };
    }
    await new Promise((r) => setTimeout(r, 30));          // let the "Analyzing" spinner paint before Python blocks
    const out = JSON.parse(w.call(body === undefined ? "GET" : "POST", p, JSON.stringify(q), JSON.stringify(body || {})));
    if (p === "/api/meta" && out.status === 200) {
      out.body.default_provider = live ? "cboe" : "mock";
      if (!live) out.body.providers = ["mock"];
      const note = document.getElementById("siteNote");
      if (note) note.innerHTML = live
        ? "Live CBOE delayed data. Everything runs in your browser; nothing you enter leaves this device."
        : "<b>Demo mode:</b> this browser couldn't read CBOE's live data (CBOE may not allow other websites to load it), so this page runs on synthetic market data. For live quotes, run the app in Termux. Everything runs in your browser; nothing you enter leaves this device.";
    }
    if (out.status !== 200 || (out.body && out.body.error)) throw out.body || { error: "HTTP " + out.status };
    return out.body;
  };
})();
