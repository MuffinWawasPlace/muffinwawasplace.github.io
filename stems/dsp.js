/* Stem Studio (web): FFT, STFT/ISTFT and MDX-Net chunked separation in plain JavaScript.
   Port of stemsep/dsp.py and stemsep/engines/mdx_onnx.py. Matches torch.stft(center=True, reflect pad, periodic
   Hann) like the Python version. Works in a Web Worker (importScripts) and in Node (require) for testing. */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------------- FFT (radix-2, plus Bluestein for other sizes) */
  function Radix2(n) {
    this.n = n;
    let bits = 0; while ((1 << bits) < n) bits++;
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } this.rev[i] = r; }
    this.cos = new Float64Array(n / 2); this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { const a = -2 * Math.PI * i / n; this.cos[i] = Math.cos(a); this.sin[i] = Math.sin(a); }
  }
  /* in-place forward DFT: X[k] = sum x[j] e^{-2 pi i jk/n} */
  Radix2.prototype.forward = function (re, im) {
    const n = this.n, rev = this.rev, C = this.cos, S = this.sin;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = start + k, b = a + half;
          const wr = C[t], wi = S[t];
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  };

  function FFT(n) {
    this.n = n;
    if ((n & (n - 1)) === 0) { this.r2 = new Radix2(n); return; }
    let m = 1; while (m < 2 * n - 1) m <<= 1;
    this.m = m; this.r2 = new Radix2(m);
    // chirp w_k = e^{-i pi k^2 / n}; k^2 taken mod 2n so the angle stays exact for large k
    this.wr = new Float64Array(n); this.wi = new Float64Array(n);
    for (let k = 0; k < n; k++) { const a = -Math.PI * ((k * k) % (2 * n)) / n; this.wr[k] = Math.cos(a); this.wi[k] = Math.sin(a); }
    this.br = new Float64Array(m); this.bi = new Float64Array(m);
    this.br[0] = this.wr[0]; this.bi[0] = -this.wi[0];
    for (let k = 1; k < n; k++) { this.br[k] = this.br[m - k] = this.wr[k]; this.bi[k] = this.bi[m - k] = -this.wi[k]; }
    this.r2.forward(this.br, this.bi);
    this.ar = new Float64Array(m); this.ai = new Float64Array(m);
  }
  FFT.prototype.forward = function (re, im) {
    if (!this.m) return this.r2.forward(re, im);
    const n = this.n, m = this.m, ar = this.ar, ai = this.ai, wr = this.wr, wi = this.wi, br = this.br, bi = this.bi;
    ar.fill(0); ai.fill(0);
    for (let k = 0; k < n; k++) { ar[k] = re[k] * wr[k] - im[k] * wi[k]; ai[k] = re[k] * wi[k] + im[k] * wr[k]; }
    this.r2.forward(ar, ai);
    for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
    // inverse via conjugation: ifft(z) = conj(fft(conj(z))) / m
    for (let k = 0; k < m; k++) ai[k] = -ai[k];
    this.r2.forward(ar, ai);
    for (let k = 0; k < n; k++) {
      const r = ar[k] / m, i = -ai[k] / m;
      re[k] = r * wr[k] - i * wi[k]; im[k] = r * wi[k] + i * wr[k];
    }
  };
  FFT.prototype.inverse = function (re, im) {      // unnormalized-by-n handled here: returns ifft
    const n = this.n;
    for (let k = 0; k < n; k++) im[k] = -im[k];
    this.forward(re, im);
    for (let k = 0; k < n; k++) { re[k] /= n; im[k] = -im[k] / n; }
  };

  const fftCache = {};
  const getFFT = (n) => fftCache[n] || (fftCache[n] = new FFT(n));
  const hannCache = {};
  function hann(n) {
    if (!hannCache[n]) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); hannCache[n] = w; }
    return hannCache[n];
  }

  /* ---------------------------------------------------------------- STFT / ISTFT for a stereo segment.
     Both channels share one complex FFT per frame (z = L + iR), which halves the work. */
  // seg: [Float32Array L, Float32Array R] of equal length. Returns {re:[L,R], im:[L,R]} Float32Array[bins*frames],
  // laid out [bin][frame] so a model row can be copied directly. Only the first `keepBins` bins are returned.
  function stftStereo(L, R, nFft, hop, keepBins) {
    const pad = nFft >> 1, T = L.length;
    const nFrames = 1 + Math.floor((T + 2 * pad - nFft) / hop);
    const w = hann(nFft), fft = getFFT(nFft);
    const zr = new Float64Array(nFft), zi = new Float64Array(nFft);
    const out = { re: [new Float32Array(keepBins * nFrames), new Float32Array(keepBins * nFrames)],
                  im: [new Float32Array(keepBins * nFrames), new Float32Array(keepBins * nFrames)], frames: nFrames };
    const at = (x, i) => { // reflect padding without copying (numpy 'reflect': edge sample not repeated)
      let j = i - pad;
      if (j < 0) j = -j; else if (j >= T) j = 2 * (T - 1) - j;
      return x[j];
    };
    for (let f = 0; f < nFrames; f++) {
      const s = f * hop;
      for (let i = 0; i < nFft; i++) { const p = s + i; zr[i] = at(L, p) * w[i]; zi[i] = at(R, p) * w[i]; }
      fft.forward(zr, zi);
      for (let k = 0; k < keepBins; k++) {
        const j = k === 0 ? 0 : nFft - k;
        const ar = zr[k], ai = zi[k], br = zr[j], bi = -zi[j];          // Z[k], conj(Z[n-k])
        const o = k * nFrames + f;
        out.re[0][o] = 0.5 * (ar + br); out.im[0][o] = 0.5 * (ai + bi); // L = (Z + conj Z')/2
        out.re[1][o] = 0.5 * (ai - bi); out.im[1][o] = -0.5 * (ar - br); // R = (Z - conj Z')/(2i)
      }
    }
    return out;
  }

  // spec rows for k < nBins (rest zero): re/im [L,R] Float32Array[nBins*frames] laid out [bin][frame].
  // Returns [Float32Array L, Float32Array R] of `length` samples (center crop), like torch.istft / dsp.istft.
  function istftStereo(re, im, nBins, nFrames, nFft, hop, length) {
    const pad = nFft >> 1, total = nFft + hop * (nFrames - 1);
    const w = hann(nFft), fft = getFFT(nFft);
    const yl = new Float64Array(total), yr = new Float64Array(total), wsum = new Float64Array(total);
    const zr = new Float64Array(nFft), zi = new Float64Array(nFft);
    const half = nFft >> 1;
    for (let f = 0; f < nFrames; f++) {
      zr.fill(0); zi.fill(0);
      for (let k = 0; k < nBins && k <= half; k++) {
        const o = k * nFrames + f;
        let lr = re[0][o], li = im[0][o], rr = re[1][o], ri = im[1][o];
        if (k === 0 || k === half) { li = 0; ri = 0; }                 // irfft ignores imag of DC / Nyquist
        // Z = XL + i XR on bins k and n-k (Hermitian partners)
        zr[k] = lr - ri; zi[k] = li + rr;
        if (k > 0 && k < half) { const j = nFft - k; zr[j] = lr + ri; zi[j] = -li + rr; }
      }
      fft.inverse(zr, zi);
      const s = f * hop;
      for (let i = 0; i < nFft; i++) { yl[s + i] += zr[i] * w[i]; yr[s + i] += zi[i] * w[i]; wsum[s + i] += w[i] * w[i]; }
    }
    const L = new Float32Array(length), R = new Float32Array(length);
    for (let i = 0; i < length; i++) { const d = Math.max(wsum[pad + i], 1e-8); L[i] = yl[pad + i] / d; R[i] = yr[pad + i] / d; }
    return [L, R];
  }

  /* ---------------------------------------------------------------- MDX-Net chunked inference */
  const HOP = 1024;
  function mdxGeometry(p) {
    const dimT = 1 << p.dimTPow, chunk = HOP * (dimT - 1), trim = p.nFft >> 1;
    return { dimT, chunk, trim, gen: chunk - 2 * trim };
  }
  const numChunks = (n, p) => Math.max(1, Math.ceil(n / mdxGeometry(p).gen));

  /* mix: [L, R] Float32Array(n). run(inputFloat32, dims) -> Promise<Float32Array> (the model output [1,4,dimF,dimT]).
     out: [L, R] Float32Array(n), filled with the predicted stem x compensate (chunks are assigned, not overlap-added). */
  async function separateChunks(run, mix, out, p, onChunk, shouldStop) {
    const n = mix[0].length, g = mdxGeometry(p), dimF = p.dimF, dimT = g.dimT;
    const total = numChunks(n, p);
    const segL = new Float32Array(g.chunk), segR = new Float32Array(g.chunk);
    for (let k = 0; k < total; k++) {
      if (shouldStop && shouldStop()) return k;
      const s = k * g.gen, a = s - g.trim;
      segL.fill(0); segR.fill(0);
      const sa = Math.max(a, 0), sb = Math.min(a + g.chunk, n);
      if (sb > sa) { segL.set(mix[0].subarray(sa, sb), sa - a); segR.set(mix[1].subarray(sa, sb), sa - a); }
      const spec = stftStereo(segL, segR, p.nFft, HOP, dimF);          // frames === dimT
      const x = new Float32Array(4 * dimF * dimT), plane = dimF * dimT;
      x.set(spec.re[0], 0); x.set(spec.im[0], plane); x.set(spec.re[1], 2 * plane); x.set(spec.im[1], 3 * plane);
      for (let c = 0; c < 4; c++) x.fill(0, c * plane, c * plane + 3 * dimT); // lowest 3 bins zeroed (UVR reference)
      const y = await run(x, [1, 4, dimF, dimT]);
      const wav = istftStereo([y.subarray(0, plane), y.subarray(2 * plane, 3 * plane)],
                              [y.subarray(plane, 2 * plane), y.subarray(3 * plane, 4 * plane)], dimF, dimT, p.nFft, HOP, g.chunk);
      const end = Math.min(s + g.gen, n), c = p.compensate;
      for (let i = s; i < end; i++) { out[0][i] = wav[0][g.trim + i - s] * c; out[1][i] = wav[1][g.trim + i - s] * c; }
      if (onChunk) onChunk(k + 1, total);
    }
    return total;
  }

  const api = { FFT, hann, stftStereo, istftStereo, separateChunks, numChunks, mdxGeometry, HOP };
  root.StemDSP = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
