/* Separation runs here, off the main thread, so the page stays responsive.
   Messages in : {type:"run", models:[{id,url,stem,params}], wantAccompaniment, L, R}
   Messages out: {type:"status"|"progress"|"stem"|"done"|"error", ...} */
"use strict";
const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_CACHE = "stem-models-v1";

importScripts("dsp.js");
let ortLoaded = false;
function loadOrt() {
  if (ortLoaded) return;
  importScripts(ORT_BASE + "ort.min.js");
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ortLoaded = true;
}

let stopFlag = false;
const post = (m, transfer) => self.postMessage(m, transfer || []);

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === "stop") { stopFlag = true; return; }
  if (m.type !== "run") return;
  stopFlag = false;
  try { await run(m); } catch (e) {
    const msg = String(e && e.message || e);
    const oom = /memory|allocation|RangeError|Aborted\(\)|OOM/i.test(msg);
    post({ type: "error", message: oom ? "The browser ran out of memory. Close other tabs and try again, or use the fast vocals mode." : msg, detail: msg });
  }
};

async function modelBytes(url) {
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(url);
  if (!hit) throw new Error("Model not downloaded yet. Tap Download on the mode first.");
  return new Uint8Array(await hit.arrayBuffer());
}

async function run(m) {
  post({ type: "status", text: "Loading the AI runtime…" });
  loadOrt();
  const n = m.L.length, mix = [m.L, m.R];
  const totals = m.models.map((x) => StemDSP.numChunks(n, x.params));
  const grand = totals.reduce((a, b) => a + b, 0);
  let before = 0;
  const t0 = Date.now();
  for (let i = 0; i < m.models.length; i++) {
    const spec = m.models[i];
    post({ type: "status", text: `Loading ${spec.stem} model…` });
    const session = await ort.InferenceSession.create(await modelBytes(spec.url), {
      executionProviders: ["wasm"], graphOptimizationLevel: "all", enableCpuMemArena: false, enableMemPattern: false,
    });
    const inName = session.inputNames[0], outName = session.outputNames[0];
    const out = [new Float32Array(n), new Float32Array(n)];
    const runModel = async (x, dims) => {
      const r = await session.run({ [inName]: new ort.Tensor("float32", x, dims) });
      const y = r[outName];
      if (y.dims[1] !== 4 || y.dims[2] !== spec.params.dimF || y.dims[3] !== dims[3]) {
        throw new Error(`Model output shape ${y.dims} does not match this mode. The cached model file is probably wrong; delete models and re-download.`);
      }
      return y.data;
    };
    const done = await StemDSP.separateChunks(runModel, mix, out, spec.params, (k, tot) => {
      post({ type: "progress", done: before + k, total: grand, stem: spec.stem, chunk: k, chunks: tot, elapsed: (Date.now() - t0) / 1000 });
    }, () => stopFlag);
    try { await session.release(); } catch (e) { /* older runtimes */ }
    if (done < totals[i]) { post({ type: "stopped" }); return; }
    before += totals[i];
    if (spec.stem === "vocals" && m.wantAccompaniment) {
      const acc = [new Float32Array(n), new Float32Array(n)];
      for (let c = 0; c < 2; c++) { const a = acc[c], x = mix[c], v = out[c]; for (let j = 0; j < n; j++) a[j] = x[j] - v[j]; }
      post({ type: "stem", name: "accompaniment", L: acc[0], R: acc[1] }, [acc[0].buffer, acc[1].buffer]);
    }
    post({ type: "stem", name: spec.stem, L: out[0], R: out[1] }, [out[0].buffer, out[1].buffer]);
  }
  post({ type: "done", seconds: (Date.now() - t0) / 1000 });
}
