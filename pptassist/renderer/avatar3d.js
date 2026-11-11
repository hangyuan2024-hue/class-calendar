// 捞捞 · 老师的分身（three.js）：默认是公仔风（faceStyle "doll"，2026.11）——大头手办：一缕缕有厚度的黑发、高马尾，瓷白的脸上画着粗眉毛、眯眯笑眼、腮红和小嘴，
//   格子高领毛衣、紫裤子、棕短靴、肉乎乎的小手，像拍手办一样打光（环境柔光 + 软阴影）；spec.rig 打开会露出机器人骨架（红关节球、绿线路、银脊椎和骨头手）。
//   另外还有机器人屏幕脸（screen）和几种照片脸。默认不要光环、扫描线（spec.stage 打开才有）
//   形象只是一份数据（发型、刘海、眼镜、皮肤 / 头发 / 衣服颜色……），洗一遍再用，不带代码。
//   LaoAvatar.create(容器, 形象, 选项) → 带渲染循环的小舞台：talk(音量) 说话、mood("wave"/"point"/"gesture"/"nod"/"think"/"idle") 做动作；
//   LaoAvatar.build(形象) → 只要模型（一个 THREE.Group + update(dt)），放进别的场景里用（捞捞编程的 3D 舞台）。
//   导出视频时用 api.frameAt(秒, 音量)：不走计时器，一帧一帧地画，画面和声音严丝合缝。
"use strict";
(function (root) {
  const STYLES = ["none", "short", "bob", "long", "flare", "ponytail", "bun", "curly"];   // none = 不要头发（屏幕脸的机器人头）
  const hexOf = (s, d) => (typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s) ? parseInt(s.slice(1), 16) : Number.isInteger(s) && s >= 0 && s <= 0xffffff ? s : d);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  // 照片脸的版式：脸的贴图是 1024×1024，左眼、右眼、嘴巴中间放在固定的位置（标五官时就是把照片对到这三个点上）
  //   W、H、Y：贴图对应头上多宽、多高、中心多高（头的局部坐标）——五官和头的比例接近真人，脸占满头的正面
  //   LIT、GLOW：照片脸（和头、脖子、手的皮肤）受灯光照的多少、自己发光的多少——两边一样，接缝才看不出来
  const FACE = { size: 1024, eyeL: [0.334, 0.418], eyeR: [0.666, 0.418], mouth: [0.5, 0.732], W: 0.125, H: 0.158, Y: 0.124, LIT: 0.62, GLOW: 0.4 };
  FACE.EX = (FACE.eyeR[0] - 0.5) * 2 * FACE.W; FACE.EY = FACE.Y + (0.5 - FACE.eyeL[1]) * 2 * FACE.H;   // 头上眼睛的位置（眼镜对着它戴）
  // 脸的着色：嘴（往下拉开，里面是深色和一排牙）、眨眼（上眼皮盖下来）、脸的轮廓（椭圆外面渐渐透明）
  const FACE_GLSL = `
#ifdef USE_MAP
  #define FACE_LIT ${FACE.LIT.toFixed(3)}
  #define FACE_GLOW ${FACE.GLOW.toFixed(3)}
  vec2 fuv = vUv;
  vec2 eL = vec2(${FACE.eyeL[0]}, ${FACE.eyeL[1]}), eR = vec2(${FACE.eyeR[0]}, ${FACE.eyeR[1]}), mC = vec2(${FACE.mouth[0]}, ${FACE.mouth[1]});
  float eW = 0.085, mW = 0.115;
  vec2 m = fuv - mC;
  float ry = mW * 0.7;
  float inX = 1.0 - smoothstep(0.55, 1.0, abs(m.x) / mW);
  float open = uTalk * ry * 0.6 * inX;
  vec4 fc = vec4(1.0);
  if (m.y > 0.0 && m.y < open && abs(m.x) < mW) fc = mix(vec4(0.32, 0.07, 0.09, 1.0), vec4(0.93, 0.92, 0.9, 1.0), step(m.y, open * 0.28) * step(0.35, inX));
  else if (m.y >= open && m.y < 2.2 * ry && abs(m.x) < mW * 1.15) { float k = clamp(1.0 - (m.y - open) / (2.2 * ry - open), 0.0, 1.0); fc = texture2D(map, vec2(fuv.x, fuv.y - open * k)); }
  else fc = texture2D(map, fuv);
  for (int i = 0; i < 2; i++) {
    vec2 e = i == 0 ? eL : eR;
    vec2 d = (fuv - e) / vec2(eW * 0.62, eW * 0.42);
    float top = e.y - eW * 0.42;
    if (dot(d, d) < 1.0 && fuv.y - top < uBlink * eW * 0.84) fc = texture2D(map, vec2(fuv.x, top - eW * 0.12));
  }
  vec2 q = (fuv - vec2(0.5, 0.55)) / vec2(0.37, 0.4);
  float fmask = (1.0 - smoothstep(0.7, 1.0, length(q))) * (1.0 - smoothstep(0.86, 0.93, fuv.y)) * step(0.0, fuv.x);
  // 赛博：脸是一块仿生面板——边上一道清楚的接缝（凹槽），下半圈从缝里透出一点光；虹膜一圈细光环
  float plate = 0.0, groove = 0.0, gGlow = 0.0, iris = 0.0;
  if (uCyber > 0.5) {
    float pq = length(q);
    plate = (1.0 - smoothstep(0.945, 0.958, pq)) * (1.0 - smoothstep(0.9, 0.95, fuv.y)) * step(0.0, fuv.x);
    // 压出来的面板边：缝外侧一道暗，缝里侧上半圈一道亮（像真的有厚度）
    float gin = 1.0 - smoothstep(0.9, 0.95, fuv.y);
    groove = smoothstep(0.012, 0.0, pq - 0.946) * smoothstep(0.0, 0.004, pq - 0.946 + 0.004) * gin * step(0.0, fuv.x);
    float bevel = smoothstep(0.02, 0.0, 0.946 - pq) * step(pq, 0.946) * (1.0 - smoothstep(0.35, 0.6, fuv.y)) * gin;
    fc.rgb *= 1.0 + 0.18 * bevel;
    gGlow = smoothstep(0.03, 0.0, abs(pq - 0.952)) * smoothstep(0.5, 0.68, fuv.y) * (1.0 - smoothstep(0.88, 0.94, fuv.y));
    fmask = plate;
    float fl = dot(fc.rgb, vec3(0.299, 0.587, 0.114));
    for (int i = 0; i < 2; i++) { vec2 e = i == 0 ? eL : eR; iris += smoothstep(0.0032, 0.0, abs(length(fuv - e) - 0.021)) * (1.0 - smoothstep(0.3, 0.5, fl)); }
    iris *= 1.0 - smoothstep(0.15, 0.4, uBlink);
    fc.rgb *= 1.0 - 0.45 * groove;
  }
  // 脸的边上（太阳穴、下颌两侧）几段发光的短线，像电路；太阳穴各一个小光点
  float qd = length(q);
  float ang = atan(q.y, q.x);
  float ring = smoothstep(0.022, 0.0, abs(qd - 1.07)) * smoothstep(0.55, 0.8, abs(q.x)) * (1.0 - smoothstep(0.8, 0.92, fuv.y)) * 0.55;
  float node = smoothstep(0.035, 0.0, length(q - vec2(1.04, -0.32))) + smoothstep(0.035, 0.0, length(q - vec2(-1.04, -0.32)));
  float fline = clamp(ring * (1.0 - uCyber) + node, 0.0, 1.0) * step(0.0, fuv.x) * uTech;
  float scan = smoothstep(0.01, 0.0, abs(fuv.y - (fract(uTime * 0.09) * 4.0 - 0.6))) * fmask * uTech * 0.6;   // 隔十来秒才扫过一次
  // 眼神光：瞳孔右上方一个小亮点（和主灯同一边），眼睛立刻有神；眨眼时藏起来
  float cat = 0.0;
  for (int i = 0; i < 2; i++) { vec2 e = i == 0 ? eL : eR; cat += smoothstep(0.0072, 0.0035, length(fuv - e - vec2(0.0105, -0.0115))); }
  cat *= 1.0 - smoothstep(0.15, 0.4, uBlink);
  diffuseColor *= vec4(fc.rgb * FACE_LIT, max(fmask, fline));
#endif
`;
  // 脸像一块屏幕：一部分自己发光，照片的颜色不被灯光冲淡
  const FACE_EMISSIVE = `
#ifdef USE_MAP
  float rimF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.5);
  totalEmissiveRadiance = fc.rgb * ${FACE.GLOW.toFixed(3)} * (1.0 - fline) + uAccent * (fline * 1.2 + rimF * 0.25 * fmask * uTech + scan * 0.15 + (gGlow * 0.5 + iris * 0.6) * uTech) + vec3(cat * 0.75);
#endif
`;
  // ---------- 屏幕脸：老师的五官变成机器人屏幕上的发光线条 ----------
  //   照片不直接贴上去：先从照片里量出眉毛的形状和粗细、眼睛的长短和眼皮的弧度、嘴的宽度和嘴角的弯法、鼻子多宽（face.js 的 analyze），
  //   存成一小份线条数据 faceLines（都是 0–1 的坐标，版式和 FACE 一样），这里在一块深色玻璃屏幕上画出来，每一帧都能眨眼、说话、看方向。
  //   形状：brows [左, 右] 各 7 个点 + browT 粗细；eyes [左, 右] 各 { up 7 点, lo 7 点, iris [u, v, r] }；mouth { line 9 点, h 唇厚, open 笑时露齿的高度 }；nose [u, v, 宽]
  const N7 = 7, N9 = 9;
  // 屏幕（面罩）的位置见下面的 VISOR   // 屏幕（椭圆）在脸版式里的位置
  function defaultLines() {
    const [lu, ev] = FACE.eyeL, [ru] = FACE.eyeR, [mu, mv] = FACE.mouth;
    const arc = (cu, cv, w, h, n) => Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return [cu - w / 2 + w * k, cv - h * Math.sin(Math.PI * k)]; });
    const eye = (cu) => ({ up: arc(cu, ev + 0.006, 0.17, 0.045, N7), lo: arc(cu, ev + 0.006, 0.17, -0.025, N7), iris: [cu, ev, 0.026] });
    return {
      brows: [arc(lu - 0.01, ev - 0.08, 0.2, 0.025, N7), arc(ru + 0.01, ev - 0.08, 0.2, 0.025, N7)], browT: [0.02, 0.02],
      eyes: [eye(lu), eye(ru)],
      mouth: { line: arc(mu, mv, 0.28, -0.012, N9), h: 0.05, open: 0 },
      nose: [0.5, ev + (mv - ev) * 0.62, 0.09],
    };
  }
  // 线条数据洗一遍：只要数字、都在 0–1 里、点数对得上；不对就当没有（用默认的五官）
  function cleanLines(f) {
    if (!f || typeof f !== "object") return undefined;
    const num = (x, a = 0, b = 1) => (typeof x === "number" && isFinite(x) ? Math.round(clamp(x, a, b) * 1000) / 1000 : null);
    const pts = (a, n) => (Array.isArray(a) && a.length === n && a.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) !== null && num(p[1]) !== null) ? a.map((p) => [num(p[0]), num(p[1])]) : null);
    try {
      const brows = Array.isArray(f.brows) && f.brows.length === 2 ? f.brows.map((b) => pts(b, N7)) : null;
      const eyes = Array.isArray(f.eyes) && f.eyes.length === 2 ? f.eyes.map((e) => e && { up: pts(e.up, N7), lo: pts(e.lo, N7), iris: Array.isArray(e.iris) && e.iris.length === 3 ? e.iris.map((x, i) => num(x, 0, i === 2 ? 0.08 : 1)) : null }) : null;
      const m = f.mouth || {}, mouth = { line: pts(m.line, N9), h: num(m.h, 0.01, 0.12), open: num(m.open, 0, 0.08) };
      const browT = Array.isArray(f.browT) && f.browT.length === 2 ? f.browT.map((x) => num(x, 0.006, 0.05)) : null;
      const nose = Array.isArray(f.nose) && f.nose.length === 3 ? f.nose.map((x, i) => num(x, 0, i === 2 ? 0.25 : 1)) : null;
      if (!brows || brows.some((b) => !b) || !eyes || eyes.some((e) => !e || !e.up || !e.lo || !e.iris || e.iris.includes(null)) || !mouth.line || mouth.h === null || mouth.open === null || !browT || browT.includes(null) || !nose || nose.includes(null)) return undefined;
      return { brows, browT, eyes, mouth, nose };
    } catch { return undefined; }
  }
  const hexCss = (n) => "#" + n.toString(16).padStart(2, "0").padStart(6, "0");
  const rgba = (n, a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  const mixHex = (a, b, k) => { const c = (x, sh) => Math.round(((x >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k); return (c(a, 16) << 16) | (c(a, 8) << 8) | c(a, 0); };
  // ---------- 屏幕脸（2026.11 课堂版）----------
  //   头正面是一块圆角方形的黑色玻璃面罩，上面只有发光的大眼睛、眉毛和嘴（像 EVE、Vector 这类受欢迎的机器人）：
  //   不画眼皮、鼻子、嘴唇这些真人线条（那样既不像人也不像机器人，看着别扭）。
  //   老师本人的特点从照片量出来的 faceLines 里取：两眼的距离、眼睛圆还是细长、眼角往上还是往下、眉毛的粗细和走向、嘴多宽、笑的弧度、戴不戴眼镜。
  const VISOR = { cx: 0.5, cy: 0.47, rx: 0.35, ry: 0.255, n: 3.4 };   // 面罩（超椭圆）在脸版式里的位置
  const SCREEN = VISOR;
  const looks = new WeakMap();
  // 把量出来的线条变成几个「风格参数」（同一份 faceLines 只算一次）
  function faceLook(L) {
    let f = looks.get(L); if (f) return f;
    const [eL, eR] = L.eyes;
    const sep = clamp((eR.iris[0] - eL.iris[0]) / 2, 0.12, 0.155);
    const openOf = (e) => { let h = 0; for (let i = 1; i < N7 - 1; i++) h = Math.max(h, e.lo[i][1] - e.up[i][1]); const w = e.up[N7 - 1][0] - e.up[0][0]; return w > 0.02 ? h / w : 0.4; };
    const op = clamp((openOf(eL) + openOf(eR)) / 2, 0.15, 0.65);
    // 眼角：外眼角比内眼角高 → 正数（左眼的外眼角是第一个点，右眼是最后一个点）
    const tiltOf = (e, outerFirst) => { const a = e.up[0], b = e.up[N7 - 1], o = outerFirst ? a : b, i = outerFirst ? b : a; return (i[1] - o[1]) / Math.max(0.05, Math.abs(b[0] - a[0])); };
    const tilt = clamp((tiltOf(eL, true) + tiltOf(eR, false)) / 2, -0.3, 0.3);
    const browOf = (b, e, outerFirst, t) => {
      const o = outerFirst ? b[0] : b[N7 - 1], i = outerFirst ? b[N7 - 1] : b[0], m = b[3];
      return { slope: clamp((i[1] - o[1]) / Math.max(0.05, Math.abs(i[0] - o[0])), -0.45, 0.45), arch: clamp((o[1] + i[1]) / 2 - m[1], -0.005, 0.03), gap: clamp(e.iris[1] - (o[1] + i[1] + m[1]) / 3, 0.04, 0.14), t };
    };
    const brows = [browOf(L.brows[0], eL, true, L.browT[0]), browOf(L.brows[1], eR, false, L.browT[1])];
    const ml = L.mouth.line, mw0 = ml[N9 - 1][0] - ml[0][0], smile = clamp(((ml[0][1] + ml[N9 - 1][1]) / 2 - ml[4][1]) * -1 / Math.max(0.05, mw0), -0.05, 0.25);
    const ew = 0.094, eh = ew * clamp(1.0 + (op - 0.4) * 1.5, 0.72, 1.25);
    f = { sep, ew, eh, tilt, brows, mw: clamp(mw0 * 0.5, 0.1, 0.15), smile, open: L.mouth.open };
    looks.set(L, f); return f;
  }
  // 在 2D 画布上画屏幕脸。st：{ talk 0–1, blink 0–1（1 = 闭眼）, look [-1..1, -1..1], happy 0–1, think 0–1, t 秒 }
  function drawScreen(ctx, S, P, st = {}) {
    const L = P.faceLines || defaultLines(), F = faceLook(L);
    const acc = P.accent, talk = clamp(st.talk || 0, 0, 1), blink = clamp(st.blink || 0, 0, 1), happy = clamp(st.happy || 0, 0, 1), think = clamp(st.think || 0, 0, 1);
    const look = st.look || [0, 0], t = st.t || 0;
    const X = (u) => u * S, Y = (v) => v * S, lw = (k) => Math.max(1, k * S);
    const V = VISOR;
    const sq = (c, cx, cy, rx, ry, n) => { c.beginPath(); for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2, co = Math.cos(a), si = Math.sin(a); const x = cx + rx * Math.sign(co) * Math.pow(Math.abs(co), 2 / n), y = cy + ry * Math.sign(si) * Math.pow(Math.abs(si), 2 / n); if (i) c.lineTo(X(x), Y(y)); else c.moveTo(X(x), Y(y)); } c.closePath(); };
    const rr = (c, cx, cy, w, h, r) => { const x0 = X(cx - w / 2), y0 = Y(cy - h / 2), W = X(w), H = Y(h), R = Math.min(X(r), W / 2, H / 2); c.beginPath(); c.moveTo(x0 + R, y0); c.arcTo(x0 + W, y0, x0 + W, y0 + H, R); c.arcTo(x0 + W, y0 + H, x0, y0 + H, R); c.arcTo(x0, y0 + H, x0, y0, R); c.arcTo(x0, y0, x0 + W, y0, R); c.closePath(); };
    ctx.save(); ctx.clearRect(0, 0, S, S);
    // 1) 面罩：深色玻璃（中间稍亮），往里收的一圈暗边
    sq(ctx, V.cx, V.cy, V.rx, V.ry, V.n);
    const bg = ctx.createRadialGradient(X(V.cx), Y(V.cy - 0.04), S * 0.03, X(V.cx), Y(V.cy), S * 0.42);
    bg.addColorStop(0, "#18233d"); bg.addColorStop(0.6, "#0d1427"); bg.addColorStop(1, "#060a16");
    ctx.fillStyle = bg; ctx.fill();
    ctx.save(); sq(ctx, V.cx, V.cy, V.rx, V.ry, V.n); ctx.clip();
    // 屏幕被五官照亮的一点点底光
    const pool = ctx.createRadialGradient(X(0.5), Y(V.cy - 0.02), 0, X(0.5), Y(V.cy - 0.02), S * 0.3);
    pool.addColorStop(0, rgba(acc, 0.1)); pool.addColorStop(1, rgba(acc, 0)); ctx.fillStyle = pool; ctx.fillRect(0, 0, S, S);
    // 2) 五官先画在一张透明的图层上，再整张加柔光贴回来——光晕均匀，笑眼的「挖空」也不会挖到玻璃
    let lay = drawScreen._lay; if (!lay || lay.width !== S) { lay = drawScreen._lay = (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(S, S) : Object.assign(document.createElement("canvas"), { width: S, height: S })); }
    const g = lay.getContext("2d"); g.clearRect(0, 0, S, S); g.lineCap = "round"; g.lineJoin = "round";
    const light = mixHex(acc, 0xffffff, 0.55), lx = look[0] * 0.026, ly = look[1] * 0.016;
    const ev = 0.43 + ly, open = 1 - blink * 0.93;
    // 眉毛
    const bLift = 0.012 * happy + 0.006 * talk * (0.5 + 0.5 * Math.sin(t * 6.5));
    [-1, 1].forEach((sd, k) => {
      const B = F.brows[k], cx = 0.5 + sd * F.sep + lx * 0.6, len = 0.1;
      const lift = bLift + (sd > 0 ? think * 0.022 : -think * 0.004);
      const by = ev - F.eh / 2 - 0.035 - clamp(B.gap - 0.085, -0.02, 0.03) * 0.5 - lift;
      const dy = clamp(B.slope, -0.45, 0.45) * len * 0.45;   // 外眉梢比眉头高多少
      const ox = cx + sd * len / 2, ix = cx - sd * len / 2;
      g.strokeStyle = rgba(light, 0.92); g.lineWidth = lw(clamp(B.t * 1.1, 0.015, 0.026));
      g.beginPath(); g.moveTo(X(ix), Y(by + dy / 2)); g.quadraticCurveTo(X(cx), Y(by - B.arch * 1.4 - 0.008), X(ox), Y(by - dy / 2)); g.stroke();
    });
    // 眼睛：饱满的圆角形，上亮下深；眨眼压扁成一条；开心时下边挖成弯弯的笑眼；两点眼神光
    [-1, 1].forEach((sd) => {
      const cx = 0.5 + sd * F.sep + lx, w = F.ew * (1 + 0.04 * happy), h = Math.max(0.014, F.eh * open * (1 - 0.12 * think));
      g.save(); g.translate(X(cx), Y(ev)); g.rotate(-sd * F.tilt * 0.6); g.translate(-X(cx), -Y(ev));
      rr(g, cx, ev, w, h, Math.min(w, h) * 0.46);
      const eg = g.createLinearGradient(0, Y(ev - h / 2), 0, Y(ev + h / 2)); eg.addColorStop(0, hexCss(mixHex(acc, 0xffffff, 0.45))); eg.addColorStop(0.6, hexCss(mixHex(acc, 0xffffff, 0.1))); eg.addColorStop(1, hexCss(mixHex(acc, 0x0b1430, 0.15)));
      g.fillStyle = eg; g.fill();
      if (happy > 0.02 && blink < 0.6) {   // 笑眼：从下面挖掉一块
        g.globalCompositeOperation = "destination-out";
        g.beginPath(); g.ellipse(X(cx), Y(ev + h * (1.55 - 0.95 * happy)), X(w * 0.78), Y(h * 0.82), 0, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = "source-over";
      }
      if (blink < 0.5 && happy < 0.55) {
        g.fillStyle = "rgba(255,255,255,0.95)";
        rr(g, cx - w * 0.17 + lx * 0.3, ev - h * 0.2, w * 0.3, Math.min(h * 0.24, w * 0.24), w * 0.1); g.fill();
        g.beginPath(); g.arc(X(cx + w * 0.16 + lx * 0.3), Y(ev + h * 0.12), X(w * 0.06), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    });
    // 嘴：平时一道微笑；说话时张开成圆圆的「D」形，里面深色、底下一点舌头的光；想事情时变成歪到一边的小短线
    {
      const mx = 0.5 + lx * 0.5 + think * 0.025, my = 0.64 + ly * 0.5, mw = F.mw * (1 - 0.45 * think) * (1 + 0.08 * happy);
      const curve = (0.022 + F.smile * 0.07) * (1 - think) + 0.012 * happy;
      const opn = clamp(talk * 0.075 + happy * 0.016 + F.open * 0.3, 0, 0.085);
      if (opn < 0.007) {
        g.strokeStyle = hexCss(light); g.lineWidth = lw(0.017);
        g.beginPath(); g.moveTo(X(mx - mw / 2), Y(my - curve * 0.35 + think * 0.008)); g.quadraticCurveTo(X(mx), Y(my + curve), X(mx + mw / 2), Y(my - curve * 0.35 - think * 0.008)); g.stroke();
      } else {
        const top = (c) => { c.moveTo(X(mx - mw / 2), Y(my - curve * 0.35)); c.quadraticCurveTo(X(mx), Y(my + curve * 0.45), X(mx + mw / 2), Y(my - curve * 0.35)); };
        const bot = (c, k) => c.quadraticCurveTo(X(mx), Y(my + curve * 0.45 + opn * 2 * k + curve * 0.5), X(mx - mw / 2), Y(my - curve * 0.35));
        g.beginPath(); top(g); bot(g, 1); g.closePath();
        g.fillStyle = hexCss(light); g.fill();
        g.save(); g.beginPath(); top(g); bot(g, 1); g.closePath(); g.clip();
        g.lineWidth = lw(0.03); g.strokeStyle = "rgba(0,0,0,0)";
        g.beginPath(); g.moveTo(X(mx - mw / 2 + 0.012), Y(my - curve * 0.35 + 0.01)); g.quadraticCurveTo(X(mx), Y(my + curve * 0.45 + 0.008), X(mx + mw / 2 - 0.012), Y(my - curve * 0.35 + 0.01)); g.quadraticCurveTo(X(mx), Y(my + curve * 0.95 + opn * 2 - 0.012), X(mx - mw / 2 + 0.012), Y(my - curve * 0.35 + 0.01)); g.closePath();
        g.fillStyle = "#0a1022"; g.fill();
        g.fillStyle = rgba(mixHex(acc, 0xff8fb1, 0.55), 0.85); g.beginPath(); g.ellipse(X(mx), Y(my + curve * 0.95 + opn * 1.8), X(mw * 0.26), Y(Math.max(0.006, opn * 0.45)), 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    // 眼镜：一副发光的细框
    if (P.glasses) {
      g.strokeStyle = "rgba(255,255,255,0.78)"; g.lineWidth = lw(0.0065);
      const gw = F.ew * 1.62, gh = F.eh * 1.32 + 0.012;
      for (const sd of [-1, 1]) { rr(g, 0.5 + sd * F.sep, 0.435, gw, gh, gh * 0.38); g.stroke(); }
      g.beginPath(); g.moveTo(X(0.5 - F.sep + gw / 2), Y(0.43)); g.quadraticCurveTo(X(0.5), Y(0.415), X(0.5 + F.sep - gw / 2), Y(0.43)); g.stroke();
    }
    // 腮红：开心、说话时眼睛下面一点淡淡的暖光
    if (P.blush && happy > 0.05) {
      const a = 0.45 * happy;
      for (const sd of [-1, 1]) { const x = X(0.5 + sd * (F.sep + 0.03)), y = Y(ev + F.eh * 0.62 + 0.03), rg = ctx.createRadialGradient(x, y, 0, x, y, S * 0.055); rg.addColorStop(0, `rgba(255,110,150,${a})`); rg.addColorStop(1, "rgba(255,110,150,0)"); ctx.fillStyle = rg; ctx.fillRect(x - S * 0.06, y - S * 0.06, S * 0.12, S * 0.12); }
    }
    // 贴回面罩：先带柔光（发光的感觉），再贴一次让边清楚
    ctx.shadowColor = rgba(acc, 0.75); ctx.shadowBlur = S * 0.03; ctx.drawImage(lay, 0, 0);
    ctx.shadowBlur = S * 0.012; ctx.drawImage(lay, 0, 0); ctx.shadowBlur = 0;
    // 3) 玻璃的反光：顶上一大片柔光、左上一道细高光
    const gl = ctx.createLinearGradient(0, Y(V.cy - V.ry), 0, Y(V.cy - V.ry * 0.15));
    gl.addColorStop(0, "rgba(255,255,255,0.16)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(X(V.cx), Y(V.cy - V.ry * 0.95), X(V.rx * 0.92), Y(V.ry * 0.62), 0, 0, Math.PI * 2); ctx.fill();
    if (P.stage) {   // 舞台效果：很淡的扫描线
      ctx.globalAlpha = 0.05; ctx.fillStyle = hexCss(acc);
      for (let y = 0; y < S; y += Math.max(2, Math.round(S / 170))) ctx.fillRect(0, y, S, Math.max(1, S / 1024));
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // 4) 面罩的边：外面一圈细暗线，里面上亮下暗的斜边（像嵌进头壳里）
    sq(ctx, V.cx, V.cy, V.rx, V.ry, V.n); ctx.strokeStyle = "rgba(20,26,40,0.85)"; ctx.lineWidth = lw(0.008); ctx.stroke();
    const bev = ctx.createLinearGradient(0, Y(V.cy - V.ry), 0, Y(V.cy + V.ry));
    bev.addColorStop(0, "rgba(255,255,255,0.35)"); bev.addColorStop(0.5, "rgba(255,255,255,0.06)"); bev.addColorStop(1, "rgba(0,0,0,0.25)");
    sq(ctx, V.cx, V.cy, V.rx - 0.006, V.ry - 0.006, V.n); ctx.strokeStyle = bev; ctx.lineWidth = lw(0.006); ctx.stroke();
    ctx.restore();
  }

  const MOODS = ["wave", "point", "gesture", "nod", "think"];   // 能选的动作（idle 是站着）

  // ---------- 形象数据 ----------
  function sanitize(s) {
    s = s && typeof s === "object" ? s : {};
    const p = s.person && typeof s.person === "object" ? s.person : s;   // 皮肤文件里在 person 下；单独的形象文件直接平铺
    const str = (x, n) => String(x == null ? "" : x).replace(/[<>]/g, "").slice(0, n);
    return {
      name: str(p.name != null ? p.name : s.name, 24),
      skin: hexOf(p.skin, 0xf0bf9c), hair: hexOf(p.hair, 0x2a1b14),
      hairStyle: STYLES.includes(p.hairStyle) ? p.hairStyle : "bob",
      bangs: ["side", "none", "middle"].includes(p.bangs) ? p.bangs : "full", eyeStyle: p.eyeStyle === "smile" ? "smile" : "open",
      glasses: !!p.glasses, glassesColor: hexOf(p.glassesColor, 0x3b3b46),
      eye: hexOf(p.eye, 0x2b1d18), blush: p.blush !== false, earrings: !!p.earrings,
      top: hexOf(p.top, 0xf3f5fb), collar: hexOf(p.collar, null),
      bottom: p.bottom === "skirt" ? "skirt" : "pants", pants: hexOf(p.pants, 0x3b4a6b), shoes: hexOf(p.shoes, 0x2f3650),
      accent: hexOf(p.accent, 0x22d3ee), antenna: !!p.antenna, earpods: p.earpods !== false, photoFace: p.photoFace !== false, tech: p.tech !== false, faceStyle: ["doll", "ai3d", "screen", "cyber", "photo", "soft", "cartoon"].includes(p.faceStyle) ? p.faceStyle : "doll", rig: p.rig === true, grid: p.grid !== false, body: p.body === "tall" ? "tall" : "chibi", faceLines: cleanLines(p.faceLines), faceShape: ["round", "oval", "long", "square"].includes(p.faceShape) ? p.faceShape : "round", part: p.part === "right" ? "right" : "left", shell: hexOf(p.shell, 0xeef1f6), stage: !!p.stage,
    };
  }

  // ---------- 模型：真人比例的机器人分身（屏幕脸 / 照片脸；公仔风在上面的 buildDoll）----------
  //   身材和真人一样（大约 6.5 个头高），身子、胳膊、腿是光滑的流线型外壳，关节是看得见的金属球（机器人本来就这样）；
  //   老师的发型、发色、衣服颜色照搬，脸是一块光滑的面板：发光的眼睛、一排会跟着声音跳的发光「嘴」。
  //   骨架：脚底 y=0 → 胯（hips）→ 腰（spine）→ 胸 → 脖子 → 头；肩 → 肘 → 腕 → 手指；胯 → 膝 → 踝。
  const G = {};   // 共用的形状（第一次用时再造）
  function geos(T) {
    if (G.ball) return G;
    Object.assign(G, {
      ball: new T.SphereGeometry(1, 40, 28),
      cap: (r, l) => new T.CapsuleGeometry(r, l, 8, 16),
      torus: (r, t, arc = Math.PI * 2) => new T.TorusGeometry(r, t, 10, 48, arc),
      cyl: (rt, rb, h, seg = 28) => new T.CylinderGeometry(rt, rb, h, seg),
      shell: {},
    });
    return G;
  }
  function hairShell(T, k, w, t0, t1) { return G.shell[k] || (G.shell[k] = new T.SphereGeometry(1, 48, 24, Math.PI / 2 + w / 2, Math.PI * 2 - w, t0, t1 - t0)); }


  // ---------- 雕塑：用距离场（SDF）捏形状，再变成三角形网格（surface nets）----------
  //   像捏黏土：圆、椭圆、两头不一样粗的圆柱光滑地并在一起（smin）或挖掉一块（smax），出来是一整块圆润、没有接缝的形状。
  const SC = (function () {
  const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ---------- 形状（都返回「到表面的距离」，里面是负数）----------
  const sphere = (cx, cy, cz, r) => (x, y, z) => len3(x - cx, y - cy, z - cz) - r;
  // 椭球（近似距离，够用）
  const ellipsoid = (cx, cy, cz, rx, ry, rz) => (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = len3(px, py, pz), k1 = len3(px / rx, py / ry, pz / rz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  };
  // 两头不一样粗的「胶囊」（round cone）：a 点半径 ra，b 点半径 rb
  const cone = (a, b, ra, rb) => {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    const l2 = bax * bax + bay * bay + baz * baz, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
    return (x, y, z) => {
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const yy = pax * bax + pay * bay + paz * baz, z0 = yy - l2;
      const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
      const x2 = cx * cx + cy * cy + cz * cz, y2 = yy * yy * l2, z2 = z0 * z0 * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(z0) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    };
  };
  // 一串点连成的「管子」（每一段是 cone），半径从 r0 渐变到 r1；sx/sz 可以把截面压扁（发片）
  const strand = (pts, r0, r1, k = 0.004) => {
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push(cone(pts[i], pts[i + 1], r0 + (r1 - r0) * (i / (pts.length - 1)), r0 + (r1 - r0) * ((i + 1) / (pts.length - 1))));
    return union(segs, k);
  };
  // 圆角盒子
  const box = (cx, cy, cz, hx, hy, hz, r = 0) => (x, y, z) => {
    const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
    return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
  // 平面：n·p - d（n 是单位向量，朝外为正）
  const plane = (nx, ny, nz, d) => (x, y, z) => nx * x + ny * y + nz * z - d;

  // ---------- 组合 ----------
  const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
  const smax = (a, b, k) => -smin(-a, -b, k);
  const union = (fs, k = 0) => (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k); return d; };
  const cut = (f, g, k = 0) => (x, y, z) => smax(f(x, y, z), -g(x, y, z), k);          // f 挖掉 g
  const inter = (f, g, k = 0) => (x, y, z) => smax(f(x, y, z), g(x, y, z), k);
  const shell = (f, t) => (x, y, z) => Math.abs(f(x, y, z)) - t;
  const offset = (f, d) => (x, y, z) => f(x, y, z) - d;
  // 包围盒外面直接给一个大概的距离，省得每个点都算一遍复杂的形状
  const bound = (f, lo, hi, pad = 0.02) => (x, y, z) => {
    const dx = Math.max(lo[0] - pad - x, 0, x - hi[0] - pad), dy = Math.max(lo[1] - pad - y, 0, y - hi[1] - pad), dz = Math.max(lo[2] - pad - z, 0, z - hi[2] - pad);
    return dx + dy + dz > 0 ? len3(dx, dy, dz) + pad * 0.5 : f(x, y, z);
  };

  // ---------- 变成网格（surface nets）----------
  //   lo / hi：范围；h：格子大小。返回 { pos, nor, idx }（Float32Array / Uint32Array）
  function mesh(f, lo, hi, h, opt = {}) {
    const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
    const N = nx * ny * nz, V = new Float32Array(N);
    // 只在表面附近细算：先按 4×4×4 一块算块中心，离表面远的整块直接填上同一个符号（快十来倍）
    const B = 4, R = B * h * 0.87 * 1.5 + h;
    for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
      const ei = Math.min(nx, bi + B), ej = Math.min(ny, bj + B), ek = Math.min(nz, bk + B);
      const dc = f(lo[0] + ((bi + ei - 1) / 2) * h, lo[1] + ((bj + ej - 1) / 2) * h, lo[2] + ((bk + ek - 1) / 2) * h);
      const far = Math.abs(dc) > R;
      for (let k = bk; k < ek; k++) { const z = lo[2] + k * h; for (let j = bj; j < ej; j++) { const y = lo[1] + j * h; let i = bi + nx * (j + ny * k); for (let ii = bi; ii < ei; ii++, i++) V[i] = far ? dc : f(lo[0] + ii * h, y, z); } }
    }
    const at = (i, j, k) => V[i + nx * (j + ny * k)];
    const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const P = [], cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
    const E = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let neg = 0;
      for (let c = 0; c < 8; c++) if (at(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2)) < 0) neg++;
      if (neg === 0 || neg === 8) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const e of E) {
        const a = at(i + e[0], j + e[1], k + e[2]), b = at(i + e[3], j + e[4], k + e[5]);
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b);
        sx += e[0] + (e[3] - e[0]) * t; sy += e[1] + (e[4] - e[1]) * t; sz += e[2] + (e[5] - e[2]) * t; n++;
      }
      vid[cid(i, j, k)] = P.length / 3;
      P.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
    }
    const I = [];
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d); };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const v0 = at(i, j, k) < 0;
      if (i < nx - 1 && v0 !== (at(i + 1, j, k) < 0)) quad(vid[cid(i, j - 1, k - 1)], vid[cid(i, j, k - 1)], vid[cid(i, j, k)], vid[cid(i, j - 1, k)], !v0);
      if (j < ny - 1 && v0 !== (at(i, j + 1, k) < 0)) quad(vid[cid(i - 1, j, k - 1)], vid[cid(i - 1, j, k)], vid[cid(i, j, k)], vid[cid(i, j, k - 1)], !v0);
      if (k < nz - 1 && v0 !== (at(i, j, k + 1) < 0)) quad(vid[cid(i - 1, j - 1, k)], vid[cid(i, j - 1, k)], vid[cid(i, j, k)], vid[cid(i - 1, j, k)], !v0);
    }
    const pos = new Float32Array(P), nor = new Float32Array(P.length), e = h * 0.5;
    const grad = (x, y, z) => { const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e), l = len3(gx, gy, gz) || 1; return [gx / l, gy / l, gz / l]; };
    for (let v = 0; v < pos.length; v += 3) {
      let x = pos[v], y = pos[v + 1], z = pos[v + 2];
      for (let it = 0; it < (opt.project == null ? 1 : opt.project); it++) { const d = f(x, y, z), g = grad(x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }   // 推到表面上
      pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
      const g = grad(x, y, z); nor[v] = g[0]; nor[v + 1] = g[1]; nor[v + 2] = g[2];
    }
    return { pos, nor, idx: new Uint32Array(I) };
  }

  return { sphere, ellipsoid, cone, strand, box, plane, smin, smax, union, cut, inter, shell, offset, bound, mesh };
  })();

  // ================= 公仔（2026.11 第二版：国潮手办）=================
  //   像潮玩店里的盲盒手办：大头（约 2.3 个头高）、圆圆的脸蛋、大眼睛（深色眼珠 + 两点高光）、小鼻子、小嘴、淡淡的腮红，
  //   头和头发是「捏」出来的一整块（距离场雕塑，见上面的 SC）：圆润、没有接缝，头发是一束束有体积的造型；
  //   衣服是新中式：立领、对襟、三对盘扣、镶边，下摆和袖口绣着祥云；裤子或者马面裙，黑面白底的布鞋。
  //   颜色从照片里取，再「归」到最近的中国传统色（黛蓝、朱红、月白、松绿……），所以怎么搭都好看。
  //   老师的特点：发型（短发 / 波波头 / 长发 / 外翻 / 马尾 / 发髻 / 卷发）、刘海（齐 / 斜 / 中分 / 不要）、发色、肤色、
  //   眼睛圆还是细长、眼角往上还是往下、眉毛粗细和走向、嘴多宽、爱不爱笑（faceLines 量出来的）、戴不戴眼镜。
  //   骨架的关节名字和别的样子一样（hips / spine / chest / head / arms / legs），动作、导出视频、捞捞编程舞台都通用。
  const DOLL = { FW: 0.2, FH: 0.2, FY: 0.16 };   // 脸贴图：头的局部坐标 → 画布（x ±FW、y 以 FY 为中心 ±FH）
  const FIG = { eyeX: 0.074, eyeY: 0.13, browY: 0.206, noseY: 0.1, mouthY: 0.062, blushX: 0.114, blushY: 0.09 };
  // 中国传统色：照片里的衣服颜色归到最近的一个（在 Lab 颜色空间里比）
  const GUO = [["玄青", 0x2c2d38], ["墨灰", 0x585b66], ["黛蓝", 0x3d4f6e], ["靛青", 0x2e5b8a], ["天青", 0x9ec2d8], ["月白", 0xeef1ec], ["米白", 0xf3ead6],
    ["朱红", 0xc63a2f], ["胭脂", 0x9b2b38], ["杏黄", 0xe9b450], ["松绿", 0x3d8a6c], ["竹青", 0x8fba9c], ["藕荷", 0xb49dc4], ["桃粉", 0xf0aeac], ["驼色", 0xa98762]];
  const labOf = (hex) => {
    const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    const r = f((hex >> 16) & 255), g = f((hex >> 8) & 255), b = f(hex & 255);
    const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.9505, Y = r * 0.2126 + g * 0.7152 + b * 0.0722, Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.089;
    const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
  };
  function guoColor(hex) {
    const a = labOf(hex); let best = GUO[0], bd = Infinity;
    for (const c of GUO) { const b = labOf(c[1]), d = (a[0] - b[0]) ** 2 * 0.6 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    return { name: best[0], hex: best[1] };
  }
  // 镶边、盘扣的颜色：深色衣服配金色，浅色配朱红，红衣服配金色
  const trimOf = (hex) => { const l = labOf(hex); return l[0] < 55 || (l[1] > 30 && l[0] < 70) ? 0xd8b06a : 0xc63a2f; };
  // 手办的皮肤：保留色相（老师本来的肤色），往瓷白的方向靠一点、更干净
  const figSkin = (hex) => { const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return { h: clamp(h, 0.02, 0.1), s: clamp(s, 0.35, 0.62), l: clamp(lerp(l, 0.8, 0.4), 0.5, 0.87) }; };
  // 头发：太黑的头发在灯下看不出形状，提一点点亮、带一点暖
  // 浅色、棕色的头发（照片里常常发灰）：颜色饱和一点、亮一点，金发就是金色
  const figHair = (hex) => { const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510; if (l < 0.13) return mixHex(hex, 0x3a2a24, 0.55); if (l < 0.22) return hex; const m = (r + g + b) / 3, k = 1.45, f = (c) => clamp(Math.round(m + (c - m) * k + (l > 0.35 ? 18 : 6)), 0, 255); return (f(r) << 16) | (f(g) << 8) | f(b); };

  // ---------- 捏头和头发（距离场），做好的网格按发型存起来，换颜色不用重算 ----------
  const SHAPES = new Map();
  function figHead(shape = "round") {
    const E = SC.ellipsoid;
    const cr = E(0, 0.205, -0.005, 0.196, 0.172, 0.184);                          // 脑袋
    // 脸型（照片量的，只微调，都还是圆嘟嘟的）：圆脸脸蛋宽；鹅蛋脸下巴尖一点；长脸下巴往下一点；方脸下巴宽
    const K = { round: [0.072, 0.102, 0.086, 0.062, 0.066], oval: [0.066, 0.096, 0.08, 0.056, 0.068], long: [0.064, 0.094, 0.078, 0.046, 0.074], square: [0.072, 0.1, 0.094, 0.058, 0.064] }[shape] || [0.072, 0.102, 0.086, 0.062, 0.066];
    const cheeks = [-1, 1].map((s) => E(s * K[0], 0.1, 0.05, K[1], 0.086, 0.1));   // 圆圆的脸蛋（肉嘟嘟的下半张脸）
    const chin = E(0, K[3], 0.052, K[2], K[4], 0.082);
    const face = SC.union([cr, ...cheeks, chin], 0.055);
    const ears = [-1, 1].map((s) => E(s * 0.19, 0.142, -0.014, 0.022, 0.036, 0.028));
    const head = SC.union([face, ...ears], 0.016);
    return { cr, face, head };
  }
  // 正面上 (x, y) 这一点的表面在多前面（z）：从前往后找
  const frontZ = (f, x, y, z0 = 0.45) => { let a = 0, b = z0; if (f(x, y, b) < 0) return b; if (f(x, y, a) > 0) return 0; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (f(x, y, m) < 0) a = m; else b = m; } return a; };
  function figShapes(style, bangs, shape = "round") {
    const key = style + "|" + bangs; if (SHAPES.has(key)) return { ...SHAPES.get(key), head: figHeadMesh(shape) };
    const { ellipsoid: E, sphere: Sp, union: U, cut: Cut, inter: In, offset: Off, plane: Pl, box: Bx, strand: Str, cone: Co, bound: Bd, mesh: M } = SC;
    const H = figHead(), out = { hair: [], extra: [] }, smaxF = SC.smax;
    if (style !== "none") {
      const short = style === "short", tied = style === "ponytail" || style === "bun", curly = style === "curly";
      const shellT = curly ? 0.034 : short ? 0.02 : 0.024;
      const cap = Off(H.cr, shellT);
      // 脸前面空出来的地方（圆角的「窗」）：上沿是发际线，两边到太阳穴；短发再把耳朵、后脖子露出来
      const top = bangs === "none" ? 0.305 : 0.29;
      const win = Bx(0, top - 0.2, 0.22, short ? 0.158 : 0.15, 0.2, 0.22, 0.09);
      let helmet = Cut(cap, win, 0.014);
      if (short) {
        const ears = [-1, 1].map((s) => E(s * 0.2, 0.12, -0.005, 0.05, 0.075, 0.06));
        helmet = Cut(In(helmet, Pl(0, -1, 0, -0.12), 0.02), U(ears), 0.016);
        // 短发头顶蓬一点（有型，不是贴着头皮的头盔）
        helmet = U([helmet, Cut(E(0.012, 0.3, 0.02, 0.19, 0.095, 0.19), win, 0.014)], 0.03);
        // 侧分：分缝那边浅浅一道沟，另一边头发往上蓬起来一点（像吹过的）
        const swoop = E(0.035, 0.335, 0.05, 0.15, 0.06, 0.13), part = Co([-0.07, top + 0.01, 0.17], [-0.06, 0.39, -0.02], 0.006, 0.004);
        helmet = Cut(U([helmet, Cut(swoop, win, 0.014)], 0.03), part, 0.006);
      }
      if (curly) {   // 卷发：发壳表面一个个小卷（三个方向的波叠起来，鼓起来的地方圆圆的）
        const base = helmet;
        helmet = (x, y, z) => { const d = base(x, y, z); if (d > 0.05) return d - 0.012; const w = Math.sin(x * 44 + Math.sin(z * 24)) * Math.sin(y * 42 + Math.sin(x * 20)) * Math.sin(z * 41 + Math.sin(y * 22)); return d - 0.017 * (w * 0.5 + 0.5) ** 0.8; };
      }
      const parts = [{ f: helmet, lo: [-0.27, 0.0, -0.27], hi: [0.27, 0.43, 0.26], h: 0.0042 }];
      if (style === "bob" || style === "long" || style === "flare" || curly) {
        // 波波头：两边和后面垂到下巴，发尾往里收；长发 / 外翻：再往下接一整片披到背上（一整块捏出来，没有接缝），前面两缕垂到肩膀
        const long = style === "long" || style === "flare", flare = style === "flare";
        const B = E(0, 0.16, -0.016, curly ? 0.25 : 0.236, 0.25, curly ? 0.24 : 0.226);
        let f = In(B, Pl(0, -1, 0, curly ? -0.0 : 0.012), 0.03);
        if (long) {
          const back = In(E(0, 0.0, -0.085, 0.222, 0.3, 0.125), Pl(0, -1, 0, flare ? 0.2 : 0.25), 0.05);
          const locks = [-1, 1].map((sd) => Str([[sd * 0.19, 0.14, -0.01], [sd * 0.2, 0.03, 0.0], [sd * 0.195, -0.09, 0.012], [sd * (flare ? 0.22 : 0.185), -0.18, 0.012]], 0.036, 0.026, 0.01));
          const ends = flare ? [-1, 1].map((sd) => Str([[sd * 0.17, -0.12, -0.06], [sd * 0.23, -0.19, -0.06], [sd * 0.27, -0.2, -0.05]], 0.045, 0.025, 0.01)) : [];
          f = U([f, back, ...locks, ...ends], 0.045);
        }
        if (curly) { const g0 = f; f = (x, y, z) => { const d = g0(x, y, z); if (d > 0.05) return d - 0.012; const w = Math.sin(x * 44 + Math.sin(z * 24)) * Math.sin(y * 42 + Math.sin(x * 20)) * Math.sin(z * 41 + Math.sin(y * 22)); return d - 0.017 * (w * 0.5 + 0.5) ** 0.8; }; }
        const bob = Cut(f, Bx(0, top - 0.24, 0.24, 0.152, 0.24, 0.24, 0.08), 0.016);
        parts.push(long ? { f: bob, lo: [-0.32, -0.3, -0.27], hi: [0.32, 0.42, 0.26], h: 0.005 } : { f: bob, lo: [-0.27, -0.03, -0.27], hi: [0.27, 0.42, 0.26], h: 0.0045 });
      }
      if (style === "ponytail") {
        // 高马尾：后脑勺上面扎起来，往后翘一下再垂下来；系一个朱红的蝴蝶结
        const tail = U([Str([[0, 0.345, -0.19], [0, 0.34, -0.27], [0, 0.24, -0.315], [0, 0.1, -0.3], [0.01, -0.03, -0.26], [0.025, -0.12, -0.21]], 0.075, 0.03, 0.015), E(0, 0.2, -0.3, 0.07, 0.11, 0.065)], 0.04);
        parts.push({ f: U([tail, Sp(0, 0.33, -0.17, 0.05)], 0.02), lo: [-0.1, -0.15, -0.38], hi: [0.1, 0.42, -0.1], h: 0.004 });
        out.extra.push({ kind: "bow", at: [0, 0.35, -0.235], dir: [0, 0.3, -1] });
      }
      if (style === "bun") {
        // 发髻：头顶偏后一个圆髻，插一支簪子（玉珠 + 小流苏）
        const bun = U([E(0, 0.385, -0.085, 0.092, 0.078, 0.088), E(0, 0.355, -0.06, 0.07, 0.04, 0.07)], 0.02);
        const wrap = Cut(bun, Bx(0, 0.392, -0.085, 0.2, 0.004, 0.2, 0), 0.006);   // 盘起来的一道纹
        parts.push({ f: wrap, lo: [-0.12, 0.29, -0.2], hi: [0.12, 0.48, 0.03], h: 0.0035 });
        out.extra.push({ kind: "pin", a: [-0.13, 0.43, -0.03], b: [0.13, 0.375, -0.14] });
      }
      if (bangs !== "none") {
        const shell = Off(H.cr, shellT + 0.004);
        // 刘海：贴着额头的一整片（越往发梢越薄），下沿一个个尖尖的发梢，发梢之间往上有一道浅浅的缝——像手办上雕出来的一缕缕
        //   齐刘海平着；斜刘海斜着梳向一边（分缝那边高）；中分从中间往两边分开，额头中间露出来
        const side = bangs === "side", mid = bangs === "middle", W = 0.056;
        const sweep = (x, y) => (side ? x + 0.55 * (y - 0.22) : mid ? Math.abs(x) + 0.45 * (y - 0.22) : x);
        const edgeY = (x) => (side ? 0.218 + 0.07 * clamp((-0.07 - x) / 0.12, 0, 1) ** 1.5 : mid ? 0.222 + 0.075 * Math.exp(-((x / 0.055) ** 2)) : 0.216) + 0.03 * (x / 0.175) ** 4;
        const bangF = (x, y, z) => {
          const u = sweep(x, y), sn = Math.abs(Math.sin((Math.PI * u) / W));
          const tipY = edgeY(x) + 0.02 * Math.pow(sn, 0.85);                         // 下沿：发梢尖尖的，发梢之间圆圆地往上收
          const fade = clamp((0.37 - y) / 0.08, 0, 1);                                // 往头顶慢慢收进发壳里（不起台阶）
          const thick = shellT - 0.006 + fade * (0.008 + 0.013 * clamp((y - tipY) / 0.07, 0, 1));   // 发梢薄、中间厚
          let d = H.cr(x, y, z) - thick + 0.0035 * Math.pow(sn, 10) * fade;           // 发缝
          d = smaxF(d, tipY - y, 0.006);                                              // 下沿
          d = smaxF(d, 0.04 - z, 0.02);                                               // 只要前面
          return smaxF(d, y - 0.4, 0.02);
        };
        parts.push({ f: bangF, lo: [-0.22, 0.18, 0.0], hi: [0.22, 0.42, 0.26], h: 0.003 });
      }
      // 每一块做成网格（外面先套包围盒，省得到处算）
      for (const p of parts) out.hair.push(M(Bd(p.f, p.lo, p.hi), p.lo, p.hi, p.h));
    }
    SHAPES.set(key, out);
    return { ...out, head: figHeadMesh(shape) };
  }
  function figHeadMesh(shape) {
    const k = "head|" + shape; if (SHAPES.has(k)) return SHAPES.get(k);
    const m = SC.mesh(SC.bound(figHead(shape).head, [-0.22, -0.02, -0.21], [0.22, 0.39, 0.21]), [-0.23, -0.03, -0.22], [0.23, 0.4, 0.22], 0.004);
    SHAPES.set(k, m); return m;
  }

  // 脸：画在一张透明画布上，平着投到头的正面。st：{ talk, blink, look, happy, think, t }
  function dollFaceDraw(ctx, S, P, st = {}) {
    const talk = clamp(st.talk || 0, 0, 1), blink = clamp(st.blink || 0, 0, 1), happy = clamp(st.happy || 0, 0, 1), think = clamp(st.think || 0, 0, 1);
    const look = st.look || [0, 0];
    const X = (x) => (0.5 + x / (2 * DOLL.FW)) * S, Y = (y) => (0.5 - (y - DOLL.FY) / (2 * DOLL.FH)) * S, Lw = (k) => Math.max(1, (k / (2 * DOLL.FW)) * S);
    const F = P.faceLines ? faceLook(P.faceLines) : null;
    ctx.save(); ctx.clearRect(0, 0, S, S); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const hair = figHair(P.hair), ink = hexCss(mixHex(hair, 0x1d120e, 0.5)), browC = hexCss(mixHex(hair, 0x2a1a14, 0.25));
    // 照片量出来的特点 → 可爱化以后的参数（只在一个好看的范围里变）
    const open = F ? clamp(0.92 + (F.eh / F.ew - 1.0) * 0.5, 0.8, 1.06) : 1;   // 眼睛圆还是细长
    const tilt = F ? clamp(F.tilt, -0.15, 0.15) : 0.03;                          // 眼角往上（正）还是往下
    const ex = FIG.eyeX * (F ? clamp(F.sep / 0.14, 0.95, 1.06) : 1), ey = FIG.eyeY;
    // 腮红：大大的、淡淡的
    if (P.blush) for (const sd of [-1, 1]) { const x = X(sd * FIG.blushX), y = Y(FIG.blushY), rx = Lw(0.034), g = ctx.createRadialGradient(x, y, 0, x, y, rx); const a = 0.42 + 0.2 * happy; g.addColorStop(0, `rgba(246,140,130,${a})`); g.addColorStop(0.6, `rgba(246,140,130,${a * 0.45})`); g.addColorStop(1, "rgba(246,140,130,0)"); ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.72); ctx.translate(-x, -y); ctx.fillStyle = g; ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2); ctx.restore(); }
    // 刘海下面一层淡淡的影子
    if (P.hairStyle !== "none" && P.bangs !== "none") { const g = ctx.createLinearGradient(0, Y(0.27), 0, Y(0.2)); g.addColorStop(0, "rgba(110,60,50,0.28)"); g.addColorStop(1, "rgba(110,60,50,0)"); ctx.fillStyle = g; ctx.fillRect(0, Y(0.3), S, Y(0.2) - Y(0.3)); }
    // 眉毛：短短的、软软的两笔（粗细、走向照着照片）
    for (const [k, sd] of [[0, -1], [1, 1]]) {
      const B = F ? F.brows[k] : { slope: 0.08, arch: 0.01, t: 0.018 };
      const cx = sd * (ex + 0.004) + look[0] * 0.003, len = 0.042, lift = 0.006 * happy + (sd > 0 ? 0.01 * think : -0.002 * think) + 0.003 * talk;
      const by = FIG.browY + lift, dy = clamp(B.slope, -0.4, 0.4) * len * 0.6;
      const ix = cx - sd * len / 2, ox = cx + sd * len / 2, th = clamp(B.t * 0.55, 0.0075, 0.012);
      ctx.strokeStyle = browC; ctx.lineWidth = Lw(th);
      ctx.beginPath(); ctx.moveTo(X(ix), Y(by - dy / 2)); ctx.quadraticCurveTo(X(cx), Y(by + 0.006 + clamp(B.arch, 0, 0.02) * 0.3), X(ox), Y(by + dy / 2 - 0.002)); ctx.stroke();
    }
    // 眼睛：大大的深色眼珠（下面透一点琥珀色）、黑瞳孔、上眼线带一根小睫毛、两点高光；会眨、会看方向；开心时变成弯弯的笑眼
    const eyeCol = P.eye;
    for (const sd of [-1, 1]) {
      const cx = sd * ex, cy = ey, w = 0.054, h = 0.066 * open;
      ctx.save(); ctx.translate(X(cx), Y(cy)); ctx.rotate(-sd * tilt * 0.5); ctx.translate(-X(cx), -Y(cy));
      if ((happy > 0.55 || P.eyeStyle === "smile") && blink < 0.5) {
        ctx.strokeStyle = ink; ctx.lineWidth = Lw(0.0085);
        ctx.beginPath(); ctx.moveTo(X(cx - w * 0.55), Y(cy - 0.006)); ctx.quadraticCurveTo(X(cx), Y(cy + 0.03), X(cx + w * 0.55), Y(cy - 0.006)); ctx.stroke();
      } else if (blink > 0.55) {
        ctx.strokeStyle = ink; ctx.lineWidth = Lw(0.008);
        ctx.beginPath(); ctx.moveTo(X(cx - w * 0.56), Y(cy + 0.002)); ctx.quadraticCurveTo(X(cx), Y(cy - 0.016), X(cx + w * 0.56), Y(cy + 0.002)); ctx.stroke();
      } else {
        const k = 1 - blink * 0.9, hh = h * k, lx = look[0] * 0.007, ly = look[1] * 0.005;
        // 眼白只露一点点边（让眼珠更大更亮）
        ctx.fillStyle = "#fffaf6"; ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), Lw(w * 0.55), Lw(hh * 0.52), 0, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), Lw(w * 0.55), Lw(hh * 0.52), 0, 0, Math.PI * 2); ctx.clip();
        const ix = X(cx + lx), iy = Y(cy + ly - 0.002), ir = Lw(w * 0.47);
        const g = ctx.createRadialGradient(ix, iy + ir * 0.45, ir * 0.1, ix, iy, ir * 1.05);
        g.addColorStop(0, hexCss(mixHex(eyeCol, 0xd9a35e, 0.55))); g.addColorStop(0.55, hexCss(mixHex(eyeCol, 0x6b3f24, 0.25))); g.addColorStop(1, hexCss(mixHex(eyeCol, 0x0c0706, 0.55)));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ix, iy, ir, Lw(hh * 0.5), 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hexCss(mixHex(eyeCol, 0x050303, 0.75)); ctx.beginPath(); ctx.ellipse(ix, iy - Lw(0.002), ir * 0.46, Lw(hh * 0.25), 0, 0, Math.PI * 2); ctx.fill();
        // 上眼皮的影子
        const sh = ctx.createLinearGradient(0, Y(cy + hh * 0.52), 0, Y(cy + hh * 0.1)); sh.addColorStop(0, "rgba(20,10,8,0.45)"); sh.addColorStop(1, "rgba(20,10,8,0)"); ctx.fillStyle = sh; ctx.fillRect(X(cx - w), Y(cy + hh * 0.6), Lw(w * 2), Y(cy + hh * 0.1) - Y(cy + hh * 0.6));
        // 高光：右上一大点、左下一小点（两只眼睛同一边，像同一盏灯）
        if (blink < 0.4) {
          ctx.fillStyle = "rgba(255,255,255,0.97)"; ctx.beginPath(); ctx.ellipse(X(cx + lx + 0.011), Y(cy + ly + hh * 0.2), Lw(0.0092), Lw(0.0115), -0.4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(X(cx + lx - 0.01), Y(cy + ly - hh * 0.2), Lw(0.0042), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        // 上眼线：粗一点、两头细，外眼角一根小睫毛往外翘
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.moveTo(X(cx - sd * w * 0.6), Y(cy + hh * 0.18));
        ctx.quadraticCurveTo(X(cx - sd * w * 0.1), Y(cy + hh * 0.62 + 0.004), X(cx + sd * w * 0.62), Y(cy + hh * 0.3));
        ctx.lineTo(X(cx + sd * w * 0.78), Y(cy + hh * 0.42));
        ctx.lineTo(X(cx + sd * w * 0.58), Y(cy + hh * 0.2));
        ctx.quadraticCurveTo(X(cx - sd * w * 0.1), Y(cy + hh * 0.5), X(cx - sd * w * 0.6), Y(cy + hh * 0.18)); ctx.closePath(); ctx.fill();
        // 下眼皮一笔很淡的线
        ctx.strokeStyle = "rgba(120,70,60,0.35)"; ctx.lineWidth = Lw(0.0035);
        ctx.beginPath(); ctx.moveTo(X(cx - w * 0.3), Y(cy - hh * 0.5)); ctx.quadraticCurveTo(X(cx), Y(cy - hh * 0.58), X(cx + w * 0.3), Y(cy - hh * 0.5)); ctx.stroke();
      }
      ctx.restore();
    }
    // 鼻子：一点淡淡的影子（3D 上还有一个小小的鼓包）
    { const x = X(0.004), y = Y(FIG.noseY - 0.004), r = Lw(0.009), g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(200,110,95,0.3)"); g.addColorStop(1, "rgba(200,110,95,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    // 嘴：平时一道小小的笑；说话时张开（圆圆的，里面深红、一点粉色的舌头）；开心时笑开
    const mw = F ? clamp(0.03 * (F.mw / 0.12), 0.026, 0.036) : 0.03, my = FIG.mouthY, mx = look[0] * 0.002 + think * 0.006;
    const curve = 0.006 + (F ? clamp(F.smile, 0, 0.2) * 0.02 : 0.003) - think * 0.006;
    const grin = F && F.open > 0.012 ? 1 - talk : 0;   // 照片里是露齿笑的老师：平时就是张嘴笑
    const opn = clamp(talk * 0.022 + happy * 0.008 + grin * 0.008, 0, 0.026), lip = "#8a3a34";
    if (opn < 0.003) {
      ctx.strokeStyle = lip; ctx.lineWidth = Lw(0.0042);
      ctx.beginPath(); ctx.moveTo(X(mx - mw / 2), Y(my + curve * 0.4)); ctx.quadraticCurveTo(X(mx), Y(my - curve), X(mx + mw / 2), Y(my + curve * 0.4)); ctx.stroke();
    } else {
      const w2 = mw * (0.85 + 0.25 * Math.max(happy, grin * 0.8)), top = my + 0.004, bot = my - opn * 1.6;
      const mouth = () => { ctx.beginPath(); ctx.moveTo(X(mx - w2 / 2), Y(top)); ctx.quadraticCurveTo(X(mx), Y(top - 0.004 * (1 - happy)), X(mx + w2 / 2), Y(top)); ctx.bezierCurveTo(X(mx + w2 / 2), Y(bot), X(mx - w2 / 2), Y(bot), X(mx - w2 / 2), Y(top)); ctx.closePath(); };
      mouth(); ctx.fillStyle = "#7a2630"; ctx.fill();
      ctx.save(); mouth(); ctx.clip(); ctx.fillStyle = "#ee8a92"; ctx.beginPath(); ctx.ellipse(X(mx), Y(bot + opn * 0.3), Lw(w2 * 0.34), Lw(Math.max(0.003, opn * 0.5)), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(X(mx - w2 * 0.32), Y(top + 0.0005), Lw(w2 * 0.64), Lw(Math.min(0.004, opn * 0.25))); ctx.restore();
    }
    ctx.restore();
  }

  function buildDoll(T, P, opt, K) {
    const { glow, mesh, grp, lathe, mats, geosOwn, texOwn } = K;
    const managed = !!(T.ColorManagement && T.ColorManagement.legacyMode === false);
    const C = (c) => { const k = new T.Color(c); if (!managed) k.convertSRGBToLinear(); return k; };
    const std = (col, o = {}) => { const e = o.emissive != null ? C(o.emissive) : undefined; return K.std(C(col), { ...o, ...(e ? { emissive: e } : {}) }); };
    const physM = (col, o = {}) => { const m = new T.MeshPhysicalMaterial({ color: C(col), roughness: 0.5, metalness: 0.0, ...o }); mats.push(m); return m; };
    const geoOf = (m) => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(m.pos, 3)); g.setAttribute("normal", new T.BufferAttribute(m.nor, 3)); g.setIndex(new T.BufferAttribute(m.idx, 1)); geosOwn.push(g); return g; };
    // 布料的纹理（法线贴图）：斜纹，灯一照有很细的起伏
    const weave = (() => {
      const c = typeof document !== "undefined" ? document.createElement("canvas") : null; if (!c) return null;
      const N = 64; c.width = c.height = N; const g = c.getContext("2d"), img = g.createImageData(N, N);
      const hgt = (x, y) => 0.5 + 0.5 * Math.sin((Math.PI * 2 * (x + y)) / 8);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = hgt((x + 1) % N, y) - hgt((x + N - 1) % N, y), dy = hgt(x, (y + 1) % N) - hgt(x, (y + N - 1) % N), nx = -dx * 0.8, ny = dy * 0.8, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4; img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(24, 12); texOwn.push(t); return t;
    })();
    const cloth = (col, o = {}) => { const m = physM(col, { roughness: 0.82, sheen: 0.35, sheenRoughness: 0.6, sheenColor: C(mixHex(col, 0xffffff, 0.3)), ...o }); if (weave && !o.map) { m.normalMap = weave; m.normalScale = new T.Vector2(0.25, 0.25); } m.userData.envK = 0.7; return m; };
    // 颜色：衣服归到中国传统色；镶边和盘扣配金色或朱红
    const topG = guoColor(P.top), botG = guoColor(P.pants), trim = trimOf(topG.hex);
    const skinHSL = figSkin(P.skin), skinCol = new T.Color().setHSL(skinHSL.h, skinHSL.s, skinHSL.l).getHex();
    const hairCol = figHair(P.hair);
    // 皮肤：哑光的软胶，边上一点暖暖的透光
    const skinM = physM(skinCol, { roughness: 0.6, sheen: 0.5, sheenRoughness: 0.45, sheenColor: C(0xffc2a8), emissive: C(skinCol).multiplyScalar(0.06) });
    // 头发：半哑光，一束束的边上有柔柔的光
    const hairM = physM(hairCol, { roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.55, sheen: 0.4, sheenRoughness: 0.35, sheenColor: C(mixHex(hairCol, 0xa8b0c8, 0.55)) }); hairM.userData.envK = 0.5;
    const trimM = physM(trim, { roughness: 0.35, metalness: trim === 0xd8b06a ? 0.55 : 0.05, clearcoat: 0.4 });
    // 上衣：画一张贴图——底色、下摆一圈祥云、前襟中间一道镶边
    const jacketTex = (() => {
      const c = typeof document !== "undefined" ? document.createElement("canvas") : null; if (!c) return null;
      c.width = 1024; c.height = 512; const g = c.getContext("2d");
      g.fillStyle = hexCss(topG.hex); g.fillRect(0, 0, 1024, 512);
      const tc = hexCss(trim), soft = rgba(mixHex(topG.hex, trim, 0.55), 0.9);
      // 下摆的镶边（贴图下面一截 = 衣服的下摆）
      g.fillStyle = tc; g.fillRect(0, 446, 1024, 12);
      // 祥云：一朵朵卷云纹，沿下摆排一圈
      const cloud = (x, y, s) => {
        g.lineWidth = 3.2 * s; g.strokeStyle = soft; g.lineCap = "round";
        g.beginPath(); g.arc(x, y, 9 * s, Math.PI * 0.9, Math.PI * 2.6); g.stroke();
        g.beginPath(); g.arc(x + 15 * s, y - 4 * s, 11 * s, Math.PI * 1.0, Math.PI * 2.4); g.stroke();
        g.beginPath(); g.arc(x + 31 * s, y + 1 * s, 8 * s, Math.PI * 1.1, Math.PI * 2.9); g.stroke();
        g.beginPath(); g.moveTo(x - 10 * s, y + 10 * s); g.quadraticCurveTo(x + 15 * s, y + 18 * s, x + 42 * s, y + 9 * s); g.stroke();
      };
      for (let i = 0; i < 14; i++) cloud(20 + i * 74, 408 + (i % 2) * 8, 1);
      // 前襟（u = 0.5 是正前方）：一道镶边
      g.fillStyle = tc; g.fillRect(509, 0, 6, 512);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; texOwn.push(t); return t;
    })();
    const topM = cloth(topG.hex, jacketTex ? { map: jacketTex, color: C(0xffffff) } : {});
    if (jacketTex && weave) { topM.normalMap = weave; topM.normalScale = new T.Vector2(0.2, 0.2); }
    const sleeveM = cloth(topG.hex), pantsM = cloth(botG.hex);
    const shoeM = physM(0x26252b, { roughness: 0.85, sheen: 0.3, sheenColor: C(0x666677) }), soleM = physM(0xf1ebdc, { roughness: 0.7 });
    const redM = physM(0xc8302a, { roughness: 0.4, clearcoat: 0.5, sheen: 0.4, sheenColor: C(0xff8a7a) });
    const jadeM = physM(0x8fd1b0, { roughness: 0.15, clearcoat: 1, transmission: 0, emissive: C(0x1a3a2c) });
    const goldM = physM(0xd8b06a, { roughness: 0.3, metalness: 0.7 });

    const root3 = new T.Group(), body = grp(root3), A = { root: root3, body };
    const ring = mesh(G.torus(0.3, 0.005), glow(P.accent, { transparent: true, opacity: 0.5 }), root3, false); ring.rotation.x = Math.PI / 2; ring.position.y = 0.004;
    const ring2 = mesh(G.torus(0.23, 0.003), glow(P.accent, { transparent: true, opacity: 0.25 }), root3, false); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.004;
    const halo = new T.Mesh(new T.CircleGeometry(0.4, 40), new T.MeshBasicMaterial({ map: haloTex(T, P.accent), transparent: true, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.003; root3.add(halo); mats.push(halo.material);
    ring.visible = ring2.visible = halo.visible = !!P.stage;
    A.ring = ring; A.ring2 = ring2; A.halo = halo;

    // ---- 比例：Q版（默认）约 2.3 头身；"tall" 修长一点 ----
    const QB = P.body !== "tall", HS = QB ? 1.42 : 1.15, LS = QB ? 0.6 : 0.95, AS = QB ? 0.8 : 1;
    const sy = (pts, k) => pts.map(([a, y, z]) => (z === undefined ? [a, y * k] : [a, y * k, z]));
    const HIP = 0.47 - 0.33 * (1 - LS), hips = grp(body, 0, HIP, 0); A.hips = hips;
    const skirt = P.bottom === "skirt";
    lathe([[0.001, -0.07], [0.1, -0.08], [0.13, -0.045], [0.138, 0.03], [0.13, 0.075], [0.001, 0.08]], pantsM, hips, 0.8);
    if (skirt) {
      // 马面裙：一圈褶子，下摆一道织金的襕边
      const sk = lathe([[0.001, -0.25 * LS / 0.6], [0.23, -0.25 * LS / 0.6], [0.222, -0.19 * LS / 0.6], [0.19, -0.05], [0.165, 0.05], [0.001, 0.07]], pantsM, hips, 0.84, 144);
      const pos = sk.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), r = Math.hypot(x, z); if (r < 1e-4) continue; const a = Math.atan2(x, z), k = 1 + 0.03 * Math.max(0, -y / 0.25) * Math.abs(Math.sin(a * 18)); pos.setXYZ(i, x * k, y, z * k); }
      pos.needsUpdate = true; sk.geometry.computeVertexNormals();
      const band = lathe([[0.226, -0.215 * LS / 0.6], [0.229, -0.2 * LS / 0.6], [0.225, -0.18 * LS / 0.6]], goldM, hips, 0.845, 144); band.castShadow = false;
    }
    const legM = skirt ? cloth(0xf1ebdc) : pantsM;
    A.legs = [-1, 1].map((s) => {
      const hip = grp(hips, s * 0.074, -0.04, 0);
      mesh(G.ball, legM, hip).scale.setScalar(skirt ? 0.045 : 0.07);
      lathe(sy(skirt ? [[0.001, 0.01], [0.046, 0.0], [0.044, -0.09], [0.04, -0.17], [0.038, -0.3], [0.001, -0.31]] : [[0.001, 0.012], [0.07, 0.0], [0.072, -0.08], [0.076, -0.2], [0.079, -0.3], [0.074, -0.322], [0.001, -0.323]], LS), legM, hip, 0.95, 40, 48);
      const knee = grp(hip, 0, -0.17 * LS, 0);
      const ankle = grp(knee, 0, -0.16 * LS, 0);
      // 布鞋：黑色的鞋面、圆头，白色的千层底
      lathe([[0.058, -0.075], [0.062, -0.05], [0.06, -0.03], [0.05, -0.025]], shoeM, ankle, 1.0, 32);
      const toe = mesh(G.ball, shoeM, ankle); toe.scale.set(0.066, 0.042, 0.1); toe.position.set(0, -0.08, 0.034);
      const sole = mesh(G.ball, soleM, ankle, false); sole.scale.set(0.07, 0.02, 0.108); sole.position.set(0, -0.108, 0.034);
      const strap = mesh(G.torus(0.05, 0.006, Math.PI), shoeM, ankle, false); strap.position.set(0, -0.072, 0.03); strap.rotation.set(0, 0, 0); strap.scale.set(1.1, 0.7, 1);
      return { s, hip, knee, ankle };
    });

    // ---- 新中式上衣：一整件（下摆盖住腰），立领、对襟、三对盘扣 ----
    const spine = grp(hips, 0, 0.08, 0); A.spine = spine;
    const chest = grp(spine, 0, 0.0, 0); A.chest = chest;
    const CH = [[0.001, -0.135], [0.176, -0.135], [0.175, -0.07], [0.168, 0.02], [0.168, 0.11], [0.164, 0.17], [0.15, 0.215], [0.118, 0.244], [0.07, 0.258], [0.001, 0.26]], CZ = 0.8;
    lathe(CH, topM, chest, CZ, 96, 48);
    const chestR = (y) => { for (let i = 1; i < CH.length; i++) if (y <= CH[i][1]) { const [r0, y0] = CH[i - 1], [r1, y1] = CH[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1); } return 0.06; };
    const onChest = (x, y, out = 0.004) => { const r = chestR(y), z = Math.sqrt(Math.max(0, r * r - x * x)) * CZ; return [x, y, z + out]; };
    // 立领：一圈直立的领子，前面留一个小口；上沿镶边
    { const g = new T.CylinderGeometry(0.074, 0.08, 0.046, 48, 1, true, 0.22, Math.PI * 2 - 0.44); geosOwn.push(g); const col = mesh(g, cloth(topG.hex, { side: T.DoubleSide }), chest, false); col.position.y = 0.272; col.scale.z = 0.92;
      const rim = mesh(G.torus(0.074, 0.004, Math.PI * 2 - 0.44), trimM, chest, false); rim.rotation.set(Math.PI / 2, 0, Math.PI / 2 + 0.22); rim.position.y = 0.295; rim.scale.set(1, 0.92, 1); }
    // 盘扣：每一对是两个小圈 + 中间一颗扣子，横着扣在前襟上
    for (const y of [0.205, 0.145, 0.085]) {
      const [x0, y0, z0] = onChest(0, y, 0.003);
      for (const sd of [-1, 1]) { const lp = mesh(G.torus(0.011, 0.0032), trimM, chest, false); lp.position.set(x0 + sd * 0.017, y0, z0 - 0.002); lp.scale.set(1.25, 0.8, 1); }
      const kn = mesh(G.ball, trimM, chest, false); kn.scale.setScalar(0.0065); kn.position.set(x0, y0, z0 + 0.003);
    }

    // ---- 胳膊：袖子到手腕，袖口宽一点、镶边 ----
    A.arms = [-1, 1].map((s) => {
      const sh = grp(chest, s * 0.152, 0.2, 0);
      mesh(G.ball, sleeveM, sh).scale.set(0.058, 0.06, 0.058);
      lathe(sy([[0.001, 0.02], [0.05, 0.012], [0.058, -0.02], [0.06, -0.09], [0.06, -0.15], [0.05, -0.175], [0.001, -0.18]], AS), sleeveM, sh, 1, 40);
      const el = grp(sh, 0, -0.155 * AS, 0);
      mesh(G.ball, sleeveM, el).scale.setScalar(0.058);
      lathe(sy([[0.001, 0.02], [0.056, 0.012], [0.06, -0.02], [0.064, -0.08], [0.068, -0.118], [0.066, -0.126], [0.001, -0.128]], AS), sleeveM, el, 1, 40);
      lathe([[0.062, -0.112 * AS], [0.07, -0.118 * AS], [0.07, -0.126 * AS], [0.064, -0.13 * AS]], trimM, el, 1, 40);
      const wr = grp(el, 0, -0.152 * AS, 0); wr.scale.setScalar(1.35);
      const seg = (len, r, parent) => { const b = mesh(G.cap(r, len), skinM, parent); b.position.y = -len / 2 - r * 0.6; return b; };
      mesh(G.ball, skinM, wr).scale.set(0.021, 0.018, 0.017);
      const palm = mesh(G.ball, skinM, wr); palm.scale.set(0.03, 0.031, 0.0165); palm.position.set(0, -0.03, 0.001);
      const fingers = [-1.5, -0.5, 0.5, 1.5].map((k, i) => {
        const len = [0.012, 0.0145, 0.015, 0.013][s > 0 ? 3 - i : i];
        const f = grp(wr, k * 0.0118, -0.05 + Math.abs(k) * 0.003, 0.001); f.rotation.z = k * 0.05;
        seg(len, 0.0069, f);
        const f2 = grp(f, 0, -len - 0.004, 0); seg(len * 0.8, 0.0064, f2);
        f.userData.f2 = f2;
        return f;
      });
      const th = grp(wr, -s * 0.025, -0.022, 0.007); th.rotation.set(-0.35, 0, -s * 0.8);
      seg(0.013, 0.0076, th); { const t2 = grp(th, 0, -0.017, 0); seg(0.01, 0.007, t2); }
      return { s, sh, el, wr, fingers, th };
    });

    // ---- 脖子 → 头（捏出来的一整块：脑袋 + 脸蛋 + 下巴 + 耳朵）----
    const neck = grp(chest, 0, 0.27, 0);
    lathe([[0.001, -0.01], [0.056, -0.01], [0.052, 0.03], [0.046, 0.055], [0.001, 0.062]], skinM, neck, 0.95, 32);
    const head = grp(neck, 0, 0.03, 0); head.scale.setScalar(HS); A.head = head;
    const SH = figShapes(P.hairStyle, P.bangs, P.faceShape), headGeo = geoOf(SH.head);
    const headMesh = mesh(headGeo, skinM, head);
    const HF = figHead(P.faceShape).head;
    // 小鼻子：一个很小的鼓包
    { const n = mesh(G.ball, skinM, head, false); n.scale.set(0.011, 0.009, 0.008); n.position.set(0, FIG.noseY, frontZ(HF, 0, FIG.noseY) - 0.003); }
    // 脸：一张透明的画布平着投到正面（眉毛、眼睛、腮红、嘴），每一帧画一次
    let face = null;
    { const S = opt.screenSize || 768, cv = typeof document !== "undefined" ? document.createElement("canvas") : null;
      if (cv) {
        cv.width = cv.height = S;
        const tex = new T.CanvasTexture(cv); tex.flipY = false; tex.anisotropy = 8; tex.encoding = T.sRGBEncoding; texOwn.push(tex);
        const g = headGeo.clone(); geosOwn.push(g);
        const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (z < 0.03) { uv[i * 2] = -1; uv[i * 2 + 1] = -1; } else { uv[i * 2] = 0.5 + x / (2 * DOLL.FW); uv[i * 2 + 1] = 0.5 - (y - DOLL.FY) / (2 * DOLL.FH); } }
        g.setAttribute("uv", new T.BufferAttribute(uv, 2));
        const fm = new T.MeshPhysicalMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        mats.push(fm);
        const fp = mesh(g, fm, head, false); fp.renderOrder = 1;
        face = { ctx: cv.getContext("2d"), S, tex };
      } }
    if (P.glasses) {
      const gm = physM(P.glassesColor, { metalness: 0.5, roughness: 0.3 }), gz = (x, y) => frontZ(HF, x, y) + 0.016;
      for (const sd of [-1, 1]) { const x = sd * FIG.eyeX, l = mesh(G.torus(0.04, 0.0036), gm, head, false); l.scale.set(1.02, 0.92, 1); l.position.set(x, FIG.eyeY, gz(x, FIG.eyeY)); l.lookAt(l.position.clone().add(new T.Vector3(sd * 0.25, 0, 1))); }
      const br = mesh(G.cap(0.0026, 0.044), gm, head, false); br.rotation.z = Math.PI / 2; br.position.set(0, FIG.eyeY + 0.008, gz(0, FIG.eyeY + 0.008) + 0.004);
    }
    // 头发
    const hairOn = P.hairStyle !== "none";
    const hairG = grp(head); if (P.part === "right") hairG.scale.x = -1;   // 分缝在另一边：头发整个左右翻过来
    for (const m of SH.hair) mesh(geoOf(m), hairM, hairG);
    for (const x of SH.extra) {
      if (x.kind === "bow") {
        // 朱红的蝴蝶结：两片圆圆的翅膀 + 中间一个结 + 两根垂下来的带子
        const g = grp(head, ...x.at); g.lookAt(new T.Vector3(...x.at).add(new T.Vector3(...x.dir)));
        for (const sd of [-1, 1]) { const w = mesh(G.ball, redM, g); w.scale.set(0.06, 0.036, 0.02); w.position.set(sd * 0.056, 0.006, 0); w.rotation.z = sd * 0.25; const tl = mesh(G.cap(0.01, 0.06), redM, g); tl.position.set(sd * 0.02, -0.055, 0.004); tl.rotation.z = sd * 0.3; tl.scale.set(1.3, 1, 0.5); }
        const kn = mesh(G.ball, redM, g); kn.scale.set(0.022, 0.024, 0.018);
        A.hairTie = g;
      } else if (x.kind === "pin") {
        // 簪子：一根细金簪，一头一颗玉珠，下面挂两串小流苏
        const a = new T.Vector3(...x.a), b = new T.Vector3(...x.b), d = b.clone().sub(a), L = d.length();
        const rod = mesh(G.cyl(0.0035, 0.0035, L, 10), goldM, head, false); rod.position.copy(a).add(b).multiplyScalar(0.5); rod.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
        const bead = mesh(G.ball, jadeM, head); bead.scale.setScalar(0.016); bead.position.copy(a);
        for (const k of [0, 1]) for (let i = 0; i < 3; i++) { const t = mesh(G.ball, i === 2 ? redM : goldM, head, false); t.scale.setScalar(i === 2 ? 0.006 : 0.004); t.position.copy(a).add(new T.Vector3(-0.006 + k * 0.012, -0.022 - i * 0.014, 0.004)); }
      }
    }

    const NECK_Y = HIP + 0.08 + 0.27 + 0.03;
    A.height = NECK_Y + (0.375 + (hairOn ? 0.03 : 0) + (P.hairStyle === "bun" ? 0.08 : 0)) * HS;
    A.faceY = NECK_Y + 0.17 * HS; A.faceSpan = 0.5 * HS; A.srgb = !managed; A.fullTall = true;
    A.palette = { top: topG.name, bottom: botG.name };

    // ---------- 动起来（和别的样子同一套动作，按公仔的短胳膊调过角度）----------
    const st = { t: Math.random() * 10, talk: 0, talkS: 0, talkSlow: 0, blink: 1 + Math.random() * 3, mood: "idle", moodT: 0, w: { wave: 0, point: 0, gesture: 0, nod: 0, think: 0 } };
    A.state = st; A.eyes = [];
    A.talk = (v) => { st.talk = clamp(+v || 0, 0, 1); };
    A.mood = (m, secs = 0) => { st.mood = MOODS.includes(m) ? m : "idle"; st.moodT = secs; };
    const fingerCurl = (arm, k, index) => { arm.fingers.forEach((f, i) => { const isIndex = arm.s > 0 ? i === 2 : i === 1; const c = isIndex && index != null ? index : k; f.rotation.x = -c * 0.9; if (f.userData.f2) f.userData.f2.rotation.x = -c * 0.8; }); arm.th.rotation.x = -k * 0.5; };
    A.update = (dt) => {
      dt = Math.min(dt, 0.1); st.t += dt; const t = st.t, W = st.w;
      if (st.moodT > 0) { st.moodT -= dt; if (st.moodT <= 0) st.mood = "idle"; }
      st.talkS = lerp(st.talkS, st.talk, 1 - Math.exp(-dt * 30));
      st.talkSlow = lerp(st.talkSlow, st.talk > 0.08 ? 1 : 0, 1 - Math.exp(-dt * 2.5));
      for (const k in W) W[k] = lerp(W[k], st.mood === k ? 1 : 0, 1 - Math.exp(-dt * 5));
      const talkG = st.talkSlow * (1 - W.wave) * (1 - W.point) * (1 - W.think), G2 = Math.max(W.gesture, talkG * 0.55);
      body.position.y = 0.012 + Math.sin(t * 1.4) * 0.005;
      hips.position.x = Math.sin(t * 0.45) * 0.006; hips.rotation.z = Math.sin(t * 0.45) * 0.012;
      spine.rotation.z = -Math.sin(t * 0.45) * 0.016; spine.rotation.x = Math.sin(t * 1.8) * 0.005 - W.think * 0.03;
      chest.scale.set(1, 1 + Math.sin(t * 1.8) * 0.006, 1);
      for (const L of A.legs) { L.hip.rotation.z = -hips.rotation.z; L.knee.rotation.x = 0.02 + (L.s * Math.sin(t * 0.45) > 0 ? 0.03 : 0); L.hip.rotation.x = -L.knee.rotation.x / 2; L.ankle.rotation.x = -L.knee.rotation.x / 2; }
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      ring.scale.setScalar(1 + pulse * 0.03); ring.material.opacity = 0.45 + pulse * 0.25; ring2.rotation.z = t * 0.6;
      st.blink -= dt; let ey = 1;
      if (st.blink < 0.12) ey = Math.max(0.1, Math.abs(st.blink - 0.06) / 0.06);
      if (st.blink <= 0) st.blink = 2 + Math.random() * 3.5;
      if (face) {
        const look = [Math.sin(t * 0.37) * 0.25 * (1 - W.point) - W.point * 0.9 + W.think * 0.5, Math.sin(t * 0.29) * 0.15 - W.think * 0.8];
        dollFaceDraw(face.ctx, face.S, P, { talk: st.talkS, blink: 1 - ey, look, happy: Math.max(W.wave, W.nod * 0.6), think: W.think, t });
        face.tex.needsUpdate = true;
      }
      head.rotation.set(
        Math.sin(t * 6.5) * 0.03 * st.talkS + W.nod * (0.08 + Math.sin(t * 6) * 0.13) + W.think * 0.05,
        Math.sin(t * 0.5) * 0.08 * (1 - W.point) - W.point * 0.35 + G2 * Math.sin(t * 0.9) * 0.07,
        Math.sin(t * 0.7) * 0.025 + W.think * 0.14);
      for (const a of A.arms) {
        const s = a.s;
        let shX = Math.sin(t * 1.2 + s) * 0.02, shZ = s * 0.16, shY = 0, elX = -0.1, elZ = 0, wrX = 0, wrY = -s * 1.1, wrZ = 0, curl = 0.4, idx = null;   // 平时手心朝着身子、手指微微弯
        const ph = t * 2.2 + (s > 0 ? 0 : 1.7);
        shX = lerp(shX, -0.5 - 0.12 * Math.sin(ph), G2); shZ = lerp(shZ, s * 0.25, G2); elX = lerp(elX, -1.2 - 0.25 * Math.sin(ph * 1.3), G2); wrY = lerp(wrY, -s * 1.0, G2); curl = lerp(curl, 0.1, G2);
        if (s < 0) {
          // 挥手：胳膊举起来，小臂在头旁边左右摆
          shZ = lerp(shZ, -2.35, W.wave); shX = lerp(shX, -0.15, W.wave); elZ = lerp(elZ, -0.55 + Math.sin(t * 8) * 0.38, W.wave); elX = lerp(elX, 0, W.wave); wrY = lerp(wrY, 0, W.wave); curl = lerp(curl, 0.05, W.wave);
          // 指幻灯片：胳膊往左上方伸，食指指出去
          shZ = lerp(shZ, -1.7, W.point); shX = lerp(shX, 0, W.point); shY = lerp(shY, -0.2, W.point); elX = lerp(elX, -0.9, W.point); elZ = lerp(elZ, -0.75, W.point); wrZ = lerp(wrZ, -0.15, W.point); if (W.point > 0.3) idx = 0.05; curl = lerp(curl, 1.4, W.point);
          // 想一想：手托下巴
          shX = lerp(shX, -1.45, W.think); shZ = lerp(shZ, -0.5, W.think); elX = lerp(elX, -2.3, W.think); elZ = lerp(elZ, 0.55, W.think); wrY = lerp(wrY, 0.5, W.think); wrZ = lerp(wrZ, 0.3, W.think); curl = lerp(curl, 1.1, W.think);
        } else {
          const down = Math.max(W.wave, W.point, W.think);
          shX = lerp(shX, 0, down); shZ = lerp(shZ, 0.16, down); elX = lerp(elX, -0.15, down); wrY = lerp(wrY, -s * 1.1, down); curl = lerp(curl, 0.4, down);
        }
        a.sh.rotation.set(shX, shY, shZ); a.el.rotation.set(elX, 0, elZ); a.wr.rotation.set(wrX, wrY, wrZ);
        fingerCurl(a, curl, idx);
      }
    };
    // 自己挡自己的影子（刘海在额头上、头在脖子上、胳膊在身上）：立体感主要靠这个
    root3.traverse((o) => { if (o.isMesh && o !== ring && o !== ring2 && o !== halo) o.receiveShadow = true; });
    // 环境光照（柔光箱的反光）：envFor() 做一张，舞台给进来
    A.setEnv = (tex, k = 1) => { for (const m of mats) if (m.isMeshStandardMaterial) { m.envMap = tex || null; m.envMapIntensity = (m.userData.envK != null ? m.userData.envK : 1) * k; m.needsUpdate = true; } };
    A.dispose = () => { for (const m of mats) { if (m.map && !m.map.__keep) m.map.dispose(); m.dispose(); } for (const g of geosOwn) g.dispose(); for (const t of texOwn) t.dispose(); };
    A.spec = P;
    return A;
  }

  // 摄影棚一样的环境光：一个渐变的大球（上亮下暗）+ 几块柔光箱（右前上方主光、左边补光、背后轮廓光、地面反光），
  // 用 PMREM 做成环境贴图。每个渲染器做一次，本机算、不用下载任何图片
  const ENVS = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function envFor(ren) {
    const T = root.THREE; if (!T || !ren || !T.PMREMGenerator) return null;
    if (ENVS && ENVS.has(ren)) return ENVS.get(ren);
    const sc = new T.Scene(), trash = [];
    const sky = new T.SphereGeometry(5, 32, 16), pos = sky.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) { const t = clamp((pos.getY(i) / 5 + 1) / 2, 0, 1), k = t * t * (3 - 2 * t); col.push(0.06 + 0.34 * k, 0.06 + 0.34 * k, 0.065 + 0.36 * k); }
    sky.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    const skyM = new T.MeshBasicMaterial({ side: T.BackSide, vertexColors: true }); sc.add(new T.Mesh(sky, skyM)); trash.push(sky, skyM);
    const panel = (w, h, x, y, z, k, c) => { const g = new T.PlaneGeometry(w, h), m = new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(k), side: T.DoubleSide }); const p = new T.Mesh(g, m); p.position.set(x, y, z); p.lookAt(0, 0, 0); sc.add(p); trash.push(g, m); };
    panel(2.6, 2.6, 2.4, 2.8, 3.0, 7, 0xfff3e8);    // 主光
    panel(2.2, 2.0, -3.2, 1.0, 2.4, 1.6, 0xeef3ff); // 补光
    panel(4.0, 1.0, -1.2, 2.6, -3.6, 5, 0xe3ecff); // 轮廓光
    panel(6.0, 2.0, 0, -3.6, 1.0, 1.5, 0xfff4ec);   // 地面反光
    const pm = new T.PMREMGenerator(ren), tex = pm.fromScene(sc, 0.04).texture; pm.dispose(); for (const x of trash) x.dispose();
    if (ENVS) ENVS.set(ren, tex);
    return tex;
  }

  // ================= AI 生成的 3D 形象（捞捞形象工坊做的 avatar.glb）=================
  //   模型、贴图、骨骼、蒙皮都是工坊做好的；这里让它动起来：
  //   · 身子、头：和公仔一样的呼吸、晃动、点头、转头
  //   · 胳膊：按这个模型自己的胳膊长度现算姿势（两节骨头的 IK）——挥手是手举到头旁边左右摆，指幻灯片是往左上方伸，
  //     想一想是把手送到下巴底下
  //   · 脸：工坊把眼睛和嘴从贴图上抠了下来（贴图上补成了皮肤），这里在脸上贴一层透明画布，每帧把它们画回原位：
  //     平时和生成的一模一样，眨眼时把眼睛压扁、说话时把嘴换成张开的样子
  // 读 avatar.glb（bytes）→ { gltf, lao, img }。three.js 的 GLTFLoader 要先加载（vendor/three/GLTFLoader.js）
  async function loadAi(bytes) {
    const T = root.THREE;
    if (!T || !T.GLTFLoader) throw new Error("GLTFLoader 没加载");
    const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    // 界面的安全设置不许 fetch：别让加载器用 createImageBitmap（它是 fetch 图片的），改用 <img> 读贴图
    const cib = root.createImageBitmap;
    let gltf;
    try {
      gltf = await new Promise((res, rej) => { try { root.createImageBitmap = undefined; } catch (e) {} new T.GLTFLoader().parse(buf, "", res, rej); try { root.createImageBitmap = cib; } catch (e) {} });
    } finally { try { root.createImageBitmap = cib; } catch (e) {} }
    const lao = gltf.parser && gltf.parser.json && gltf.parser.json.extras && gltf.parser.json.extras.lao;
    if (!lao || !Array.isArray(lao.joints)) throw new Error("这个模型不是捞捞形象工坊做的（没有关节信息）");
    const load = (uri) => new Promise((res) => { if (!uri) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = uri; });
    const f = lao.face || {};
    const img = { eyes: await Promise.all((f.eyes || []).map((e) => load(e.sprite))), mouth: await load(f.mouth && f.mouth.sprite) };
    return { gltf, lao, img };
  }

  // 脸上的画布：眼睛、嘴画回原位，会眨、会说话
  function aiFaceDraw(ctx, CW, CH, F, img, st) {
    const [fx0, fy0, fx1, fy1] = F.face;
    const X = (x) => ((x - fx0) / (fx1 - fx0)) * CW, Y = (y) => ((fy1 - y) / (fy1 - fy0)) * CH;
    ctx.clearRect(0, 0, CW, CH);
    const blink = clamp(st.blink || 0, 0, 1), talk = clamp(st.talk || 0, 0, 1), happy = clamp(st.happy || 0, 0, 1), look = st.look || [0, 0];
    (F.eyes || []).forEach((e, i) => {
      const [x0, y0, x1, y1] = e.box, rx = X(x0), ry = Y(y1), rw = X(x1) - rx, rh = Y(y0) - ry, im = img.eyes[i];
      const dx = look[0] * rw * 0.05, dy = -look[1] * rh * 0.04;
      const shut = e.closed ? 0 : Math.max(blink, happy > 0.55 ? (happy - 0.55) / 0.45 : 0);
      if (im) {
        if (shut < 0.98) {
          const k = 1 - shut * 0.94, h = rh * k, top = ry + (rh - h) * 0.62;   // 往下眼皮那边合
          ctx.save(); ctx.globalAlpha = 1; ctx.drawImage(im, rx + dx, top + dy, rw, h); ctx.restore();
        }
      }
      if (shut > 0.45) {   // 闭着 / 笑眯眯：一道弧（笑的时候往上拱）
        const a = clamp((shut - 0.45) / 0.4, 0, 1), cx = rx + rw / 2, cy = ry + rh * (happy > 0.55 ? 0.58 : 0.66), w = rw * 0.42;
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = e.color || "#2a1b14"; ctx.lineCap = "round"; ctx.lineWidth = Math.max(1.5, rh * 0.09);
        ctx.beginPath(); ctx.moveTo(cx - w, cy); ctx.quadraticCurveTo(cx, cy + (happy > 0.55 ? -rh * 0.32 : rh * 0.14), cx + w, cy); ctx.stroke(); ctx.restore();
      }
    });
    const M = F.mouth;
    if (M) {
      const [x0, y0, x1, y1] = M.box, rx = X(x0), ry = Y(y1), rw = X(x1) - rx, rh = Y(y0) - ry, im = img.mouth;
      const opn = clamp(talk * 1.1 + happy * 0.12, 0, 1);
      if (opn < 0.06 && im) ctx.drawImage(im, rx, ry, rw, rh);
      else {
        // 张开的嘴：上边几乎平、下边圆，里面深红，底下一点粉色的舌头，嘴唇边用原来的嘴色
        const cx = rx + rw / 2, top = ry + rh * 0.42, w2 = rw * (0.62 + 0.12 * (1 - opn)), hgt = rw * (0.1 + 0.36 * opn);
        const path = () => { ctx.beginPath(); ctx.moveTo(cx - w2 / 2, top); ctx.quadraticCurveTo(cx, top + hgt * 0.12, cx + w2 / 2, top); ctx.bezierCurveTo(cx + w2 / 2, top + hgt * 1.25, cx - w2 / 2, top + hgt * 1.25, cx - w2 / 2, top); ctx.closePath(); };
        path(); ctx.fillStyle = "#5e1a26"; ctx.fill();
        ctx.save(); path(); ctx.clip(); ctx.fillStyle = "#e07a88"; ctx.beginPath(); ctx.ellipse(cx, top + hgt * 0.95, w2 * 0.3, Math.max(1, hgt * 0.42), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        path(); ctx.strokeStyle = M.color || "#8a3b3b"; ctx.lineWidth = Math.max(1.2, rw * 0.035); ctx.stroke();
      }
    }
  }

  function buildAi(T, P, AI, K) {
    const { glow, mats } = K;
    const lao = AI.lao, F = lao.face || null, scene = AI.gltf.scene;
    const managed = !!(T.ColorManagement && T.ColorManagement.legacyMode === false);
    const root3 = new T.Group(), body = new T.Group(); root3.add(body);
    const A = { root: root3, body };
    // 和公仔一样的光环（舞台光效）
    const ring = new T.Mesh(G.torus(0.3, 0.005), glow(P.accent, { transparent: true, opacity: 0.5 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.004; root3.add(ring);
    const ring2 = new T.Mesh(G.torus(0.23, 0.003), glow(P.accent, { transparent: true, opacity: 0.25 })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.004; root3.add(ring2);
    const halo = new T.Mesh(new T.CircleGeometry(0.4, 40), new T.MeshBasicMaterial({ map: haloTex(T, P.accent), transparent: true, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.003; root3.add(halo); mats.push(halo.material);
    ring.visible = ring2.visible = halo.visible = !!P.stage;
    A.ring = ring; A.ring2 = ring2; A.halo = halo;
    body.add(scene); scene.position.set(0, 0, 0); scene.rotation.set(0, 0, 0);
    const bones = {}, skinned = [], own = [];
    scene.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material; if (m && m.isMeshStandardMaterial) { m.metalness = 0; m.roughness = 0.66; own.push(m); }
        if (o.isSkinnedMesh) skinned.push(o);
      }
    });
    const need = ["hips", "spine", "chest", "neck", "head", "shoulder_L", "elbow_L", "wrist_L", "shoulder_R", "elbow_R", "wrist_R"];
    const miss = need.filter((n) => !bones[n]);
    if (miss.length || !skinned.length) throw new Error("模型的骨骼不全：" + miss.join("、"));
    for (const b of Object.values(bones)) { b.userData.rest = b.position.clone(); b.quaternion.identity(); }
    const J = {}; for (const j of lao.joints) J[j.name] = new T.Vector3().fromArray(j.pos);
    const X = lao.extra || {}; for (const k in X) J[k] = new T.Vector3().fromArray(X[k]);
    A.hips = bones.hips; A.spine = bones.spine; A.chest = bones.chest; A.head = bones.head;
    // ---- 脸上的画布：从皮里挑出脸正面那一块三角形（跟着同一套骨骼动），uv 按正面投影铺满画布
    let face = null;
    if (F && F.face && typeof document !== "undefined") {
      const src = skinned[0], g = src.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
      const [fx0, fy0, fx1, fy1] = F.face, pad = 0.004, zMin = (F.frontZ != null ? F.frontZ : 0.2) - 0.12;
      const P0 = [], N0 = [], U0 = [], SI = [], SW = [], map = new Map();
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const take = (k) => {
        if (map.has(k)) return map.get(k);
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), nx = nor.getX(k), ny = nor.getY(k), nz = nor.getZ(k);
        P0.push(x + nx * 0.0012, y + ny * 0.0012, z + nz * 0.0012); N0.push(nx, ny, nz);
        U0.push((x - fx0) / (fx1 - fx0), (fy1 - y) / (fy1 - fy0));
        SI.push(si.getX(k), si.getY(k), si.getZ(k), si.getW(k)); SW.push(sw.getX(k), sw.getY(k), sw.getZ(k), sw.getW(k));
        map.set(k, P0.length / 3 - 1); return P0.length / 3 - 1;
      };
      const I = [], n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
        let ok = true;
        for (const k of [a, b, c]) { const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k); if (x < fx0 - pad || x > fx1 + pad || y < fy0 - pad || y > fy1 + pad || z < zMin || nor.getZ(k) < 0.05) { ok = false; break; } }
        if (ok) I.push(take(a), take(b), take(c));
      }
      if (I.length) {
        const fg = new T.BufferGeometry();
        fg.setAttribute("position", new T.Float32BufferAttribute(P0, 3)); fg.setAttribute("normal", new T.Float32BufferAttribute(N0, 3)); fg.setAttribute("uv", new T.Float32BufferAttribute(U0, 2));
        fg.setAttribute("skinIndex", new T.Uint16BufferAttribute(SI, 4)); fg.setAttribute("skinWeight", new T.Float32BufferAttribute(SW, 4)); fg.setIndex(I);
        const ar = (fx1 - fx0) / (fy1 - fy0), CH = 512, CW = Math.max(64, Math.round(CH * ar));
        const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
        const tex = new T.CanvasTexture(cv); tex.flipY = false; tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
        const fm = new T.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.66, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        own.push(fm); mats.push(fm);
        const fmsh = new T.SkinnedMesh(fg, fm); fmsh.frustumCulled = false; fmsh.renderOrder = 2;
        src.parent.add(fmsh); fmsh.bind(src.skeleton, src.bindMatrix);
        face = { ctx: cv.getContext("2d"), CW, CH, tex, geo: fg, mesh: fmsh };
      }
    }
    // ---- 尺寸、镜头
    A.height = lao.height || 1.25;
    const top = J.headTop ? J.headTop.y : A.height;
    A.faceY = F && F.face ? (F.face[1] + F.face[3]) / 2 : (J.head.y + top) / 2;
    A.faceSpan = Math.max(0.3, (top - J.neck.y) * 1.35);
    A.srgb = !managed; A.fullTall = true;
    A.setEnv = (tex, k = 1) => { for (const m of own) { m.envMap = tex || null; m.envMapIntensity = 0.8 * k; m.needsUpdate = true; } };
    // ---- 胳膊的 IK
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const arm = (s) => {
      const nm = s > 0 ? "L" : "R", S0 = J["shoulder_" + nm], E0 = J["elbow_" + nm], W0 = J["wrist_" + nm], H0 = J["handTip_" + nm] || W0.clone().add(V(0, -0.08, 0));
      return { s, sh: bones["shoulder_" + nm], el: bones["elbow_" + nm], wr: bones["wrist_" + nm], S0, E0, W0, a: S0.distanceTo(E0), b: E0.distanceTo(W0), hl: W0.distanceTo(H0),
        dU: E0.clone().sub(S0).normalize(), dF: W0.clone().sub(E0).normalize(), dH: H0.clone().sub(W0).normalize() };
    };
    A.arms = [arm(-1), arm(1)];
    A.legs = ["L", "R"].map((nm) => ({ s: nm === "L" ? 1 : -1, hip: bones["hip_" + nm], knee: bones["knee_" + nm], ankle: bones["ankle_" + nm] }));
    const modelRoot = scene;
    const inv = new T.Matrix4(), mtx = new T.Matrix4(), q1 = new T.Quaternion(), q2 = new T.Quaternion(), qc = new T.Quaternion(), tv = new T.Vector3(), sv = new T.Vector3();
    const modelPose = (bone, pos, quat) => { mtx.multiplyMatrices(inv, bone.matrixWorld); mtx.decompose(pos, quat, sv); };
    const lerpV = (a, b, t) => a.clone().lerp(b, t);
    const chin = F && F.mouth ? V((F.mouth.box[0] + F.mouth.box[2]) / 2, F.mouth.box[1] - 0.012, (F.frontZ != null ? F.frontZ : J.head.z + 0.15) - 0.03) : V(J.head.x, J.head.y + 0.01, J.head.z + 0.14);
    function solveArm(a, T0, pole, handDir, wave) {
      const S = new T.Vector3(), Q = new T.Quaternion();
      modelPose(a.sh.parent, tv, qc);           // 胸口现在的朝向
      modelPose(a.sh, S, Q);                    // 肩膀现在的位置
      const L = a.a + a.b, d0 = T0.clone().sub(S); let d = clamp(d0.length(), Math.abs(a.a - a.b) + 1e-3, L * 0.999);
      const dir = d0.normalize(), Tm = S.clone().addScaledVector(dir, d);
      const ap = (a.a * a.a - a.b * a.b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.a * a.a - ap * ap));
      const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)); if (perp.lengthSq() < 1e-8) perp.set(0, 0, -1); perp.normalize();
      const E = S.clone().addScaledVector(dir, ap).addScaledVector(perp, h);
      let Tf = Tm;
      if (wave) { const v = Tm.clone().sub(E); v.applyAxisAngle(V(0, 0, 1), wave); Tf = E.clone().add(v); }
      const u = E.clone().sub(S).normalize().applyQuaternion(q1.copy(qc).invert());
      a.sh.quaternion.setFromUnitVectors(a.dU, u);
      const Qs = qc.clone().multiply(a.sh.quaternion);
      const f = Tf.clone().sub(E).normalize().applyQuaternion(q1.copy(Qs).invert());
      a.el.quaternion.setFromUnitVectors(a.dF, f);
      const Qe = Qs.clone().multiply(a.el.quaternion);
      const hd = (handDir || Tf.clone().sub(E)).clone().normalize().applyQuaternion(q1.copy(Qe).invert());
      a.wr.quaternion.setFromUnitVectors(a.dH, hd);
    }
    // ---- 动起来（和公仔同一套节奏）
    const st = { t: Math.random() * 10, talk: 0, talkS: 0, talkSlow: 0, blink: 1 + Math.random() * 3, mood: "idle", moodT: 0, w: { wave: 0, point: 0, gesture: 0, nod: 0, think: 0 } };
    A.state = st; A.eyes = [];
    A.talk = (v) => { st.talk = clamp(+v || 0, 0, 1); };
    A.mood = (m, secs = 0) => { st.mood = MOODS.includes(m) ? m : "idle"; st.moodT = secs; };
    const hipsRest = bones.hips.userData.rest.clone();
    A.update = (dt) => {
      dt = Math.min(dt, 0.1); st.t += dt; const t = st.t, W = st.w;
      if (st.moodT > 0) { st.moodT -= dt; if (st.moodT <= 0) st.mood = "idle"; }
      st.talkS = lerp(st.talkS, st.talk, 1 - Math.exp(-dt * 30));
      st.talkSlow = lerp(st.talkSlow, st.talk > 0.08 ? 1 : 0, 1 - Math.exp(-dt * 2.5));
      for (const k in W) W[k] = lerp(W[k], st.mood === k ? 1 : 0, 1 - Math.exp(-dt * 5));
      const talkG = st.talkSlow * (1 - W.wave) * (1 - W.point) * (1 - W.think), G2 = Math.max(W.gesture, talkG * 0.55);
      body.position.y = Math.sin(t * 1.4) * 0.004;
      bones.hips.position.copy(hipsRest).add(V(Math.sin(t * 0.45) * 0.006, 0, 0)); bones.hips.rotation.set(0, 0, Math.sin(t * 0.45) * 0.012);
      bones.spine.rotation.set(Math.sin(t * 1.8) * 0.006 - W.think * 0.03, 0, -Math.sin(t * 0.45) * 0.016);
      bones.chest.rotation.set(Math.sin(t * 1.8) * 0.008, 0, 0);
      for (const L of A.legs) if (L.hip) { L.hip.rotation.set(0, 0, -bones.hips.rotation.z); if (L.knee) L.knee.rotation.set(0.02, 0, 0); }
      bones.neck.rotation.set(0, 0, 0);
      bones.head.rotation.set(
        Math.sin(t * 6.5) * 0.03 * st.talkS + W.nod * (0.08 + Math.sin(t * 6) * 0.13) + W.think * 0.08,
        Math.sin(t * 0.5) * 0.08 * (1 - W.point) - W.point * 0.3 + G2 * Math.sin(t * 0.9) * 0.07,
        Math.sin(t * 0.7) * 0.025 + W.think * 0.12);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      ring.scale.setScalar(1 + pulse * 0.03); ring.material.opacity = 0.45 + pulse * 0.25; ring2.rotation.z = t * 0.6;
      root3.updateMatrixWorld(true);
      inv.copy(modelRoot.matrixWorld).invert();
      for (const a of A.arms) {
        const s = a.s, L = a.a + a.b, S = a.S0, ph = t * 2.2 + (s > 0 ? 0 : 1.7);
        // 平时：手垂在原来的位置，轻轻晃
        let Tg = a.W0.clone().add(V(0, Math.sin(t * 1.2 + s) * 0.004, Math.sin(t * 1.2 + s) * 0.006)), pole = V(s * 0.25, 0, -1), hand = null, wave = 0;
        // 边讲边比划：小臂往前，手在胸前上下动
        const gT = S.clone().add(V(s * 0.25 * L, -0.5 * L, 0.6 * L)).add(V(0, 0.05 * Math.sin(ph) * L, 0.04 * Math.cos(ph * 1.3) * L));
        Tg = lerpV(Tg, gT, G2); pole = lerpV(pole, V(s * 0.6, -1, -0.3), G2);
        if (s < 0) {
          const wT = S.clone().add(V(s * 0.55 * L, 0.62 * L, 0.15 * L));                       // 挥手：手举到头旁边
          const pT = S.clone().add(V(s * 0.82, 0.5, 0.38).normalize().multiplyScalar(L * 0.98));  // 指幻灯片：往左上方伸直
          const kT = chin.clone().add(V(s * 0.02, -a.hl * 0.85, 0.035));                         // 想一想：手到下巴底下
          Tg = lerpV(Tg, wT, W.wave); pole = lerpV(pole, V(s, -0.7, -0.2), W.wave);
          Tg = lerpV(Tg, pT, W.point); pole = lerpV(pole, V(0, -1, -0.2), W.point);
          Tg = lerpV(Tg, kT, W.think); pole = lerpV(pole, V(s * 0.7, -1, 0.3), W.think);
          wave = W.wave * Math.sin(t * 8) * 0.38;
          if (W.think > 0.05) hand = lerpV(V(0, -1, 0), chin.clone().sub(kT).normalize(), W.think);
          if (W.wave > 0.05) hand = lerpV(hand || V(0, -1, 0), V(s * 0.15, 1, 0.1).normalize(), W.wave);
        }
        solveArm(a, Tg, pole, hand, wave);
      }
      st.blink -= dt; let bl = 0;
      if (st.blink < 0.12) bl = 1 - Math.max(0, Math.abs(st.blink - 0.06) / 0.06);
      if (st.blink <= 0) st.blink = 2 + Math.random() * 3.5;
      if (face) {
        const look = [Math.sin(t * 0.37) * 0.25 * (1 - W.point) - W.point * 0.9, Math.sin(t * 0.29) * 0.15];
        aiFaceDraw(face.ctx, face.CW, face.CH, F, AI.img, { talk: st.talkS, blink: bl, look, happy: Math.max(W.wave, W.nod * 0.6) });
        face.tex.needsUpdate = true;
      }
    };
    A.dispose = () => {
      body.remove(scene);
      if (face) { face.mesh.parent && face.mesh.parent.remove(face.mesh); face.geo.dispose(); face.tex.dispose(); face.mesh.material.dispose(); }
      ring.material.dispose(); ring2.material.dispose(); halo.geometry.dispose(); halo.material.dispose();
    };
    A.spec = P;
    return A;
  }

  function build(spec, opt = {}) {
    const T = root.THREE;
    const P = sanitize(spec);
    geos(T);
    const mats = [], geosOwn = [], texOwn = [];
    const std = (col, o = {}) => { const m = new T.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.12, ...o }); mats.push(m); return m; };
    const glow = (col, o = {}) => { const m = new T.MeshBasicMaterial({ color: col, ...o }); m.__base = new T.Color(col); mats.push(m); return m; };
    const mesh = (g, m, parent, shadow = true) => { const x = new T.Mesh(g, m); x.castShadow = shadow; if (parent) parent.add(x); return x; };
    const grp = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    // 光滑的旋转体（profile：[半径, 高度]，连成样条曲线再转一圈）；接缝放在背面，正脸中间不会有一道亮线
    // 轮廓一律从下往上排（从上往下排的话面是朝里的：看上去发虚，背后的东西还会透出来）
    const lathe = (pts, m, parent, sz = 1, seg = 48, res = 36) => { if (pts[0][1] > pts[pts.length - 1][1]) pts = pts.slice().reverse(); const c = new T.SplineCurve(pts.map(([r, y]) => new T.Vector2(Math.max(0.0001, r), y))); const g = new T.LatheGeometry(c.getPoints(res), seg, Math.PI, Math.PI * 2); geosOwn.push(g); const x = mesh(g, m, parent); x.scale.z = sz; return x; };
    // 一节四肢：从 0 往下 len 长，上粗下细，两头圆
    const limb = (len, r0, r1, m, parent, sz = 1) => lathe([[0.0001, 0.012], [r0 * 0.75, 0.004], [r0, -len * 0.12], [(r0 + r1) / 2 * 1.02, -len * 0.5], [r1, -len * 0.88], [r1 * 0.75, -len - 0.004], [0.0001, -len - 0.012]], m, parent, sz, 32);
    // AI 生成的 3D 形象：模型要先读好（opt.ai = loadAi 的结果）；还没读好就先用公仔顶着
    if (P.faceStyle === "ai3d" && opt.ai) {
      try { return buildAi(T, P, opt.ai, { glow, mats }); } catch (e) { if (root.console) console.warn("AI 形象没用上：", e); }
    }
    if (P.faceStyle === "doll" || P.faceStyle === "ai3d") return buildDoll(T, P, opt, { std, glow, mesh, grp, lathe, limb, mats, geosOwn, texOwn });   // 公仔风：单独一套模型

    // screen：屏幕脸（五官是发光线条，头是白色机器人外壳）；照片的几种：脸上贴处理过的照片
    const screen = P.faceStyle === "screen" && P.photoFace !== false;
    const faceSrc = !screen && P.photoFace !== false ? opt.face : null, cyber = P.faceStyle === "cyber";
    const phys = (col, o = {}) => { const m = new T.MeshPhysicalMaterial({ color: col, roughness: 0.3, metalness: 0.04, clearcoat: 1, clearcoatRoughness: 0.14, ...o }); mats.push(m); return m; };
    // 屏幕脸的头壳：白色釉面，有一层清漆的光
    const skinM = screen ? phys(P.shell, { emissive: new T.Color(P.shell).multiplyScalar(0.07) }) : faceSrc
      ? std(new T.Color(P.skin).multiplyScalar(FACE.LIT), { roughness: cyber ? 0.58 : 0.55, metalness: cyber ? 0.06 : 0.05, emissive: new T.Color(P.skin).multiplyScalar(FACE.GLOW), toneMapped: false })
      : std(P.skin, { roughness: 0.35, metalness: 0.15, emissive: new T.Color(P.skin).multiplyScalar(0.12) });
    const hairM = std(P.hair, { roughness: 0.45, metalness: 0.1, side: T.DoubleSide });
    hairM.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying vec3 vHP;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vHP = position;");
      sh.fragmentShader = "varying vec3 vHP;\n" + sh.fragmentShader
        .replace("#include <color_fragment>", `#include <color_fragment>
  float az = atan(vHP.x, vHP.z);
  float st1 = sin(az * 58.0 + sin(az * 9.0 + vHP.y * 3.0) * 2.5) * 0.5 + 0.5;
  float st2 = sin(az * 157.0 + vHP.y * 6.0 + sin(az * 23.0 + vHP.y * 2.0) * 2.0) * 0.5 + 0.5;
  float st3 = sin(az * 311.0 + sin(az * 41.0) * 3.0) * 0.5 + 0.5;
  float strand = st1 * 0.45 + st2 * 0.35 + st3 * 0.2;
  diffuseColor.rgb *= 0.86 + 0.22 * strand;`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * (0.8 + 0.4 * strand), 0.2, 1.0);");
    };
    hairM.customProgramCacheKey = () => "laolao-hair";
    // 课堂版（2026.11）：像一位穿着得体的老师助教——衣服是布料的哑光质感，关节藏在衣服里，没有黑色金属球；
    //   头大一点（大约 4.6 个头高）、脸屏幕更大，放在 PPT 角落里也看得清表情
    const topM = std(P.top, { roughness: 0.78, metalness: 0.02 }), pantsM = std(P.pants, { roughness: 0.8, metalness: 0.02 }), shoeM = std(P.shoes, { roughness: 0.45, metalness: 0.08 });
    const shirtM = std(P.collar != null ? P.collar : 0xf7f8fb, { roughness: 0.7, metalness: 0.0 });
    const handM = std(P.shell, { roughness: 0.32, metalness: 0.08 });
    const jointM = std(new T.Color(P.shell).multiplyScalar(0.82), { roughness: 0.35, metalness: 0.1 }), darkM = std(0x5b6475, { roughness: 0.4, metalness: 0.2 });
    const accM = glow(P.accent);

    const root3 = new T.Group();
    const body = grp(root3);
    const A = { root: root3, body };
    // 脚下：光环只在「科技感」打开时显示，默认课堂里不要
    const ring = mesh(G.torus(0.3, 0.005), glow(P.accent, { transparent: true, opacity: 0.5 }), root3, false); ring.rotation.x = Math.PI / 2; ring.position.y = 0.004;
    const ring2 = mesh(G.torus(0.23, 0.003), glow(P.accent, { transparent: true, opacity: 0.25 }), root3, false); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.004;
    const halo = new T.Mesh(new T.CircleGeometry(0.4, 40), new T.MeshBasicMaterial({ map: haloTex(T, P.accent), transparent: true, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.003; root3.add(halo); mats.push(halo.material);
    ring.visible = ring2.visible = halo.visible = !!P.stage;
    A.ring = ring; A.ring2 = ring2; A.halo = halo;

    // ---- 胯 + 腿（裤子 / 裙子一直到脚踝，膝盖藏在裤腿里） ----
    const LEG = 0.78;
    const hips = grp(body, 0, LEG, 0); A.hips = hips;
    if (P.bottom === "skirt") lathe([[0.001, -0.3], [0.205, -0.3], [0.198, -0.22], [0.17, -0.06], [0.15, 0.06], [0.14, 0.1], [0.001, 0.105]], pantsM, hips, 0.78);
    else lathe([[0.001, -0.08], [0.1, -0.09], [0.145, -0.055], [0.152, 0.02], [0.145, 0.085], [0.135, 0.11], [0.001, 0.112]], pantsM, hips, 0.72);
    const legM = P.bottom === "skirt" ? std(new T.Color(P.pants).lerp(new T.Color(0x2a2d36), 0.55), { roughness: 0.6, metalness: 0.05 }) : pantsM;   // 裙子下面是深色袜裤
    A.legs = [-1, 1].map((s) => {
      const hip = grp(hips, s * 0.078, -0.05, 0);
      mesh(G.ball, legM, hip).scale.setScalar(0.07);
      limb(0.33, 0.071, 0.058, legM, hip, 0.95);
      const knee = grp(hip, 0, -0.345, 0);
      mesh(G.ball, legM, knee).scale.setScalar(0.06);
      limb(0.31, 0.06, 0.05, legM, knee, 0.95);
      const ankle = grp(knee, 0, -0.33, 0);
      const foot = mesh(G.ball, shoeM, ankle); foot.scale.set(0.055, 0.04, 0.11); foot.position.set(0, -0.04, 0.035);
      const sole = mesh(G.ball, darkM, ankle, false); sole.scale.set(0.057, 0.012, 0.112); sole.position.set(0, -0.068, 0.035);
      return { s, hip, knee, ankle };
    });

    // ---- 腰 → 胸：一件外套（上衣颜色）从腰包到肩，里面白衬衫的领子，胸前一个工作牌 ----
    const spine = grp(hips, 0, 0.1, 0); A.spine = spine;
    lathe([[0.001, -0.075], [0.152, -0.075], [0.15, -0.03], [0.146, 0.0], [0.12, 0.012], [0.001, 0.014]], topM, spine, 0.74);   // 衣摆盖住腰（上面收进胸口里，不和胸口的面重叠）
    const chest = grp(spine, 0, 0.04, 0); A.chest = chest;
    lathe([[0.001, -0.02], [0.142, -0.02], [0.148, 0.05], [0.164, 0.15], [0.185, 0.24], [0.19, 0.3], [0.178, 0.345], [0.13, 0.378], [0.06, 0.392], [0.001, 0.394]], topM, chest, 0.68);
    // 衬衫：胸口一条 V 形的白色（领口开到第二颗扣子），两片翻领
    { const g = new T.CircleGeometry(1, 3); geosOwn.push(g); const v = mesh(g, shirtM, chest, false); v.scale.set(0.042, 0.075, 1); v.rotation.z = -Math.PI / 2; v.position.set(0, 0.333, 0.121); v.rotation.x = -0.42;
      const tie = mesh(G.cap(0.011, 0.05), std(new T.Color(P.accent).multiplyScalar(0.55), { roughness: 0.6, metalness: 0 }), chest, false); tie.position.set(0, 0.318, 0.127); tie.rotation.x = -0.32; tie.scale.set(1, 1, 0.45); A.tie = tie; }   // 一条主题色的小领带
    // 工作牌（左胸）：白底、一道主题色
    const badge = mesh(new T.BoxGeometry(1, 1, 1), shirtM, chest, false); badge.scale.set(0.05, 0.03, 0.004); badge.position.set(-0.078, 0.255, 0.126); badge.rotation.y = -0.28; geosOwn.push(badge.geometry);
    const core = mesh(new T.BoxGeometry(1, 1, 1), glow(P.accent), chest, false); core.scale.set(0.05, 0.008, 0.0045); core.position.set(-0.078, 0.266, 0.127); core.rotation.y = -0.28; geosOwn.push(core.geometry); A.core = core;

    // ---- 胳膊：袖子（上衣颜色）一直到手腕，肘在袖子里；手是白色的机器人手 ----
    A.arms = [-1, 1].map((s) => {
      const sh = grp(chest, s * 0.178, 0.31, 0);
      mesh(G.ball, topM, sh).scale.set(0.056, 0.052, 0.054);
      limb(0.245, 0.05, 0.042, topM, sh);
      const el = grp(sh, 0, -0.255, 0);
      mesh(G.ball, topM, el).scale.setScalar(0.043);
      limb(0.215, 0.043, 0.037, topM, el);
      const cuff = mesh(G.torus(0.036, 0.006), shirtM, el, false); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.205;   // 衬衫袖口
      const wr = grp(el, 0, -0.225, 0);
      mesh(G.ball, jointM, wr).scale.setScalar(0.024);
      const palm = mesh(G.ball, handM, wr); palm.scale.set(0.036, 0.046, 0.02); palm.position.y = -0.045;
      // 四根手指 + 大拇指（拇指在身体内侧）
      const fingers = [-1.5, -0.5, 0.5, 1.5].map((k, i) => {
        const f = grp(wr, k * 0.0165, -0.083, 0);
        const len = [0.03, 0.037, 0.039, 0.035][s > 0 ? 3 - i : i];
        const m = mesh(G.cap(0.0092, len), handM, f, false); m.position.y = -len / 2 - 0.004;
        return f;
      });
      const th = grp(wr, -s * 0.032, -0.035, 0.01); th.rotation.z = -s * 0.6;
      const tm = mesh(G.cap(0.0105, 0.028), handM, th, false); tm.position.y = -0.02;
      return { s, sh, el, wr, fingers, th };
    });

    // ---- 脖子 → 头：短短的浅灰脖子，衬衫领子围一圈 ----
    const neck = grp(chest, 0, 0.385, 0);
    const neckM = screen ? jointM : faceSrc ? std(new T.Color(P.skin).multiplyScalar(FACE.LIT * 0.8), { roughness: 0.6, metalness: 0.05, emissive: new T.Color(P.skin).multiplyScalar(FACE.GLOW * 0.78), toneMapped: false }) : skinM;   // 脖子在下巴的阴影里，暗一点才真实
    lathe([[0.001, -0.02], [0.048, -0.02], [0.047, 0.03], [0.045, 0.06], [0.048, 0.08], [0.035, 0.1], [0.001, 0.105]], neckM, neck, 0.95, 32);
    lathe([[0.058, -0.02], [0.07, -0.015], [0.066, 0.012], [0.058, 0.03], [0.054, 0.034]], shirtM, neck, 0.9, 40);
    const nl = mesh(G.torus(0.0545, 0.0028), accM, neck, false); nl.rotation.x = Math.PI / 2; nl.scale.set(1, 0.9, 1); nl.position.y = 0.034; nl.visible = !!P.stage;
    const head = grp(neck, 0, 0.03, 0); if (screen) head.scale.set(1.4, 1.26, 1.3); else head.scale.set(1.36, 1.3, 1.3); A.head = head;
    // 头：下巴尖一点、头顶圆的蛋形面板（肉色，有一点金属光泽）
    const HR = 0.118, hy = 0.135;                 // 头的大致半径、头中心离脖子多高
    // 屏幕脸的头：圆润、稍宽的「蛋形」头壳（下巴不尖，侧面饱满，正面能放下一大块面罩）；照片脸还是原来的头形
    const headMesh = screen
      ? lathe([[0.001, 0.0], [0.05, 0.003], [0.088, 0.018], [0.11, 0.045], [0.12, 0.085], [0.123, 0.13], [0.121, 0.17], [0.112, 0.205], [0.094, 0.235], [0.066, 0.256], [0.033, 0.266], [0.001, 0.268]], skinM, head, 1.0, 128, 72)
      : lathe([[0.001, 0.0], [0.045, 0.004], [0.08, 0.03], [0.104, 0.075], [0.116, 0.13], [0.118, 0.175], [0.11, 0.215], [0.085, 0.248], [0.045, 0.265], [0.001, 0.268]], skinM, head, 1.02, faceSrc ? 140 : 48, faceSrc ? 90 : 36);
    // 照片脸要有立体感：按标好的五官位置，在脸的正面做起伏（鼻梁鼻尖、眉骨、眼窝、颧骨、嘴唇、下巴），灯一照就有真的阴影
    if (faceSrc) {
      const g = headMesh.geometry, pos = g.attributes.position;
      const gs = (u, v, cu, cv, su, sv) => Math.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2));
      const [lu, ev] = FACE.eyeL, [ru] = FACE.eyeR, [mu, mv] = FACE.mouth, nv = ev + (mv - ev) * 0.68;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (z <= 0) continue;
        const u = 0.5 + x / (2 * FACE.W), v = 0.5 - (y - FACE.Y) / (2 * FACE.H);
        const ridge = Math.exp(-(((u - 0.5) / 0.05) ** 2)) * Math.max(0, Math.min(1, (v - ev + 0.02) / (nv - ev + 0.02))) * (v < nv + 0.04 ? 1 : Math.exp(-(((v - nv - 0.04) / 0.03) ** 2)));
        let d = 0.006 * ridge                                                 // 鼻梁到鼻尖越来越高
          + 0.004 * gs(u, v, 0.5, nv + 0.02, 0.07, 0.03)                         // 鼻翼
          - 0.003 * (gs(u, v, lu, ev, 0.08, 0.05) + gs(u, v, ru, ev, 0.08, 0.05))   // 眼窝
          + 0.0028 * (gs(u, v, lu, ev - 0.075, 0.09, 0.025) + gs(u, v, ru, ev - 0.075, 0.09, 0.025))   // 眉骨
          + 0.0035 * (gs(u, v, lu - 0.03, mv - 0.1, 0.09, 0.08) + gs(u, v, ru + 0.03, mv - 0.1, 0.09, 0.08))   // 颧骨、脸颊
          + 0.0032 * gs(u, v, mu, mv, 0.085, 0.032)                             // 嘴唇
          - 0.002 * gs(u, v, mu, mv + 0.06, 0.07, 0.02)                         // 下唇下面的小凹
          + 0.0025 * gs(u, v, mu, mv + 0.15, 0.08, 0.05);                       // 下巴
        d *= Math.min(1, z / 0.05);                                             // 只在正面，往两边慢慢没有
        const r = Math.hypot(x, z) || 1;
        pos.setXYZ(i, x + (x / r) * d, y, z + (z / r) * d);
      }
      pos.needsUpdate = true; g.computeVertexNormals();
    }
    const fc = new T.Vector3(0, hy, 0.0), fr = HR * 1.06;
    const Z = new T.Vector3(0, 0, 1);
    const onFace = (m, dx, dy, out = 1) => { const dz = Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy)); const d = new T.Vector3(dx, dy, dz).normalize(); m.position.set(fc.x + d.x * fr * out, fc.y + d.y * fr * out, fc.z + d.z * fr * out); m.quaternion.setFromUnitVectors(Z, d); return m; };
    // 下颌两侧一道细缝（看得出是机器人）
    if (!screen) for (const s of [-1, 1]) { const js = mesh(G.torus(0.07, 0.0022, 1.2), darkM, head, false); js.position.set(s * 0.06, 0.1, 0.0); js.rotation.set(0, s * 1.2, s > 0 ? -2.3 : -2.3 + Math.PI - 0.3); }
    // 耳朵：圆形耳机，外圈发光
    for (const s of [-1, 1]) {
      const pod = mesh(G.cyl(0.03, 0.033, 0.02), jointM, head); pod.rotation.z = Math.PI / 2; pod.position.set(s * 0.119, 0.13, -0.008);
      if (P.earpods) { const pr = mesh(G.torus(0.02, 0.0035), accM, head, false); pr.rotation.y = Math.PI / 2; pr.position.set(s * 0.13, 0.13, -0.008); }
    }
    // 头发：脑后、头顶一个壳，发型决定往下多长、要不要外翻
    const hc = new T.Vector3(0, hy + 0.012, -0.004), hairR = HR * 1.24;
    const shell = (k, w, t0, t1, R) => { const m = mesh(hairShell(T, k, w, t0, t1), hairM, head); m.scale.setScalar(R); m.position.copy(hc); return m; };
    const reshape = (m, cut, stretch, flare = 0, flip = 0) => {
      const g = m.geometry; if (g.__shaped) return; g.__shaped = true;
      const pos = g.attributes.position, y0 = Math.cos(cut);
      let ymin = 0; for (let i = 0; i < pos.count; i++) ymin = Math.min(ymin, y0 + (pos.getY(i) - y0) * stretch);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i); if (y >= y0) continue;
        const az = Math.atan2(pos.getX(i), pos.getZ(i)), k0 = (y0 - (y0 + (y - y0) * stretch)) / (y0 - ymin);
        const ny = y0 + (y - y0) * stretch + k0 * k0 * k0 * 0.07 * (0.5 + 0.5 * Math.sin(az * 13 + Math.sin(az * 4) * 1.6)), k = (y0 - ny) / (y0 - ymin);
        const f = 1 + flare * k * k + flip * Math.pow(Math.max(0, k - 0.8) / 0.2, 2);
        pos.setXYZ(i, pos.getX(i) * f, ny, pos.getZ(i) * f);
      }
      pos.needsUpdate = true; g.computeVertexNormals();
    };
    const cut = Math.PI * 0.31, R = hairR;
    const gh = ({ flare: 1.55, long: 1.45, bob: 1.45, short: 1.6, ponytail: 1.7, bun: 1.7, curly: 1.5 }[P.hairStyle] || 1.5) / 2;   // 脸前面没被头发盖住的那段（半角）
    if (P.hairStyle !== "none") {   // 头顶一整片：发际线是弧形——额头中间高，往两边太阳穴慢慢低下来
      const g = hairShell(T, "cap", 0, 0, cut).clone(); geosOwn.push(g);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const th = Math.acos(clamp(y, -1, 1)), h = Math.hypot(x, z); if (h < 1e-6) continue;
        const az = Math.abs(Math.atan2(x, z)), e = clamp(az / gh, 0, 1), side = az < gh - 0.02 ? e * e * (3 - 2 * e) : 0;
        const t2 = th * (1 + 0.38 * side), r = Math.sin(t2);
        pos.setXYZ(i, (x / h) * r, Math.cos(t2), (z / h) * r);
      }
      g.computeVertexNormals();
      const m = mesh(g, hairM, head); m.scale.setScalar(R); m.position.copy(hc);
    }
    if (P.hairStyle === "flare") reshape(shell("flare", 1.55, cut, Math.PI * 0.95, R), cut, 2.6, 0.75, 0.55);
    if (P.hairStyle === "long") reshape(shell("long", 1.45, cut, Math.PI * 0.95, R), cut, 2.9, 0.15, 0);
    if (P.hairStyle === "bob") reshape(shell("bob", 1.45, cut, Math.PI * 0.8, R), cut, 1.25, 0.1, 0.1);
    if (P.hairStyle === "short") reshape(shell("short", 1.6, cut, Math.PI * 0.6, R), cut, 1.0, 0, 0);
    if (P.hairStyle === "ponytail" || P.hairStyle === "bun") reshape(shell("tied", 1.7, cut, Math.PI * 0.62, R * 0.99), cut, 1.0, 0, 0);
    if (P.hairStyle === "ponytail") { const pt = mesh(G.cap(0.04, 0.16), hairM, head); pt.position.set(0, hy - 0.04, -R - 0.03); pt.rotation.x = 0.3; const tie = mesh(G.ball, accM, head, false); tie.scale.setScalar(0.022); tie.position.set(0, hy + 0.05, -R + 0.005); }
    if (P.hairStyle === "bun") { const bn = mesh(G.ball, hairM, head); bn.scale.setScalar(0.06); bn.position.set(0, hy + R + 0.02, -0.04); }
    if (P.hairStyle === "curly") { reshape(shell("curly", 1.5, cut, Math.PI * 0.75, R * 1.04), cut, 1.3, 0.3, 0); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (Math.sin(a) > 0.5) continue; const cu = mesh(G.ball, hairM, head); cu.scale.setScalar(0.04); cu.position.set(Math.cos(a) * R, hy - 0.02 + Math.sin(i * 1.7) * 0.03, -0.02 + Math.sin(a) * R); } }
    // 刘海
    if (P.hairStyle !== "none" && (P.bangs === "middle" || P.bangs === "side")) for (const s of [-1, 1]) {
      const side = P.bangs === "side" ? (s < 0 ? 1.25 : 0.55) : 1;
      const g = new T.SphereGeometry(1, 28, 14, s > 0 ? Math.PI / 2 + 0.05 : Math.PI / 2 - 1.45, 1.4, 0, Math.PI * 0.5);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const th = Math.acos(Math.max(-1, Math.min(1, y))), sd = Math.min(1, Math.abs(Math.atan2(x, z)) / 1.45);
        const ph = Math.atan2(z, -x), tip = Math.pow(th / (Math.PI * 0.5), 3);   // 刘海的边：一绺一绺、有长有短，不是直线
        const t2 = th * (0.38 + 0.62 * Math.pow(sd, 0.8)) * 1.12 * side * (1 - tip * (1 - sd) * 0.04 * (0.5 + 0.5 * Math.sin(ph * 15 + Math.sin(ph * 5) * 1.2)));
        const r = Math.sin(t2);
        pos.setXYZ(i, -Math.cos(ph) * r, Math.cos(t2), Math.sin(ph) * r);
      }
      g.computeVertexNormals(); geosOwn.push(g);
      const bm = mesh(g, hairM, head); bm.scale.set(fr * 1.08, fr * 1.08, fr * 1.12); bm.position.set(0, hy + 0.01, 0.0);
    }
    if (P.hairStyle !== "none" && P.bangs === "full") { const g = new T.SphereGeometry(1, 32, 12, Math.PI / 2 - 1.2, 2.4, 0, Math.PI * 0.36); geosOwn.push(g); const bm = mesh(g, hairM, head); bm.scale.set(fr * 1.08, fr * 1.08, fr * 1.13); bm.position.set(0, hy + 0.012, 0); }
    // 脸：有老师的照片就用照片做的卡通脸（像一块贴着头的屏幕，嘴会跟着声音张、眼睛会眨），一看就认得出是谁；
    //     没有照片就是机器人面罩（发光的眼睛 + 灯条嘴）
    let faceU = null, bars = [], scr = null;
    if (screen) {
      // 屏幕脸：一块画布，每一帧画一次（眨眼、说话、看方向），贴在头的正面；玻璃有反光，线条自己发光
      const S = opt.screenSize || 768, cv = typeof document !== "undefined" ? document.createElement("canvas") : null;
      if (cv) {
        cv.width = cv.height = S;
        const tex = new T.CanvasTexture(cv); tex.flipY = false; tex.anisotropy = 8; texOwn.push(tex);
        const g = headMesh.geometry.clone(); geosOwn.push(g);
        const pos = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (z < -0.02) uv.setXY(i, -1, -1); else uv.setXY(i, 0.5 + x / (2 * FACE.W), 0.5 - (y - FACE.Y) / (2 * FACE.H)); }
        uv.needsUpdate = true;
        const sm = new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.85, transparent: true, depthWrite: false, roughness: 0.32, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
        mats.push(sm);
        const sp = mesh(g, sm, head, false); sp.scale.copy(headMesh.scale); sp.renderOrder = 1;
        scr = { ctx: cv.getContext("2d"), S, tex, acc: 0 };
      }
      A.eyes = [];
    } else if (faceSrc) {
      let tex;
      if (faceSrc.isTexture) tex = faceSrc;
      else if (typeof faceSrc === "string") { const img = new Image(); tex = new T.Texture(img); img.onload = () => { tex.needsUpdate = true; }; img.src = faceSrc; texOwn.push(tex); }
      else { tex = new T.Texture(faceSrc); tex.needsUpdate = true; texOwn.push(tex); }
      tex.flipY = false; tex.anisotropy = 8;   // 斜着看也清楚
      // 把头的形状再复制一层，正面平着投上照片（背面不贴）
      const g = headMesh.geometry.clone(); geosOwn.push(g);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (z < -0.02) uv.setXY(i, -1, -1);
        else uv.setXY(i, 0.5 + x / (2 * FACE.W), 0.5 - (y - FACE.Y) / (2 * FACE.H));
      }
      uv.needsUpdate = true;
      const fm = new T.MeshStandardMaterial({ map: tex, transparent: true, roughness: cyber ? 0.58 : 0.55, metalness: cyber ? 0.06 : 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
      mats.push(fm);
      faceU = { uTalk: { value: 0 }, uBlink: { value: 0 }, uTime: { value: 0 }, uTech: { value: P.tech ? 1 : 0 }, uCyber: { value: P.faceStyle === "cyber" ? 1 : 0 }, uAccent: { value: new T.Color(P.accent) } };
      fm.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, faceU); sh.fragmentShader = "uniform float uTalk;\nuniform float uBlink;\nuniform float uTime;\nuniform float uTech;\nuniform float uCyber;\nuniform vec3 uAccent;\n" + sh.fragmentShader.replace("#include <map_fragment>", FACE_GLSL).replace("#include <emissivemap_fragment>", FACE_EMISSIVE); };
      fm.customProgramCacheKey = () => "laolao-face";
      const fp = mesh(g, fm, head, false); fp.scale.copy(headMesh.scale); fp.renderOrder = 1;
      A.eyes = [];
    } else {
      // 眼睛：一条深色玻璃面罩横在眼睛那里（一看就是机器人），眼睛在面罩上发光（睁眼是圆圆的，眯眯眼是两道弯）
      const vis = new T.CylinderGeometry(1, 1, 1, 48, 1, true, -1.15, 2.3); geosOwn.push(vis);
      const visor = mesh(vis, std(0x0b0f1a, { roughness: 0.08, metalness: 0.9, side: T.DoubleSide }), head, false); visor.scale.set(0.124, 0.05, 0.13); visor.position.set(0, hy + 0.012, 0.0);
      A.eyes = [-1, 1].map((s) => {
        let e;
        if (P.eyeStyle === "smile") { e = mesh(G.torus(0.018, 0.0045, Math.PI), accM, head, false); onFace(e, s * 0.34, 0.02, 1.075); }
        else { e = mesh(G.ball, accM, head, false); onFace(e, s * 0.34, 0.06, 1.07); e.scale.set(0.017, 0.019, 0.004); }
        return e;
      });
      // 鼻梁（很淡的一点起伏）
      const nose = mesh(G.ball, skinM, head, false); nose.scale.set(0.008, 0.016, 0.008); onFace(nose, 0, -0.16, 0.975);
      // 嘴：一条深色的槽，里面一排发光的小竖条，说话时跟着声音一高一低（像均衡器）
      const slot = mesh(G.cap(0.007, 0.04), darkM, head, false); onFace(slot, 0, -0.4, 0.975); slot.rotateZ(Math.PI / 2); slot.scale.set(1, 1, 0.5);
      bars = [-2, -1, 0, 1, 2].map((k) => { const b = mesh(G.cap(0.0028, 0.004), glow(P.accent), head, false); onFace(b, k * 0.055, -0.4, 0.993); return b; });
      A.bars = bars;
      if (P.blush) { const bm = std(0xff9db0, { transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false }); for (const s of [-1, 1]) { const b = mesh(G.ball, bm, head, false); b.scale.set(0.02, 0.011, 0.005); onFace(b, s * 0.55, -0.2, 0.99); } }
    }
    if (P.glasses && !screen) {
      const gm = std(P.glassesColor, { metalness: 0.5, roughness: 0.3 });
      // 照片脸的眼睛位置和机器人面罩的不一样
      const ex = faceSrc ? FACE.EX / fr : 0.34, eyy = faceSrc ? (FACE.EY - hy) / fr : 0.05;
      for (const s of [-1, 1]) { const l = mesh(G.torus(0.032, 0.0038), gm, head, false); onFace(l, s * ex, eyy, 1.11); }
      const br = mesh(G.cyl(0.003, 0.003, 0.03, 6), gm, head, false); onFace(br, 0, eyy + 0.02, 1.11); br.rotateZ(Math.PI / 2);
    }
    if (P.earrings) for (const s of [-1, 1]) { const er = mesh(G.ball, accM, head, false); er.scale.setScalar(0.009); er.position.set(s * 0.123, 0.085, 0.0); }
    if (P.antenna) { const st = mesh(G.cyl(0.004, 0.005, 0.05, 8), darkM, head); st.position.set(0.122, 0.19, -0.01); const bl = mesh(G.ball, glow(P.accent), head, false); bl.scale.setScalar(0.012); bl.position.set(0.122, 0.22, -0.01); A.antenna = bl; }
    A.height = LEG + 0.1 + 0.04 + 0.385 + 0.03 + 0.27 * 1.3;

    // ---------- 动起来 ----------
    //   动作：idle 站着、wave 挥手、point 指着幻灯片、gesture 边讲边比划、nod 点头、think 想一想
    const WHITE = new T.Color(0xffffff);
    const st = { t: Math.random() * 10, talk: 0, talkS: 0, talkSlow: 0, blink: 1 + Math.random() * 3, mood: "idle", moodT: 0, w: { wave: 0, point: 0, gesture: 0, nod: 0, think: 0 } };
    A.state = st;
    A.talk = (v) => { st.talk = clamp(+v || 0, 0, 1); };
    A.mood = (m, secs = 0) => { st.mood = MOODS.includes(m) ? m : "idle"; st.moodT = secs; };
    const fingerCurl = (arm, k, index) => { arm.fingers.forEach((f, i) => { const isIndex = arm.s > 0 ? i === 2 : i === 1; f.rotation.x = -(isIndex && index != null ? index : k); }); arm.th.rotation.x = -k * 0.6; };
    A.update = (dt) => {
      dt = Math.min(dt, 0.1); st.t += dt; const t = st.t, W = st.w;
      if (st.moodT > 0) { st.moodT -= dt; if (st.moodT <= 0) st.mood = "idle"; }
      st.talkS = lerp(st.talkS, st.talk, 1 - Math.exp(-dt * 30));
      st.talkSlow = lerp(st.talkSlow, st.talk > 0.08 ? 1 : 0, 1 - Math.exp(-dt * 2.5));
      for (const k in W) W[k] = lerp(W[k], st.mood === k ? 1 : 0, 1 - Math.exp(-dt * 5));
      const talkG = st.talkSlow * (1 - W.wave) * (1 - W.point) * (1 - W.think);   // 说话时默认也比划一点
      const G2 = Math.max(W.gesture, talkG * 0.55);
      // 站姿：呼吸、重心轻轻左右换
      body.position.y = 0.012 + Math.sin(t * 1.4) * 0.006;
      hips.position.x = Math.sin(t * 0.45) * 0.008; hips.rotation.z = Math.sin(t * 0.45) * 0.015;
      spine.rotation.z = -Math.sin(t * 0.45) * 0.02; spine.rotation.x = Math.sin(t * 1.8) * 0.006 - W.think * 0.04;
      chest.scale.set(1, 1 + Math.sin(t * 1.8) * 0.006, 1);
      for (const L of A.legs) { L.hip.rotation.z = -hips.rotation.z; L.knee.rotation.x = 0.02 + (L.s * Math.sin(t * 0.45) > 0 ? 0.04 : 0); L.hip.rotation.x = -L.knee.rotation.x / 2; L.ankle.rotation.x = -L.knee.rotation.x / 2; }
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      ring.scale.setScalar(1 + pulse * 0.03); ring.material.opacity = 0.45 + pulse * 0.25; ring2.rotation.z = t * 0.6;
      core.material.color.copy(core.material.__base).lerp(WHITE, 0.15 + st.talkS * 0.6 + pulse * 0.1);
      if (A.antenna) A.antenna.material.color.copy(A.antenna.material.__base).lerp(WHITE, (Math.sin(t * 5) > 0.6 ? 0.6 : 0));
      // 眨眼（灯灭一下）
      st.blink -= dt; let ey = 1;
      if (st.blink < 0.12) ey = Math.max(0.1, Math.abs(st.blink - 0.06) / 0.06);
      if (st.blink <= 0) st.blink = 2 + Math.random() * 3.5;
      for (const e of A.eyes) { if (!e.__s) e.__s = e.scale.clone(); e.scale.set(e.__s.x, e.__s.y * ey, e.__s.z); }
      if (faceU) { faceU.uTalk.value = st.talkS; faceU.uBlink.value = 1 - ey; faceU.uTime.value = t; }
      if (scr) {   // 屏幕脸：看方向（指幻灯片时看过去，想事情时往上看），开心（挥手、笑）
        const look = [Math.sin(t * 0.37) * 0.25 * (1 - W.point) - W.point * 0.9 + W.think * 0.5, Math.sin(t * 0.29) * 0.15 - W.think * 0.8];
        drawScreen(scr.ctx, scr.S, P, { talk: st.talkS, blink: 1 - ey, look, happy: Math.max(W.wave, W.nod * 0.6, W.gesture * 0.25), think: W.think, t });
        scr.tex.needsUpdate = true;
      }
      // 嘴：一排灯条跟着声音跳
      bars.forEach((b, i) => { const h = 0.004 + st.talkS * (0.016 + 0.012 * Math.sin(t * 23 + i * 1.9)) * (1 - Math.abs(i - 2) * 0.18); b.scale.set(1, Math.max(0.3, h / 0.004), 1); b.material.color.copy(b.material.__base).lerp(WHITE, st.talkS * 0.3); });
      // 头：微微动；说话时轻点；点头；想事情歪头；指的时候转向幻灯片
      head.rotation.set(
        Math.sin(t * 6.5) * 0.03 * st.talkS + W.nod * (0.08 + Math.sin(t * 6) * 0.14) + W.think * 0.06,
        Math.sin(t * 0.5) * 0.08 * (1 - W.point) - W.point * 0.45 + G2 * Math.sin(t * 0.9) * 0.08,
        Math.sin(t * 0.7) * 0.025 + W.think * 0.16);
      // 胳膊（s<0 是观众看的左边，指幻灯片、托腮用；s>0 挥手用；比划两只手一起）
      for (const a of A.arms) {
        const s = a.s;
        let shX = Math.sin(t * 1.2 + s) * 0.02, shZ = s * 0.1, shY = 0, elX = -0.12, elZ = 0, wrX = 0, wrY = 0, wrZ = 0, curl = 0.45, idx = null;
        // 边讲边比划：小臂抬起，手掌朝上，两只手交替动
        const ph = t * 2.2 + (s > 0 ? 0 : 1.7);
        shX = lerp(shX, -0.35 - 0.12 * Math.sin(ph), G2); shZ = lerp(shZ, s * 0.18, G2); elX = lerp(elX, -1.25 - 0.25 * Math.sin(ph * 1.3), G2); wrY = lerp(wrY, -s * 1.1, G2); curl = lerp(curl, 0.15, G2);
        // 课堂版：挥手、指幻灯片、托腮都用靠幻灯片那一侧的手（画面左边），另一只手自然放着——形象站在 PPT 右下角，竖的画面不用很宽
        if (s < 0) {
          // 挥手：手举到脸旁边，小臂竖起来左右摆（像在讲台上跟同学打招呼）
          shZ = lerp(shZ, -0.62, W.wave); shX = lerp(shX, -0.2, W.wave); elZ = lerp(elZ, -2.25 + Math.sin(t * 8) * 0.32, W.wave); elX = lerp(elX, -0.1, W.wave); wrY = lerp(wrY, 0, W.wave); curl = lerp(curl, 0.05, W.wave);
          // 指幻灯片：手抬到肩膀上面，食指往左上方指（「请看这里」），不会伸出画面
          shZ = lerp(shZ, -0.5, W.point); shX = lerp(shX, -0.2, W.point); shY = lerp(shY, 0.1, W.point); elX = lerp(elX, -0.12, W.point); elZ = lerp(elZ, -1.9, W.point); wrY = lerp(wrY, 0, W.point); wrZ = lerp(wrZ, -0.25, W.point); if (W.point > 0.3) idx = 0.05; curl = lerp(curl, 1.45, W.point);
          // 想一想：手托下巴
          shX = lerp(shX, -0.95, W.think); shZ = lerp(shZ, -0.05, W.think); elX = lerp(elX, -2.45, W.think); elZ = lerp(elZ, 0.25, W.think); wrY = lerp(wrY, 0.6, W.think); curl = lerp(curl, 0.9, W.think);
        } else {
          // 挥手、指、想的时候这只手自然垂着
          const down = Math.max(W.wave, W.point, W.think);
          shX = lerp(shX, 0, down); shZ = lerp(shZ, 0.1, down); elX = lerp(elX, -0.2, down); wrY = lerp(wrY, 0, down); curl = lerp(curl, 0.45, down);
        }
        a.sh.rotation.set(shX, shY, shZ); a.el.rotation.set(elX, 0, elZ); a.wr.rotation.set(wrX, wrY, wrZ);
        fingerCurl(a, curl, idx);
      }
    };
    A.dispose = () => { for (const m of mats) { if (m.map && !m.map.__keep) m.map.dispose(); m.dispose(); } for (const g of geosOwn) g.dispose(); for (const t of texOwn) t.dispose(); };
    A.spec = P;
    return A;
  }

  function haloTex(T, col) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), r = (col >> 16) & 255, gg = (col >> 8) & 255, b = col & 255;
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, `rgba(${r},${gg},${b},0.55)`); gr.addColorStop(0.5, `rgba(${r},${gg},${b},0.16)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c); return t;
  }

  // ---------- 小舞台：一个形象站在那里 ----------
  //   opt.transparent：背景透明（叠在别的东西上）；opt.bg：背景色；opt.view："full" 全身、"bust" 半身
  function create(el, spec, opt = {}) {
    const T = root.THREE; if (!T) return null;
    const W = () => Math.max(1, el.clientWidth || opt.width || 400), H = () => Math.max(1, el.clientHeight || opt.height || 400);
    const ren = new T.WebGLRenderer({ antialias: true, alpha: !!opt.transparent, preserveDrawingBuffer: !!opt.capture });
    ren.setPixelRatio(opt.pixelRatio || Math.min(2, root.devicePixelRatio || 1));
    ren.setSize(W(), H());
    ren.toneMapping = T.ACESFilmicToneMapping; ren.toneMappingExposure = 1.15;
    ren.shadowMap.enabled = true; ren.shadowMap.type = T.PCFSoftShadowMap;
    if (!opt.transparent) ren.setClearColor(opt.bg != null ? opt.bg : 0x0b1224, 1); else ren.setClearColor(0x000000, 0);
    ren.domElement.className = "lav-canvas";
    el.appendChild(ren.domElement);
    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(26, W() / H(), 0.05, 50);
    const hemi = new T.HemisphereLight(0xf4f7ff, 0x8a8f9e, 0.85); scene.add(hemi);   // 课堂：明亮、柔和，像教室里的灯
    const key = new T.DirectionalLight(0xffffff, 0.9); key.position.set(0.9, 4, 3.2); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.camera.left = -1; key.shadow.camera.right = 1; key.shadow.camera.top = 2; key.shadow.camera.bottom = -0.5; scene.add(key);
    const rim = new T.DirectionalLight(0xcfe6ff, 0.45); rim.position.set(-2, 1.6, -2); scene.add(rim);
    const fill = new T.DirectionalLight(0xfff1e6, 0.45); fill.position.set(-1.5, 1.2, 2.4); scene.add(fill);
    const floor = new T.Mesh(new T.CircleGeometry(1.2, 40), new T.ShadowMaterial({ opacity: 0.14 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    let face = opt.face || null, ai = opt.ai && opt.ai.gltf ? opt.ai : null;
    let A = build(spec, { face, ai }); scene.add(A.root);
    // 公仔风按 sRGB 输出（颜色正、不发灰），像拍手办一样打光：环境柔光 + 右前上方暖色主光（带软阴影）+ 背后冷色轮廓光；别的样子还是原来的设定
    const look = () => {
      const doll = !!A.fullTall;
      // 公仔风不用 ACES 色调映射（它会把浅肤色、亮颜色压灰），灯光总量控制在不过曝的范围里
      ren.toneMapping = doll ? T.NoToneMapping : T.ACESFilmicToneMapping; floor.material.needsUpdate = true;
      ren.outputEncoding = A.srgb ? T.sRGBEncoding : T.LinearEncoding; ren.toneMappingExposure = A.srgb ? 1.0 : 1.15;
      hemi.intensity = doll ? 0.12 : 0.85; key.intensity = doll ? 0.8 : 0.9; key.color.set(doll ? 0xfff2e6 : 0xffffff); key.position.set(doll ? 1.2 : 0.9, doll ? 3.2 : 4, 3.2);
      fill.intensity = doll ? 0.26 : 0.45; rim.intensity = doll ? 0.55 : 0.45; rim.position.set(doll ? -1.6 : -2, doll ? 2.2 : 1.6, -2);
      if (doll && A.setEnv) A.setEnv(envFor(ren), 0.4);
    };
    look();
    function frameCam() {
      const h = A.height, bust = opt.view === "bust" || opt.view === "face";
      cam.aspect = W() / H();
      const ty = opt.view === "face" ? (A.faceY != null ? A.faceY : h - 0.16) : bust ? h * 0.8 : h * 0.5, span = opt.view === "face" ? (A.faceSpan || 0.5) : bust ? h * 0.5 : h * 1.06;   // face：只看脸（近景）
      // 竖的画面（PPT 里的视频）按高度撑满，人往右挪一点，往左指的胳膊才放得下；横的画面按宽度放得下为准
      //   要放得下：举起来挥的手（头顶上面）和往左伸直指的手（离身体中心 0.75 左右）
      //   课堂版：竖的画面拍到大腿往上（脸大一点，坐在 PPT 角落里也看得清），指幻灯片是斜着往左上指，宽度放得下
      const tall = cam.aspect < 0.75 && !bust;
      //   公仔风：本来就是全身的手办样子，竖的画面拍全身（脚下留一点地方）
      const sp = tall ? (A.fullTall ? Math.max(h + 0.16, 0.66 / cam.aspect) : Math.max(h * 0.86, 0.8 / cam.aspect)) : span, cy = tall ? (A.fullTall ? h / 2 + 0.03 : h + 0.13 - sp / 2) : ty;
      const dist = sp / 2 / Math.tan((cam.fov * Math.PI) / 360) / (tall ? 1 : Math.min(1, cam.aspect * 1.05));
      const ox = tall ? (A.fullTall ? -0.08 : -0.13) : 0;
      cam.position.set(ox, cy + 0.06, dist); cam.lookAt(ox, cy, 0); cam.updateProjectionMatrix();
    }
    frameCam();
    let raf = 0, last = 0, dead = false, manual = !!opt.manual;
    // 看不见的时候（换到别的页、换成了 Q版动画）不画，省显卡
    function loop(now) { if (dead || manual) return; raf = requestAnimationFrame(loop); if (ren.domElement.offsetParent === null) { last = now; return; } const dt = last ? (now - last) / 1000 : 0.016; last = now; A.update(dt); ren.render(scene, cam); }
    if (!manual) raf = requestAnimationFrame(loop);
    const ro = root.ResizeObserver ? new ResizeObserver(() => { ren.setSize(W(), H()); frameCam(); }) : null; if (ro) ro.observe(el);
    const api = {
      canvas: ren.domElement,
      setSpec(s) { scene.remove(A.root); A.dispose(); A = build(s, { face, ai }); scene.add(A.root); look(); frameCam(); return A.spec; },
      setFace(f, s) { face = f || null; return api.setSpec(s || A.spec); },
      // AI 生成的 3D 形象：bytes 是 avatar.glb（null = 不用了）；读好以后换上。返回 Promise
      async setAi(bytes, s) { ai = bytes ? await loadAi(bytes) : null; return api.setSpec(s || A.spec); },
      get hasAi() { return !!ai; },
      get spec() { return A.spec; },
      get model() { return A; },
      talk(v) { A.talk(v); },
      mood(m, secs) { A.mood(m, secs); },
      // 导出视频：手动一帧一帧画（dt 秒，这一帧的音量）
      frame(dt, level, mood) { if (mood !== undefined && mood !== A.state.mood) A.mood(mood); A.talk(level || 0); A.update(dt); ren.render(scene, cam); return ren.domElement; },
      setManual(on) { manual = !!on; if (!manual && !dead) { last = 0; raf = requestAnimationFrame(loop); } },
      resize(w, h) { ren.setSize(w, h); cam.aspect = w / h; frameCam(); },
      dispose() { dead = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); A.dispose(); if (ai) ai.gltf.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); ren.dispose(); ren.domElement.remove(); },
    };
    return api;
  }

  root.LaoAvatar = { sanitize, build, create, envFor, loadAi, drawAiFace: aiFaceDraw, drawScreen, drawDollFace: dollFaceDraw, defaultLines, cleanLines, STYLES, MOODS, FACE, SCREEN, sculpt: SC, guoColor, figShapes, figSkinCss: (c) => { const k = figSkin(hexOf(c, 0xf0bf9c)), T = root.THREE; return T ? "#" + new T.Color().setHSL(k.h, k.s, k.l).getHexString() : c; } };
})(typeof window !== "undefined" ? window : globalThis);
