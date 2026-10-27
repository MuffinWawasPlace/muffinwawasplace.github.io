/* View renderers: pure functions (result + UI state) -> HTML strings. All values are escaped. */
"use strict";
const V = (() => {
  const { esc, num, usd, usd0, susd, pct, spct, sgn, title, kind, status, ok } = U;
  const shortDate = (iso) => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  const STATS = [["attack", "Attack", "return potential / premium efficiency (risk-reward component)"],
    ["armor", "Armor", "distance from danger: technical fit blended with model P(profit)"],
    ["speed", "Speed", "time-decay profile (theta component)"], ["shield", "Shield", "volatility pricing (vol-edge component)"],
    ["supply", "Supply", "liquidity: spread, open interest, volume"], ["power", "Power", "|net delta| in shares per contract"]];

  /* ================================================================== BOARD */
  function board(R, S) {
    const u = R.underlying, rg = R.regime, em = rg.expected_move || {};
    const chg = u.change_pct;
    const fresh = u.freshness || {};
    const head = R.headline;
    return `<div class="board"><div>
      <div class="panel">
        <div class="ticker">
          <div><div class="ticker-sym">${esc(u.symbol)}</div></div>
          <div class="ticker-px num">${usd(u.spot)}</div>
          <div class="ticker-chg ${chg >= 0 ? "up" : "down"}">${spct(chg, 2)} <span class="faint small">vs ${esc(u.change_ref || "n/a")}</span></div>
          <div class="chips" style="margin-left:auto"><span class="chip">${esc(u.spot_source)}${kind(u.is_mock ? "conceptual" : "observed")}</span>
            <span class="chip">${u.is_mock ? "Synthetic session" : esc(fresh.market_session === "open" ? "Market open" : "Market closed")}</span></div>
        </div>
        <div class="strip">
          <button class="cell" data-go="regime"><div class="cell-k">Regime ${kind("inferred")}</div><div class="cell-v">${esc(rg.label)}</div>
            <div class="cell-s">Confidence ${pct(rg.confidence, 0)} (agreement index)</div></button>
          <button class="cell" data-go="regime"><div class="cell-k">IV regime ${kind("calculated")}</div><div class="cell-v">${esc(rg.iv_regime.level)}</div>
            <div class="cell-s">ATM IV / realized ${ok(rg.iv_regime.ratio) ? rg.iv_regime.ratio.toFixed(2) : "n/a"}</div></button>
          <button class="cell" data-go="chart"><div class="cell-k">Expected move ${kind("calculated")}</div><div class="cell-v">${ok(em.pct) ? "±" + pct(em.pct) : "n/a"}</div>
            <div class="cell-s">${em.dte != null ? `to ${shortDate(em.focus_expiration)} (${em.dte} DTE), ±${pct(em.daily_pct, 2)} per day` : esc(em.source || "")}</div></button>
          <button class="cell" data-go="regime"><div class="cell-k">Volatility ${kind("calculated")}</div><div class="cell-v">${esc(rg.volatility.text || "n/a")}</div>
            <div class="cell-s">RV20 ${pct(rg.volatility.rv20)} at the ${pct(rg.volatility.rv_pctile, 0)} percentile</div></button>
        </div>
      </div>
      ${head ? lock(head, R) : `<div class="panel"><h3>No qualifying setup</h3><p class="muted">Every candidate failed a hard quality gate. Open Diagnostics for the reasons.</p></div>`}
      ${arena(R, S)}
    </div>
    <aside>${regimeCard(R)}${eventsCard(R)}${R.portfolio.entered ? portfolioCard(R) : ""}</aside></div>`;
  }

  function lock(h, R) {
    const z = h.zone || {};
    const credit = h.price.side === "CREDIT";
    const legs = h.legs.map((l) => `${l.action} ${l.strike}${l.right}`).join(" + ") + (h.stock_units ? " + 100 shares" : "");
    return `<section class="lock" style="margin-top:12px" aria-label="Highest-ranked setup">
      <div class="lock-top">${C.ring(h.score, h.status)}
        <div style="min-width:0;flex:1">
          <div class="small muted">Highest-ranked setup under the current model</div>
          <div class="lock-action">${esc(h.action)}</div>
          <div class="lock-sub">${esc(h.name)}: ${esc(legs)}, ${shortDate(h.expiration)} (${h.dte} DTE)</div>
        </div>
        <div class="lock-side">${status(h.status)}<button class="btn" data-open="${esc(h.id)}">Inspect calculation</button></div>
      </div>
      ${h.hypothetical ? `<div class="waitbox">${R.portfolio.entered ? esc(h.requirements.join("; ")) : "Assumes you own 100 " + esc(R.underlying.symbol) + " shares per contract. No portfolio entered, so this is ranked as a hypothetical."}</div>` : ""}
      <div class="prices">
        <div><div class="price-k">Current mid ${kind("calculated")}</div><div class="price-v">${usd(z.mid)}</div><div class="tiny faint">${credit ? "credit" : "debit"} per share</div></div>
        <div><div class="price-k">Preferred limit ${kind("calculated")}</div><div class="price-v">${usd(z.preferred)}</div><div class="tiny faint">score at this fill ${num(z.at_preferred_score, 1)}</div></div>
        <div><div class="price-k">Acceptable range ${kind("calculated")}</div><div class="price-v">${z.acceptable ? usd(z.acceptable[0]) + "–" + usd(z.acceptable[1]) : "none"}</div><div class="tiny faint">inside today's market</div></div>
        <div><div class="price-k">${esc(title(z.label_worst || "worst acceptable"))} ${kind("calculated")}</div><div class="price-v">${usd(z.worst_acceptable)}</div><div class="tiny faint">re-scored to the ENTER line ${num(z.threshold, 0)}</div></div>
      </div>
      <div class="ladder">${C.ladder(z)}</div><div class="ladder-key"><span><i style="width:10px;height:10px;border-radius:50%;background:var(--ice)"></i>preferred limit</span><span><i style="width:14px;height:8px;background:rgba(92,192,138,.22);border:1px solid var(--enter)"></i>acceptable fills</span><span><i style="width:0;height:12px;border-left:2px dashed var(--avoid)"></i>${esc(z.label_worst || "worst acceptable")}</span><span><i style="width:14px;height:8px;background:#1A3146;border:1px solid #2A4A63"></i>bid–ask</span></div>
      ${h.wait_condition ? `<div class="waitbox">${esc(h.wait_condition)}</div>` : ""}
      <div class="inval"><b>Thesis invalidation</b> ${kind(h.invalidation.kind)}: ${esc(h.invalidation.text)}</div>
      <div class="lock-grid">
        <div><h4>Why it ranked high</h4><ul>${h.why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h4>What could break it</h4><ul>${h.breaks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      ${(h.fit_statements || []).length && R.portfolio.entered ? `<hr class="rule"><h4>Portfolio fit ${h.portfolio_fit != null ? Math.round(h.portfolio_fit) + "/100" : ""}</h4><ul>${h.fit_statements.map((s) => `<li class="${s.tone === "bad" ? "down" : s.tone === "good" ? "up" : ""}">${esc(s.text)}</li>`).join("")}</ul>` : ""}
    </section>`;
  }

  function arena(R, S) {
    const tabs = [...R.arenas.map((a) => [a.key, a.title]), ["strategy", "Strategy battle"]];
    const cur = S.arena || "put";
    let body;
    if (cur === "strategy") body = strategyBattle(R);
    else {
      const a = R.arenas.find((x) => x.key === cur) || R.arenas[0];
      const sel = S.arenaSel[a.key] || {};
      const strat = sel.strategy && a.participants[sel.strategy] ? sel.strategy : a.default;
      const meta = a.strategies.find((s) => s.key === strat) || {};
      const all = a.participants[strat] || [];
      const exps = Array.from(new Set(all.map((p) => p.expiration))).sort();
      const exp = sel.exp && exps.includes(sel.exp) ? sel.exp : (meta.best_expiration || exps[0]);
      const list = all.filter((p) => p.expiration === exp);
      const live = list.filter((p) => !p.disqualified).sort((x, y) => y.score - x.score);
      const dq = list.filter((p) => p.disqualified);
      const thrE = R.config.enter_threshold, thrA = R.config.avoid_threshold;
      body = `<div class="arena-controls">
          <div class="chips" role="group" aria-label="Strategy">${a.strategies.map((s) => `<button class="chip" data-arena-strat="${a.key}:${s.key}" aria-pressed="${s.key === strat}">${esc(s.name)} <span class="faint">${s.best_score != null ? Math.round(s.best_score) : "–"}</span></button>`).join("")}</div>
          <div class="chips" role="group" aria-label="Expiration">${exps.map((e) => `<button class="chip" data-arena-exp="${a.key}:${e}" aria-pressed="${e === exp}">${shortDate(e)}</button>`).join("")}</div>
        </div>
        <div class="small muted" style="margin-bottom:4px">${live.length} contracts competing, ranked by Trade Quality. Ticks mark the AVOID (${thrA}) and ENTER (${thrE}) lines.</div>
        ${live.map((p, i) => row(p, i + 1, R, S, i === 0)).join("") || `<div class="empty small">No qualifying contracts for this strategy and expiration.</div>`}
        ${dq.length ? `<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">${dq.length} disqualified by quality gates</summary>${dq.map((p) => row(p, "–", R, S, false)).join("")}</details>` : ""}
        <div class="legend-stats">${STATS.map(([k, n, d]) => `<span title="${esc(d)}"><b>${n}</b> ${esc(d.split(":")[0].split("(")[0])}</span>`).join("")} <span>${kind("conceptual")} radar is a visual summary of score components</span></div>`;
    }
    return `<section class="panel" style="margin-top:12px">
      <div class="arena-tabs" role="tablist">${tabs.map(([k, t]) => `<button class="arena-tab" role="tab" data-arena="${k}" aria-selected="${k === cur}">${esc(t)}</button>`).join("")}</div>
      ${body}</section>`;
  }

  function row(p, rank, R, S, lead) {
    const thrE = R.config.enter_threshold, thrA = R.config.avoid_threshold;
    const m = p.metrics;
    const picked = S.picked.has(p.id);
    const cr = p.price.side === "CREDIT";
    const meta = [
      `<span>|Δ| ${num(m.primary_delta, 2)}</span>`,
      `<span>${cr ? "credit" : "debit"} ${usd(p.price.mid)}</span>`,
      m.em_ratio != null ? `<span>${num(m.em_ratio, 2)}× EM</span>` : "",
      m.pop != null ? `<span>P(profit) ${pct(m.pop, 0)}</span>` : "",
      `<span>OI ${(p.legs[0].oi || 0).toLocaleString()}</span>`,
      p.hypothetical ? `<span class="faint">needs shares/cash</span>` : "",
      p.disqualified ? `<span class="down">${esc(p.gates[0] || "gated")}</span>` : (p.reasons[0] ? `<span class="faint">${esc(p.reasons[0])}</span>` : ""),
    ].join("");
    return `<div class="row ${lead ? "lead" : ""} ${p.disqualified ? "dq" : ""}" data-open="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.action)} score ${p.score}">
      <span class="row-rank">${rank}</span>
      <div class="row-name"><span class="row-label">${esc(p.label)}</span><span class="small muted">${shortDate(p.expiration)}, ${p.dte}d</span>${status(p.status)}</div>
      <div class="row-bar"><div class="bar"><div class="bar-fill ${lead ? "sel" : ""}" style="width:${Math.max(1, p.score)}%"></div>
        <i class="bar-tick avoid" style="left:${thrA}%"></i><i class="bar-tick enter" style="left:${thrE}%"></i></div><span class="bar-num">${Math.round(p.score)}</span></div>
      <div class="row-meta">${meta}</div>
      <div class="row-radar">${C.radar(p.battle, 52, lead)}</div>
      <label class="row-pick" title="Add to comparison"><input type="checkbox" data-pick="${esc(p.id)}" ${picked ? "checked" : ""} aria-label="Compare ${esc(p.label)}"></label>
    </div>`;
  }

  function strategyBattle(R) {
    return `<div class="small muted" style="margin-bottom:6px">Which kind of exposure fits this environment? Regime fit is the strategy-level component; the score is its best candidate.</div>` +
      R.strategies.map((s) => `<div class="strat-row" ${s.best ? `data-open="${esc(s.best.id)}"` : ""}>
        <div><b>${esc(s.name)}</b> <span class="faint small">${esc(title(s.family))}</span>
          <div class="small muted">${s.best ? esc(s.best.action) + ", " + shortDate(s.best.expiration) + " " + status(s.best.status) : "no qualifying candidate"}</div>
          <div class="fitbar" title="regime fit ${num(s.regime_fit, 2)}"><i style="width:${Math.round(s.regime_fit * 100)}%"></i></div>
          <div class="tiny faint">regime fit ${num(s.regime_fit, 2)}; ${s.n} candidates, ${s.n_disqualified} gated</div></div>
        <div class="bar-num" style="align-self:center">${s.best_score != null ? Math.round(s.best_score) : "–"}</div></div>`).join("");
  }

  function regimeCard(R) {
    const rg = R.regime, tf = rg.timeframes;
    const names = { daily: "Daily", weekly: "Weekly", short_term: "Short-term", intraday: "4H / 1H" };
    const lean = Math.max(-1, Math.min(1, rg.posture.D_eff || 0));
    return `<section class="panel"><div class="panel-head"><h3>Regime engine</h3><button class="btn btn-ghost sp small" data-go="regime">Details</button></div>
      <div class="cell-v" style="font-size:22px">${esc(rg.label)}</div>
      <div class="small muted">Confidence ${pct(rg.confidence, 0)} (agreement index, not a probability)</div>
      <div class="meter"><i style="width:${Math.round(rg.confidence * 100)}%"></i></div>
      <div class="tf" style="margin-top:12px">${Object.keys(names).map((k) => `<span class="k2">${names[k]}</span><span>${tf[k] && tf[k].available ? esc(tf[k].label) : `<span class="faint">Unavailable</span>${kind("unavailable")}`}</span>`).join("")}
        <span class="k2">Volatility</span><span>${esc(rg.volatility.text)}</span></div>
      <div class="small muted" style="margin-top:12px">Directional lean (bearish to bullish) ${sgn(lean)}</div>
      <div class="lean"><div class="axis"></div><div class="mid"></div><div class="dot" style="left:${50 + lean * 50}%"></div></div>
      ${(rg.override_notes || []).length ? `<div class="note">${esc(rg.override_notes[0])}</div>` : ""}</section>`;
  }

  function eventsCard(R) {
    const ev = R.events.items.slice(0, 6);
    return `<section class="panel"><div class="panel-head"><h3>Events</h3><span class="sp tiny faint">earnings / ex-div not in feed</span></div>
      ${ev.length ? ev.map((e) => `<div class="ev"><span class="num">${shortDate(e.date)}<div class="tiny faint">${e.days_away}d</div></span>
        <span>${esc(e.name)}<div class="tiny faint">${esc(e.time_et)}</div></span><span class="risk-${esc(e.risk)} small">${esc(title(e.risk.toLowerCase()))}</span></div>`).join("")
        : `<div class="small muted">No scheduled events in the next 120 days.</div>`}
      <div class="note">${esc(R.events.coverage.earnings)}</div></section>`;
  }

  function portfolioCard(R) {
    const st = R.portfolio.state;
    if (!st) return "";
    return `<section class="panel"><div class="panel-head"><h3>Portfolio</h3><button class="btn btn-ghost sp small" data-go="portfolio">Open</button></div>
      <dl class="kv"><dt>Equity</dt><dd>${usd0(st.equity)}</dd><dt>Free cash</dt><dd>${usd0(st.free_cash)}</dd>
      <dt>Delta</dt><dd>${usd0(st.totals.delta_usd)}</dd><dt>Vega / pt</dt><dd>${usd0(st.totals.vega_usd)}</dd><dt>Theta / day</dt><dd>${usd0(st.totals.theta_usd)}</dd></dl>
      ${(R.portfolio.management && R.portfolio.management.results.length) ? `<hr class="rule">${R.portfolio.management.results.map((m) => `<div class="small"><b>${esc(m.action.replace("_", " "))}</b> ${esc(m.position)}</div>`).join("")}` : ""}</section>`;
  }

  /* ================================================================== DETAIL DRAWER */
  function drawer(d, tab, R) {
    const t = d.trade;
    const tabs = [["score", "Score"], ["entry", "Entry"], ["risk", "Risk"], ["size", "Size & portfolio"], ["debug", "Debugger"]];
    let body = "";
    if (tab === "score") body = scoreTab(d, R);
    else if (tab === "entry") body = entryTab(d);
    else if (tab === "risk") body = riskTab(d);
    else if (tab === "size") body = sizeTab(d);
    else body = debugTab(d);
    return `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Trade detail">
      <div class="drawer-head"><div class="drawer-title">${C.ring(t.score, t.status)}
        <div style="min-width:0"><div class="lock-action" style="font-size:22px">${esc(t.action)}</div>
          <div class="small muted">${esc(t.name)}, ${shortDate(t.expiration)} (${t.dte} DTE) ${t.hypothetical ? "· hypothetical: needs shares/cash" : ""}</div>
          <div style="margin-top:4px">${status(t.status)}</div></div>
        <button class="btn btn-ghost x" data-close aria-label="Close">Close</button></div>
        <div class="subtabs" role="tablist">${tabs.map(([k, n]) => `<button class="tab" role="tab" data-dtab="${k}" aria-selected="${k === tab}">${n}</button>`).join("")}</div></div>
      <div class="drawer-body">${body}</div></aside>`;
  }

  function scoreTab(d, R) {
    const t = d.trade;
    const comps = t.components.map((c) => `<div class="comp"><div><b>${esc(c.label)}</b> <span class="faint small">factor ${num(c.factor, 2)} × weight ${num(c.weight, 1)}</span></div>
      <div class="r num" style="text-align:right"><b>${num(c.points, 1)}</b><span class="faint">/${num(c.weight, 0)}</span></div>
      <div class="comp-bar"><i style="width:${Math.round(c.factor * 100)}%"></i></div><ul>${(c.explain || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("");
    const pen = t.penalties.length ? t.penalties.map((p) => `<div class="comp"><div>${esc(title(p.key))} <span class="faint small">${esc(p.why)}</span></div><div class="down" style="text-align:right">${num(p.points, 1)}</div></div>`).join("") : `<div class="small muted">No penalties.</div>`;
    const gates = t.gates.length ? `<div class="banner error" style="margin:0 0 10px">Disqualified: ${esc(t.gates.join("; "))}</div>` : "";
    const lg = t.legs.map((l) => `<tr><td>${esc(l.action)}</td><td>${l.strike}${l.right}</td><td class="r">${usd(l.bid)}</td><td class="r">${usd(l.ask)}</td><td class="r">${pct(l.iv)}</td><td class="r">${num(l.delta, 3)}</td><td class="r">${(l.oi || 0).toLocaleString()}</td></tr>`).join("");
    return `${gates}<div class="tscroll"><table class="t"><tr><th>Leg</th><th>Strike</th><th class="r">Bid ${kind("observed")}</th><th class="r">Ask</th><th class="r">IV</th><th class="r">Delta ${kind("calculated")}</th><th class="r">OI</th></tr>${lg}</table></div>
      <h3 style="margin-top:14px">Trade Quality ${num(t.score, 1)} / 100</h3>
      <div class="small muted">Components sum to ${num(t.raw_score, 1)}; penalties ${num(t.score - t.raw_score, 1)} (floor 0, cap 100). Weights are configurable in Settings.</div>
      ${comps}<h4 style="margin-top:14px">Penalties</h4>${pen}
      <h4 style="margin-top:14px">Why it ranks here</h4><ul class="small">${d.why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${d.nearby.length ? `<h4 style="margin-top:14px">Nearby strikes, same expiration</h4><table class="t">${d.nearby.map((n) => `<tr data-open="${esc(n.id)}" style="cursor:pointer"><td>${esc(n.label)}</td><td>|Δ| ${num(n.delta, 2)}</td><td class="r">${num(n.score, 1)}</td><td>${status(n.status)}</td></tr>`).join("")}</table>` : ""}`;
  }

  function entryTab(d) {
    const z = d.zone || {}, dec = d.decision;
    const icon = { pass: "●", warn: "■", fail: "▲" };
    return `<div class="prices" style="margin-top:0">
        <div><div class="price-k">Current market ${kind("observed")}</div><div class="price-v">${usd(z.side === "CREDIT" ? z.natural : z.best)}–${usd(z.side === "CREDIT" ? z.best : z.natural)}</div><div class="tiny faint">bid–ask (net per share)</div></div>
        <div><div class="price-k">Preferred limit ${kind("calculated")}</div><div class="price-v">${usd(z.preferred)}</div><div class="tiny faint">score ${num(z.at_preferred_score, 1)}</div></div>
        <div><div class="price-k">Acceptable range</div><div class="price-v">${z.acceptable ? usd(z.acceptable[0]) + "–" + usd(z.acceptable[1]) : "none"}</div></div>
        <div><div class="price-k">${esc(title(z.label_worst || ""))}</div><div class="price-v">${usd(z.worst_acceptable)}</div></div></div>
      <div class="ladder">${C.ladder(z)}</div><div class="ladder-key"><span><i style="width:10px;height:10px;border-radius:50%;background:var(--ice)"></i>preferred limit</span><span><i style="width:14px;height:8px;background:rgba(92,192,138,.22);border:1px solid var(--enter)"></i>acceptable fills</span><span><i style="width:0;height:12px;border-left:2px dashed var(--avoid)"></i>${esc(z.label_worst || "worst acceptable")}</span><span><i style="width:14px;height:8px;background:#1A3146;border:1px solid #2A4A63"></i>bid–ask</span></div>
      <dl class="kv small" style="margin-top:8px"><dt>Mid</dt><dd>${usd(z.mid)} ${kind("calculated")}</dd><dt>Microprice</dt><dd>${z.microprice != null ? usd(z.microprice) + " (size-weighted)" : "n/a (multi-leg or no sizes)"}</dd>
        <dt>Natural fill score</dt><dd>${num(z.at_natural_score, 1)}</dd><dt>Preferred</dt><dd>${esc(z.preferred_note || "")}</dd><dt>Edge</dt><dd>${esc(z.worst_note || "")}</dd></dl>
      ${d.wait_condition ? `<div class="waitbox">${esc(d.wait_condition)}</div>` : ""}
      <div class="inval"><b>Entry invalidation</b> ${kind(d.invalidation.kind)}: ${esc(d.invalidation.text)}</div>
      <h3 style="margin-top:16px">Should I enter right now? ${status(dec.status)}</h3>
      ${dec.checks.map((c) => `<div class="check"><span class="ic-${c.status}" aria-label="${c.status}">${icon[c.status]}</span><b>${esc(title(c.name))}</b><span class="muted">${esc(c.detail)}</span></div>`).join("")}
      <div class="note">No single limit price is mathematically correct. The worst acceptable fill is found by re-scoring the trade at hypothetical prices until it crosses the ENTER line.</div>`;
  }

  function riskTab(d) {
    const r = d.risk;
    const sc = (r.scenarios || []).map((s) => `<tr><td>${sgn(s.move_em, 1)} EM</td><td class="r">${usd(s.spot)}</td><td class="r">${spct(s.move_pct)}</td><td class="r ${s.pnl_expiry_usd >= 0 ? "up" : "down"}">${susd(s.pnl_expiry_usd)}</td><td class="r">${s.pnl_half_time_usd != null ? susd(s.pnl_half_time_usd) : ""}</td></tr>`).join("");
    const am = (d.american || []).map((a) => `<li>${esc(a.leg)}: ${a.early_exercise_premium != null ? usd(a.early_exercise_premium, 3) + "/sh (" + pct(a.pct_of_mid) + " of mid)" : "n/a"}</li>`).join("");
    return `<div class="trio">
        <div><div class="price-k">Premium ${r.side === "CREDIT" ? "received" : "paid"} ${kind("observed")}</div><div class="big">${usd0(r.side === "CREDIT" ? r.premium_received_usd : r.premium_paid_usd)}</div><div class="tiny faint">per contract at mid</div></div>
        <div><div class="price-k">Obligation created ${kind("calculated")}</div><div class="small">${esc(r.obligation.text)}</div></div>
        <div><div class="price-k">Collateral required ${kind("calculated")}</div><div class="big">${usd0(r.collateral.amount_usd)}</div><div class="tiny faint">${esc(r.collateral.basis)}</div></div></div>
      ${r.side === "CREDIT" ? `<div class="note">Premium is compensation for the obligation above, not free income.</div>` : ""}
      <dl class="kv" style="margin-top:12px"><dt>Max theoretical loss</dt><dd>${r.max_loss_unbounded ? "UNBOUNDED" : usd0(r.max_loss_usd)} ${kind("calculated")}</dd>
        <dt>Max gain</dt><dd>${r.max_gain_unbounded ? "unbounded" : usd0(r.max_gain_usd)}</dd>
        <dt>Breakeven</dt><dd>${(r.breakevens || []).map((b, i) => usd(b) + " (" + spct(r.breakeven_distance_pct[i]) + ")").join(", ") || "n/a"}</dd>
        <dt>Capital at risk basis</dt><dd>${usd0(r.capital_basis_usd)} <span class="faint small">${esc(r.capital_basis_note)}</span></dd>
        <dt>Adverse 1 / 2 EM</dt><dd>${usd0(r.realistic_loss.adverse_1em_usd)} / ${usd0(r.realistic_loss.adverse_2em_usd)} ${kind("calculated")}</dd>
        <dt>Gap risk</dt><dd>${r.gap.available ? `${spct(r.gap.gap_pct)} gap → ${susd(r.gap.pnl_usd)}` : "unavailable"} ${kind(r.gap.available ? "estimated" : "unavailable")}</dd>
        <dt>Volatility risk</dt><dd>vega ${susd(r.vol_risk.vega_usd_per_vol_pt, 2)}/pt; +5 IV ${susd(r.vol_risk.pnl_iv_up5_usd)}, −5 IV ${susd(r.vol_risk.pnl_iv_down5_usd)}</dd>
        <dt>Directional</dt><dd>${num(r.directional.delta_shares, 1)} share-equivalents; ±1% ≈ ${susd(r.directional.pnl_up_1pct_usd)} / ${susd(r.directional.pnl_down_1pct_usd)}</dd>
        <dt>Theta</dt><dd>${susd(r.theta.per_day_usd, 2)} per day</dd>
        <dt>Liquidity</dt><dd>crossing the spread once costs ${usd0(r.liquidity_risk.spread_cost_usd)}</dd>
        <dt>Assignment</dt><dd>${esc(r.assignment.level)} ${kind("inferred")}<div class="small muted">${(r.assignment.notes || []).map(esc).join("<br>")}</div></dd>
        <dt>P(profit) at expiry</dt><dd>${pct(r.probability.profit_at_expiry)} ${kind("estimated")} <span class="faint small">risk-neutral model, not a forecast</span></dd></dl>
      <h4 style="margin-top:14px">Scenarios (expected-move multiples)</h4>
      <div class="tscroll"><table class="t"><tr><th>Move</th><th class="r">Spot</th><th class="r">%</th><th class="r">At expiry</th><th class="r">Half-time mark ${kind("estimated")}</th></tr>${sc}</table></div>
      <h4 style="margin-top:14px">American exercise check</h4><ul class="small">${am}</ul><div class="note">${esc(d.american_note)}</div>
      <h4 style="margin-top:14px">What could break it</h4><ul class="small">${d.breaks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  }

  function sizeTab(d) {
    const s = d.sizing, f = d.fit;
    const rows = s.rows.map((r) => `<tr><td>${r.contracts}</td><td class="r">${usd0(r.risk_usd)}</td><td class="r">${r.risk_pct != null ? pct(r.risk_pct) : "–"}</td><td class="r">${usd0(r.collateral_usd)}</td><td class="r">${usd0(r.delta_usd)}</td><td class="r">${usd0(r.vega_usd)}</td><td class="r">${usd0(r.theta_usd)}</td><td>${r.breaches.length ? `<span class="down small">${esc(r.breaches.join("; "))}</span>` : `<span class="up small">within limits</span>`}</td></tr>`).join("");
    return `<h3>Isolated quality ${num(d.trade.score, 1)} vs portfolio fit ${f.score != null ? num(f.score, 0) : "n/a"}</h3>
      <ul class="small">${f.statements.map((x) => `<li class="${x.tone === "bad" ? "down" : x.tone === "good" ? "up" : ""}">${esc(x.text)}</li>`).join("")}</ul>
      ${f.method ? `<div class="note">${esc(f.method)}</div>` : ""}
      <h4 style="margin-top:14px">Exposure by contract count</h4>
      <div class="tscroll"><table class="t"><tr><th>#</th><th class="r">Risk</th><th class="r">% equity</th><th class="r">Collateral</th><th class="r">Δ $</th><th class="r">Vega/pt</th><th class="r">Theta/day</th><th>Limits</th></tr>${rows}</table></div>
      <div class="note">Risk basis: ${esc(s.risk_basis)}. ${esc(s.note)} ${s.max_within_limits != null ? `<b>Inside every limit up to ${s.max_within_limits} contract(s).</b>` : ""}</div>`;
  }

  function debugTab(d) {
    return `<div class="small muted" style="margin-bottom:10px">Every stage the engine ran for this trade, in order. Each block is the exact data passed to the next stage.</div>
      <div class="pipe">${d.pipeline.map((p, i) => `<details class="pipe-step" ${i === 0 ? "open" : ""}><summary>${esc(p.stage)} ${kind(p.kind)} <span class="faint small">${esc(p.kind)}</span></summary><pre class="json">${U.json(p.data)}</pre></details>`).join("")}</div>`;
  }

  /* ================================================================== COMPARE */
  function comparePanel(c) {
    const W = c.winners, defs = c.definitions;
    const fields = [["Premium", (r) => susd(r.premium_usd)], ["Strategy", (r) => esc(r.strategy)], ["Expiration", (r) => `${shortDate(r.expiration)} (${r.dte}d)`],
      ["Delta (sh)", (r) => num(r.delta_shares, 1)], ["Gamma", (r) => num(r.gamma, 3)], ["Theta / day", (r) => susd(r.theta_usd, 2)], ["Vega / pt", (r) => susd(r.vega_usd, 2)],
      ["IV", (r) => pct(r.iv)], ["Liquidity", (r) => num(r.liquidity, 2)], ["EM coverage", (r) => r.em_coverage != null ? num(r.em_coverage, 2) + "×" : "n/a"],
      ["Level distance", (r) => r.support_distance_atr != null ? num(r.support_distance_atr, 1) + " ATR" : "n/a"],
      ["Breakeven", (r) => (r.breakevens || []).map((b) => usd(b)).join(", ")], ["P(profit)", (r) => pct(r.pop, 0)], ["Max loss", (r) => r.max_loss_usd == null ? "unbounded" : usd0(r.max_loss_usd)],
      ["Trade Quality", (r) => `<b>${num(r.score, 1)}</b> ${status(r.status)}`], ["Portfolio fit", (r) => r.portfolio_fit != null ? num(r.portfolio_fit, 0) : "n/a"],
      ["Portfolio impact", (r) => `<span class="small muted">${(r.portfolio_notes || []).map(esc).join("<br>") || "n/a"}</span>`]];
    const names = { safety: "Best for safety", premium: "Best for premium", theta: "Best for theta", liquidity: "Best for liquidity", overall: "Best overall fit" };
    return `<div class="winners">${Object.keys(names).map((k) => W[k] ? `<div class="winner" title="${esc(defs[k])}"><span class="small muted">${names[k]}</span><b>${esc(W[k].label)}</b></div>` : "").join("")}</div>
      <div class="tscroll"><table class="t"><tr><th></th>${c.rows.map((r) => `<th>${esc(r.label)}<div class="tiny faint">${esc(r.action)}</div></th>`).join("")}</tr>
      ${fields.map(([n, f]) => `<tr><td class="muted">${n}</td>${c.rows.map((r) => `<td>${f(r)}</td>`).join("")}</tr>`).join("")}</table></div>
      <div class="note">${Object.keys(defs).map((k) => `${names[k]}: ${esc(defs[k])}.`).join(" ")}</div>`;
  }

  /* ================================================================== REGIME */
  function regime(R) {
    const rg = R.regime, p = rg.posture, iv = rg.iv_regime;
    const names = { daily: "Daily", weekly: "Weekly", short_term: "Short-term (5-10 sessions)", intraday: "4H / 1H" };
    const tfr = Object.keys(names).map((k) => { const t = rg.timeframes[k] || {}; return `<tr><td>${names[k]}</td><td>${t.available ? `<b>${esc(t.label)}</b>` : `<span class="faint">Unavailable</span> ${kind("unavailable")}`}</td><td class="r">${t.norm != null ? sgn(t.norm) : ""}</td><td class="small muted">${esc(t.detail || "")}</td></tr>`; }).join("");
    const comps = (rg.components || []).map((c) => `<tr><td>${esc(c.name)}</td><td class="r">${c.value == null ? "n/a" : c.kind === "num" ? num(c.value, 1) : spct(c.value, 2)}</td><td class="r">${sgn(c.points, 1)}</td><td class="small faint">${esc(c.rule)}</td></tr>`).join("");
    const conf = rg.confidence_components.map((c) => `<tr><td>${esc(c.name)}</td><td class="r">${sgn(c.value, 3)}</td><td class="small muted">${esc(c.note)}</td></tr>`).join("");
    const trace = (rg.rule_trace || []).map((t) => `<details><summary class="small" style="cursor:pointer">${esc(t.rule)}</summary><pre class="json">${U.json(t)}</pre></details>`).join("");
    const ind = rg.indicators || {};
    const fit = rg.strategy_fit.map((s) => `<div class="strat-row" style="cursor:default"><div><b>${esc(s.name)}</b> <span class="faint small">${esc(title(s.family))}</span>
      <div class="fitbar"><i style="width:${Math.round(s.fit * 100)}%"></i></div><ul class="small muted" style="margin:4px 0 0;padding-left:16px">${s.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div class="bar-num" style="font-size:17px">${num(s.fit, 2)}</div></div>`).join("");
    return `<div class="two"><div>
      <section class="panel"><div class="small muted">Current regime ${kind("inferred")}</div><h2 style="font-size:30px">${esc(rg.label)}</h2>
        <div class="small muted">Confidence ${pct(rg.confidence, 0)}: agreement index built from the components below, not the probability of being right.</div>
        <div class="meter"><i style="width:${Math.round(rg.confidence * 100)}%"></i></div>
        <ul style="margin-top:12px">${rg.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${(rg.override_notes || []).map((x) => `<div class="waitbox small">${esc(x)}</div>`).join("")}
        ${(rg.notes || []).filter(Boolean).map((x) => `<div class="note">${esc(x)}</div>`).join("")}</section>
      <section class="panel"><h3>Timeframes</h3><div class="tscroll"><table class="t"><tr><th>Timeframe</th><th>View</th><th class="r">Lean</th><th>Inputs</th></tr>${tfr}</table></div>
        <div class="note">Short-term carries 15% of the blended lean and cannot relabel an intact higher-timeframe trend as a reversal. Intraday bars are not provided by the configured endpoints.</div></section>
      <section class="panel"><h3>Volatility and expected move</h3><dl class="kv">
        <dt>Volatility state</dt><dd>${esc(rg.volatility.text)}</dd><dt>RV5 / 10 / 20 / 60</dt><dd>${pct(rg.volatility.rv5)} / ${pct(rg.volatility.rv10)} / ${pct(rg.volatility.rv20)} / ${pct(rg.volatility.rv60)} ${kind("calculated")}</dd>
        <dt>RV20 percentile (1y)</dt><dd>${pct(rg.volatility.rv_pctile, 0)}</dd><dt>ATR14 / ATR50</dt><dd>${num(rg.volatility.atr_ratio, 2)}</dd>
        <dt>IV regime</dt><dd>${esc(iv.level)}: ${esc(iv.note)}</dd><dt>Term structure</dt><dd>${esc(R.volatility.term.label)}</dd>
        <dt>Expected move</dt><dd>${rg.expected_move.pct != null ? "±" + pct(rg.expected_move.pct) + " (" + usd(rg.expected_move.usd) + ") to " + esc(rg.expected_move.focus_expiration) : "n/a"} ${kind("calculated")}<div class="small muted">${esc(rg.expected_move.basis)}</div></dd></dl>
        <div class="note">IV rank is unavailable: the engine has no historical IV series, so richness is measured against realized volatility.</div></section>
      <section class="panel"><h3>Posture fed to strategy scoring</h3><dl class="kv"><dt>D (direction)</dt><dd>${sgn(p.D)} → effective ${sgn(p.D_eff)}</dd><dt>V (IV richness)</dt><dd>${sgn(p.V)}</dd>
        <dt>R (range-bound)</dt><dd>${num(p.R, 2)}</dd><dt>E (vol trend)</dt><dd>${sgn(p.E, 0)}</dd><dt>Hedge need</dt><dd>${num(p.hedge_need, 2)}</dd></dl>
        <ul class="small muted">${p.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
    </div><div>
      <section class="panel"><h3>What kind of exposure fits?</h3><div class="small muted">Regime fit by strategy: direction, volatility pricing and structure together.</div>${fit}</section>
      <section class="panel"><h3>Daily trend score (preserved legacy)</h3><div class="tscroll"><table class="t"><tr><th>Component</th><th class="r">Value</th><th class="r">Points</th><th>Rule</th></tr>${comps}</table></div></section>
      <section class="panel"><h3>Confidence build-up</h3><table class="t">${conf}</table></section>
      <section class="panel"><h3>Indicators</h3><dl class="kv small">
        <dt>SMA 20 / 50 / 200</dt><dd>${num(ind.sma20)} / ${num(ind.sma50)} / ${num(ind.sma200)}</dd><dt>RSI14</dt><dd>${num(ind.rsi14, 1)}</dd>
        <dt>ATR14</dt><dd>${num(ind.atr14)} (${pct(ind.atr14_pct, 2)})</dd><dt>Z vs SMA20</dt><dd>${sgn(ind.z20)} ATR</dd>
        <dt>Return 5 / 20 / 60d</dt><dd>${spct(ind.ret5)} / ${spct(ind.ret20)} / ${spct(ind.ret60)}</dd><dt>20d range</dt><dd>${num(ind.range20_atr, 1)} ATR</dd>
        <dt>Bollinger width pctile</dt><dd>${pct(ind.bb_width_pctile, 0)}</dd><dt>Volume vs 20d</dt><dd>${num(ind.vol_ratio, 2)}×</dd></dl></section>
      <section class="panel"><h3>Rule trace</h3><div class="small muted">Every classification rule, in evaluation order.</div>${trace}</section>
      ${eventsCard(R)}
    </div></div>`;
  }

  /* ================================================================== CHART */
  function chart(R, S) {
    const tg = S.chartShow;
    const box = (k, n, col, dash) => `<label><input type="checkbox" data-show="${k}" ${tg[k] ? "checked" : ""}>${col ? `<span class="sw" style="border-color:${col};border-top-style:${dash || "solid"}"></span>` : ""}${n}</label>`;
    const lv = R.technicals.levels;
    const sel = S.chartSel;
    return `<section class="panel"><div class="panel-head"><h3>${esc(R.underlying.symbol)} price structure</h3><span class="sp small muted">${sel ? "Showing " + esc(sel.label) : "Showing the highest-ranked setup"}</span></div>
      <div class="legend">${box("sma20", "SMA20", "var(--s1)")}${box("sma50", "SMA50", "var(--s2)", "dashed")}${box("sma200", "SMA200", "var(--s3)", "dotted")}
        ${box("atr", "ATR band (SMA20 ± 2 ATR)")}${box("levels", "Support / resistance")}${box("cone", "Expected move cone")}${box("strikes", "Candidate strikes")}</div>
      <div class="chart-wrap"><canvas class="chart" id="priceChart" aria-label="Price chart with moving averages, levels, expected move and strikes"></canvas></div>
      <div class="note">Candles are the observed daily history (${esc(R.underlying.history_source || "")}). Levels are inferred from past swing pivots; the cone is ±1/±2 standard deviations from ATM IV, a calculated range, not a forecast.</div></section>
      <div class="two" style="margin-top:12px"><section class="panel"><h3>Support ${kind("inferred")}</h3><table class="t"><tr><th>Price</th><th class="r">Distance</th><th class="r">Touches</th><th>Source</th></tr>
        ${lv.supports.map((l) => `<tr><td>${usd(l.price)}</td><td class="r">${num(l.distance_atr, 1)} ATR (${spct(l.distance_pct)})</td><td class="r">${l.touches}</td><td class="small muted">${esc(l.source)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">none</td></tr>`}</table></section>
      <section class="panel"><h3>Resistance ${kind("inferred")}</h3><table class="t"><tr><th>Price</th><th class="r">Distance</th><th class="r">Touches</th><th>Source</th></tr>
        ${lv.resistances.map((l) => `<tr><td>${usd(l.price)}</td><td class="r">${num(l.distance_atr, 1)} ATR (${spct(l.distance_pct)})</td><td class="r">${l.touches}</td><td class="small muted">${esc(l.source)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">none</td></tr>`}</table>
        <div class="note">${esc(lv.note || "")}</div></section></div>`;
  }

  /* ================================================================== HISTORY */
  function history(R) {
    const h = R.history;
    if (!h || !h.available) return `<section class="panel"><h3>Historical context</h3><p class="muted">${esc((h && h.note) || "unavailable")}</p></section>`;
    const d = h.daily, g = h.gaps;
    const mx = Math.max(d.abs_p90 || 0.01, 1e-6);
    const hb = (n, v) => `<div class="hbar"><span class="muted">${n}</span><span class="tr"><i style="width:${Math.min(100, (v || 0) / mx * 100)}%"></i></span><span class="num">${pct(v, 2)}</span></div>`;
    const sim = h.similar || {};
    const simRows = sim.available ? Object.keys(sim.horizons).map((k) => { const s = sim.horizons[k]; return s.insufficient || !s.n ? `<tr><td>${k} days</td><td colspan="6" class="muted">${esc(s.note || "insufficient")}</td></tr>` :
      `<tr><td>${k} days</td><td class="r">${s.n}</td><td class="r">${spct(s.mean)}</td><td class="r">${spct(s.median)}</td><td class="r">${spct(s.best)}</td><td class="r">${spct(s.worst)}</td><td class="r">${pct(s.pct_positive, 0)}</td></tr>`; }).join("") : "";
    const ex = Object.keys(h.excursions || {}).map((k) => { const e = h.excursions[k]; return `<tr><td>${k}d</td><td class="r">${spct(e.drawdown_p50)}</td><td class="r">${spct(e.drawdown_p90_worst)}</td><td class="r">${spct(e.drawdown_worst)}</td><td class="r">${spct(e.rally_p50)}</td><td class="r">${spct(e.rally_p90_best)}</td><td class="r">${pct(e.p_dip_3pct, 0)}</td></tr>`; }).join("");
    const st = h.streaks, sh = h.shocks, lb = h.levels;
    const lvl = (k, n) => lb[k] && lb[k].n >= 5 ? `<tr><td>${n}</td><td class="r">${lb[k].n}</td><td class="r">${spct(lb[k].mean_5d)}</td><td class="r">${pct(lb[k].pct_positive, 0)}</td></tr>` : `<tr><td>${n}</td><td class="r">${lb[k] ? lb[k].n : 0}</td><td colspan="2" class="muted">too few</td></tr>`;
    return `<div class="banner" style="margin:0 0 12px"><b>Historical context only.</b> Descriptive statistics of ${esc(h.span)} (${h.n_bars} bars). Nothing here predicts the future.</div>
      <div class="two"><div>
      <section class="panel"><h3>Daily moves ${kind("calculated")}</h3>${hb("25th pct", d.abs_p25)}${hb("Median", d.abs_p50)}${hb("75th pct", d.abs_p75)}${hb("90th pct", d.abs_p90)}
        <dl class="kv small" style="margin-top:10px"><dt>Average |move|</dt><dd>${pct(d.avg_abs_move, 2)}</dd><dt>Median |move|</dt><dd>${pct(d.median_abs_move, 2)}</dd>
        <dt>ATR14</dt><dd>${usd(R.technicals.snapshot.atr14)} (${pct(R.technicals.snapshot.atr14_pct, 2)})</dd><dt>Moves ≥ 2%</dt><dd>${pct(d.freq_ge_2pct)} of days</dd><dt>Moves ≥ 2 sd</dt><dd>${pct(d.freq_ge_2sd)} of days</dd>
        <dt>Average / median gap</dt><dd>${pct(g.mean_abs, 2)} / ${pct(g.median_abs, 2)}</dd><dt>Gap 5th / 95th pct</dt><dd>${spct(g.p5_down, 2)} / ${spct(g.p95_up, 2)}</dd>
        <dt>Max drawdown in sample</dt><dd>${spct(h.drawdown.max_drawdown_sample)}</dd><dt>From 52w high</dt><dd>${spct(h.drawdown.current_from_52w_high)}</dd></dl></section>
      <section class="panel"><h3>Streaks and clustering</h3><dl class="kv small"><dt>Current streak</dt><dd>${st.current.length} ${esc(st.current.direction)} day(s)</dd>
        <dt>Up after 1 / 2 / 3 up days</dt><dd>${["1", "2", "3"].map((k) => pct(st.up[k].p_continue, 0)).join(" / ")}</dd>
        <dt>Down after 1 / 2 / 3 down days</dt><dd>${["1", "2", "3"].map((k) => pct(st.down[k].p_continue, 0)).join(" / ")}</dd>
        <dt>|return| autocorrelation</dt><dd>lag1 ${num(h.clustering.abs_autocorr_lag1, 2)}, lag5 ${num(h.clustering.abs_autocorr_lag5, 2)}</dd>
        <dt>Big day after a big day</dt><dd>${pct(h.clustering.p_big_next_after_big, 0)} vs ${pct(h.clustering.p_big_next, 0)} unconditional</dd></dl>
        <div class="note">${esc(h.clustering.note)}</div></section>
      <section class="panel"><h3>After unusually large moves</h3><table class="t"><tr><th></th><th class="r">n</th><th class="r">Next day</th><th class="r">Next 5 days</th><th class="r">5d positive</th></tr>
        ${["down", "up"].map((s) => `<tr><td>${s === "down" ? "Down shock" : "Up shock"}</td><td class="r">${sh[s]["5d"].n}</td><td class="r">${spct(sh[s]["1d"].mean, 2)}</td><td class="r">${spct(sh[s]["5d"].mean, 2)}</td><td class="r">${pct(sh[s]["5d"].pct_positive, 0)}</td></tr>`).join("")}</table>
        <div class="note">${esc(sh.definition)}</div></section></div><div>
      <section class="panel"><h3>Similar historical setups</h3>${sim.available ? `<div class="small muted">Today: trend ${sim.current.trend > 0 ? "up" : sim.current.trend < 0 ? "down" : "mixed"}, ${esc(sim.current.ext)} the 20-day average, ${esc(sim.current.vol || "?")} realized vol. Matching uses only data available on each past day.</div>
        <div class="tscroll"><table class="t"><tr><th>Forward</th><th class="r">n</th><th class="r">Mean</th><th class="r">Median</th><th class="r">Best</th><th class="r">Worst</th><th class="r">Positive</th></tr>${simRows}</table></div>` : `<p class="muted">${esc(sim.note || "unavailable")}</p>`}</section>
      <section class="panel"><h3>Drawdowns and rallies inside a window</h3><div class="tscroll"><table class="t"><tr><th>Window</th><th class="r">Median dip</th><th class="r">Bad dip (10th)</th><th class="r">Worst</th><th class="r">Median rally</th><th class="r">Good rally (90th)</th><th class="r">Dip ≥ 3%</th></tr>${ex}</table></div>
        <div class="note">Overlapping windows are not independent samples.</div></section>
      <section class="panel"><h3>Behaviour near prior 20-day extremes</h3><table class="t"><tr><th>Condition</th><th class="r">n</th><th class="r">Next 5d mean</th><th class="r">Positive</th></tr>
        ${lvl("near_low", "Near prior low")}${lvl("broke_low", "Broke prior low")}${lvl("near_high", "Near prior high")}${lvl("broke_high", "Broke prior high")}</table>
        <div class="note">${esc(lb.definition)}</div></section></div></div>`;
  }


  /* ---------------------------------------------------------------- portfolio entry form */
  function pfForm(S) {
    const F = S.pf, mm = (S.meta && S.meta.money_market_funds) || {};
    const fld = (key, label, val, attrs = "") => `<label class="pf-f"><span>${label}</span><input class="input" data-pf="${key}" value="${esc(val == null ? "" : val)}" ${attrs}></label>`;
    const del = (key) => `<button class="btn btn-ghost pf-x" data-pfdel="${key}" aria-label="Remove row">✕</button>`;
    const fundOpts = (cur) => { const keys = Object.keys(mm); if (cur && !keys.includes(cur)) keys.unshift(cur);
      return `<option value="">Pick fund</option>` + keys.map((k) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(k)}${mm[k] ? " · " + esc(mm[k]) : ""}</option>`).join(""); };
    const mmRows = F.mm.map((r, i) => `<div class="pf-row pf-row-mm">
        <label class="pf-f pf-wide"><span>Fund</span><select data-pf="mm:${i}:symbol">${fundOpts(r.symbol)}</select></label>
        ${fld(`mm:${i}:amount`, "Amount ($)", r.amount, 'type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"')}${del(`mm:${i}`)}</div>`).join("");
    const stRows = F.stocks.map((r, i) => `<div class="pf-row pf-row-st">
        ${fld(`stocks:${i}:symbol`, "Ticker", r.symbol, 'maxlength="10" autocapitalize="characters" spellcheck="false" placeholder="SPY"')}
        ${fld(`stocks:${i}:qty`, "Shares", r.qty, 'type="text" inputmode="decimal" autocomplete="off" placeholder="0"')}${del(`stocks:${i}`)}</div>`).join("");
    const opRows = F.options.map((r, i) => `<div class="pf-row pf-row-op">
        <label class="pf-f"><span>Bought or sold</span><select data-pf="options:${i}:side"><option value="long" ${r.side !== "short" ? "selected" : ""}>Bought (long)</option><option value="short" ${r.side === "short" ? "selected" : ""}>Sold (short)</option></select></label>
        ${fld(`options:${i}:contracts`, "Contracts", r.contracts, 'type="text" inputmode="numeric" autocomplete="off" placeholder="1"')}
        ${fld(`options:${i}:symbol`, "Ticker", r.symbol, 'maxlength="10" autocapitalize="characters" spellcheck="false" placeholder="SPY"')}
        <label class="pf-f"><span>Type</span><select data-pf="options:${i}:right"><option value="P" ${r.right !== "C" ? "selected" : ""}>Put</option><option value="C" ${r.right === "C" ? "selected" : ""}>Call</option></select></label>
        ${fld(`options:${i}:strike`, "Strike", r.strike, 'type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"')}
        ${fld(`options:${i}:expiration`, "Expiration", r.expiration, 'type="date"')}
        ${fld(`options:${i}:entry`, "Price paid/received per share (optional)", r.entry, 'type="text" inputmode="decimal" autocomplete="off" placeholder="optional"')}${del(`options:${i}`)}</div>`).join("");
    const empty = (t) => `<div class="small faint pf-none">${t}</div>`;
    return `<section class="panel" id="pfPanel"><div class="panel-head"><h3>What you already own</h3><span class="sp small muted">kept in this browser only; sent with each analysis</span></div>
      <div class="pf-import">
        <label class="btn" for="pfFile">Import broker CSV</label><input type="file" id="pfFile" accept=".csv,text/csv,text/plain" class="hidden">
        <span class="small muted">Fidelity: Accounts › Positions › Download. Schwab, Robinhood and others work if the file has Symbol and Quantity columns.</span>
      </div>
      <div id="pfImport"></div>
      <div class="pf-sec"><h4>Cash</h4><div class="pf-row pf-row-cash">${fld("cash", "Cash ($)", F.cash, 'type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"')}</div></div>
      <div class="pf-sec"><h4>Money-market / sweep funds <span class="faint small">counted as cash at $1.00 a share</span></h4>${mmRows || empty("None")}<button class="btn btn-ghost small" data-pfadd="mm">+ Add fund</button></div>
      <div class="pf-sec"><h4>Stocks &amp; ETFs</h4>${stRows || empty("None")}<button class="btn btn-ghost small" data-pfadd="stocks">+ Add stock</button></div>
      <div class="pf-sec"><h4>Options</h4>${opRows || empty("None")}<button class="btn btn-ghost small" data-pfadd="options">+ Add option</button></div>
      <details class="pf-paste"><summary class="small">Paste a list instead</summary>
        <textarea id="pfText" rows="4" spellcheck="false" placeholder="cash 2392.86&#10;89 SPY shares&#10;SPAXX 2538.27&#10;-1 SPY P 550 2026-12-18 3.10"></textarea>
        <button class="btn small" id="pfFill" style="margin-top:6px">Fill the form from this list</button></details>
      <div class="pf-actions">
        <button class="btn btn-primary" id="pfApply">Save and re-run</button><button class="btn btn-ghost" id="pfClear">Clear all</button>
        <label class="small"><input type="checkbox" id="pfRemember" ${S.rememberPf ? "checked" : ""}> Remember on this device</label>
        <label class="small"><input type="checkbox" id="pfAssign" ${S.assignmentOk ? "checked" : ""}> OK with getting assigned on short puts</label></div>
      <div id="pfMsg" class="small" style="margin-top:8px"></div></section>`;
  }

  /* ================================================================== PORTFOLIO */
  function portfolio(R, S) {
    const P = R && R.portfolio;
    const st = P && P.state;
    const input = pfForm(S);
    if (!st) return input + `<section class="panel"><p class="muted">No portfolio entered. Trades are ranked on isolated quality only; portfolio fit and sizing limits need positions and cash.</p></section>`;
    const pos = st.positions.map((p) => `<tr><td>${esc(p.label)}</td><td class="r">${p.qty}</td><td class="r">${usd(p.mark)}</td><td class="r">${usd0(p.value)}</td><td class="r">${num(p.delta_shares, 0)}</td><td class="r">${usd0(p.theta_usd)}</td><td class="r">${usd0(p.vega_usd)}</td><td class="r">${p.pnl_usd != null ? susd(p.pnl_usd) : ""}</td><td class="small faint">${esc(p.source)}</td></tr>`).join("");
    const grp = Object.values(st.groups).map((g) => { const c = st.equity > 0 ? Math.abs(g.delta_usd) / st.equity : null; const lim = g.broad ? R.config.limits.max_underlying_conc_broad : R.config.limits.max_underlying_conc_other;
      return `<tr><td>${esc(g.group)}</td><td class="small muted">${esc(g.members.join(", "))}</td><td class="r">${usd0(g.delta_usd)}</td><td class="r ${c > lim ? "down" : ""}">${pct(c, 0)}</td><td class="r">${pct(lim, 0)}</td></tr>`; }).join("");
    const mg = P.management;
    const mgr = mg && mg.results.length ? mg.results.map((m) => `<div class="panel" style="background:var(--panel-2)"><div class="panel-head"><b>${esc(m.action.replace("_", " "))}</b><span>${esc(m.position)} ×${m.contracts}</span><span class="sp faint small">${esc(m.quote_source || "")}</span></div>
      <ul class="small">${m.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${m.roll ? `<div class="small">Roll to <b>${esc(m.roll.to)}</b> at ~${usd(m.roll.open_mid)}: net ${susd(m.roll.net_mid_total)} at mids, ${susd(m.roll.net_cons_total)} conservative</div>` : ""}
      ${m.replacement ? `<div class="small">Replacement candidate: ${esc(m.replacement.label)} at ~${usd(m.replacement.mid)}</div>` : ""}</div>`).join("") : `<p class="muted small">${esc((mg && mg.note) || "No short options to manage.")}</p>`;
    const L = R.config.limits;
    return input + `<div class="two"><div>
      <section class="panel"><h3>Current exposure ${kind("calculated")}</h3><dl class="kv"><dt>Equity</dt><dd>${usd0(st.equity)} <span class="faint small">${esc(st.equity_note)}</span></dd>
        <dt>Cash / free cash</dt><dd>${usd0(st.cash)} / ${usd0(st.free_cash)}</dd><dt>Short-put collateral</dt><dd>${usd0(st.short_put_collateral)}</dd>
        <dt>Net delta</dt><dd>${usd0(st.totals.delta_usd)} (${st.equity > 0 ? pct(Math.abs(st.totals.delta_usd) / st.equity, 0) : "n/a"} of equity; limit ${pct(L.max_portfolio_delta_pct, 0)})</dd>
        <dt>Net vega</dt><dd>${usd0(st.totals.vega_usd)} per vol point (limit ${usd0(L.max_portfolio_vega_pct * st.equity)})</dd><dt>Net theta</dt><dd>${usd0(st.totals.theta_usd)} per day</dd></dl>
        ${st.warnings.map((w) => `<div class="waitbox small">${esc(w)}</div>`).join("")}</section>
      <section class="panel"><h3>Concentration by exposure group</h3><div class="tscroll"><table class="t"><tr><th>Group</th><th>Members</th><th class="r">Δ $ (lev.)</th><th class="r">% equity</th><th class="r">Guideline</th></tr>${grp}</table></div>
        <div class="note">Leverage-weighted groups (e.g. TQQQ counts 3× toward NASDAQ100) preserved from the Options Suggester.</div></section></div><div>
      <section class="panel"><h3>Positions</h3><div class="tscroll"><table class="t"><tr><th>Position</th><th class="r">Qty</th><th class="r">Mark</th><th class="r">Value</th><th class="r">Δ sh</th><th class="r">Θ/day</th><th class="r">Vega</th><th class="r">P&amp;L</th><th>Source</th></tr>${pos}</table></div></section>
      <section class="panel"><h3>Existing position management</h3><div class="small muted">${esc((mg && mg.note) || "")}</div>${mgr}</section></div></div>`;
  }

  /* ================================================================== BACKTEST */
  function backtest(B, S) {
    const p = S.bt;
    const form = `<section class="panel"><div class="panel-head"><h3>Walk-forward check of the regime gate</h3></div>
      <p class="small muted">Does skipping short-premium entries in hostile regimes improve results versus entering every time? Each decision sees only data up to that day.</p>
      <div class="form">
        <label>Policy<select id="btPolicy">${["cash_secured_put", "put_credit_spread", "covered_call"].map((k) => `<option value="${k}" ${p.policy === k ? "selected" : ""}>${title(k)}</option>`).join("")}</select></label>
        <label>DTE<input class="input" id="btDte" type="number" min="5" max="90" value="${p.dte}"></label>
        <label>Target |delta|<input class="input" id="btDelta" type="number" step="0.01" min="0.05" max="0.5" value="${p.target_delta}"></label>
        <label>IV / RV assumption<input class="input" id="btIv" type="number" step="0.05" min="0.5" max="2" value="${p.iv_premium}"></label>
        <label>Spread (frac of mid)<input class="input" id="btSpread" type="number" step="0.01" min="0" max="0.5" value="${p.spread_pct}"></label>
        <label>Commission / leg<input class="input" id="btComm" type="number" step="0.05" min="0" value="${p.commission}"></label></div>
      <div style="margin-top:10px"><button class="btn btn-primary" id="btRun">Run backtest</button> <span id="btMsg" class="small muted"></span></div></section>`;
    if (!B) return form;
    if (!B.available) return form + `<section class="panel"><p class="muted">${esc(B.note)}</p></section>`;
    const g = B.runs.gated, a = B.runs.always;
    const cell = (s, k, f) => s.stats.n ? f(s.stats[k]) : "–";
    const rows = [["Trades", "n", (x) => x], ["Win rate", "win_rate", (x) => pct(x, 0)], ["Average P&L", "avg_pnl", (x) => susd(x)], ["Median P&L", "median_pnl", (x) => susd(x)],
      ["Worst trade", "worst", (x) => susd(x)], ["Total", "total", (x) => susd(x)], ["Max drawdown", "max_drawdown", (x) => susd(x)], ["Return on avg capital / yr", "return_on_avg_capital_annualized", (x) => pct(x)]];
    const halves = (s) => `${s.first_half.n || 0} trades, avg ${susd(s.first_half.avg_pnl)} / ${s.second_half.n || 0} trades, avg ${susd(s.second_half.avg_pnl)}`;
    return form + `<div class="two"><section class="panel"><h3>Results ${B.is_mock ? `<span class="chip">mock data</span>` : ""}</h3>
        <table class="t"><tr><th></th><th class="r">Regime-gated</th><th class="r">Always enter</th></tr>${rows.map(([n, k, f]) => `<tr><td>${n}</td><td class="r">${cell(g, k, f)}</td><td class="r">${cell(a, k, f)}</td></tr>`).join("")}
        <tr><td>First half / second half</td><td class="r small">${halves(g)}</td><td class="r small">${halves(a)}</td></tr><tr><td>Entries skipped by gate</td><td class="r">${g.skipped.length}</td><td class="r">0</td></tr></table>
        <p><b>${esc(B.verdict)}</b></p></section>
      <section class="panel"><h3>Cumulative P&amp;L per contract</h3><div class="legend"><span><span class="sw" style="border-color:var(--s1)"></span>Regime-gated</span><span><span class="sw" style="border-color:var(--s2);border-top-style:dashed"></span>Always enter</span></div>
        <div class="chart-wrap"><canvas class="chart" id="btChart" aria-label="Cumulative P&L"></canvas></div></section></div>
      <section class="panel"><h3>How this can mislead</h3><ul class="small">${B.caveats.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section class="panel"><h3>Trades (gated)</h3><div class="tscroll"><table class="t"><tr><th>Entry</th><th>Settle</th><th>Regime at entry</th><th class="r">Spot</th><th class="r">Strike(s)</th><th class="r">Credit</th><th class="r">P&amp;L</th></tr>
        ${g.trades.map((t) => `<tr><td>${t.entry_date}</td><td>${t.settle_date}</td><td class="small">${esc(t.regime_at_entry || "")}</td><td class="r">${usd(t.spot)}</td><td class="r">${t.strikes.join("/")}</td><td class="r">${usd(t.credit)}</td><td class="r ${t.pnl >= 0 ? "up" : "down"}">${susd(t.pnl)}</td></tr>`).join("")}</table></div></section>`;
  }

  /* ================================================================== SETTINGS */
  function settings(M, S) {
    const w = S.weights, labels = M.labels || {};
    const tot = Object.values(w).reduce((x, y) => x + (+y || 0), 0) || 1;
    const sl = Object.keys(w).map((k) => `<div class="slider"><span>${esc(labels[k] || title(k))}</span><input type="range" min="0" max="40" step="1" value="${w[k]}" data-weight="${k}" aria-label="${esc(labels[k] || k)} weight"><span class="num">${(w[k] / tot * 100).toFixed(0)}%</span></div>`).join("");
    const c = S.cfg, L = c.limits;
    const inp = (id, v, step = "any", min = "") => `<input class="input" data-cfg="${id}" type="number" step="${step}" ${min !== "" ? `min="${min}"` : ""} value="${v}">`;
    const bands = Object.keys(c.delta_bands).map((k) => `<label>${esc(title(k))}<span style="display:flex;gap:6px">${`<input class="input" data-band="${k}:0" type="number" step="0.01" min="0.02" max="0.95" value="${c.delta_bands[k][0]}">`}<input class="input" data-band="${k}:1" type="number" step="0.01" min="0.02" max="0.95" value="${c.delta_bands[k][1]}"></span></label>`).join("");
    return `<div class="two"><div>
      <section class="panel"><h3>Trade Quality weights</h3><div class="small muted">Normalized to 100. The score is exactly Σ weight × factor + penalties.</div>${sl}
        <div style="margin-top:8px"><button class="btn btn-ghost" id="wReset">Reset weights</button></div></section>
      <section class="panel"><h3>Decision thresholds and windows</h3><div class="form">
        <label>ENTER at or above${inp("enter_threshold", c.enter_threshold, 1)}</label><label>AVOID below${inp("avoid_threshold", c.avoid_threshold, 1)}</label>
        <label>Min DTE${inp("dte_min", c.dte_min, 1, 0)}</label><label>Max DTE${inp("dte_max", c.dte_max, 1, 1)}</label><label>Target DTE${inp("preferred_dte", c.preferred_dte, 1, 1)}</label>
        <label>Expirations scanned${inp("max_expirations", c.max_expirations, 1, 1)}</label><label>Better-peer margin${inp("better_peer_margin", c.better_peer_margin, 0.5)}</label>
        <label>Wide spread (frac)${inp("wide_spread_pct", c.wide_spread_pct, 0.01)}</label><label>Max spread gate${inp("max_spread_pct", c.max_spread_pct, 0.01)}</label>
        <label>Min open interest${inp("min_open_interest", c.min_open_interest, 1, 0)}</label><label>Risk-free rate${inp("risk_free", c.risk_free, 0.001)}</label><label>Dividend yield${inp("div_yield", c.div_yield, 0.001)}</label>
        <label>Weeklies<select data-cfg="allow_weeklies"><option value="true" ${c.allow_weeklies ? "selected" : ""}>allowed</option><option value="false" ${!c.allow_weeklies ? "selected" : ""}>monthlies only</option></select></label>
        <label>Hypothetical trades<select data-cfg="include_hypothetical"><option value="true" ${c.include_hypothetical ? "selected" : ""}>rank them</option><option value="false" ${!c.include_hypothetical ? "selected" : ""}>hide them</option></select></label></div></section>
      <section class="panel"><h3>Position limits</h3><div class="form">
        <label>Max trade risk (% equity)${`<input class="input" data-lim="max_trade_risk_pct" type="number" step="0.005" value="${L.max_trade_risk_pct}">`}</label>
        <label>Max trade risk ($, 0 = off)${`<input class="input" data-lim="max_trade_risk_usd" type="number" step="100" value="${L.max_trade_risk_usd}">`}</label>
        <label>Underlying conc. broad${`<input class="input" data-lim="max_underlying_conc_broad" type="number" step="0.05" value="${L.max_underlying_conc_broad}">`}</label>
        <label>Underlying conc. other${`<input class="input" data-lim="max_underlying_conc_other" type="number" step="0.05" value="${L.max_underlying_conc_other}">`}</label>
        <label>Expiration conc.${`<input class="input" data-lim="max_expiration_conc" type="number" step="0.05" value="${L.max_expiration_conc}">`}</label>
        <label>Portfolio delta (% eq.)${`<input class="input" data-lim="max_portfolio_delta_pct" type="number" step="0.05" value="${L.max_portfolio_delta_pct}">`}</label>
        <label>Portfolio vega (% eq./pt)${`<input class="input" data-lim="max_portfolio_vega_pct" type="number" step="0.001" value="${L.max_portfolio_vega_pct}">`}</label></div></section></div><div>
      <section class="panel"><h3>Delta bands (|delta| of the primary leg)</h3><div class="form">${bands}</div></section>
      <section class="panel"><h3>Your events</h3><div class="small muted">Earnings, ex-dividend and company events are not in the CBOE feed. Add them here, one per line: <b>YYYY-MM-DD Name RISK</b> (HIGH, MEDIUM or LOW). Optional symbol list in brackets: <b>2026-10-29 AAPL earnings HIGH [AAPL]</b>.</div>
        <textarea id="evText" rows="5" spellcheck="false">${esc(S.eventsText)}</textarea></section>
      <section class="panel"><button class="btn btn-primary" id="cfgApply">Apply settings and re-run</button> <button class="btn btn-ghost" id="cfgReset">Restore defaults</button>
        <label class="small" style="margin-left:8px"><input type="checkbox" id="cfgRemember" ${S.rememberCfg ? "checked" : ""}> Remember on this device</label></section></div></div>`;
  }

  /* ================================================================== DIAGNOSTICS */
  function diagnostics(R) {
    const d = R.diagnostics, m = R.meta;
    const fc = Object.entries(d.chain.flag_counts || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v}</td></tr>`).join("");
    const dr = Object.entries(d.chain.dropped_at_provider || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v}</td></tr>`).join("");
    const tm = Object.entries(m.timings_ms || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${num(v, 0)} ms</td></tr>`).join("");
    const dk = Object.entries(m.data_kinds).map(([k, v]) => `<tr><td>${kind(k)} ${esc(k)}</td><td class="small muted">${esc(v)}</td></tr>`).join("");
    return `<div class="two"><div>
      <section class="panel"><h3>Data source</h3><dl class="kv small"><dt>Provider</dt><dd>${esc(m.provider)}${m.is_mock ? " (synthetic)" : ""}</dd><dt>Generated</dt><dd>${esc(m.generated_at_et)} ET</dd>
        <dt>Chain timestamp</dt><dd>${esc(R.underlying.chain_timestamp)}</dd><dt>Freshness</dt><dd>${esc(d.freshness.note)}</dd><dt>History</dt><dd>${esc(d.history_source || "none")} (${d.bars} bars)</dd>
        <dt>Contracts</dt><dd>${d.chain.input_records} received, ${d.chain.usable} usable</dd><dt>Trades built</dt><dd>${d.n_trades} (${d.n_disqualified} disqualified by gates)</dd>
        <dt>Expirations</dt><dd>${esc(R.volatility.selection_note)}</dd></dl></section>
      <section class="panel"><h3>Warnings</h3>${d.warnings.length ? `<ul class="small">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="muted small">None.</p>`}</section>
      <section class="panel"><h3>Data labels</h3><table class="t">${dk}</table></section></div><div>
      <section class="panel"><h3>Quote flags (normalizer)</h3><table class="t">${fc || `<tr><td class="muted">none</td></tr>`}</table>
        <h4 style="margin-top:12px">Rows dropped at the provider</h4><table class="t">${dr || `<tr><td class="muted">none</td></tr>`}</table>
        <div class="note">Flagged quotes are kept but excluded or penalised; nothing is silently repaired.</div></section>
      <section class="panel"><h3>Timings</h3><table class="t">${tm}</table></section></div></div>
      <section class="panel" style="margin-top:12px"><p class="small muted">${esc(m.disclaimer)}</p></section>`;
  }

  return { board, drawer, comparePanel, regime, chart, history, portfolio, pfForm, backtest, settings, diagnostics };
})();
