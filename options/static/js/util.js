/* Shared helpers: escaping, number formatting, API calls, safe local storage. No dependencies. */
"use strict";
const U = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ok = (x) => x !== null && x !== undefined && typeof x === "number" && isFinite(x);
  const num = (x, d = 2) => ok(x) ? x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "n/a";
  const usd = (x, d = 2) => ok(x) ? (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "n/a";
  const usd0 = (x) => usd(x, 0);
  const susd = (x, d = 0) => ok(x) ? (x >= 0 ? "+" : "-") + "$" + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "n/a";
  const pct = (x, d = 1) => ok(x) ? (x * 100).toFixed(d) + "%" : "n/a";
  const spct = (x, d = 1) => ok(x) ? (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%" : "n/a";
  const sgn = (x, d = 2) => ok(x) ? (x >= 0 ? "+" : "") + x.toFixed(d) : "n/a";
  const title = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const KIND = { observed: "observed: taken directly from the data provider", calculated: "calculated: deterministic from observed data",
    estimated: "estimated: model output under stated assumptions", inferred: "inferred: rule-based interpretation",
    conceptual: "conceptual: visual summary of calculated components", unavailable: "unavailable: no source; never guessed" };
  const kind = (k) => {
    const key = String(k || "").split(/[ /(]/)[0];
    if (!KIND[key]) return "";
    return `<abbr class="k k-${key}" title="${esc(KIND[key])}">${key[0]}</abbr>`;
  };
  const status = (s) => s ? `<span class="status st-${esc(s)}">${esc(s)}</span>` : "";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("obe:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("obe:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem("obe:" + k); } catch (e) { /* ignore */ } },
  };
  async function api(path, body) {
    const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    let r;
    try { r = await fetch(path, opt); } catch (e) { throw { error: "Cannot reach the local server.", hint: "Is `run.sh` still running in Termux?" }; }
    let j = null;
    try { j = await r.json(); } catch (e) { throw { error: `Server returned ${r.status} without JSON.` }; }
    if (!r.ok || (j && j.error)) throw j || { error: `HTTP ${r.status}` };
    return j;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const json = (o) => esc(JSON.stringify(o, null, 2));
  return { esc, ok, num, usd, usd0, susd, pct, spct, sgn, title, kind, status, store, api, $, $$, json };
})();
