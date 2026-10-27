/* Hand-rolled canvas/SVG charts (no CDN: works offline on Termux).
   Series colours are the validated dark-surface palette; identity never relies on colour alone
   (dash pattern + direct label on every line). */
"use strict";
const C = (() => {
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const COL = () => ({ ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"), line: css("--line"), line2: css("--line-2"),
    ice: css("--ice"), s1: css("--s1"), s2: css("--s2"), s3: css("--s3"), panel: css("--panel"), panel2: css("--panel-2") });
  const FONT = '12px "IBM Plex Sans", system-ui, sans-serif';

  function setup(canvas, height) {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = canvas.parentElement.clientWidth || 600;
    canvas.style.height = height + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: height };
  }

  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo || 1;
    const step0 = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function tipAt(wrap, html, x, y) {
    let tip = wrap.querySelector(".tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; wrap.appendChild(tip); }
    if (html == null) { tip.style.display = "none"; return; }
    tip.innerHTML = html;
    tip.style.display = "block";
    const tw = tip.offsetWidth, ww = wrap.clientWidth;
    tip.style.left = Math.max(4, Math.min(ww - tw - 4, x + 14)) + "px";
    tip.style.top = Math.max(4, y - 10) + "px";
  }

  /* ------------------------------------------------------------------ price chart */
  function price(canvas, d, opt) {
    const show = opt.show || {};
    const height = window.innerWidth < 700 ? 320 : 440;
    const { ctx, w, h } = setup(canvas, height);
    const c = COL();
    const bars = d.bars || [];
    if (!bars.length) { ctx.fillStyle = c.ink2; ctx.font = FONT; ctx.fillText("No price history available", 12, 24); return; }
    const pad = { l: 8, r: 64, t: 12, b: 26 };
    const cone = show.cone && d.cone ? d.cone : null;
    const futureSlots = cone ? Math.max(4, Math.round(cone.points[cone.points.length - 1].days * 252 / 365)) : 0;
    const slots = bars.length + futureSlots + 1;
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const X = (i) => pad.l + (i + 0.5) * pw / slots;
    let lo = Infinity, hi = -Infinity;
    const take = (v) => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
    bars.forEach((b) => { take(b.l); take(b.h); });
    if (show.sma20) d.sma20.forEach(take);
    if (show.sma50) d.sma50.forEach(take);
    if (show.sma200) d.sma200.forEach(take);
    if (show.atr) { d.atr_upper.forEach(take); d.atr_lower.forEach(take); }
    const span0 = hi - lo;
    const near = (v) => v >= lo - span0 * 0.6 && v <= hi + span0 * 0.6;
    if (cone) cone.points.forEach((p) => { take(d.spot + 2 * p.em); take(d.spot - 2 * p.em); });
    (opt.selected || []).forEach((k) => near(k) && take(k));
    if (show.levels) [...d.levels.supports, ...d.levels.resistances].forEach((v) => near(v) && take(v));
    const m = (hi - lo) * 0.04;
    lo -= m; hi += m;
    const Y = (v) => pad.t + (hi - v) / (hi - lo) * ph;

    // grid + axis
    ctx.font = FONT;
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.fillStyle = c.ink3; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    niceTicks(lo, hi, 6).forEach((v) => {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(v.toFixed(v >= 100 ? 0 : 2), w - pad.r + 8, y);
    });
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let lastM = "";
    bars.forEach((b, i) => {
      const mo = b.d.slice(0, 7);
      if (mo !== lastM) { if (lastM) ctx.fillText(new Date(b.d + "T12:00:00").toLocaleString(undefined, { month: "short" }), X(i), h - pad.b + 7); lastM = mo; }
    });
    // ATR band
    if (show.atr) {
      ctx.beginPath();
      let started = false;
      d.atr_upper.forEach((v, i) => { if (v == null) return; started ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); started = true; });
      for (let i = d.atr_lower.length - 1; i >= 0; i--) { const v = d.atr_lower[i]; if (v != null) ctx.lineTo(X(i), Y(v)); }
      ctx.closePath(); ctx.fillStyle = "rgba(127,209,232,0.06)"; ctx.fill();
    }
    // cone (1 sd filled, 2 sd outline)
    const x0 = X(bars.length - 1);
    if (cone) {
      const pts = cone.points.map((p) => ({ x: x0 + (p.days * 252 / 365) * pw / slots, em: p.em }));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, Y(d.spot + p.em)) : ctx.moveTo(p.x, Y(d.spot + p.em))));
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, Y(d.spot - pts[i].em));
      ctx.closePath(); ctx.fillStyle = "rgba(127,209,232,0.10)"; ctx.fill();
      ctx.setLineDash([2, 3]); ctx.strokeStyle = c.ice; ctx.globalAlpha = 0.6;
      [2, -2].forEach((k) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, Y(d.spot + k * p.em)) : ctx.moveTo(p.x, Y(d.spot + k * p.em)))); ctx.stroke(); });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const last = pts[pts.length - 1];
      ctx.fillStyle = c.ink2; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText("±1σ / ±2σ to " + cone.expiration, Math.min(last.x, w - pad.r - 4), Y(d.spot + 2 * last.em) - 3);
    }
    // levels
    if (show.levels) {
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      const used = [];
      const lab = (v, t) => {
        if (!near(v)) return;
        const yy = Y(v);
        const clash = used.some((u) => Math.abs(u - yy) < 13);
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = c.ink3; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        if (clash) return;
        used.push(yy);
        ctx.fillStyle = c.ink2; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(`${t} ${v.toFixed(2)}`, pad.l + 4, y - 2);
      };
      d.levels.supports.forEach((v) => lab(v, "Support"));
      d.levels.resistances.forEach((v) => lab(v, "Resistance"));
      ctx.setLineDash([]);
    }
    // candles (neutral ink: overlays carry the colour)
    const bw = Math.max(1, Math.min(9, pw / slots * 0.62));
    bars.forEach((b, i) => {
      const x = Math.round(X(i)) + 0.5;
      ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      const yo = Y(b.o), yc = Y(b.c), top = Math.min(yo, yc), hh = Math.max(1, Math.abs(yo - yc));
      if (b.c >= b.o) { ctx.strokeStyle = c.ink2; ctx.strokeRect(x - bw / 2, top, bw, hh); }
      else { ctx.fillStyle = c.ink3; ctx.fillRect(x - bw / 2, top, bw, hh); }
    });
    // moving averages with direct labels
    const series = [["sma20", "SMA20", c.s1, []], ["sma50", "SMA50", c.s2, [7, 4]], ["sma200", "SMA200", c.s3, [2, 3]]];
    const labels = [];
    series.forEach(([k, name, col, dash]) => {
      if (!show[k]) return;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath();
      let s = false, lastV = null;
      d[k].forEach((v, i) => { if (v == null) return; s ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); s = true; lastV = v; });
      ctx.stroke(); ctx.setLineDash([]);
      if (lastV != null) labels.push({ y: Y(lastV), name, col });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    labels.forEach((l) => { ctx.fillStyle = l.col; ctx.fillRect(x0 + 6, l.y - 1, 8, 2); ctx.fillStyle = c.ink2; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(l.name, x0 + 17, l.y); });
    // strikes: candidate ticks on the axis, selected strikes as labelled lines
    if (show.strikes) {
      ctx.strokeStyle = c.line2; ctx.lineWidth = 2;
      (d.strikes || []).forEach((s) => { if (s.strike < lo || s.strike > hi) return; const y = Y(s.strike); ctx.beginPath(); ctx.moveTo(w - pad.r, y); ctx.lineTo(w - pad.r + 5, y); ctx.stroke(); });
    }
    (opt.selected || []).forEach((k, i) => {
      if (k < lo || k > hi) return;
      const y = Math.round(Y(k)) + 0.5;
      ctx.strokeStyle = c.ice; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      const t = (opt.selectedLabels && opt.selectedLabels[i]) || ("Strike " + k);
      ctx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
      const tw = ctx.measureText(t).width + 10;
      ctx.fillStyle = c.ice; ctx.fillRect(w - pad.r - tw - 4, y - 9, tw, 18);
      ctx.fillStyle = "#06222D"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, w - pad.r - tw + 1, y);
      ctx.font = FONT;
    });
    // spot pill
    const ys = Y(d.spot);
    ctx.strokeStyle = c.ink2; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(pad.l, ys); ctx.lineTo(w - pad.r, ys); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c.ink; ctx.fillRect(w - pad.r + 2, ys - 9, pad.r - 4, 18);
    ctx.fillStyle = c.panel; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(d.spot.toFixed(2), w - pad.r + 6, ys);

    // crosshair + tooltip
    const wrap = canvas.parentElement;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const move = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const i = Math.round((x - pad.l) / (pw / slots) - 0.5);
      if (i < 0 || i >= bars.length) { leave(); return; }
      ctx.putImageData(snapshot, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(snapshot, 0, 0);
      const dpr = canvas.width / w; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = c.ink2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(X(i)) + 0.5, pad.t); ctx.lineTo(Math.round(X(i)) + 0.5, h - pad.b); ctx.stroke();
      const b = bars[i];
      const ma = (k, n) => d[k][i] != null ? `<div>${n} ${d[k][i].toFixed(2)}</div>` : "";
      tipAt(wrap, `<b>${b.d}</b><div>O ${b.o.toFixed(2)} H ${b.h.toFixed(2)}</div><div>L ${b.l.toFixed(2)} C ${b.c.toFixed(2)}</div>` +
        ma("sma20", "SMA20") + ma("sma50", "SMA50") + ma("sma200", "SMA200"), X(i), clientY - r.top);
    };
    const leave = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(snapshot, 0, 0); const dpr = canvas.width / w; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); tipAt(wrap, null); };
    canvas.onmousemove = (e) => move(e.clientX, e.clientY);
    canvas.onmouseleave = leave;
    canvas.ontouchstart = canvas.ontouchmove = (e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); };
    canvas.ontouchend = () => setTimeout(leave, 1500);
  }

  /* ------------------------------------------------------------------ line chart (equity curves) */
  function lines(canvas, series, opt = {}) {
    const { ctx, w, h } = setup(canvas, opt.height || 260);
    const c = COL();
    const pad = { l: 8, r: 64, t: 12, b: 26 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort();
    if (!dates.length) { ctx.fillStyle = c.ink2; ctx.font = FONT; ctx.fillText("No trades", 12, 24); return; }
    const t0 = Date.parse(dates[0]), t1 = Date.parse(dates[dates.length - 1]) || t0 + 1;
    const X = (x) => pad.l + (Date.parse(x) - t0) / Math.max(1, t1 - t0) * pw;
    let lo = 0, hi = 0;
    series.forEach((s) => s.points.forEach((p) => { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }));
    const m = (hi - lo) * 0.06 || 1; lo -= m; hi += m;
    const Y = (v) => pad.t + (hi - v) / (hi - lo) * ph;
    ctx.font = FONT; ctx.strokeStyle = c.line; ctx.fillStyle = c.ink3; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    niceTicks(lo, hi, 5).forEach((v) => { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText((opt.fmt || String)(v), w - pad.r + 8, y); });
    ctx.strokeStyle = c.ink3; ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]].forEach((x) => ctx.fillText(x, Math.max(40, Math.min(w - pad.r - 40, X(x))), h - pad.b + 7));
    series.forEach((s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []); ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke(); ctx.setLineDash([]);
      const lp = s.points[s.points.length - 1];
      if (lp) { ctx.fillStyle = c.ink2; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(s.name, Math.min(X(lp.x) + 6, w - pad.r + 8), Y(lp.y) + (s.labelDy || 0)); }
    });
    const wrap = canvas.parentElement;
    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left;
      const tx = t0 + (x - pad.l) / pw * (t1 - t0);
      const rows = series.map((s) => { let best = null; s.points.forEach((p) => { if (Date.parse(p.x) <= tx) best = p; }); return best ? `<div>${U.esc(s.name)}: ${(opt.fmt || String)(best.y)} <span class="faint">${best.x}</span></div>` : ""; }).join("");
      tipAt(wrap, rows || null, x, e.clientY - r.top);
    };
    canvas.onmouseleave = () => tipAt(wrap, null);
  }

  /* ------------------------------------------------------------------ SVG micro-graphics */
  const AX = ["attack", "armor", "speed", "shield", "supply", "power"];
  function radar(b, size = 52, sel = false) {
    if (!b) return "";
    const cx = size / 2, cy = size / 2, R = size / 2 - 3;
    const pt = (i, f) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f]; };
    const ring = (f) => AX.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(",")).join(" ");
    const poly = AX.map((k, i) => pt(i, Math.max(0.06, Math.min(1, (b[k] || 0) / 100))).map((v) => v.toFixed(1)).join(",")).join(" ");
    const tip = AX.map((k) => `${k} ${b[k]}`).join(" · ");
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Battle stats: ${tip}"><title>${tip}</title>` +
      `<polygon points="${ring(1)}" fill="none" stroke="#2A4A63" stroke-width="1"/><polygon points="${ring(0.5)}" fill="none" stroke="#1F3A50" stroke-width="1"/>` +
      `<polygon points="${poly}" fill="${sel ? "rgba(127,209,232,.35)" : "rgba(47,159,198,.28)"}" stroke="${sel ? "#7FD1E8" : "#2F9FC6"}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  function ring(score, status) {
    const r = 32, cx = 38, cy = 38, circ = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, (score || 0) / 100));
    const col = { ENTER: "#5CC08A", WAIT: "#E3B341", AVOID: "#EF6B5B" }[status] || "#7FD1E8";
    return `<svg class="ring" viewBox="0 0 76 76" role="img" aria-label="Trade quality ${score} of 100"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1A3146" stroke-width="6"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-dasharray="${(circ * f).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>` +
      `<text x="${cx}" y="${cy + 2}" text-anchor="middle" dominant-baseline="middle" fill="#DDE7EE" font-size="22" font-weight="700">${Math.round(score)}</text>` +
      `<text x="${cx}" y="${cy + 19}" text-anchor="middle" fill="#6F879A" font-size="9">/100</text></svg>`;
  }

  /* price ladder: observed bid/ask + calculated mid, preferred, acceptable band, worst acceptable.
     Shapes in a stretchable SVG, labels in HTML so text never distorts on narrow screens. */
  function ladder(z) {
    if (!z || !isFinite(z.mid)) return "";
    const credit = z.side === "CREDIT";
    const bid = credit ? z.natural : z.best, ask = credit ? z.best : z.natural;
    const pts = [bid, ask, z.mid, z.preferred, z.worst_acceptable].filter((v) => v != null && isFinite(v));
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const pad = Math.max((hi - lo) * 0.18, 0.02); lo -= pad; hi += pad;
    const P = (v) => (2 + (v - lo) / (hi - lo) * 96);
    let s = `<div class="lad"><svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">`;
    s += `<line x1="1" y1="10" x2="99" y2="10" stroke="#2A4A63" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`;
    s += `<rect x="${P(bid)}" y="6" width="${Math.max(0.4, P(ask) - P(bid))}" height="8" fill="#1A3146" stroke="#2A4A63" vector-effect="non-scaling-stroke"/>`;
    if (z.acceptable) s += `<rect x="${P(z.acceptable[0])}" y="5" width="${Math.max(0.4, P(z.acceptable[1]) - P(z.acceptable[0]))}" height="10" fill="rgba(92,192,138,.22)" stroke="#5CC08A" vector-effect="non-scaling-stroke"/>`;
    s += "</svg>";
    const mark = (v, cls) => v != null && isFinite(v) ? `<i class="lad-${cls}" style="left:${P(v)}%"></i>` : "";
    const lab = (v, t, cls) => v != null && isFinite(v) ? `<span class="lad-l ${cls}" style="left:${Math.max(8, Math.min(92, P(v)))}%">${t} ${v.toFixed(2)}</span>` : "";
    s += mark(bid, "tick") + mark(ask, "tick") + mark(z.mid, "mid") + mark(z.worst_acceptable, "worst") + mark(z.preferred, "pref");
    s += lab(z.mid, "Mid", "top") + lab(bid, "Bid", "bot") + lab(ask, "Ask", "bot");
    return s + "</div>";
  }

  return { price, lines, radar, ring, ladder };
})();
