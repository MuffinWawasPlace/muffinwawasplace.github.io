/* App controller: state, requests, event delegation, view switching. */
"use strict";
(() => {
  const { $, $$, api, store, esc } = U;
  const S = {
    meta: null, R: null, view: "board", arena: "put", arenaSel: {}, picked: new Set(), busy: false,
    drawer: null, dtab: "score", detailCache: {}, chartSel: null,
    chartShow: { sma20: true, sma50: true, sma200: true, atr: false, levels: true, cone: true, strikes: true },
    pf: null, rememberPf: false, pfImport: null, assignmentOk: false,
    weights: {}, cfg: null, eventsText: "", rememberCfg: false, B: null,
    bt: { policy: "cash_secured_put", dte: 30, target_delta: 0.2, iv_premium: 1.1, spread_pct: 0.05, commission: 0.65 },
  };

  /* ------------------------------------------------------------------ init */
  async function init() {
    try { S.meta = await api("/api/meta"); } catch (e) { banner("error", e); return; }
    $("#ver").textContent = "v" + S.meta.version;
    const prov = $("#provider");
    prov.innerHTML = S.meta.providers.map((p) => `<option value="${p}">${p === "mock" ? "MOCK (synthetic)" : "CBOE delayed"}</option>`).join("");
    prov.value = store.get("provider", S.meta.default_provider);
    if (!prov.value) prov.value = S.meta.default_provider;
    $("#scenario").innerHTML = Object.entries(S.meta.scenarios).map(([k, d]) => `<option value="${k}" title="${esc(d)}">${U.title(k)}</option>`).join("");
    $("#scenario").value = store.get("scenario", "bull_pullback");
    $("#symbol").value = store.get("symbol", "SPY");
    S.rememberPf = store.get("rememberPf", false);
    S.pf = blankPf();
    if (S.rememberPf) {
      const saved = store.get("pf2", null), oldText = store.get("portfolio", "");
      if (saved) S.pf = normPf(saved);
      else if (oldText) {            // one-time move from the old free-text box into the form
        try { const r = await api("/api/portfolio/parse", { text: oldText }); if (r.ok) { S.pf = formFrom(r.portfolio); store.set("pf2", S.pf); } } catch (e) { /* keep blank */ }
        store.del("portfolio");
      }
    }
    S.assignmentOk = store.get("assignmentOk", false);
    S.rememberCfg = store.get("rememberCfg", false);
    resetCfg();
    if (S.rememberCfg) {
      const saved = store.get("cfg", null), w = store.get("weights", null);
      if (saved) S.cfg = { ...S.cfg, ...saved, limits: { ...S.cfg.limits, ...(saved.limits || {}) }, delta_bands: { ...S.cfg.delta_bands, ...(saved.delta_bands || {}) } };
      if (w) S.weights = { ...S.weights, ...w };
      S.eventsText = store.get("events", "");
    }
    syncScenario();
    renderStatic();
    run();
  }
  function resetCfg() {
    const d = S.meta.defaults;
    S.cfg = { enter_threshold: d.enter_threshold, avoid_threshold: d.avoid_threshold, dte_min: d.dte_min, dte_max: d.dte_max,
      preferred_dte: d.preferred_dte, max_expirations: d.max_expirations, better_peer_margin: d.better_peer_margin,
      wide_spread_pct: d.wide_spread_pct, max_spread_pct: d.max_spread_pct, min_open_interest: d.min_open_interest,
      risk_free: d.risk_free, div_yield: d.div_yield, allow_weeklies: d.allow_weeklies, include_hypothetical: d.include_hypothetical,
      delta_bands: JSON.parse(JSON.stringify(d.delta_bands)), limits: { ...d.limits } };
    S.weights = { ...d.weights };
  }
  const syncScenario = () => { $("#scenario").classList.toggle("hidden", $("#provider").value !== "mock"); };

  /* ------------------------------------------------------------------ requests */
  function parseEvents(text) {
    const out = [];
    (text || "").split(/\n+/).forEach((line) => {
      const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(.+?)(?:\s+(HIGH|MEDIUM|LOW))?(?:\s*\[([A-Za-z0-9.,\s]+)\])?$/i);
      if (!m) return;
      out.push({ date: m[1], name: m[2].trim(), risk: (m[3] || "MEDIUM").toUpperCase(), kind: /earn/i.test(m[2]) ? "earnings" : /ex-?div/i.test(m[2]) ? "ex_dividend" : "user",
        symbols: m[4] ? m[4].split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase()) : [] });
    });
    return out;
  }
  function request() {
    return { symbol: $("#symbol").value.trim().toUpperCase(), provider: $("#provider").value, scenario: $("#scenario").value,
      portfolio: pfPayload(), assignment_ok: S.assignmentOk, weights: S.weights, config: S.cfg,
      events: parseEvents(S.eventsText) };
  }
  async function run() {
    if (S.busy) return;
    S.busy = true;
    const btn = $("#runBtn");
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Analyzing';
    const req = request();
    store.set("symbol", req.symbol); store.set("provider", req.provider); store.set("scenario", req.scenario);
    try {
      S.R = await api("/api/analyze", req);
      S.detailCache = {}; S.picked.clear(); S.chartSel = null; S.arenaSel = {}; S.B = null;
      $("#boardEmpty").classList.add("hidden");
      banners();
      renderAll();
    } catch (e) {
      banner("error", e);
    } finally {
      S.busy = false; btn.disabled = false; btn.textContent = "Analyze";
    }
  }

  /* ------------------------------------------------------------------ banners */
  function banner(kind, e) {
    const msg = e && (e.error || e.message) || String(e);
    $("#banners").innerHTML = `<div class="banner ${kind}" role="alert"><div><b>${esc(msg)}</b>${e && e.hint ? `<div>${esc(e.hint)}</div>` : ""}</div></div>`;
  }
  function banners() {
    const R = S.R, out = [];
    if (R.meta.is_mock) out.push(`<div class="banner mock"><div><b>Mock data.</b> Synthetic scenario "${esc(U.title(R.meta.provider_info.scenario))}": ${esc(R.meta.provider_info.scenario_description)}. Nothing here is a real quote or event.</div></div>`);
    const f = R.underlying.freshness || {};
    if (R.underlying.quotes_missing) out.push(`<div class="banner error" role="alert"><div><b>CBOE sent this chain without bid/ask quotes.</b> Option marks, Greeks and scores are unreliable for this run. This usually clears within a few minutes of the open: press Analyze again.</div></div>`);
    if (!R.meta.is_mock && (f.stale || f.market_session === "closed")) out.push(`<div class="banner"><div>${esc(f.note)}</div></div>`);
    $("#banners").innerHTML = out.join("");
  }

  /* ------------------------------------------------------------------ rendering */
  function renderStatic() {
    $("#view-settings").innerHTML = V.settings({ labels: S.R ? S.R.config.labels : {} }, S);
    $("#view-backtest").innerHTML = V.backtest(S.B, S);
    if (!S.R) $("#view-portfolio").innerHTML = V.portfolio(null, S);
  }
  function renderAll() {
    const R = S.R;
    $("#board").innerHTML = V.board(R, S);
    $("#view-regime").innerHTML = V.regime(R);
    $("#view-chart").innerHTML = V.chart(R, S);
    $("#view-history").innerHTML = V.history(R);
    $("#view-portfolio").innerHTML = V.portfolio(R, S);
    $("#view-diagnostics").innerHTML = V.diagnostics(R);
    renderStatic();
    paintImport();
    tray();
    if (S.view === "chart") drawChart();
  }
  function renderBoard() { $("#board").innerHTML = V.board(S.R, S); tray(); }
  function drawChart() {
    const cv = $("#priceChart");
    if (!cv || !S.R) return;
    const t = S.chartSel || S.R.headline;
    C.price(cv, S.R.chart, { show: S.chartShow, selected: t ? t.legs.map((l) => l.strike) : [],
      selectedLabels: t ? t.legs.map((l) => `${l.action} ${l.strike}${l.right}`) : [] });
  }
  function drawBt() {
    const cv = $("#btChart");
    if (!cv || !S.B || !S.B.available) return;
    const pts = (run) => run.stats.curve ? run.stats.curve.map((p) => ({ x: p.date, y: p.cum })) : [];
    C.lines(cv, [{ name: "Gated", color: getComputedStyle(document.documentElement).getPropertyValue("--s1"), points: pts(S.B.runs.gated), labelDy: -8 },
      { name: "Always", color: getComputedStyle(document.documentElement).getPropertyValue("--s2"), dash: [7, 4], points: pts(S.B.runs.always), labelDy: 8 }], { fmt: (v) => U.usd0(v) });
  }
  function show(view) {
    S.view = view;
    $$(".tab[data-view]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === view)));
    $$(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + view));
    const tr = $("#trayRoot"); if (tr) tr.classList.toggle("hidden", view !== "board");
    if (view === "chart") requestAnimationFrame(drawChart);
    if (view === "backtest") requestAnimationFrame(drawBt);
    window.scrollTo({ top: 0 });
  }
  function tray() {
    const n = S.picked.size;
    $("#trayRoot").innerHTML = n ? `<div class="tray"><span class="small">${n} selected</span><button class="btn btn-primary" id="cmpBtn" ${n < 2 ? "disabled" : ""}>Compare</button><button class="btn btn-ghost" id="cmpClear">Clear</button></div>` : "";
  }

  /* ------------------------------------------------------------------ drawer */
  async function openTrade(id) {
    if (!S.R) return;
    S.dtab = S.drawer && S.drawer.trade.id !== id ? S.dtab : S.dtab || "score";
    try {
      const d = S.detailCache[id] || await api(`/api/trade?aid=${encodeURIComponent(S.R.analysis_id)}&id=${encodeURIComponent(id)}`);
      S.detailCache[id] = d;
      S.drawer = d;
      S.chartSel = { label: d.trade.action, legs: d.trade.legs };
      paintDrawer();
    } catch (e) { banner("error", e); }
  }
  function paintDrawer() {
    $("#drawerRoot").innerHTML = V.drawer(S.drawer, S.dtab, S.R);
    document.body.style.overflow = "hidden";
    const x = $(".drawer .x"); if (x) x.focus({ preventScroll: true });
  }
  function closeDrawer() { $("#drawerRoot").innerHTML = ""; S.drawer = null; document.body.style.overflow = ""; }
  async function openCompare() {
    try {
      const c = await api("/api/compare", { aid: S.R.analysis_id, ids: Array.from(S.picked) });
      $("#drawerRoot").innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Compare contracts" style="width:min(980px,100vw)">
        <div class="drawer-head" style="padding-bottom:12px"><div class="drawer-title"><h2>Contracts head to head</h2><button class="btn btn-ghost x" data-close>Close</button></div></div>
        <div class="drawer-body">${V.comparePanel(c)}</div></aside>`;
      document.body.style.overflow = "hidden";
    } catch (e) { banner("error", e); }
  }

  /* ------------------------------------------------------------------ settings + portfolio actions */
  function readSettings() {
    $$("[data-weight]").forEach((el) => { S.weights[el.dataset.weight] = +el.value; });
    $$("[data-cfg]").forEach((el) => { const k = el.dataset.cfg; S.cfg[k] = el.tagName === "SELECT" ? el.value === "true" : +el.value; });
    $$("[data-lim]").forEach((el) => { S.cfg.limits[el.dataset.lim] = +el.value; });
    $$("[data-band]").forEach((el) => { const [k, i] = el.dataset.band.split(":"); S.cfg.delta_bands[k][+i] = +el.value; });
    const ev = $("#evText"); if (ev) S.eventsText = ev.value;
    S.rememberCfg = !!($("#cfgRemember") || {}).checked;
    store.set("rememberCfg", S.rememberCfg);
    if (S.rememberCfg) { store.set("cfg", S.cfg); store.set("weights", S.weights); store.set("events", S.eventsText); }
    else { store.del("cfg"); store.del("weights"); store.del("events"); }
  }
  /* portfolio form state: plain strings exactly as typed; converted once in pfPayload() */
  function blankPf() { return { cash: "", mm: [], stocks: [], options: [] }; }
  const newRow = { mm: () => ({ symbol: "", amount: "" }), stocks: () => ({ symbol: "", qty: "" }),
    options: () => ({ side: "short", contracts: "1", symbol: "", right: "P", strike: "", expiration: "", entry: "" }) };
  function normPf(x) {
    const f = blankPf();
    f.cash = x && x.cash != null ? String(x.cash) : "";
    ["mm", "stocks", "options"].forEach((k) => { f[k] = Array.isArray(x && x[k]) ? x[k].map((r) => ({ ...newRow[k](), ...r })) : []; });
    return f;
  }
  const fmtN = (v) => (v == null || v === "" ? "" : String(Math.round(+v * 1e6) / 1e6));
  /* server portfolio dict (from text parse or CSV import) -> form rows */
  function formFrom(p) {
    p = p || {};
    return normPf({
      cash: p.cash ? fmtN(p.cash) : "",
      mm: Object.entries(p.cash_equivalents || {}).map(([k, v]) => ({ symbol: k, amount: fmtN(v) })),
      stocks: Object.entries(p.stocks || {}).map(([k, v]) => ({ symbol: k, qty: fmtN(v) })),
      options: (p.options || []).map((o) => ({ side: (o.side || (o.qty < 0 ? "short" : "long")), contracts: String(o.contracts || Math.abs(o.qty)),
        symbol: o.symbol, right: o.right, strike: fmtN(o.strike), expiration: String(o.expiration).slice(0, 10), entry: o.entry ? fmtN(o.entry) : "" })),
    });
  }
  function pfEmpty(f) {
    const has = (r) => Object.entries(r).some(([k, v]) => !["side", "right", "contracts"].includes(k) && String(v).trim() !== "");
    return !String(f.cash).trim() && !f.mm.some(has) && !f.stocks.some(has) && !f.options.some(has);
  }
  function pfPayload() {
    const f = S.pf;
    if (!f || pfEmpty(f)) return null;
    return { cash: f.cash, cash_equivalents: f.mm.map((r) => ({ symbol: r.symbol, amount: r.amount })),
      stocks: f.stocks.map((r) => ({ symbol: r.symbol.trim().toUpperCase(), qty: r.qty })),
      options: f.options.map((r) => ({ side: r.side, qty: r.contracts, symbol: r.symbol.trim().toUpperCase(), right: r.right, strike: r.strike, expiration: r.expiration, entry: r.entry })) };
  }
  /* field-level checks so the exact box turns red; the server re-checks with the same rules */
  function pfProblems() {
    const f = S.pf, out = [], has = (v) => String(v == null ? "" : v).trim() !== "";
    const clean = (v) => String(v).replace(/[$,\s]/g, "");
    const numOk = (v) => has(v) && clean(v) !== "" && isFinite(+clean(v)) && +clean(v) >= 0;
    if (has(f.cash) && !numOk(f.cash)) out.push(["cash", "Cash must be a number (no letters)."]);
    f.mm.forEach((r, i) => { if (!has(r.symbol) && !has(r.amount)) return;
      if (!has(r.symbol)) out.push([`mm:${i}:symbol`, `Money-market row ${i + 1}: pick the fund.`]);
      if (!numOk(r.amount)) out.push([`mm:${i}:amount`, `Money-market row ${i + 1}: enter the dollar amount.`]); });
    f.stocks.forEach((r, i) => { if (!has(r.symbol) && !has(r.qty)) return;
      if (!/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(r.symbol.trim())) out.push([`stocks:${i}:symbol`, `Stock row ${i + 1}: enter a ticker like SPY.`]);
      if (!numOk(r.qty) || +clean(r.qty) === 0) out.push([`stocks:${i}:qty`, `Stock row ${i + 1}: enter how many shares (decimals OK).`]); });
    f.options.forEach((r, i) => { if (!has(r.symbol) && !has(r.strike) && !has(r.expiration)) return;
      const n = `Option row ${i + 1}`;
      if (!/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(r.symbol.trim())) out.push([`options:${i}:symbol`, `${n}: enter the ticker.`]);
      if (!/^\d+$/.test(String(r.contracts).trim()) || +r.contracts < 1) out.push([`options:${i}:contracts`, `${n}: contracts must be a whole number, 1 or more.`]);
      if (!numOk(r.strike) || +clean(r.strike) <= 0) out.push([`options:${i}:strike`, `${n}: enter the strike price.`]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expiration)) out.push([`options:${i}:expiration`, `${n}: pick the expiration date.`]);
      if (has(r.entry) && !numOk(r.entry)) out.push([`options:${i}:entry`, `${n}: price must be a number per share, like 1.20.`]); });
    return out;
  }
  function savePf() {
    S.rememberPf = !!($("#pfRemember") || {}).checked;
    S.assignmentOk = !!($("#pfAssign") || {}).checked;
    store.set("rememberPf", S.rememberPf); store.set("assignmentOk", S.assignmentOk);
    if (S.rememberPf) store.set("pf2", S.pf); else store.del("pf2");
    store.del("portfolio");
  }
  function pfSummary() {
    const f = S.pf, n = (a) => a.filter((r) => String(r.symbol || "").trim()).length;
    const c = (v) => +String(v).replace(/[$,\s]/g, "") || 0;
    const cash = c(f.cash) + f.mm.reduce((a, r) => a + c(r.amount), 0);
    return `Cash and money market ${U.usd(cash)} · ${n(f.stocks)} stock${n(f.stocks) === 1 ? "" : "s"} · ${n(f.options)} option${n(f.options) === 1 ? "" : "s"}`;
  }
  function repaintPf(msg) {
    const panel = $("#pfPanel"); if (!panel) return;
    const keepOpen = !!(document.querySelector(".pf-paste") || {}).open;
    panel.outerHTML = V.pfForm(S);
    if (keepOpen) $(".pf-paste").open = true;
    paintImport();
    if (msg) $("#pfMsg").innerHTML = msg;
  }
  function paintImport() {
    const box = $("#pfImport"), I = S.pfImport; if (!box) return;
    if (!I) { box.innerHTML = ""; return; }
    const accts = I.accounts.length > 1 ? `<label class="small">Account <select id="pfAcct"><option value="*">All accounts combined</option>${I.accounts.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join("")}</select></label>` : "";
    box.innerHTML = `<div class="pf-importbox"><div><b>${esc(I.broker)} file read:</b> ${I.rows_used} holding${I.rows_used === 1 ? "" : "s"} found${I.accounts.length > 1 ? ` across ${I.accounts.length} accounts` : ""}.</div>
      ${accts}<div class="pf-actions" style="margin-top:6px"><button class="btn btn-primary small" id="pfLoad">Put these in the form</button><button class="btn btn-ghost small" id="pfImpCancel">Cancel</button></div>
      ${(I.notes || []).map((x) => `<div class="small muted">${esc(x)}</div>`).join("")}
      ${I.skipped.length ? `<details class="small"><summary>${I.skipped.length} line(s) not used</summary>${I.skipped.map((x) => `<div class="faint">${esc(x)}</div>`).join("")}</details>` : ""}</div>`;
  }
  async function importFile(file) {
    $("#pfMsg").innerHTML = '<span class="spin"></span> reading file';
    if (file.size > 400 * 1024) { $("#pfMsg").innerHTML = '<span class="down">That file is too big for a positions export (over 400 KB).</span>'; return; }
    const text = await file.text();
    try {
      const r = await api("/api/portfolio/import_csv", { text });
      if (!r.ok) { S.pfImport = null; paintImport(); $("#pfMsg").innerHTML = `<span class="down">${esc(r.error)}</span>`; return; }
      S.pfImport = r; paintImport(); $("#pfMsg").innerHTML = "";
    } catch (e) { $("#pfMsg").innerHTML = `<span class="down">${esc(e.error || "Import failed")}</span>`; }
  }
  async function runBacktest() {
    S.bt = { policy: $("#btPolicy").value, dte: +$("#btDte").value, target_delta: +$("#btDelta").value, iv_premium: +$("#btIv").value,
      spread_pct: +$("#btSpread").value, commission: +$("#btComm").value };
    $("#btMsg").innerHTML = '<span class="spin"></span> running walk-forward';
    try {
      S.B = await api("/api/backtest", { symbol: $("#symbol").value.trim().toUpperCase(), provider: $("#provider").value, scenario: $("#scenario").value, params: S.bt });
      $("#view-backtest").innerHTML = V.backtest(S.B, S);
      requestAnimationFrame(drawBt);
    } catch (e) { $("#btMsg").textContent = (e.error || "failed") + (e.hint ? " " + e.hint : ""); }
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    const el = (sel) => t.closest(sel);
    if (el("[data-close]")) return closeDrawer();
    if (t.matches("[data-pick]")) {
      ev.stopPropagation();
      const id = t.dataset.pick;
      t.checked ? S.picked.add(id) : S.picked.delete(id);
      if (S.picked.size > 6) { S.picked.delete(id); t.checked = false; }
      return tray();
    }
    if (el(".row-pick")) return;
    const tab = el(".tab[data-view]"); if (tab) return show(tab.dataset.view);
    const go = el("[data-go]"); if (go) { closeDrawer(); return show(go.dataset.go); }
    const dt = el("[data-dtab]"); if (dt) { S.dtab = dt.dataset.dtab; return paintDrawer(); }
    const at = el("[data-arena]"); if (at) { S.arena = at.dataset.arena; return renderBoard(); }
    const as = el("[data-arena-strat]"); if (as) { const [a, k] = as.dataset.arenaStrat.split(":"); S.arenaSel[a] = { strategy: k }; return renderBoard(); }
    const ae = el("[data-arena-exp]"); if (ae) { const [a, e] = ae.dataset.arenaExp.split(":"); const cur = S.arenaSel[a] || {}; const ar = S.R.arenas.find((x) => x.key === a); S.arenaSel[a] = { strategy: cur.strategy || ar.default, exp: e }; return renderBoard(); }
    const op = el("[data-open]"); if (op) return openTrade(op.dataset.open);
    if (t.id === "cmpBtn") return openCompare();
    if (t.id === "cmpClear") { S.picked.clear(); $$("[data-pick]").forEach((x) => (x.checked = false)); return tray(); }
    const pa = el("[data-pfadd]"); if (pa) { S.pf[pa.dataset.pfadd].push(newRow[pa.dataset.pfadd]()); repaintPf(); const last = $$(`[data-pf^="${pa.dataset.pfadd}:${S.pf[pa.dataset.pfadd].length - 1}:"]`).find((x) => x.tagName === "INPUT"); if (last) last.focus(); return; }
    const pd = el("[data-pfdel]"); if (pd) { const [k, i] = pd.dataset.pfdel.split(":"); S.pf[k].splice(+i, 1); return repaintPf(); }
    if (t.id === "pfApply") {
      $$(".pf-f .bad").forEach((x) => x.classList.remove("bad"));
      const probs = pfProblems();
      if (probs.length) {
        probs.forEach(([k]) => { const x = $(`[data-pf="${k}"]`); if (x) x.classList.add("bad"); });
        const first = $(`[data-pf="${probs[0][0]}"]`); if (first) first.focus();
        $("#pfMsg").innerHTML = `<div class="down">${probs.map((p) => esc(p[1])).join("<br>")}</div>`; return;
      }
      try { const r = await api("/api/portfolio/check", { portfolio: pfPayload() });
        if (!r.ok) { $("#pfMsg").innerHTML = `<span class="down">${esc(r.error)}</span>`; return; }
        $("#pfMsg").innerHTML = `<span class="up">Saved. ${esc(pfSummary())}.</span>` + (r.portfolio.notes || []).map((n) => `<div class="waitbox small">${esc(n)}</div>`).join("");
      } catch (e) { $("#pfMsg").innerHTML = `<span class="down">${esc(e.error || "check failed")}</span>`; return; }
      savePf(); return run();
    }
    if (t.id === "pfClear") { S.pf = blankPf(); S.pfImport = null; savePf(); repaintPf(); return run(); }
    if (t.id === "pfFill") {
      try { const r = await api("/api/portfolio/parse", { text: $("#pfText").value });
        if (!r.ok) { $("#pfMsg").innerHTML = `<span class="down">${esc(r.error)}</span>`; return; }
        S.pf = formFrom(r.portfolio); repaintPf(`<span class="up">Filled the form: ${esc(pfSummary())}. Check it, then Save and re-run.</span>`);
      } catch (e) { $("#pfMsg").innerHTML = `<span class="down">${esc(e.error || "failed")}</span>`; }
      return;
    }
    if (t.id === "pfLoad" && S.pfImport) {
      const sel = $("#pfAcct"), v = sel ? sel.value : "*";
      S.pf = formFrom(v === "*" ? S.pfImport.combined : S.pfImport.accounts[+v].portfolio);
      S.pfImport = null; repaintPf(`<span class="up">Loaded: ${esc(pfSummary())}. Check it, then Save and re-run.</span>`); return;
    }
    if (t.id === "pfImpCancel") { S.pfImport = null; return paintImport(); }
    if (t.id === "cfgApply") { readSettings(); return run(); }
    if (t.id === "cfgReset") { resetCfg(); S.eventsText = ""; renderStatic(); return; }
    if (t.id === "wReset") { S.weights = { ...S.meta.defaults.weights }; return renderStatic(); }
    if (t.id === "btRun") return runBacktest();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && S.drawer !== null) closeDrawer();
    if (ev.key === "Escape" && $(".drawer")) closeDrawer();
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches(".row[data-open], .strat-row[data-open]")) { ev.preventDefault(); openTrade(ev.target.dataset.open); }
  });
  document.addEventListener("input", (ev) => {
    const pk = ev.target.dataset && ev.target.dataset.pf;
    if (pk) {
      const parts = pk.split(":");
      let v = ev.target.value;
      if (/symbol$/.test(pk) && ev.target.tagName === "INPUT") { const p0 = ev.target.selectionStart; v = v.toUpperCase(); ev.target.value = v; try { ev.target.setSelectionRange(p0, p0); } catch (e) { /* number inputs */ } }
      if (parts.length === 1) S.pf[parts[0]] = v; else S.pf[parts[0]][+parts[1]][parts[2]] = v;
      ev.target.classList.remove("bad");
      return;
    }
    if (ev.target.matches("[data-weight]")) {
      S.weights[ev.target.dataset.weight] = +ev.target.value;
      const tot = Object.values(S.weights).reduce((a, b) => a + b, 0) || 1;
      $$("[data-weight]").forEach((el) => { el.parentElement.lastElementChild.textContent = (S.weights[el.dataset.weight] / tot * 100).toFixed(0) + "%"; });
    }
  });
  document.addEventListener("change", (ev) => {
    if (ev.target.matches("[data-show]")) { S.chartShow[ev.target.dataset.show] = ev.target.checked; drawChart(); }
    if (ev.target.id === "provider") { syncScenario(); }
    if (ev.target.matches("select[data-pf]")) { const [k, i, f] = ev.target.dataset.pf.split(":"); S.pf[k][+i][f] = ev.target.value; }
    if (ev.target.id === "pfFile" && ev.target.files && ev.target.files[0]) { importFile(ev.target.files[0]); ev.target.value = ""; }
  });
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); run(); });
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (S.view === "chart") drawChart(); if (S.view === "backtest") drawBt(); }, 150); });
  init();
})();
