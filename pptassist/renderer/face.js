// 捞捞 · 把老师的照片做成机器人分身的脸：
//   老师在照片上点三下（左眼、右眼、嘴巴中间）→ 眼睛的点自动吸到瞳孔中心 → 把照片转正、缩放，对到脸贴图的固定位置（LaoAvatar.FACE）
//   （照片里脸小要放大时用双三次插值，比浏览器自带的放大清楚）→ 轻轻磨皮、锐化（也可以选卡通一点）
//   → 脸的外圈：照片里不是皮肤的地方（头发、背景）换成皮肤色，和头接得上 → 顺便取脸颊的颜色当头的皮肤色。
//   全部在本机画布上算，不联网。
"use strict";
(function (root) {
  const F = () => root.LaoAvatar.FACE;

  // 三个点对三个点：求仿射变换（照片坐标 → 贴图坐标），解 2 个 3×3 方程
  function affine(src, dst) {
    const [[x1, y1], [x2, y2], [x3, y3]] = src;
    const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
    if (Math.abs(det) < 1e-6) throw new Error("三个点不能在一条直线上");
    const solve = (v1, v2, v3) => [
      (v1 * (y2 - y3) + v2 * (y3 - y1) + v3 * (y1 - y2)) / det,
      (v1 * (x3 - x2) + v2 * (x1 - x3) + v3 * (x2 - x1)) / det,
      (v1 * (x2 * y3 - x3 * y2) + v2 * (x3 * y1 - x1 * y3) + v3 * (x1 * y2 - x2 * y1)) / det,
    ];
    const [a, c, e] = solve(dst[0][0], dst[1][0], dst[2][0]);
    const [b, d, f] = solve(dst[0][1], dst[1][1], dst[2][1]);
    return { a, b, c, d, e, f };   // x' = a·x + c·y + e，y' = b·x + d·y + f（canvas setTransform 的顺序）
  }

  // 照片 + 三个点（照片像素坐标）→ 1024×1024 的脸贴图（还没处理）；cv.scale = 放大了几倍（贴图像素 / 照片像素）
  //   为了不把脸拉变形：横向按两眼距离缩放、转正；纵向按眼睛到嘴的距离缩放，但最多压扁 / 拉长 25%
  function align(img, marks) {
    const L = F(), S = L.size;
    const { eyeL, eyeR, mouth } = marks;
    const dst = [L.eyeL, L.eyeR, L.mouth].map(([u, v]) => [u * S, v * S]);
    const iod = Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]);
    const mid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2];
    const ux = [(eyeR[0] - eyeL[0]) / iod, (eyeR[1] - eyeL[1]) / iod], uy = [-ux[1], ux[0]];
    const drop = (mouth[0] - mid[0]) * uy[0] + (mouth[1] - mid[1]) * uy[1];
    const want = ((L.mouth[1] - L.eyeL[1]) / (L.eyeR[0] - L.eyeL[0])) * iod;
    const k = Math.max(0.75, Math.min(1.25, want / Math.max(1, drop)));
    const m2 = [mid[0] + uy[0] * drop * k, mid[1] + uy[1] * drop * k];   // 调整后的嘴的位置（正下方）
    const T = affine([eyeL, eyeR, m2], dst);
    const scale = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c));
    const cv = document.createElement("canvas"); cv.width = cv.height = S; cv.scale = scale;
    const g = cv.getContext("2d");
    if (scale <= 1.2) {   // 照片够清楚：浏览器直接画（缩小时它的质量很好）
      g.fillStyle = "#808080"; g.fillRect(0, 0, S, S);
      g.setTransform(T.a, T.b, T.c, T.d, T.e, T.f); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
      return cv;
    }
    // 要放大：自己用双三次（Catmull-Rom）插值，边缘清楚、不发糊
    const det = T.a * T.d - T.b * T.c;
    const inv = (X, Y) => [(T.d * (X - T.e) - T.c * (Y - T.f)) / det, (-T.b * (X - T.e) + T.a * (Y - T.f)) / det];
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const cs = [inv(0, 0), inv(S, 0), inv(0, S), inv(S, S)];
    const x0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0]))) - 3), y0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1]))) - 3);
    const x1 = Math.min(W, Math.ceil(Math.max(...cs.map((c) => c[0]))) + 3), y1 = Math.min(H, Math.ceil(Math.max(...cs.map((c) => c[1]))) + 3);
    const sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0);
    const sc = document.createElement("canvas"); sc.width = sw; sc.height = sh;
    const sg = sc.getContext("2d"); sg.drawImage(img, -x0, -y0);
    const sd = sg.getImageData(0, 0, sw, sh).data;
    const out = g.createImageData(S, S), od = out.data;
    const wts = (t) => { const t2 = t * t, t3 = t2 * t; return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2]; };
    for (let Y = 0; Y < S; Y++) for (let X = 0; X < S; X++) {
      const [px, py] = inv(X + 0.5, Y + 0.5);
      const fx = px - 0.5 - x0, fy = py - 0.5 - y0, ix = Math.floor(fx), iy = Math.floor(fy);
      const o = (Y * S + X) * 4;
      if (ix < 1 || iy < 1 || ix > sw - 3 || iy > sh - 3) { od[o] = od[o + 1] = od[o + 2] = 128; od[o + 3] = 255; continue; }
      const wx = wts(fx - ix), wy = wts(fy - iy);
      let r = 0, gg = 0, b = 0;
      for (let j = 0; j < 4; j++) {
        const row = (iy - 1 + j) * sw;
        for (let i = 0; i < 4; i++) { const w = wx[i] * wy[j], q = (row + ix - 1 + i) * 4; r += sd[q] * w; gg += sd[q + 1] * w; b += sd[q + 2] * w; }
      }
      od[o] = r; od[o + 1] = gg; od[o + 2] = b; od[o + 3] = 255;   // Uint8ClampedArray 自己会截到 0–255
    }
    g.putImageData(out, 0, 0);
    return cv;
  }

  // 眼睛的点吸到瞳孔中心：点的附近找最暗的一小团（瞳孔、虹膜），最多挪 0.08 个眼距，点得准就几乎不动
  function snapEyes(img, marks) {
    const { eyeL, eyeR } = marks, iod = Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]);
    if (!(iod > 8)) return marks;
    const r = Math.max(3, iod * 0.14), lim = iod * 0.08;
    const one = (p) => {
      const x0 = Math.round(p[0] - r), y0 = Math.round(p[1] - r), n = Math.round(2 * r) + 1;
      const c = document.createElement("canvas"); c.width = c.height = n;
      const g = c.getContext("2d"); g.drawImage(img, -x0, -y0);
      const d = g.getImageData(0, 0, n, n).data, lum = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = x0 + x - p[0], dy = y0 + y - p[1]; if (dx * dx + dy * dy > r * r) continue; const i = (y * n + x) * 4; lum.push([0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2], dx, dy]); }
      if (lum.length < 9) return p;
      const sorted = lum.map((v) => v[0]).sort((a, b) => a - b), thr = sorted[Math.floor(sorted.length * 0.15)], hi = sorted[Math.floor(sorted.length * 0.6)];
      if (hi - thr < 18) return p;   // 附近没有明显暗的东西（照片太糊 / 闭眼）就不动
      let sx = 0, sy = 0, sw = 0;
      for (const [l, dx, dy] of lum) { if (l > thr) continue; const w = (thr - l + 1) * Math.exp(-(dx * dx + dy * dy) / (2 * (r * 0.6) ** 2)); sx += dx * w; sy += dy * w; sw += w; }
      if (!sw) return p;
      let mx = sx / sw, my = sy / sw; const m = Math.hypot(mx, my); if (m > lim) { mx *= lim / m; my *= lim / m; }
      return [p[0] + mx, p[1] + my];
    };
    return { ...marks, eyeL: one(eyeL), eyeR: one(eyeR) };
  }

  // 处理照片，style：
  //   "cyber"  赛博（默认）：变成光滑的仿生皮肤，只留五官的特征（见 cyberize）
  //   "photo"  原样：只轻轻磨一下皮
  //   "soft"   轻度卡通：多磨一点，淡淡的色块和描边
  //   "cartoon" 卡通：色块 + 描边
  //   磨皮是双边滤波的简化版：只和颜色相近的邻居平均，所以眼睛、眉毛、嘴的边缘不会糊
  const STYLES = {
    cyber: { R: 2, passes: 1, sig: 18, post: 0, edge: 0, sat: 1.0, sharp: 0.6, cyber: true },
    photo: { R: 1, passes: 1, sig: 14, post: 0, edge: 0, sat: 1.04, sharp: 1 },
    soft: { R: 2, passes: 1, sig: 20, post: 0.25, edge: 0.25, sat: 1.1, sharp: 0.5 },
    cartoon: { R: 3, passes: 2, sig: 26, post: 0.5, edge: 0.55, sat: 1.15, sharp: 0 },
  };
  function cartoon(cv, { style = "cyber", levels = 7 } = {}) {
    const st = STYLES[style] || STYLES.cyber;
    const S = cv.width, g = cv.getContext("2d");
    const src = g.getImageData(0, 0, S, S), d = src.data, n = S * S;
    let sm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { sm[i * 3] = d[i * 4]; sm[i * 3 + 1] = d[i * 4 + 1]; sm[i * 3 + 2] = d[i * 4 + 2]; }
    const R = st.R, sig = st.sig * st.sig * 3, sp = 2 * R * R + 2;
    for (let pass = 0; pass < st.passes; pass++) {
      const inp = sm, out = new Float32Array(n * 3);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x, r0 = inp[i * 3], g0 = inp[i * 3 + 1], b0 = inp[i * 3 + 2];
        let r = 0, gg = 0, b = 0, w = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const j = (yy * S + xx) * 3, cr = inp[j], cg = inp[j + 1], cb = inp[j + 2];
          const dc = (cr - r0) ** 2 + (cg - g0) ** 2 + (cb - b0) ** 2;
          const ww = Math.exp(-dc / sig - (dx * dx + dy * dy) / sp);
          r += cr * ww; gg += cg * ww; b += cb * ww; w += ww;
        }
        out[i * 3] = r / w; out[i * 3 + 1] = gg / w; out[i * 3 + 2] = b / w;
      }
      sm = out;
    }
    // 亮度的梯度 → 描边（原样模式不描）
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.299 * sm[i * 3] + 0.587 * sm[i * 3 + 1] + 0.114 * sm[i * 3 + 2];
    const L = (xx, yy) => lum[Math.min(S - 1, Math.max(0, yy)) * S + Math.min(S - 1, Math.max(0, xx))];
    const step = 255 / (levels - 1), pm = st.post;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let e = 0;
      if (st.edge) {
        const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
        const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
        e = Math.min(1, Math.max(0, (Math.hypot(gx, gy) * (S / 512) - 70) / 160)) * st.edge;
      }
      let r = sm[i * 3], gg = sm[i * 3 + 1], b = sm[i * 3 + 2];
      if (pm) { r = r * (1 - pm) + Math.round(r / step) * step * pm; gg = gg * (1 - pm) + Math.round(gg / step) * step * pm; b = b * (1 - pm) + Math.round(b / step) * step * pm; }
      const avg = (r + gg + b) / 3; r = avg + (r - avg) * st.sat; gg = avg + (gg - avg) * st.sat; b = avg + (b - avg) * st.sat;
      const k = 1 - e;
      d[i * 4] = Math.max(0, Math.min(255, r * k + 40 * e)); d[i * 4 + 1] = Math.max(0, Math.min(255, gg * k + 28 * e)); d[i * 4 + 2] = Math.max(0, Math.min(255, b * k + 30 * e));
    }
    g.putImageData(src, 0, 0);
    return cv;
  }

  // 赛博化：照片 → 干净的合成皮肤 + 清楚的五官（频率分离）
  //   低频（大块的颜色、明暗）留着当「底」；高频（细节）只在五官上留（眉、眼、睫毛、鼻孔、嘴唇的边都是强细节），
  //   皮肤上的毛孔、雀斑、痘印、细纹这些弱细节全部抹平 → 像瓷一样光滑的仿生皮肤；再整体调成一点冷调、统一的肤色
  function cyberize(cv, ref) {
    const S = cv.width, g = cv.getContext("2d"), id = g.getImageData(0, 0, S, S), d = id.data, n = S * S;
    const src = new Float32Array(n * 3); for (let i = 0; i < n; i++) { src[i * 3] = d[i * 4]; src[i * 3 + 1] = d[i * 4 + 1]; src[i * 3 + 2] = d[i * 4 + 2]; }
    let base = src; const R = Math.round(S / 90); for (let k = 0; k < 3; k++) base = boxBlur(base, S, 3, R);
    // 每个像素的细节有多强（亮度差），在一小块里取平均 → 五官的地方大，皮肤的地方小
    const det = new Float32Array(n);
    for (let i = 0; i < n; i++) { const dl = 0.299 * (src[i * 3] - base[i * 3]) + 0.587 * (src[i * 3 + 1] - base[i * 3 + 1]) + 0.114 * (src[i * 3 + 2] - base[i * 3 + 2]); det[i] = Math.abs(dl); }
    let dm = det; for (let k = 0; k < 2; k++) dm = boxBlur(dm, S, 1, Math.round(S / 220));
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const [sr, sg, sb] = ref, sL = 0.299 * sr + 0.587 * sg + 0.114 * sb;
    // 合成皮肤的颜色：老师的肤色，饱和度降一点、偏一点冷（瓷白里带一点青）
    const tr = sL + (sr - sL) * 0.7 - 4, tg = sL + (sg - sL) * 0.7 + 2, tb = sL + (sb - sL) * 0.7 + 8;
    // 五官在哪儿是知道的（标的三个点对到了固定位置）：眼睛连眼皮、眉毛、鼻子、嘴，这些地方细节全留，照片再糊也不会被抹掉
    const L = F(), ell = (u, v, cu, cv, ru, rv) => 1 - sm(0.75, 1.0, Math.hypot((u - cu) / ru, (v - cv) / rv));
    const geo = new Float32Array(n);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S; let gm = 0;
      for (const e of [L.eyeL, L.eyeR]) gm = Math.max(gm, ell(u, v, e[0], e[1], 0.105, 0.06), ell(u, v, e[0] + (e[0] < 0.5 ? -0.01 : 0.01), e[1] - 0.078, 0.12, 0.04));
      gm = Math.max(gm, ell(u, v, 0.5, (L.eyeL[1] + L.mouth[1]) / 2 + 0.03, 0.08, 0.12), ell(u, v, L.mouth[0], L.mouth[1], 0.14, 0.07));
      geo[y * S + x] = gm;
    }
    const thr = (() => { const a = []; for (let i = 0; i < n; i += 97) a.push(dm[i]); a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.85)] || 10; })();   // 按这张照片自己的清晰度定「强细节」
    for (let i = 0; i < n; i++) {
      const m = Math.max(geo[i], sm(thr * 0.9, thr * 2.2, dm[i]));   // 0 = 皮肤，1 = 五官
      // 去掉弱细节（雀斑、毛孔、痘印的明暗差都不大），只留强的边（睫毛线、虹膜、眉毛、唇线）：差值先减掉一个门槛
      const k = Math.max(4, thr * 0.55), dl = 0.299 * (src[i * 3] - base[i * 3]) + 0.587 * (src[i * 3 + 1] - base[i * 3 + 1]) + 0.114 * (src[i * 3 + 2] - base[i * 3 + 2]);
      const keep = Math.abs(dl) > 1e-3 ? Math.max(0, Math.abs(dl) - k) / Math.abs(dl) : 0;
      for (let c = 0; c < 3; c++) {
        const b = base[i * 3 + c], hi = src[i * 3 + c] - b;
        let v = b + hi * (0.04 + 1.3 * m * keep);     // 皮肤上几乎不留细节；五官只留强的边，还加强一点（更清楚）
        const t = c === 0 ? tr : c === 1 ? tg : tb;
        const lum = 0.299 * base[i * 3] + 0.587 * base[i * 3 + 1] + 0.114 * base[i * 3 + 2];
        v = v + ((t * lum) / (sL + 1) - b) * 0.45 * (1 - m);   // 皮肤的颜色往统一的合成肤色靠（明暗保留）
        d[i * 4 + c] = v;
      }
    }
    g.putImageData(id, 0, 0);
    return cv;
  }

  // 去掉照片自带的大片明暗（比如一边脸暗），细节（五官、皱纹、雀斑）不动——立体感交给 3D 的灯光，不会「暗上加暗」
  function delight(cv, strength = 0.55) {
    const S = cv.width, g = cv.getContext("2d"), id = g.getImageData(0, 0, S, S), d = id.data, n = S * S;
    let L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2] + 1;
    let B = L; const R = Math.round(S / 14); for (let k = 0; k < 3; k++) B = boxBlur(B, S, 1, R);
    let m = 0, c = 0;
    for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x += 4) { const u = x / S - 0.5, v = y / S - 0.52; if (u * u / 0.06 + v * v / 0.07 < 1) { m += B[y * S + x]; c++; } }
    m /= Math.max(1, c);
    for (let i = 0; i < n; i++) { const f = Math.max(0.75, Math.min(1.35, Math.pow(m / B[i], strength))); d[i * 4] *= f; d[i * 4 + 1] *= f; d[i * 4 + 2] *= f; }
    g.putImageData(id, 0, 0);
    return cv;
  }

  // 皮肤的参考色：两边脸颊、额头中间、鼻梁几小块的中位数（不怕阴影、高光、雀斑）→ [r, g, b]
  function skinRef(cv) {
    const L = F(), S = cv.width, g = cv.getContext("2d"), k = Math.round(S / 40);
    const R = [], G = [], B = [];
    for (const [u, v] of [[L.eyeL[0], L.mouth[1] - 0.12], [L.eyeR[0], L.mouth[1] - 0.12], [0.5, L.eyeL[1] - 0.1], [0.5, L.eyeL[1] + 0.06]]) {
      const p = g.getImageData(Math.round(u * S) - k, Math.round(v * S) - k, 2 * k, 2 * k).data;
      for (let i = 0; i < p.length; i += 4) { R.push(p[i]); G.push(p[i + 1]); B.push(p[i + 2]); }
    }
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    return [med(R), med(G), med(B)];
  }
  const hexOf = (c) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  function skinColor(cv) { return hexOf(skinRef(cv)); }

  // 盒子模糊（横竖各一遍），给锐化和软边用
  function boxBlur(src, S, ch, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let pass = 0; pass < 2; pass++) {
      const a = pass ? tmp : src, b = pass ? out : tmp;
      for (let l = 0; l < S; l++) for (let c = 0; c < ch; c++) {
        let acc = 0; const at = (k) => (pass ? Math.min(S - 1, Math.max(0, k)) * S + l : l * S + Math.min(S - 1, Math.max(0, k))) * ch + c;
        for (let k = -r; k <= r; k++) acc += a[at(k)];
        for (let k = 0; k < S; k++) { b[at(k)] = acc / (2 * r + 1); acc += a[at(k + r + 1)] - a[at(k - r)]; }
      }
    }
    return out;
  }
  // 锐化（反锐化蒙版）：照片放大得越多，补得越多
  function sharpen(cv, amount) {
    if (!(amount > 0)) return cv;
    const S = cv.width, g = cv.getContext("2d"), id = g.getImageData(0, 0, S, S), d = id.data, n = S * S;
    const up = cv.scale || 1, r = Math.max(1, Math.min(6, Math.round(up * 0.55))), k = amount * Math.max(0.35, Math.min(1.1, 0.3 + (up - 1) * 0.12));
    const src = new Float32Array(n * 3); for (let i = 0; i < n; i++) { src[i * 3] = d[i * 4]; src[i * 3 + 1] = d[i * 4 + 1]; src[i * 3 + 2] = d[i * 4 + 2]; }
    const bl = boxBlur(src, S, 3, r);
    for (let i = 0; i < n * 3; i++) { const det = src[i] - bl[i]; d[(i / 3 | 0) * 4 + (i % 3)] = src[i] + k * (Math.abs(det) < 2 ? 0 : det); }   // 很小的差别（噪点）不放大
    g.putImageData(id, 0, 0);
    return cv;
  }
  // 脸的外圈：照片里像皮肤的地方留着，不像皮肤的（头发、背景、衣领）换掉——换成「旁边的皮肤往外长出来」的颜色
  //   （归一化卷积：只用皮肤像素做大范围平均），所以明暗、颜色都和脸边上接得上；脸中间（眉眼鼻嘴）原样不动
  //   返回脸外面一圈的平均色：头、脖子、手用这个颜色，和脸严丝合缝
  function blendEdge(cv, ref) {
    const S = cv.width, g = cv.getContext("2d"), id = g.getImageData(0, 0, S, S), d = id.data, n = S * S;
    const [sr, sg, sb] = ref, ss = sr + sg + sb + 1, scr = sr / ss, scg = sg / ss, sL = 0.299 * sr + 0.587 * sg + 0.114 * sb + 1;
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const qOf = (x, y) => { const u = (x + 0.5) / S, v = (y + 0.5) / S; return Math.hypot((u - 0.5) / 0.37, (v - 0.55) / (v < 0.55 ? 0.36 : 0.4)); };
    const w = new Float32Array(n), cw = new Float32Array(n * 3), wfa = new Float32Array(n);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, q = qOf(x, y);
      const inner = 1 - sm(0.64, 0.82, q), outer = 1 - sm(0.86, 1.02, q);
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], su = r + gg + b + 1, L = (0.299 * r + 0.587 * gg + 0.114 * b) / sL;
      const like = Math.exp(-((r / su - scr) ** 2 + (gg / su - scg) ** 2) / (2 * 0.018 * 0.018)) * sm(0.45, 0.65, L) * (1 - sm(1.4, 1.75, L));
      w[i] = Math.max(inner, like * outer);
      const wf = like * (1 - sm(0.9, 1.05, q));   // 用来往外长的：只要是皮肤、而且在脸上
      cw[i * 3] = r * wf; cw[i * 3 + 1] = gg * wf; cw[i * 3 + 2] = b * wf; wfa[i] = wf;
    }
    let num = cw, den = wfa; const R = Math.round(S / 26);
    for (let k = 0; k < 3; k++) { num = boxBlur(num, S, 3, R); den = boxBlur(den, S, 1, R); }
    const ws = boxBlur(boxBlur(w, S, 1, Math.round(S / 128)), S, 1, Math.round(S / 128));   // 软边，看不出换过
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, dn = den[i], t = sm(0.002, 0.03, dn);
      const fr = dn > 1e-6 ? num[i * 3] / dn : sr, fg = dn > 1e-6 ? num[i * 3 + 1] / dn : sg, fb = dn > 1e-6 ? num[i * 3 + 2] / dn : sb;
      const cr = sr + (fr - sr) * t, cg = sg + (fg - sg) * t, cb = sb + (fb - sb) * t;
      const k = Math.max(0, Math.min(1, ws[i]));
      d[i * 4] = cr + (d[i * 4] - cr) * k; d[i * 4 + 1] = cg + (d[i * 4 + 1] - cg) * k; d[i * 4 + 2] = cb + (d[i * 4 + 2] - cb) * k;
      const q = qOf(x, y); if (q > 1.0 && q < 1.12 && y < S * 0.85) { ar += d[i * 4]; ag += d[i * 4 + 1]; ab += d[i * 4 + 2]; an++; }
    }
    g.putImageData(id, 0, 0);
    return "#" + [ar, ag, ab].map((v) => Math.round(v / Math.max(1, an)).toString(16).padStart(2, "0")).join("");
  }

  // 一步到位：照片 + 三个点 → { canvas（脸）, skin（皮肤色）, marks（吸附后的点）, scale（放大倍数）, small（脸太小，会糊）}
  function make(img, marks, opt = {}) {
    const mk = opt.snap === false ? marks : snapEyes(img, marks);
    const st = STYLES[opt.style] || STYLES.cyber;
    const cv = align(img, mk), scale = cv.scale;
    cartoon(cv, opt); sharpen(cv, st.sharp); delight(cv, st.cyber ? 0.6 : 0.55);
    if (st.cyber) cyberize(cv, skinRef(cv));
    const skin = blendEdge(cv, skinRef(cv));
    return { canvas: cv, skin, marks: mk, scale, small: scale > 4 };
  }

  // ---------- 屏幕脸：从照片里量出五官的形状（不是贴照片）----------
  //   照片先对齐到标准版式（眼睛、嘴在固定位置），缩成 512 来量：
  //   眉毛 = 眼睛上方每一列最暗的那一行（连成线，量粗细）；眼睛 = 眼睛附近暗的部分（睫毛、虹膜）的上沿和下沿、左右两头（眼角）；
  //   嘴 = 比皮肤红或者暗的那一片（嘴唇、嘴缝）的左右两头和中线；笑着露牙就记下露了多高；鼻子 = 两个鼻孔（最暗的两点）有多宽。
  //   哪一样没量出来（被头发挡住、照片太暗）就用默认的，保证画出来不会乱。返回 { lines, found:{brows, eyes, mouth, nose} }
  function analyze(img, marks, opt = {}) {
    const LA = root.LaoAvatar, Fc = F();
    const mk = opt.snap === false ? marks : snapEyes(img, marks);
    const big = align(img, mk), S = 512;
    const cv = document.createElement("canvas"); cv.width = cv.height = S;
    const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(big, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data, n = S * S;
    let lum = new Float32Array(n), red = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; lum[i] = 0.299 * r + 0.587 * gg + 0.114 * b; red[i] = r - (gg + b) / 2; }
    lum = boxBlur(lum, S, 1, 1); red = boxBlur(red, S, 1, 1);
    const at = (a, u, v) => a[Math.min(S - 1, Math.max(0, Math.round(v * S))) * S + Math.min(S - 1, Math.max(0, Math.round(u * S)))];
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
    // 皮肤的亮度、红度：两边脸颊 + 鼻梁
    const sl = [], sr = [];
    for (const [cu, cv2] of [[Fc.eyeL[0], Fc.mouth[1] - 0.13], [Fc.eyeR[0], Fc.mouth[1] - 0.13], [0.5, Fc.eyeL[1] + 0.05]]) for (let dv = -0.025; dv <= 0.025; dv += 1 / S) for (let du = -0.025; du <= 0.025; du += 1 / S) { sl.push(at(lum, cu + du, cv2 + dv)); sr.push(at(red, cu + du, cv2 + dv)); }
    const sL = Math.max(30, med(sl)), sR = med(sr);
    const D = (u, v) => sL - at(lum, u, v);   // 比皮肤暗多少
    const step = 1 / S, def = LA.defaultLines(), found = {};
    const resample = (pts, k) => { // 折线按长度均匀取 k 个点
      if (pts.length === 1) return Array(k).fill(pts[0]);
      const out = []; for (let i = 0; i < k; i++) { const f = (i / (k - 1)) * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(f)), r = f - j; out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * r, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * r]); } return out; };
    const smooth = (a, r = 2) => a.map((_, i) => { let s2 = 0, c = 0; for (let k = -r; k <= r; k++) if (a[i + k] != null) { s2 += a[i + k]; c++; } return s2 / c; });
    const longestRun = (cols, ok, center) => { // 连续的有效列里，最长（并且最好包含 center）的那一段
      let best = null, cur = null;
      for (let i = 0; i < cols.length; i++) { if (ok[i]) { if (!cur) cur = [i, i]; cur[1] = i; } if (!ok[i] || i === cols.length - 1) { if (cur) { const has = cols[cur[0]] <= center && cols[cur[1]] >= center; const sc = cur[1] - cur[0] + (has ? 1000 : 0); if (!best || sc > best.sc) best = { a: cur[0], b: cur[1], sc }; } cur = null; } }
      return best;
    };
    const lines = { brows: [], browT: [], eyes: [], mouth: null, nose: null };
    const eyesAt = [Fc.eyeL, Fc.eyeR];
    // ---- 眼睛 ----
    eyesAt.forEach(([eu, ev], side) => {
      const cols = [], top = [], bot = [], ok = [];
      for (let u = eu - 0.13; u <= eu + 0.13; u += step * 2) {
        let t = null, b = null;
        for (let v = ev - 0.045; v <= ev + 0.045; v += step) if (D(u, v) > sL * 0.2) { if (t == null) t = v; b = v; }
        cols.push(u); top.push(t); bot.push(b); ok.push(t != null && b - t > 0.006);
      }
      const run = longestRun(cols, ok, eu);
      let e = def.eyes[side];
      if (run && cols[run.b] - cols[run.a] > 0.09) {
        const a = Math.max(run.a, 0), b = run.b, w = clamp(cols[b] - cols[a], 0.12, 0.24), cu = (cols[a] + cols[b]) / 2;
        const tp = smooth(top.slice(a, b + 1)), bt = smooth(bot.slice(a, b + 1));
        const hMid = med(bt.slice(Math.floor(bt.length / 3), Math.ceil(bt.length * 2 / 3)).map((x, i) => x - tp[Math.floor(tp.length / 3) + i]));
        const h = clamp(hMid, 0.03, 0.085);
        const cornerV = (tp[0] + bt[0]) / 2, cornerV2 = (tp[tp.length - 1] + bt[bt.length - 1]) / 2;
        const up = resample(tp.map((v, i) => [cols[a + i], v]), 7);
        up[0][1] = cornerV; up[6][1] = cornerV2;
        const lo = up.map(([u, v], i) => { const k = i / 6, base = cornerV + (cornerV2 - cornerV) * k; return [u, base + (h * 0.5) * Math.sin(Math.PI * k) * 0.9]; });
        const scaleW = w / (cols[b] - cols[a]);
        const fix = (p) => [cu + (p[0] - cu) * scaleW, p[1]];
        e = { up: up.map(fix), lo: lo.map(fix), iris: [eu, ev, clamp(h * 0.62, 0.02, 0.034)] };
        found.eyes = (found.eyes || 0) + 1;
      }
      lines.eyes.push(e);
    });
    // ---- 眉毛（在眼睛上沿再往上找）----
    eyesAt.forEach(([eu, ev], side) => {
      const eyeTop = Math.min(...lines.eyes[side].up.map((p) => p[1]));
      const cols = [], vs = [], th = [], ok = [];
      for (let u = eu - 0.15; u <= eu + 0.15; u += step * 2) {
        let best = 0, bv = null;
        for (let v = eyeTop - 0.1; v <= eyeTop - 0.022; v += step) { const dd = D(u, v) - 0.25 * Math.max(0, D(u, eyeTop - 0.13)); if (dd > best) { best = dd; bv = v; } }   // 减掉更上面（额头 / 刘海）的暗，眉毛是「比上下都暗」的一道
        let t = 0; if (bv != null) { for (let v = bv; v > bv - 0.05 && D(u, v) > best * 0.5; v -= step) t += step; for (let v = bv + step; v < bv + 0.05 && D(u, v) > best * 0.5; v += step) t += step; }
        cols.push(u); vs.push(bv); th.push(t); ok.push(best > sL * 0.06 && t < 0.045);
      }
      const run = longestRun(cols, ok, eu);
      if (run && cols[run.b] - cols[run.a] > 0.1) {
        const a = run.a, b = run.b, v2 = smooth(vs.slice(a, b + 1), 3);
        lines.brows.push(resample(v2.map((v, i) => [cols[a + i], v]), 7));
        lines.browT.push(clamp(med(th.slice(a, b + 1)), 0.01, 0.04));
        found.brows = (found.brows || 0) + 1;
      } else { lines.brows.push(def.brows[side]); lines.browT.push(def.browT[side]); }
    });
    // ---- 嘴 ----
    {
      const [mu, mv] = Fc.mouth, cols = [], tp = [], bt = [], ok = [], bright = [];
      for (let u = mu - 0.22; u <= mu + 0.22; u += step * 2) {
        let t = null, b = null, br = 0;
        for (let v = mv - 0.07; v <= mv + 0.07; v += step) { const isLip = at(red, u, v) > sR + 9 || (Math.abs(v - mv) < 0.022 && D(u, v) > sL * 0.35); /* 嘴唇（红）或者正中间的嘴缝（暗） */ if (isLip) { if (t == null) t = v; b = v; } }
        if (t != null) for (let v = t; v <= b; v += step) if (at(lum, u, v) > sL * 0.95 && at(red, u, v) < sR - 4) br += step;   // 牙齿：亮、不红
        cols.push(u); tp.push(t); bt.push(b); bright.push(br); ok.push(t != null);
      }
      const run = longestRun(cols, ok, mu);
      if (run && cols[run.b] - cols[run.a] > 0.14) {
        const a = run.a, b = run.b, t2 = smooth(tp.slice(a, b + 1)), b2 = smooth(bt.slice(a, b + 1));
        const mid = t2.map((v, i) => [cols[a + i], (v + b2[i]) / 2]);
        // 中线拟合成一条光滑的抛物线（嘴角往上弯 = 笑），机器人的嘴就该是干净的一道
        let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
        for (const [u, v] of mid) { const x = u - mu, X = [1, x, x * x]; for (let r = 0; r < 3; r++) { B[r] += X[r] * v; for (let c = 0; c < 3; c++) A[r][c] += X[r] * X[c]; } }
        const sol = solve3(A, B);
        const u0 = cols[a], u1 = cols[b];
        const line = Array.from({ length: 9 }, (_, i) => { const u = u0 + (u1 - u0) * i / 8, x = u - mu; return [u, sol ? sol[0] + sol[1] * x + sol[2] * x * x : mid[Math.round(i / 8 * (mid.length - 1))][1]]; });
        const h = clamp(med(b2.map((v, i) => v - t2[i])), 0.02, 0.1);
        const openH = clamp(med(bright.slice(a + Math.floor((b - a) / 3), a + Math.ceil((b - a) * 2 / 3))), 0, 0.06);
        lines.mouth = { line, h, open: openH > 0.012 ? openH : 0 };
        found.mouth = 1;
      } else lines.mouth = def.mouth;
    }
    // ---- 鼻子：两个鼻孔 ----
    {
      const ev = Fc.eyeL[1], mv = Fc.mouth[1], v0 = ev + (mv - ev) * 0.5, v1 = mv - 0.06;
      const darkest = (u0, u1) => { let best = -1, p = null; for (let v = v0; v <= v1; v += step) for (let u = u0; u <= u1; u += step) { const dd = D(u, v); if (dd > best) { best = dd; p = [u, v]; } } return [best, p]; };
      const [dl, pl] = darkest(0.4, 0.495), [dr, pr] = darkest(0.505, 0.6);
      if (pl && pr && dl > sL * 0.15 && dr > sL * 0.15 && Math.abs(pl[1] - pr[1]) < 0.04) { lines.nose = [0.5, (pl[1] + pr[1]) / 2 - 0.006, clamp((pr[0] - pl[0]) * 1.5, 0.06, 0.16)]; found.nose = 1; }
      else lines.nose = def.nose;
    }
    const clean = LA.cleanLines(lines) || def;
    let skin = null; try { skin = skinColor(big); } catch (e) {}   // 皮肤色（公仔照着它，再往瓷白靠一点）
    // 眼珠的颜色：两个虹膜中间一小圈（避开瞳孔和高光）的中位数；深棕、黑眼睛就用默认的暖棕色
    let eye = null;
    try {
      const R = [], G = [], B = [];
      for (const e of clean.eyes) { const [u, v, r] = e.iris; for (let a = 0; a < 24; a++) for (const k of [0.55, 0.75]) { const x = Math.round((u + Math.cos(a / 24 * Math.PI * 2) * r * k) * S), y = Math.round((v + Math.sin(a / 24 * Math.PI * 2) * r * k) * S); if (x < 0 || y < 0 || x >= S || y >= S) continue; const i = (y * S + x) * 4; const l = d[i] + d[i + 1] + d[i + 2]; if (l < 60 || l > 600) continue; R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]); } }
      if (R.length > 20) { const med = (a) => a.sort((x, y) => x - y)[a.length >> 1], c = [med(R), med(G), med(B)]; if (c[2] > c[0] + 5 && c[2] >= c[1] && c[0] + c[1] + c[2] > 150) eye = "#4d6a86"; else if (c[1] > c[0] + 4 && c[1] > c[2] + 4) eye = "#4f7a5a"; }   // 蓝灰、绿色的眼睛（照片里眼珠常常发暗，只认很明显的）
    } catch (e) {}
    return { lines: clean, found, marks: mk, scale: big.scale, small: big.scale > 6, skin, eye };
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function solve3(A, B) {   // 3×3 线性方程（克拉默法则）
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d0 = det(A); if (Math.abs(d0) < 1e-12) return null;
    return [0, 1, 2].map((k) => det(A.map((row, r) => row.map((x, c) => (c === k ? B[r] : x)))) / d0);
  }

  root.LaoFace = { analyze, affine, align, snapEyes, cartoon, sharpen, delight, cyberize, blendEdge, skinRef, skinColor, make, STYLES: Object.keys(STYLES) };
})(typeof window !== "undefined" ? window : globalThis);
