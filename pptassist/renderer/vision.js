// 捞捞 · 看照片 / 视频里的老师：自动找五官（不用再点三下）、认发型和衣服颜色、给视频的每一帧打分挑正脸 / 侧脸 / 后脑勺。
//   用 Google MediaPipe 的两个模型（Apache-2.0，模型文件跟着安装包走，全部在本机算，不联网、不上传）：
//     face_mesh：脸上 478 个点（含虹膜），算头朝哪边、眼睛睁没睁、嘴张没张；
//     selfie_segmentation：把人和背景分开（认头发时不会把背景当成头发）。
//   认头发是自己写的（下面 hairFront / hairBack）：脸上方取头发的颜色，在「人」的范围里按颜色长出整片头发，
//   再看头发垂到哪里（长短）、额头被盖住多少（刘海）、头发缝在哪（中分 / 偏分），后脑勺那一帧看有没有扎起来。
//   核心的算法只用数组，不碰浏览器（测试里用 node 直接跑）；调模型的部分只在浏览器里。
"use strict";
(function (root) {
  // ---------- 脸上的点（MediaPipe Face Mesh 的编号） ----------
  const LM = {
    top: 10, chin: 152, nose: 1, edgeR: 234, edgeL: 454, jawR: 172, jawL: 397,   // R/L 是老师自己的右 / 左（照片里 R 在左边）；jaw 是下颌角
    eyeRo: 33, eyeRi: 133, eyeRt: 159, eyeRb: 145, eyeLo: 263, eyeLi: 362, eyeLt: 386, eyeLb: 374,
    irisR: 468, irisL: 473, lipT: 13, lipB: 14, mouthR: 61, mouthL: 291,
    browR: [70, 63, 105, 66, 107], browL: [336, 296, 334, 293, 300], cheekR: [50, 205, 187], cheekL: [280, 425, 411],
    oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // ---------- 颜色 ----------
  function lab(r, g, b) {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const R = f(r), G = f(g), B = f(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const fx = t(X), fy = t(Y), fz = t(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  const hex = (r, g, b) => "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  const median = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
  const pct = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)]; };

  // 一张图（RGBA）→ 每个像素的 Lab
  function toLab(im) {
    const n = im.w * im.h, L = new Float32Array(n * 3), d = im.data;
    for (let i = 0; i < n; i++) { const c = lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); L[i * 3] = c[0]; L[i * 3 + 1] = c[1]; L[i * 3 + 2] = c[2]; }
    return L;
  }
  const dE = (L, i, c) => Math.hypot(L[i * 3] - c[0], L[i * 3 + 1] - c[1], L[i * 3 + 2] - c[2]);
  // 头发颜色比较：亮度差打个折（头发有高光、有阴影，色相比亮度稳）
  const dHair = (L, i, c) => Math.hypot((L[i * 3] - c[0]) * 0.6, L[i * 3 + 1] - c[1], L[i * 3 + 2] - c[2]);

  // 多边形填充（扫描线）→ Uint8Array 掩码
  function polyMask(w, h, pts) {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const xs = [], yc = y + 0.5;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * w + x] = 1;
    }
    return m;
  }

  // ---------- 头朝哪边、眼睛嘴巴 ----------
  // lm：[[x, y, z], …]，x、y、z 都是像素（z 和 x 同一个比例，越小越靠近镜头）
  function pose(lm) {
    const a = lm[LM.edgeR], b = lm[LM.edgeL], t = lm[LM.top], c = lm[LM.chin];
    const yaw = (Math.atan2(b[2] - a[2], b[0] - a[0]) * 180) / Math.PI;   // 正：老师往自己左边转（照片里脸朝右）… 只用绝对值和符号区分左右侧脸
    const pitch = (Math.atan2(c[2] - t[2], c[1] - t[1]) * 180) / Math.PI;
    const roll = (Math.atan2(lm[LM.eyeLo][1] - lm[LM.eyeRo][1], lm[LM.eyeLo][0] - lm[LM.eyeRo][0]) * 180) / Math.PI;
    const eo = (t1, b1, o, i) => dist(lm[t1], lm[b1]) / Math.max(1, dist(lm[o], lm[i]));
    const eyeOpen = Math.min(eo(LM.eyeRt, LM.eyeRb, LM.eyeRo, LM.eyeRi), eo(LM.eyeLt, LM.eyeLb, LM.eyeLo, LM.eyeLi));
    const mouthOpen = dist(lm[LM.lipT], lm[LM.lipB]) / Math.max(1, dist(lm[LM.mouthR], lm[LM.mouthL]));
    const fw = dist(a, b), fh = dist(t, c), jaw = dist(lm[LM.jawR], lm[LM.jawL]) / Math.max(1, fw);
    return { yaw, pitch, roll, eyeOpen, mouthOpen, fw, fh, jaw };
  }
  // 脸型：长（脸长 / 脸宽大）、方（下颌角宽）、圆（短而宽）、鹅蛋（其余）。公仔的脸蛋和下巴按这个微调
  function faceShapeOf(f) {
    if (!f || !f.fw) return "round";
    const L = f.fh / f.fw, j = f.jaw || 0.8;
    if (L > 1.36) return "long";
    if (j > 0.87) return "square";
    if (L < 1.2) return "round";
    return "oval";
  }
  // 照片上的三个点（和以前老师手点的一样）：两只眼睛（虹膜中心，没有就用眼角中点）、嘴巴中间
  function marksOf(lm) {
    const eye = (iris, o, i) => (lm[iris] ? [lm[iris][0], lm[iris][1]] : [(lm[o][0] + lm[i][0]) / 2, (lm[o][1] + lm[i][1]) / 2]);
    const e1 = eye(LM.irisR, LM.eyeRo, LM.eyeRi), e2 = eye(LM.irisL, LM.eyeLo, LM.eyeLi);
    return { e1, e2, mouth: [(lm[LM.lipT][0] + lm[LM.lipB][0]) / 2, (lm[LM.lipT][1] + lm[LM.lipB][1]) / 2] };
  }
  // 清楚不清楚：脸那一块亮度的拉普拉斯方差（按脸的大小归一）
  function sharpness(im, box) {
    const { w, d } = { w: im.w, d: im.data };
    const x0 = clamp(Math.floor(box[0]), 1, im.w - 2), x1 = clamp(Math.ceil(box[2]), 1, im.w - 2), y0 = clamp(Math.floor(box[1]), 1, im.h - 2), y1 = clamp(Math.ceil(box[3]), 1, im.h - 2);
    const Y = (x, y) => { const i = (y * w + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    let s = 0, s2 = 0, n = 0;
    const step = Math.max(1, Math.floor((x1 - x0) / 160));
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const v = 4 * Y(x, y) - Y(x - 1, y) - Y(x + 1, y) - Y(x, y - 1) - Y(x, y + 1); s += v; s2 += v * v; n++;
    }
    return n ? s2 / n - (s / n) ** 2 : 0;
  }

  // ---------- 认头发（正脸） ----------
  // im：{ w, h, data: RGBA }，lm：脸上的点（像素），person：人（0～1，Float32Array，和 im 一样大；没有就当整张都是人）
  function hairFront(im, lm, person) {
    const { w, h } = im, L = toLab(im), P = pose(lm), fw = P.fw, fh = P.fh;
    const isP = (i) => !person || person[i] > 0.5;
    const cx = (lm[LM.edgeR][0] + lm[LM.edgeL][0]) / 2, top = lm[LM.top], chin = lm[LM.chin];
    const eyeY = (lm[LM.eyeRo][1] + lm[LM.eyeLo][1]) / 2, mouthY = (lm[LM.lipT][1] + lm[LM.lipB][1]) / 2;
    const face = polyMask(w, h, LM.oval.map((k) => [lm[k][0], lm[k][1]]));
    const idx = (x, y) => clamp(Math.round(y), 0, h - 1) * w + clamp(Math.round(x), 0, w - 1);
    const notes = [];
    // 皮肤：两边脸颊
    const skinPts = [];
    for (const k of [...LM.cheekR, ...LM.cheekL]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) skinPts.push(idx(lm[k][0] + dx * fw * 0.01, lm[k][1] + dy * fw * 0.01));
    const skin = [0, 1, 2].map((c) => median(skinPts.map((i) => L[i * 3 + c])));
    // 头发的种子：额头上面一条（脸框最上面那个点再往上）+ 两边太阳穴外侧，在「人」里面、颜色不像皮肤的
    const seeds = [];
    let band = 0, scalp = 0;
    const take = (x0, x1, y0, y1, crown) => {
      for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x; if (!isP(i) || face[i]) continue; band++;
        if (crown && Math.hypot((L[i * 3] - skin[0]) * 0.3, (L[i * 3 + 1] - skin[1]) * 1.6, (L[i * 3 + 2] - skin[2]) * 1.2) < 11) scalp++;   // 头皮：亮一点暗一点都行，颜色（偏红、偏黄）要和脸一样——金发偏黄，不会算成头皮
        if (dE(L, i, skin) > 16) seeds.push(i);
      }
    };
    take(cx - 0.3 * fw, cx + 0.3 * fw, top[1] - 0.32 * fh, top[1] - 0.05 * fh, true);
    const crownN = band;
    take(lm[LM.edgeR][0] - 0.2 * fw, lm[LM.edgeR][0] - 0.02 * fw, eyeY - 0.35 * fh, eyeY);
    take(lm[LM.edgeL][0] + 0.02 * fw, lm[LM.edgeL][0] + 0.2 * fw, eyeY - 0.35 * fh, eyeY);
    // 光头：额头上面那一块大多是皮肤色（头皮），公仔就不要头发
    if (crownN > 30 && scalp > crownN * 0.6) {
      notes.push("头顶大部分是头皮，按光头做（有头发的话在下面选发型）");
      return { ok: true, style: "none", bangs: "none", color: null, conf: 0.6, notes, part: null, text: "光头（或者头发很少）", top: null, skin: hex(...labToRgb(skin)), detail: { scalp: +(scalp / crownN).toFixed(2) } };
    }
    if (band < 30 || seeds.length < band * 0.2) {
      notes.push("头顶看不到头发（光头、很短的寸头，或者照片把头顶裁掉了）");
      return { ok: false, style: "short", bangs: "none", color: null, conf: 0.3, notes, skin: hex(...labToRgb(skin)) };
    }
    // 头发颜色：种子的中位数，去掉离得远的再算一次；取偏暗的那部分（高光不算）
    let hc = [0, 1, 2].map((c) => median(seeds.map((i) => L[i * 3 + c])));
    const near = seeds.filter((i) => dHair(L, i, hc) < 22);
    if (near.length > 20) hc = [0, 1, 2].map((c) => median(near.map((i) => L[i * 3 + c])));
    const sd = seeds.map((i) => dHair(L, i, hc));
    const thr = clamp(pct(sd, 0.85) * 1.25, 12, 30);
    const skinGap = Math.hypot((hc[0] - skin[0]) * 0.6, hc[1] - skin[1], hc[2] - skin[2]);
    if (skinGap < 14) notes.push("头发颜色和皮肤很接近（浅色头发），认长短和刘海可能不准");
    // 整片头发：从种子按颜色长出去（只在「人」里面，比起皮肤更像头发）
    const H = new Uint8Array(w * h), q = new Int32Array(w * h);
    let qh = 0, qt = 0;
    // 不许长进去的地方：眉毛以下的脸（胡子、阴影会把头发连到衣领上）、脖子正中间那一条
    const browTop0 = Math.min(...[...LM.browR, ...LM.browL].map((k) => lm[k][1]));
    const block = (i) => { const x = i % w, y = (i / w) | 0; return (face[i] && y > browTop0 - 0.02 * fh) || (y > chin[1] - 0.05 * fh && y < chin[1] + 0.5 * fh && Math.abs(x - cx) < 0.2 * fw); };
    const ok = (i) => isP(i) && !block(i) && dHair(L, i, hc) < thr && dHair(L, i, hc) < dE(L, i, skin) * 0.9;
    for (const i of seeds) if (!H[i] && ok(i)) { H[i] = 1; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !H[j] && ok(j)) { H[j] = 1; q[qt++] = j; }
    }
    // 衣服（胸口中间那一块，不算头发）：顺便给公仔的上衣取色；胸口大部分都被认成头发，说明衣服和头发一个颜色，长短要小心认
    const chest = [];
    for (let y = chin[1] + 0.55 * fh; y < Math.min(h, chin[1] + 1.0 * fh); y += 2) for (let x = cx - 0.25 * fw; x < cx + 0.25 * fw; x += 2) { if (x < 0 || x >= w) continue; const i = idx(x, y); if (isP(i)) chest.push(i); }
    let top3 = null, shirtLikeHair = false;
    if (chest.length > 30) {
      const off = chest.filter((i) => !H[i]);
      shirtLikeHair = off.length < chest.length * 0.4;
      const cloth = off.filter((i) => dE(L, i, skin) > 18);   // 领口露出来的皮肤、项链不算衣服
      top3 = cloth.length > Math.max(30, chest.length * 0.15) ? rgbMode(im, cloth) : null;
    }
    // 肩膀：「人」的宽度第一次超过脸宽 2.6 倍的那一行（下巴以下，头发蓬的人别把头发当肩膀）；看不到就按一般比例
    let shoulderY = null;
    if (person) for (let y = Math.round(chin[1] + 0.15 * fh); y < Math.min(h, chin[1] + 0.9 * fh); y++) {
      let a = -1, b = -1; for (let x = 0; x < w; x++) if (person[y * w + x] > 0.5) { if (a < 0) a = x; b = x; }
      if (a >= 0 && b - a > 2.6 * fw) { shoulderY = y; break; }
    }
    const shY = shoulderY == null ? chin[1] + 0.5 * fh : shoulderY;
    // 长短：脸两边外侧那一条里，头发最低到哪
    let low = -Infinity;
    const sideLow = [];
    for (const s of [-1, 1]) {
      const ex = s < 0 ? lm[LM.edgeR][0] : lm[LM.edgeL][0];
      const xa = s < 0 ? ex - 0.45 * fw : ex + 0.02 * fw, xb = s < 0 ? ex - 0.02 * fw : ex + 0.45 * fw;
      let lowS = -Infinity, gap = 0;
      for (let y = Math.floor(eyeY); y < h; y++) {
        let n = 0; for (let x = Math.max(0, Math.floor(xa)); x <= Math.min(w - 1, xb); x++) n += H[y * w + x];
        if (n >= Math.max(2, 0.04 * fw)) { lowS = y; gap = 0; } else if (++gap > 0.08 * fh) break;   // 断开一截就不算了（衣服上的同色块）
        if (shirtLikeHair && y > shY + 0.05 * fh) break;   // 衣服和头发一个颜色：肩膀以下认不清，到肩膀为止
      }
      sideLow.push(lowS);
      low = Math.max(low, lowS);
    }
    const hitBottom = low >= h - 3;
    // 耳朵那一段（眼睛往下到嘴）脸两边外侧有没有头发：短发的人这里是耳朵和背景；披着的头发（哪怕别在耳后）这里有头发
    const earCov = [-1, 1].map((s) => {
      const ex = s < 0 ? lm[LM.edgeR][0] : lm[LM.edgeL][0], xa = s < 0 ? ex - 0.28 * fw : ex, xb = s < 0 ? ex : ex + 0.28 * fw;
      let rowsH = 0, rowsN = 0;
      for (let y = Math.floor(eyeY + 0.15 * fh); y <= mouthY; y++) { if (y < 0 || y >= h) continue; rowsN++; let n = 0; for (let x = Math.max(0, Math.floor(xa)); x <= Math.min(w - 1, xb); x++) n += H[y * w + x]; if (n >= Math.max(2, 0.05 * fw)) rowsH++; }
      return rowsN ? rowsH / rowsN : 0;
    });
    // 头发宽度（太阳穴那一行）：看蓬不蓬
    let wl = Infinity, wr = -Infinity;
    for (let y = Math.floor(eyeY - 0.25 * fh); y <= eyeY; y++) for (let x = 0; x < w; x++) if (y >= 0 && H[y * w + x]) { wl = Math.min(wl, x); wr = Math.max(wr, x); }
    const width = wr > wl ? (wr - wl) / fw : 1;
    let style, len;
    if (low < eyeY + 0.35 * fh || Math.max(...earCov) < 0.5) { style = "short"; len = "短发"; }
    else if (low < mouthY + 0.05 * fh) { style = "short"; len = "短发（到耳朵）"; }
    else if (low < shY + 0.15 * fh && !(hitBottom && h - 1 > shY + 0.15 * fh)) { style = "bob"; len = low < chin[1] + 0.2 * fh ? "下巴长短的短发" : "齐肩"; }
    else { style = "long"; len = "长发"; }
    if (shirtLikeHair && style !== "short") notes.push("衣服和头发颜色差不多，长到肩膀下面的部分分不清，按到肩膀算的");
    // 卷不卷：头发里亮度的细碎起伏 + 蓬起来
    const tex = [];
    for (let i = 0, n = w * h; i < n; i += 3) if (H[i]) { const x = i % w, y = (i / w) | 0; if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && H[i - 1] && H[i + 1] && H[i - w] && H[i + w]) tex.push(Math.abs(4 * L[i * 3] - L[(i - 1) * 3] - L[(i + 1) * 3] - L[(i - w) * 3] - L[(i + w) * 3])); }
    const rough = tex.length ? median(tex) : 0;
    if (style !== "short" && width > 1.75 && rough > 9) { style = "curly"; len = "卷发"; }
    // 刘海：额头（眉毛上沿到脸框顶）被头发盖住多少，分左、中、右三段看
    const browTop = Math.min(...[...LM.browR, ...LM.browL].map((k) => lm[k][1]));
    const fy0 = top[1] + 0.02 * fh, fy1 = browTop - 0.02 * fh;
    const cov = [0, 0, 0], cnt = [0, 0, 0];
    const fx0 = lm[LM.edgeR][0] + 0.12 * fw, fx1 = lm[LM.edgeL][0] - 0.12 * fw;
    for (let y = Math.floor(fy0); y <= fy1; y++) for (let x = Math.floor(fx0); x <= fx1; x++) {
      const i = idx(x, y); if (!face[i]) continue;
      const k = clamp(Math.floor(((x - fx0) / Math.max(1, fx1 - fx0)) * 3), 0, 2);
      cnt[k]++; cov[k] += H[i];
    }
    const C = cov.map((v, k) => (cnt[k] ? v / cnt[k] : 0)), cm = (C[0] + C[1] + C[2]) / 3;
    // 头发缝：额头上面那一条里，头发最少的那一列（中间露出一道头皮）
    let part = null;
    {
      const cols = [], xs0 = Math.floor(cx - 0.32 * fw), xs1 = Math.ceil(cx + 0.32 * fw);
      for (let x = xs0; x <= xs1; x++) { let n = 0, m = 0; for (let y = Math.floor(top[1] - 0.22 * fh); y <= top[1] + 0.04 * fh; y++) { if (y < 0 || x < 0 || x >= w) continue; const i = y * w + x; if (!isP(i)) continue; m++; n += H[i]; } cols.push(m ? n / m : 1); }
      const sm = cols.map((_, k) => { let s = 0, c = 0; for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < cols.length) { s += cols[j]; c++; } return s / c; });
      let kmin = 0; sm.forEach((v, k) => { if (v < sm[kmin]) kmin = k; });
      const med = median(sm);
      if (sm[kmin] < med * 0.6 && sm[kmin] < 0.6) part = (xs0 + kmin - cx) / fw;
    }
    // 两边头发多少：偏分的人一边多一边少
    let aL = 0, aR = 0;
    for (let y = Math.max(0, Math.floor(top[1] - 0.15 * fh)); y < Math.min(h, chin[1]); y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!H[i] || face[i]) continue; if (x < cx) aR++; else aL++; }
    const sideRatio = Math.max(aL, aR) / Math.max(1, Math.min(aL, aR));
    let bangs, bangsTxt;
    const asym = Math.abs(C[0] - C[2]);
    if (cm > 0.5 && Math.min(...C) > 0.35 && asym < 0.3) { bangs = "full"; bangsTxt = "齐刘海"; }
    else if (cm > 0.15 && C[1] < 0.25 && C[0] > 0.3 && C[2] > 0.3) { bangs = "middle"; bangsTxt = "中分刘海"; }
    else if (cm > 0.15 && (asym > 0.25 || Math.max(C[0], C[2]) > 0.45)) { bangs = "side"; bangsTxt = "斜刘海"; }
    else if (cm > 0.3) { bangs = "full"; bangsTxt = "刘海"; }
    else if (part != null && Math.abs(part) < 0.07 && sideRatio < 1.6) { bangs = "middle"; bangsTxt = "中分、不留刘海"; }
    else if (part != null || Math.max(C[0], C[2]) > 0.12 || sideRatio >= 1.6) { bangs = "side"; bangsTxt = "偏分、不留刘海"; }
    else { bangs = "none"; bangsTxt = "不留刘海"; }
    // 前面看是短发：也可能是扎起来了（马尾、丸子头）——正脸照分不出来
    const tiedPossible = style === "short" && sideLow.every((v) => v < mouthY);
    if (tiedPossible) notes.push("正面看头发是贴着头的，也可能是扎起来了（马尾 / 丸子头）：上传一段转头的视频可以自动认，或者在下面自己选");
    const hid = []; for (let i = 0, n = w * h; i < n && hid.length < 60000; i += 2) if (H[i]) hid.push(i);
    const rgb = rgbMedian(im, seeds.filter((i) => dHair(L, i, hc) < thr * 1.3).concat(hid.filter((_, k) => k % 3 === 0)));
    const color = rgb ? hex(...rgb) : hex(...labToRgb(hc));
    const conf = clamp(0.4 + Math.min(0.3, seeds.length / Math.max(1, band)) + (skinGap > 25 ? 0.2 : 0) - (shirtLikeHair ? 0.15 : 0), 0, 1);
    return {
      ok: true, style, bangs, color, conf, tiedPossible, notes, part,
      text: `${colorName(hc)}、${len}、${bangsTxt}`,
      top: top3 ? hex(...top3) : null, skin: hex(...labToRgb(skin)),
      detail: { earCov: earCov.map((v) => +v.toFixed(2)), sideRatio: +sideRatio.toFixed(2), part: part == null ? null : +part.toFixed(2), cov: C.map((v) => +v.toFixed(2)), low: (low - chin[1]) / fh, shoulder: (shY - chin[1]) / fh, width: +width.toFixed(2), rough: +rough.toFixed(1), thr: +thr.toFixed(1), shirtLikeHair },
      mask: H,
    };
  }
  // 出现最多的颜色（衣服上有花纹、项链、衬衫领子时，取占地方最大的那种颜色）：按颜色分格子数，最多的那一格取平均
  function rgbMode(im, ids) {
    const d = im.data, bins = new Map();
    for (const i of ids) { const k = (d[i * 4] >> 5) * 64 + (d[i * 4 + 1] >> 5) * 8 + (d[i * 4 + 2] >> 5); const b = bins.get(k) || [0, 0, 0, 0]; b[0] += d[i * 4]; b[1] += d[i * 4 + 1]; b[2] += d[i * 4 + 2]; b[3]++; bins.set(k, b); }
    let best = null; for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
    return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : null;
  }
  function rgbMedian(im, ids) {
    if (!ids || !ids.length) return null;
    const d = im.data; return [0, 1, 2].map((c) => median(ids.map((i) => d[i * 4 + c])));
  }
  function labToRgb([Lv, a, b]) {
    const fy = (Lv + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
    const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
    const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
    const g = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return [g(R), g(G), g(B)].map((v) => clamp(v, 0, 255));
  }
  function colorName([Lv, a, b]) {
    const C = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180) / Math.PI;
    if (Lv < 22) return "黑色";
    if (C < 8) return Lv > 70 ? "银白色" : Lv > 45 ? "灰色" : "深灰色";
    if (Lv > 62 && hue > 50 && hue < 110) return "金色";
    if (hue > -20 && hue < 45 && C > 25) return Lv < 40 ? "酒红色" : "红棕色";
    return Lv < 34 ? "深棕色" : Lv < 52 ? "棕色" : "浅棕色";
  }

  // ---------- 认头发（后脑勺，视频里背对镜头的那一帧） ----------
  // 头发颜色用正脸认出来的；person 必须有（背对着时看不到脸，只能靠「人」的轮廓）
  function hairBack(im, person, hairColor) {
    const { w, h } = im, L = toLab(im), hc = lab(...hexRgb(hairColor || "#1c1a1f"));
    const isH = (i) => person[i] > 0.5 && dHair(L, i, hc) < 26;
    // 每一行头发从哪到哪
    const span = [];
    for (let y = 0; y < h; y++) { let a = -1, b = -1, n = 0; for (let x = 0; x < w; x++) if (isH(y * w + x)) { if (a < 0) a = x; b = x; n++; } span.push(a < 0 || n < 3 ? null : [a, b, n]); }
    const y0 = span.findIndex((r) => r);
    if (y0 < 0) return { ok: false, note: "后脑勺这一帧没认出头发" };
    // 头宽：头顶往下这一段里头发最宽的地方（头发一般比头宽一点点）
    let W = 0, yW = y0;
    for (let y = y0; y < h; y++) { if (y - y0 > 1.3 * W + 10) break; const r = span[y]; if (!r) continue; const ww = r[1] - r[0]; if (ww > W) { W = ww; yW = y; } }   // 头顶有发髻时先量到的是发髻，接着往下量到后脑勺
    if (W < 20) return { ok: false, note: "后脑勺太小了" };
    const cx = (span[yW][0] + span[yW][1]) / 2;
    // 中间那一条（头宽的 ±0.5）往下数，头发一直连着到哪；每一行中间那条里头发多宽
    const wid = [];
    let gap = 0, bottom = y0;
    for (let y = y0; y < h; y++) {
      let n = 0; for (let x = Math.max(0, Math.round(cx - 0.5 * W)); x < Math.min(w, cx + 0.5 * W); x++) n += isH(y * w + x) ? 1 : 0;
      wid.push(n / W);
      if (n > 0.04 * W) { bottom = y; gap = 0; } else if (++gap > 0.06 * W) break;
    }
    const Ln = (bottom - y0) / W;   // 头发从头顶垂到哪（以头宽为单位）；后脑勺到发际线大约 1.0
    const nape = Math.round(1.05 * W);
    const tail = wid.slice(nape, Math.round(nape + 0.6 * W)).filter((v) => v > 0.04);
    const tailW = tail.length ? tail.reduce((s, v) => s + v, 0) / tail.length : 0;
    // 发髻：头顶上先长出一个小球——宽度先涨到球那么宽、停一段（平台）、再接着变宽成后脑勺；光秃秃的后脑勺是一路变宽、不停的
    let bun = false;
    const top = wid.slice(0, Math.round(0.45 * W)), run = Math.max(4, Math.round(0.05 * W));
    for (let k = 0; k + run < top.length; k++) {
      const v = top[k];
      if (v < 0.15 || v > 0.6) continue;
      if (Math.abs(top[k + run] - v) < 0.025 && Math.max(...wid.slice(k + run, k + run + Math.round(0.6 * W))) > v * 1.8) { bun = true; break; }
    }
    // 低发髻：脖子那里一小团（不长、也不太窄）
    const tailLen = tail.length / W;
    let style;
    if (Ln > 1.35 && tailW > 0 && tailW < 0.42 && tailLen > 0.3) style = "ponytail";
    else if (bun || (tailLen > 0.08 && tailLen <= 0.3 && tailW > 0.2 && tailW < 0.6 && Ln < 1.5)) style = "bun";
    else if (Ln > 1.6) style = "long";
    else if (Ln > 1.15) style = "bob";
    else style = "short";
    return { ok: true, style, detail: { W, len: +Ln.toFixed(2), tailW: +tailW.toFixed(2), tailLen: +tailLen.toFixed(2), bun } };
  }
  const hexRgb = (s) => [1, 3, 5].map((k) => parseInt(String(s).slice(k, k + 2), 16));

  // 正脸 + 后脑勺（+ 侧脸）合起来：后脑勺看得到扎没扎，优先听它的
  function mergeHair(front, back) {
    if (!front || !front.ok) return front;
    if (!back || !back.ok) return front;
    const r = { ...front, notes: front.notes.filter((n) => !/扎起来/.test(n)) };
    if (back.style === "ponytail" || back.style === "bun") { r.style = back.style; r.text = r.text.replace(/短发（到耳朵）|短发|下巴长短的短发|齐肩|长发/, back.style === "bun" ? "丸子头" : "马尾"); r.conf = Math.min(1, r.conf + 0.15); }
    else if (back.style === "long" && front.style === "bob") { r.style = "long"; r.text = r.text.replace(/齐肩|下巴长短的短发/, "长发"); }
    return r;
  }

  // ---------- 给视频的每一帧打分 ----------
  // f：{ face: pose()+sharp 或 null, person: 人占画面的比例 }
  function frameScore(f) {
    if (!f.face) return 0;
    const p = f.face, cosd = (d) => Math.cos((clamp(Math.abs(d), 0, 89) * Math.PI) / 180);
    return cosd(p.yaw) ** 6 * cosd(p.pitch) ** 4 * clamp(p.eyeOpen / 0.22, 0, 1) * (1 - clamp(p.mouthOpen * 2.2, 0, 0.6)) * Math.log(1 + p.sharp) * Math.min(1, p.fw / 120);
  }
  // frames：[{ t, face, person, hairFrac }]（按时间排好）→ 正脸、左侧脸、右侧脸、后脑勺各一帧（没有就 null）
  function pickViews(frames) {
    let front = null, left = null, right = null, back = null;
    for (const f of frames) {
      const s = frameScore(f);
      if (s > 0 && (!front || s > front.s)) front = { ...f, s };
      if (f.face && Math.abs(f.face.yaw) > 35) {
        const sd = Math.abs(f.face.yaw) * Math.log(1 + f.face.sharp);
        if (f.face.yaw > 0 && (!left || sd > left.s)) left = { ...f, s: sd };
        if (f.face.yaw < 0 && (!right || sd > right.s)) right = { ...f, s: sd };
      }
      if (!f.face && f.person > 0.04 && f.headHair > 0.6 && (!back || f.headHair * f.person > back.s)) back = { ...f, s: f.headHair * f.person };
    }
    return { front, left, right, back };
  }

  // ---------- 说话的那一段（截来当配音的参考录音） ----------
  // samples：Float32Array 单声道，rate：采样率 → 最好的一段 [开始秒, 结束秒]：3～10 秒、两头是停顿
  function speechSpan(samples, rate, { min = 3, max = 10 } = {}) {
    const hop = Math.round(rate * 0.02), n = Math.floor(samples.length / hop), e = new Float32Array(n);
    for (let k = 0; k < n; k++) { let s = 0; for (let i = k * hop; i < (k + 1) * hop; i++) s += samples[i] * samples[i]; e[k] = Math.sqrt(s / hop); }
    const sorted = Float32Array.from(e).sort(), floor = sorted[Math.floor(n * 0.1)] || 0, peak = sorted[Math.floor(n * 0.95)] || 0;
    if (peak < 0.01) return null;
    const thr = Math.max(floor * 3, floor + (peak - floor) * 0.12);
    const on = Array.from(e, (v) => v > thr);
    // 连起来：中间停顿短于 0.35 秒的算一段
    const segs = []; let a = -1, lastOn = -1;
    for (let k = 0; k < n; k++) {
      if (on[k]) { if (a < 0) a = k; lastOn = k; }
      else if (a >= 0 && k - lastOn > 0.35 / 0.02) { segs.push([a, lastOn]); a = -1; }
    }
    if (a >= 0) segs.push([a, lastOn]);
    // 挑总时长最接近 6～8 秒的一串连续的段（从一段的开头到另一段的结尾，不超过 max）
    let best = null;
    for (let i = 0; i < segs.length; i++) for (let j = i; j < segs.length; j++) {
      const t0 = Math.max(0, segs[i][0] * 0.02 - 0.15), t1 = Math.min(samples.length / rate, (segs[j][1] + 1) * 0.02 + 0.15), d = t1 - t0;
      if (d > max) break;
      const score = d >= min ? -Math.abs(d - 7) : -100 + d;
      if (!best || score > best.score) best = { t0, t1, score };
    }
    return best ? [best.t0, best.t1] : null;
  }

  const core = { LM, lab, pose, faceShapeOf, marksOf, sharpness, polyMask, hairFront, hairBack, mergeHair, frameScore, pickViews, speechSpan, colorName };

  // ---------- 浏览器里：调 MediaPipe ----------
  // MediaPipe 的 wasm 胶水代码要用 eval，主窗口的安全策略不许；所以模型放在一个单独的小页面（vision.html，只加载本地的这几个脚本）里跑，
  // 主窗口通过 postMessage 把图（ImageBitmap）送过去、拿结果回来。主窗口用 LaoVision.analyzePhoto / analyzeFrame / hairBackOf，用法和直接调一样。
  if (typeof window === "undefined") { if (typeof module !== "undefined") module.exports = core; return; }
  const IN_FRAME = /vision\.html$/.test(root.location.pathname);
  if (!IN_FRAME) {
    let frame = null, ready = null, seq = 0;
    const waits = new Map();
    root.addEventListener("message", (e) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const m = e.data || {};
      if (m.ready) return ready && ready.res();
      const w = waits.get(m.id); if (!w) return; waits.delete(m.id);
      m.error ? w.rej(new Error(m.error)) : w.res(m.result);
    });
    const boot = () => {
      if (ready) return ready.p;
      let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); ready = { p, res };
      frame = document.createElement("iframe"); frame.src = "vision.html"; frame.hidden = true; frame.setAttribute("aria-hidden", "true");
      document.body.appendChild(frame);
      setTimeout(() => rej(new Error("认脸的组件加载超时")), 60000);
      return p;
    };
    const ask = async (op, src, extra) => {
      await boot();
      const bmp = src instanceof Blob ? await createImageBitmap(src) : await createImageBitmap(src);
      const id = ++seq;
      return new Promise((res, rej) => { waits.set(id, { res, rej }); frame.contentWindow.postMessage({ id, op, bmp, extra }, "*", [bmp]); });
    };
    root.LaoVision = { ...core, ready: boot, analyzePhoto: (src) => ask("photo", src), analyzeFrame: (src, hairColor) => ask("frame", src, { hairColor }), hairBackOf: (src, hairColor) => ask("back", src, { hairColor }) };
    return;
  }
  const BASE = "vendor/mediapipe/";
  let fm = null, ss = null, chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  async function models() {
    if (!fm) {
      if (!root.FaceMesh || !root.SelfieSegmentation) throw new Error("认脸的组件没装好（vendor/mediapipe）");
      fm = new root.FaceMesh({ locateFile: (f) => BASE + "face_mesh/" + f });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      ss = new root.SelfieSegmentation({ locateFile: (f) => BASE + "selfie_segmentation/" + f });
      ss.setOptions({ modelSelection: 0 });
      await fm.initialize(); await ss.initialize();
    }
  }
  const run = (sol, image) => new Promise((res, rej) => { let r = null; sol.onResults((x) => { r = x; }); sol.send({ image }).then(() => res(r), rej); });
  // 图（img / canvas / video 帧）→ 不超过 maxSide 的画布
  function canvasOf(src, maxSide) {
    const W = src.naturalWidth || src.videoWidth || src.width, Hh = src.naturalHeight || src.videoHeight || src.height, k = Math.min(1, maxSide / Math.max(W, Hh));
    const c = document.createElement("canvas"); c.width = Math.round(W * k); c.height = Math.round(Hh * k);
    const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height);
    return { c, g, k };
  }
  // 一张图：脸上的点（原图像素）、朝向、清晰度、人的掩码（缩小后的）
  // 模型的输入固定用 SQ×SQ 的方图（照片按比例放进去、四周补黑）：输入尺寸一变模型就重新分配显存，换十来种尺寸以后人像分割会开始给空结果
  const SQ = 1024;
  let sq = null;
  function square(c) {
    if (!sq) { sq = document.createElement("canvas"); sq.width = sq.height = SQ; }
    const g = sq.getContext("2d"), s = SQ / Math.max(c.width, c.height), ox = (SQ - c.width * s) / 2, oy = (SQ - c.height * s) / 2;
    g.fillStyle = "#000"; g.fillRect(0, 0, SQ, SQ); g.imageSmoothingQuality = "high"; g.drawImage(c, ox, oy, c.width * s, c.height * s);
    return { s, ox, oy };
  }
  async function segment(c, T) {
    const s = await run(ss, sq);
    const mc = document.createElement("canvas"); mc.width = c.width; mc.height = c.height;
    const mg = mc.getContext("2d", { willReadFrequently: true });
    mg.drawImage(s.segmentationMask, T.ox, T.oy, c.width * T.s, c.height * T.s, 0, 0, c.width, c.height);
    // 模型给回来的图是显存里的 ImageBitmap，用完马上关掉
    for (const b of [s.segmentationMask, s.image]) if (b && b.close) try { b.close(); } catch (e) {}
    const md = mg.getImageData(0, 0, c.width, c.height).data, person = new Float32Array(c.width * c.height);
    let alphaAll = true; for (let i = 3; i < md.length; i += 4 * 97) if (md[i] < 250) { alphaAll = false; break; }   // 一般放在透明度里，有的版本放在红色里
    let frac = 0;
    for (let i = 0; i < person.length; i++) { person[i] = (alphaAll ? md[i * 4] : md[i * 4 + 3]) / 255; if (person[i] > 0.5) frac++; }
    return { person, frac: frac / person.length };
  }
  // 一张图：脸上的点（像素，缩小后的图上）、朝向、清晰度、人的掩码
  function look(src, { still = true } = {}) {
    return serial(async () => {
      await models();
      const { c, g, k } = canvasOf(src, 1280), T = square(c);
      if (still && fm.reset) fm.reset();
      const r = await run(fm, sq);
      if (r && r.image && r.image.close) try { r.image.close(); } catch (e) {}
      let seg = await segment(c, T);
      const raw = r && r.multiFaceLandmarks && r.multiFaceLandmarks[0];
      if (raw && seg.frac < 0.005) {   // 有脸却说没有人：分割模型坏了，重新建一个再算一次
        try { ss.close && (await ss.close()); } catch (e) {}
        ss = new root.SelfieSegmentation({ locateFile: (f) => BASE + "selfie_segmentation/" + f }); ss.setOptions({ modelSelection: 0 }); await ss.initialize();
        seg = await segment(c, T);
      }
      const im = { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
      const lm = raw ? raw.map((p) => [(p.x * SQ - T.ox) / T.s, (p.y * SQ - T.oy) / T.s, (p.z * SQ) / T.s]) : null;
      let face = null;
      if (lm) {
        const P = pose(lm), xs = lm.map((p) => p[0]), ys = lm.map((p) => p[1]);
        const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        face = { ...P, sharp: sharpness(im, box), box: box.map((v) => v / k), marks: Object.fromEntries(Object.entries(marksOf(lm)).map(([key, v]) => [key, [v[0] / k, v[1] / k]])) };
      }
      return { im, lm, person: seg.person, face, k, personFrac: seg.frac };
    });
  }
  // 一张正脸照：五官的三个点 + 头发 + 衣服颜色
  async function analyzePhoto(src) {
    const r = await look(src);
    if (!r.face) return { ok: false, error: "照片里没找到脸（要正脸、脸别太小、别太暗）" };
    const notes = [];
    if (Math.abs(r.face.yaw) > 18) notes.push("脸有点侧，换一张正对镜头的会更像");
    if (r.face.eyeOpen < 0.15) notes.push("眼睛像是闭着的");
    if (r.face.fw < 90) notes.push("照片里的脸比较小，离近一点拍会更清楚");
    const hair = hairFront(r.im, r.lm, r.person);
    return { ok: true, face: r.face, marks: r.face.marks, hair, notes, person: r.personFrac };
  }
  // 视频的一帧：给挑帧用（背对着时顺便看头那一块头发占多少）
  async function analyzeFrame(src, hairColor) {
    const r = await look(src, { still: false });
    let headHair = 0;
    if (!r.face && hairColor && r.personFrac > 0.04) {
      const { w, h } = r.im, hc = lab(...hexRgb(hairColor)), L = toLab(r.im);
      let y0 = -1; for (let y = 0; y < h && y0 < 0; y++) for (let x = 0; x < w; x++) if (r.person[y * w + x] > 0.5) { y0 = y; break; }
      let n = 0, m = 0;
      for (let y = y0; y < Math.min(h, y0 + h * 0.12); y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (r.person[i] > 0.5) { m++; if (dHair(L, i, hc) < 26) n++; } }
      headHair = m ? n / m : 0;
    }
    return { face: r.face, person: r.personFrac, headHair, r };
  }
  async function hairBackOf(src, hairColor) {
    const r = await look(src, { still: true });
    if (r.face && Math.abs(r.face.yaw) < 100) return { ok: false, note: "这一帧看得到脸，不是后脑勺" };
    return hairBack(r.im, r.person, hairColor);
  }
  const OPS = { photo: (b) => analyzePhoto(b), frame: (b, x) => analyzeFrame(b, x.hairColor).then((f) => ({ face: f.face, person: f.person, headHair: f.headHair })), back: (b, x) => hairBackOf(b, x.hairColor) };
  root.addEventListener("message", async (e) => {
    const m = e.data || {}; if (!OPS[m.op] || e.source !== root.parent) return;
    try { const result = await OPS[m.op](m.bmp, m.extra || {}); root.parent.postMessage({ id: m.id, result }, "*"); }
    catch (err) { root.parent.postMessage({ id: m.id, error: String((err && err.message) || err) }, "*"); }
    finally { if (m.bmp && m.bmp.close) m.bmp.close(); }
  });
  root.LaoVision = { ...core, look, analyzePhoto, analyzeFrame, hairBackOf, ready: () => serial(models) };
  serial(models).then(() => root.parent.postMessage({ ready: true }, "*"), (e) => console.error("vision", e));
})(typeof window !== "undefined" ? window : globalThis);
