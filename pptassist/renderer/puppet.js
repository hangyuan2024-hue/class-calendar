// 捞捞 · Q版动画（自己写的 2D 骨骼）：AI 画好的一张 Q版形象 + 几张只改了嘴 / 眼睛的图层 → 实时动起来。
//   说话：按配音的响度换「闭嘴 / 张一点 / 张大」；眨眼：隔几秒闭一下；头：绕着脖子轻轻摆、说话时跟着点；
//   身体：呼吸、挥手时轻轻蹦、指幻灯片时往那边侧身、想一想时歪头。
//   analyze()：找背景、把每张图层和原图对齐（AI 改图时会挪几个像素）、找出变了的那一块（嘴 / 眼睛）、找脖子在哪 —— 纯数组，node 里能测。
//   create()：WebGL 一个片元着色器画出来（扭头不撕裂：头和身子之间按距离渐变），背景换成这一页的颜色，脚下一圈软影子。
"use strict";
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const KINDS = ["mouthHalf", "mouthOpen", "eyesClosed"];

  // ---------- 分析（img：{ data: RGBA, width, height }）----------
  function bgOf(img) {
    const { data: d, width: w, height: h } = img, rs = [], gs = [], bs = [];
    const take = (x, y) => { const i = (y * w + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); };
    for (let x = 0; x < w; x += 2) { take(x, 0); take(x, h - 1); }
    for (let y = 0; y < h; y += 2) { take(0, y); take(w - 1, y); }
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    return [med(rs), med(gs), med(bs)];
  }
  // 背景：从四条边开始，颜色和背景差不多的连成一片（衣服里的白色不会被当成背景）
  function fgMask(img, bg, tol = 26) {
    const { data: d, width: w, height: h } = img, n = w * h;
    const isBg = new Uint8Array(n), stack = new Int32Array(n);
    let sp = 0;
    const near = (p) => { const i = p * 4; return Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) <= tol; };
    const push = (p) => { if (!isBg[p] && near(p)) { isBg[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
      const p = stack[--sp], x = p % w;
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < n - w) push(p + w);
    }
    const fg = new Uint8Array(n); for (let p = 0; p < n; p++) fg[p] = isBg[p] ? 0 : 1;
    return fg;
  }
  // 抗锯齿的边：挨着背景的那一圈按「和背景差多少」给半透明
  function alphaOf(img, fg, bg) {
    const { data: d, width: w, height: h } = img, a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (!fg[p]) continue;
      const edge = (x > 0 && !fg[p - 1]) || (x < w - 1 && !fg[p + 1]) || (y > 0 && !fg[p - w]) || (y < h - 1 && !fg[p + w]);
      if (!edge) { a[p] = 255; continue; }
      const i = p * 4, dd = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
      a[p] = Math.round(clamp(dd / 70, 0.15, 1) * 255);
    }
    return a;
  }
  function boxOf(fg, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fg[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }
  const gray = (img) => { const { data: d, width: w, height: h } = img, g = new Float32Array(w * h); for (let p = 0, i = 0; p < w * h; p++, i += 4) g[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; return g; };
  // 图层和原图对齐：在 ±R 像素里找差别最小的平移（每隔一个像素算一次，够准又快）
  function align(A, B, w, h, box, R = 10) {
    let best = [0, 0], bv = Infinity;
    const [x0, y0, x1, y1] = box;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let s = 0, n = 0;
      for (let y = Math.max(y0, -dy); y < Math.min(y1, h - dy); y += 3) for (let x = Math.max(x0, -dx); x < Math.min(x1, w - dx); x += 3) { s += Math.abs(B[(y + dy) * w + x + dx] - A[y * w + x]); n++; }
      if (n && s / n < bv) { bv = s / n; best = [dx, dy]; }
    }
    return best;
  }
  // 变了的那一块：差得多的像素 → 连通块 → 留大的
  // box：只在这里面找（脸）；all：数一数整个人身上变了多少（改动太大的图层不用）
  function changed(F, L, w, h, shift, box, opt = {}) {
    const [dx, dy] = shift, thr = opt.thr || 34;
    const m = new Uint8Array(w * h);
    const [bx0, by0, bx1, by1] = box;
    const diff = (x, y) => { const xs = x + dx, ys = y + dy; if (xs < 0 || ys < 0 || xs >= w || ys >= h) return false; const i = (y * w + x) * 4, j = (ys * w + xs) * 4; return Math.max(Math.abs(F[i] - L[j]), Math.abs(F[i + 1] - L[j + 1]), Math.abs(F[i + 2] - L[j + 2])) > thr; };
    let total = 0;
    if (opt.all) { const [ax0, ay0, ax1, ay1] = opt.all; for (let y = ay0; y < ay1; y += 2) for (let x = ax0; x < ax1; x += 2) if (diff(x, y)) total += 4; }
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const xs = x + dx, ys = y + dy; if (xs < 0 || ys < 0 || xs >= w || ys >= h) continue;
      const i = (y * w + x) * 4, j = (ys * w + xs) * 4;
      if (Math.max(Math.abs(F[i] - L[j]), Math.abs(F[i + 1] - L[j + 1]), Math.abs(F[i + 2] - L[j + 2])) > thr) m[y * w + x] = 1;
    }
    // 去掉零星的点：3×3 里至少 4 个才算
    const c = new Uint8Array(w * h);
    for (let y = by0 + 1; y < by1 - 1; y++) for (let x = bx0 + 1; x < bx1 - 1; x++) {
      const p = y * w + x; if (!m[p]) continue;
      const s = m[p - 1] + m[p + 1] + m[p - w] + m[p + w] + m[p - w - 1] + m[p - w + 1] + m[p + w - 1] + m[p + w + 1];
      if (s >= 3) c[p] = 1;
    }
    const lab = new Int32Array(w * h), comps = [], st = [];
    for (let p0 = 0; p0 < w * h; p0++) {
      if (!c[p0] || lab[p0]) continue;
      const id = comps.length + 1; let n = 0, X0 = w, Y0 = h, X1 = 0, Y1 = 0; st.push(p0); lab[p0] = id;
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p / w) | 0; n++;
        if (x < X0) X0 = x; if (x > X1) X1 = x; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y;
        for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) { const q = p + yy * w + xx, qx = x + xx; if (qx >= 0 && qx < w && q >= 0 && q < w * h && c[q] && !lab[q]) { lab[q] = id; st.push(q); } }
      }
      comps.push({ id, n, box: [X0, Y0, X1 + 1, Y1 + 1] });
    }
    comps.sort((a, b) => b.n - a.n);
    if (!comps.length) return null;
    // 嘴、眼睛只能在脸的中间一带，不能贴着脸的上下边（那是头发、衣服变了）
    if (opt.near) { const [ny0, ny1] = opt.near; const f = comps.filter((k) => (k.box[1] + k.box[3]) / 2 >= ny0 && (k.box[1] + k.box[3]) / 2 <= ny1); if (f.length) comps.splice(0, comps.length, ...f); }
    const keep = opt.one ? [comps[0]] : comps.filter((k) => k.n >= comps[0].n * 0.25).slice(0, 2);
    const ids = new Set(keep.map((k) => k.id));
    let X0 = w, Y0 = h, X1 = 0, Y1 = 0, n = 0;
    for (const k of keep) { X0 = Math.min(X0, k.box[0]); Y0 = Math.min(Y0, k.box[1]); X1 = Math.max(X1, k.box[2]); Y1 = Math.max(Y1, k.box[3]); n += k.n; }
    // 往外放一点，边上羽化（贴回去看不出接缝）
    const pad = opt.pad || 6;
    X0 = Math.max(0, X0 - pad * 2); Y0 = Math.max(0, Y0 - pad * 2); X1 = Math.min(w, X1 + pad * 2); Y1 = Math.min(h, Y1 + pad * 2);
    const mw = X1 - X0, mh = Y1 - Y0, mask = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (ids.has(lab[(y + Y0) * w + x + X0])) mask[y * mw + x] = 1;
    const out = feather(mask, mw, mh, pad);
    return { box: [X0, Y0, X1, Y1], n, total, mask: out, mw, mh };
  }
  // 先膨胀 r 再模糊 r：边缘软
  function feather(m, w, h, r) {
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r) && !v; yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) if (m[yy * w + xx]) { v = 1; break; }
      d[y * w + x] = v;
    }
    const blur = (s, horiz) => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = horiz ? x + k : x, yy = horiz ? y : y + k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; a += s[yy * w + xx]; n++; } o[y * w + x] = a / n; } return o; };
    return blur(blur(d, true), false);
  }
  // 脖子：从头顶往下，人的宽度先变宽（大头）再变窄（脖子）再变宽（肩膀）—— 最窄的那一行
  function neckOf(fg, w, h, box, hint) {
    const [x0, y0, x1, y1] = box, H = y1 - y0;
    const width = (y) => { let a = -1, b = -1; for (let x = x0; x < x1; x++) if (fg[y * w + x]) { if (a < 0) a = x; b = x; } return a < 0 ? [0, 0, 0] : [b - a + 1, a, b]; };
    let headY = y0, headW = 0;
    const lim0 = y0 + Math.round(H * 0.12), lim1 = y0 + Math.round(H * 0.55);
    for (let y = y0; y < lim1; y++) { const [wd] = width(y); if (wd > headW) { headW = wd; headY = y; } }
    let best = null;
    const from = Math.max(headY + 1, hint ? Math.round(hint) : lim0);
    for (let y = from; y < Math.min(y1, y0 + Math.round(H * 0.7)); y++) { const [wd, a, b] = width(y); if (wd > 0 && (!best || wd < best.w)) best = { y, w: wd, cx: (a + b) / 2 }; if (best && wd > best.w * 1.6 && y > best.y + 4) break; }
    if (!best || best.w > headW * 0.95) return { y: y0 + H * 0.36, cx: (x0 + x1) / 2, sure: false, headW };
    return { y: best.y, cx: best.cx, sure: true, headW };
  }

  // figure、layers：{ data, width, height }；返回动画数据（坐标都除以宽高，0～1）
  function analyze(figure, layers = {}) {
    const { width: w, height: h } = figure;
    const bg = bgOf(figure), fg = fgMask(figure, bg);
    const box = boxOf(fg, w, h);
    const warn = [];
    if (!box) return { ok: false, warn: ["整张图都是背景：换一张白底的全身形象"] };
    const bh = box[3] - box[1];
    const face = [box[0], box[1], box[2], box[1] + Math.round(bh * 0.6)];   // 大头：脸都在上面六成里
    const G = gray(figure), out = {};
    for (const k of KINDS) {
      const L = layers[k]; if (!L) continue;
      if (L.width !== w || L.height !== h) { warn.push(k + " 图层大小和原图不一样，没用上"); continue; }
      const sh = align(G, gray(L), w, h, box);
      const r = changed(figure.data, L.data, w, h, sh, face, { one: k !== "eyesClosed", all: box, near: [box[1] + bh * 0.12, box[1] + bh * 0.52] });
      if (!r) { warn.push((k === "eyesClosed" ? "闭眼" : "张嘴") + "的图和原图几乎一样：重新画一下这张图层"); continue; }
      const area = (box[2] - box[0]) * bh;
      if (r.n > area * 0.08 || r.total - r.n * 1.6 > area * 0.12) { warn.push((k === "eyesClosed" ? "闭眼" : "张嘴") + "的图改动太大（不只改了" + (k === "eyesClosed" ? "眼睛" : "嘴") + "）：重新画一下这张图层"); continue; }
      out[k] = { dx: sh[0], dy: sh[1], box: r.box, mw: r.mw, mh: r.mh, mask: r.mask };
    }
    const m = out.mouthOpen || out.mouthHalf, e = out.eyesClosed;
    const neck = neckOf(fg, w, h, box, m ? m.box[3] + 2 : null);
    if (!neck.sure) warn.push("没认准脖子在哪，头动的时候可能不自然");
    const faceX = m ? (m.box[0] + m.box[2]) / 2 : e ? (e.box[0] + e.box[2]) / 2 : neck.cx;
    return { ok: true, w, h, bg, box, neck: neck.y, pivot: [faceX, neck.y], headW: neck.headW, layers: out, warn };
  }
  // 存起来用：遮罩压成 0～255 的 base64
  function pack(rig) {
    if (!rig || !rig.ok) return rig;
    const L = {};
    for (const [k, v] of Object.entries(rig.layers)) {
      const b = new Uint8Array(v.mask.length); for (let i = 0; i < b.length; i++) b[i] = Math.round(clamp(v.mask[i], 0, 1) * 255);
      let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      L[k] = { dx: v.dx, dy: v.dy, box: v.box, mw: v.mw, mh: v.mh, mask: (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "latin1").toString("base64")) };
    }
    return { ...rig, layers: L, v: 1 };
  }
  function unpackMask(s, n) {
    const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("latin1");
    const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = bin.charCodeAt(i) / 255; return m;
  }

  // ---------- 动作：每一帧头转多少、身子歪多少（和 3D 公仔用同样的动作名）----------
  const MOODS = ["idle", "wave", "point", "gesture", "nod", "think"];
  function motion(opt = {}) {
    const side = opt.side === "left" ? 1 : -1;   // 形象在右下角时幻灯片在左边：往左侧身
    const st = { t: Math.random() * 10, mood: "idle", moodT: 0, talk: 0, talkS: 0, talkSlow: 0, w: { wave: 0, point: 0, gesture: 0, nod: 0, think: 0 }, blinkIn: 1.5 + Math.random() * 2, blink: 0, mouth: 0, hold: 0 };
    const lerp = (a, b, k) => a + (b - a) * k;
    return {
      st,
      mood(m, secs = 0) { st.mood = MOODS.includes(m) ? m : "idle"; st.moodT = secs; },
      talk(v) { st.talk = clamp(+v || 0, 0, 1); },
      step(dt) {
        st.t += dt; const t = st.t;
        if (st.moodT > 0) { st.moodT -= dt; if (st.moodT <= 0) st.mood = "idle"; }
        for (const k in st.w) st.w[k] = lerp(st.w[k], st.mood === k ? 1 : 0, 1 - Math.exp(-dt * 5));
        st.talkS = lerp(st.talkS, st.talk, 1 - Math.exp(-dt * 22));
        st.talkSlow = lerp(st.talkSlow, st.talk, 1 - Math.exp(-dt * 3));
        // 嘴：0 闭、1 张一点、2 张大；换了以后至少停两帧（不闪）
        const want = st.talkS < 0.13 ? 0 : st.talkS < 0.42 ? 1 : 2;
        if (st.hold > 0) st.hold -= dt; else if (want !== st.mouth) { st.mouth = want; st.hold = 0.07; }
        // 眨眼：隔 2～5 秒眨一下，偶尔连眨两下；想一想的时候不眨
        st.blinkIn -= dt;
        if (st.blink > 0) st.blink -= dt;
        else if (st.blinkIn <= 0 && st.w.think < 0.5) { st.blink = 0.12; st.blinkIn = Math.random() < 0.18 ? 0.28 : 2 + Math.random() * 3; }
        const W = st.w, D = Math.PI / 180, sp = st.talkSlow;
        let rot = (1.1 * Math.sin(t * 0.9) + 0.5 * Math.sin(t * 2.3 + 1)) * D;   // 头：慢慢地摆
        rot += (1.6 * sp + 0.8 * W.gesture) * Math.sin(t * 3.1) * D;           // 说话时摆得多一点
        rot += side * 3.5 * W.point * D + 7 * W.think * D;                      // 指幻灯片往那边转；想一想歪头
        let hx = 0, hy = -0.004 * st.talkS + 0.0025 * Math.sin(t * 1.7);        // 头：说到重音往上一点
        hy += 0.011 * W.nod * Math.max(0, Math.sin(t * Math.PI * 2 * 1.4));     // 点头
        hx += side * 0.006 * W.point;
        let lean = 0.35 * Math.sin(t * 0.5) * D + side * 2.6 * W.point * D + (1.2 * Math.sin(t * 1.3)) * W.gesture * D + 2.2 * Math.sin(t * Math.PI * 2 * 1.8) * W.wave * D - 1.5 * W.think * D;
        let hop = 0.012 * W.wave * Math.abs(Math.sin(t * Math.PI * 2 * 1.8)) + 0.004 * W.gesture * Math.max(0, Math.sin(t * 2.6));
        const breath = 0.006 * Math.sin(t * Math.PI * 2 * 0.25);
        return { rot, hx, hy, lean, hop, breath, mouth: st.mouth, blink: st.blink > 0 };
      },
    };
  }

  const core = { analyze, pack, unpackMask, bgOf, fgMask, alphaOf, align, changed, neckOf, motion, KINDS, MOODS };
  if (typeof window === "undefined") { if (typeof module !== "undefined") module.exports = core; return; }

  // ---------- 浏览器里：WebGL 画 ----------
  const VS = "attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
  const FS = `precision highp float;varying vec2 v;
uniform sampler2D tBase,tHalf,tOpen,tEyes;uniform vec2 uSize,uOut;uniform vec4 uFit;uniform vec3 uBg,uKey;
uniform float uRot,uLean,uBreath,uHop,uNeck,uBand,uMouth,uBlink,uTrans,uShadow;uniform vec2 uHead,uPivot,uFeet;
vec2 rot(vec2 q,float a){float c=cos(a),s=sin(a);return vec2(c*q.x-s*q.y,s*q.x+c*q.y);}
void main(){
  vec2 o=v*uOut; vec2 p=(o-uFit.xy)/uFit.z;            // 画面上的点 → 原图上的像素
  float sa=uShadow*exp(-pow((p.x-uFeet.x)/(uFit.w),2.)*1.0-pow((p.y-uFeet.y)/(uFit.w*0.16),2.));
  p.y+=uHop; p=uFeet+rot(p-uFeet,-uLean); p.y=uFeet.y+(p.y-uFeet.y)/(1.+uBreath);
  float hw=smoothstep(uNeck+uBand,uNeck-uBand,p.y);       // 1：头，0：身子，中间渐变
  p=uPivot+rot(p-uHead*hw-uPivot,-uRot*hw);
  vec2 t=p/uSize; vec4 c=vec4(0.);
  if(t.x>=0.&&t.y>=0.&&t.x<=1.&&t.y<=1.){
    c=texture2D(tBase,t);
    vec4 m=uMouth>1.5?texture2D(tOpen,t):uMouth>.5?texture2D(tHalf,t):vec4(0.);
    c.rgb=mix(c.rgb,m.rgb,m.a);
    if(uBlink>.5){vec4 e=texture2D(tEyes,t);c.rgb=mix(c.rgb,e.rgb,e.a);}
    if(c.a>0.&&c.a<.99)c.rgb=clamp((c.rgb-(1.-c.a)*uKey)/c.a,0.,1.);   // 去掉边上残留的白边
  }
  vec3 bgc=mix(uBg,uBg*.78,sa);
  float a=c.a;
  gl_FragColor=uTrans>.5?vec4(c.rgb,max(a,sa*.6)):vec4(mix(bgc,c.rgb,a),1.);
}`;

  function toData(img) {
    const c = document.createElement("canvas"); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
  }
  async function loadImg(src) {
    if (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement) return src;
    const url = src instanceof Uint8Array ? URL.createObjectURL(new Blob([src], { type: "image/png" })) : src;
    return await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("图片读不了")); i.src = url; });
  }
  // 在浏览器里分析（图片可以是 <img>、data: 地址或 png 字节）
  async function analyzeImages(figure, layers = {}) {
    const F = toData(await loadImg(figure)), L = {};
    for (const k of KINDS) if (layers[k]) L[k] = toData(await loadImg(layers[k]));
    return pack(analyze(F, L));
  }

  // 把图层做成「只有变了的那块不透明」的贴图（已经按对齐的平移挪好）
  function layerCanvas(F, L, info) {
    const w = F.width, h = F.height, c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"), out = g.createImageData(w, h);
    const m = unpackMask(info.mask, info.mw * info.mh), [x0, y0] = info.box;
    for (let y = 0; y < info.mh; y++) for (let x = 0; x < info.mw; x++) {
      const X = x + x0, Y = y + y0, xs = X + info.dx, ys = Y + info.dy; if (xs < 0 || ys < 0 || xs >= w || ys >= h) continue;
      const i = (Y * w + X) * 4, j = (ys * w + xs) * 4;
      out.data[i] = L.data[j]; out.data[i + 1] = L.data[j + 1]; out.data[i + 2] = L.data[j + 2]; out.data[i + 3] = Math.round(m[y * info.mw + x] * 255);
    }
    g.putImageData(out, 0, 0); return c;
  }

  // 舞台：opt = { width, height, bg（0xRRGGBB）, transparent, manual（不自己转圈，导出视频时一帧帧画）, side }
  async function create(host, src, opt = {}) {
    const rig = src.rig && src.rig.ok ? src.rig : await analyzeImages(src.figure, src.layers || {});
    if (!rig || !rig.ok) throw new Error((rig && rig.warn && rig.warn[0]) || "这张形象认不出来");
    const fImg = await loadImg(src.figure), F = toData(fImg);
    const fg = fgMask(F, rig.bg), al = alphaOf(F, fg, rig.bg);
    const base = document.createElement("canvas"); base.width = F.width; base.height = F.height;
    const bd = new ImageData(new Uint8ClampedArray(F.data), F.width, F.height); for (let p = 0; p < al.length; p++) bd.data[p * 4 + 3] = al[p];
    base.getContext("2d").putImageData(bd, 0, 0);
    const lay = {};
    for (const k of KINDS) if (rig.layers[k] && src.layers && src.layers[k]) lay[k] = layerCanvas(F, toData(await loadImg(src.layers[k])), rig.layers[k]);
    const W = opt.width || 360, H = opt.height || 640;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; cv.style.width = "100%"; cv.style.height = "100%";
    const gl = cv.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: !!opt.manual, alpha: !!opt.transparent, antialias: false });
    if (!gl) throw new Error("这台电脑画不了动画（显卡驱动太旧？）");
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const empty = document.createElement("canvas"); empty.width = empty.height = 1;
    const texs = [base, lay.mouthHalf || empty, lay.mouthOpen || lay.mouthHalf || empty, lay.eyesClosed || empty].map((c, i) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    });
    const U = (n) => gl.getUniformLocation(pr, n);
    ["tBase", "tHalf", "tOpen", "tEyes"].forEach((n, i) => gl.uniform1i(U(n), i));
    // 摆位置：头顶到脚占画面高度的 90%，左右居中，脚在下面留一点地方给影子
    const [bx0, by0, bx1, by1] = rig.box, fh = by1 - by0, sc = (H * 0.9) / fh;
    const ox = W / 2 - ((bx0 + bx1) / 2) * sc, oy = H * 0.955 - by1 * sc;
    gl.uniform2f(U("uSize"), F.width, F.height); gl.uniform2f(U("uOut"), W, H);
    gl.uniform4f(U("uFit"), ox, oy, sc, (bx1 - bx0) * 0.3);
    gl.uniform3f(U("uKey"), rig.bg[0] / 255, rig.bg[1] / 255, rig.bg[2] / 255);
    gl.uniform2f(U("uPivot"), rig.pivot[0], rig.pivot[1]); gl.uniform2f(U("uFeet"), (bx0 + bx1) / 2, by1);
    gl.uniform1f(U("uNeck"), rig.neck); gl.uniform1f(U("uBand"), Math.max(6, fh * 0.035));
    gl.uniform1f(U("uTrans"), opt.transparent ? 1 : 0); gl.uniform1f(U("uShadow"), 0.35);
    const setBg = (n) => gl.uniform3f(U("uBg"), ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    setBg(opt.bg != null ? opt.bg : 0xffffff);
    gl.viewport(0, 0, W, H);
    const mo = motion({ side: opt.side });
    const draw = (dt) => {
      const m = mo.step(dt);
      gl.uniform1f(U("uRot"), m.rot); gl.uniform1f(U("uLean"), m.lean); gl.uniform1f(U("uBreath"), m.breath); gl.uniform1f(U("uHop"), m.hop * fh);
      gl.uniform2f(U("uHead"), m.hx * fh, m.hy * fh); gl.uniform1f(U("uMouth"), lay.mouthHalf || lay.mouthOpen ? m.mouth : 0); gl.uniform1f(U("uBlink"), lay.eyesClosed && m.blink ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return cv;
    };
    host.appendChild(cv);
    let raf = 0, last = performance.now();
    if (!opt.manual) { const loop = (now) => { draw(Math.min(0.05, (now - last) / 1000)); last = now; raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
    return {
      canvas: cv, rig,
      talk: (v) => mo.talk(v), mood: (m, s) => mo.mood(m, s), setBg,
      frame(dt, level, mood) { if (mood !== undefined && mood !== mo.st.mood) mo.mood(mood); mo.talk(level || 0); return draw(dt); },
      dispose() { cancelAnimationFrame(raf); texs.forEach((t) => gl.deleteTexture(t)); gl.deleteProgram(pr); gl.deleteBuffer(buf); const ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); cv.remove(); },
    };
  }
  root.LaoPuppet = { ...core, analyzeImages, create };
})(typeof window !== "undefined" ? window : globalThis);
