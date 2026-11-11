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
      accent: hexOf(p.accent, 0x22d3ee), antenna: !!p.antenna, earpods: p.earpods !== false, photoFace: p.photoFace !== false, tech: p.tech !== false, faceStyle: ["doll", "ai3d", "screen", "cyber", "photo", "soft", "cartoon"].includes(p.faceStyle) ? p.faceStyle : "doll", rig: p.rig === true, grid: p.grid !== false, body: p.body === "tall" ? "tall" : "chibi", faceLines: cleanLines(p.faceLines), shell: hexOf(p.shell, 0xeef1f6), stage: !!p.stage,
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


  // ================= 公仔风（2026.11 用户选定的样子）=================
  //   像潮玩手办：大头（大约 3.3 个头高）、肉色的脸上画着弯弯的笑眼、粗短眉毛、小鼻子、小嘴和腮红；
  //   黑色有光泽的头发（刘海、两边垂下的发丝、高马尾），毛衣、裤子、短靴是布料 / 皮革的质感；
  //   「机器人」的那一面是一套露在外面的骨架：红色关节球、绿色线路、银色脊椎、银色骨架手，衣服和头发上一层白色细网格。
  //   骨架的关节名字和别的样子一样（hips / spine / chest / head / arms / legs），动作、导出视频、捞捞编程舞台都通用。
  const DOLL = { FW: 0.2, FH: 0.2, FY: 0.16 };   // 脸贴图：头的局部坐标 → 画布（x ±FW、y 以 FY 为中心 ±FH）
  function dollFaceDraw(ctx, S, P, st = {}) {
    const talk = clamp(st.talk || 0, 0, 1), blink = clamp(st.blink || 0, 0, 1), happy = clamp(st.happy || 0, 0, 1), think = clamp(st.think || 0, 0, 1);
    const look = st.look || [0, 0];
    const X = (x) => (0.5 + x / (2 * DOLL.FW)) * S, Y = (y) => (0.5 - (y - DOLL.FY) / (2 * DOLL.FH)) * S, Lw = (k) => Math.max(1, (k / (2 * DOLL.FW)) * S);
    const F = P.faceLines ? faceLook(P.faceLines) : null;
    ctx.save(); ctx.clearRect(0, 0, S, S); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const ink = hexCss(mixHex(P.hair, 0x24160f, 0.3)), sep = F ? clamp(0.072 * (F.sep / 0.14), 0.064, 0.082) : 0.072, ey = 0.152;
    // 腮红：大大的、淡淡的桃色圆（一直有，笑的时候更红）
    if (P.blush) for (const sd of [-1, 1]) { const x = X(sd * (sep + 0.03)), y = Y(0.104), r = Lw(0.04), g = ctx.createRadialGradient(x, y, 0, x, y, r); const a = 0.55 + 0.18 * happy; g.addColorStop(0, `rgba(242,150,138,${a})`); g.addColorStop(0.55, `rgba(242,150,138,${a * 0.6})`); g.addColorStop(1, "rgba(242,150,138,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    // 刘海下面的一层淡淡的影子（额头上方暗一点，脸更立体）
    if (P.hairStyle !== "none" && P.bangs !== "none") { const g = ctx.createLinearGradient(0, Y(0.3), 0, Y(0.235)); g.addColorStop(0, "rgba(120,62,48,0.32)"); g.addColorStop(1, "rgba(120,62,48,0)"); ctx.fillStyle = g; ctx.fillRect(0, Y(0.36), S, Y(0.235) - Y(0.36)); }
    // 一道两头尖、中间粗的弧（眉毛、笑眼都这样画）：从 a 到 b，中间往上拱 bow，最粗 th
    const crescent = (ax, ay, bx, by, bow, th, col) => {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.quadraticCurveTo(X(mx), Y(my + bow * 2 + th), X(bx), Y(by)); ctx.quadraticCurveTo(X(mx), Y(my + bow * 2 - th), X(ax), Y(ay)); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    };
    // 眉毛：粗、柔和地往上弯、两头细；走向和粗细从照片里量的来（想事情时一边挑起来）
    for (const [k, sd] of [[0, -1], [1, 1]]) {
      const B = F ? F.brows[k] : { slope: 0.1, arch: 0.012, t: 0.02 };
      const cx = sd * (sep + 0.004) + look[0] * 0.004, len = 0.07, lift = 0.004 * happy + (sd > 0 ? 0.012 * think : 0);
      const by = 0.214 + lift, dy = clamp(B.slope, -0.4, 0.4) * len * 0.3, ix = cx - sd * len / 2, ox = cx + sd * len / 2;
      crescent(ix, by - 0.002 - dy / 2, ox, by - 0.004 + dy / 2, 0.008 + B.arch * 0.25, clamp(B.t * 0.75, 0.014, 0.019), ink);
    }
    // 眼睛
    const smile = P.eyeStyle !== "open";
    for (const sd of [-1, 1]) {
      const cx = sd * sep + look[0] * 0.006, cy = ey + look[1] * 0.004, w = 0.064;
      if (smile || happy > 0.6) {
        // 弯弯的笑眼（往上拱的一道粗弧），外眼角一根小睫毛往外翘
        crescent(cx - w / 2, cy - 0.006, cx + w / 2, cy - 0.006, 0.014, 0.0135, ink);
        const ex = cx + sd * w / 2;
        ctx.strokeStyle = ink; ctx.lineWidth = Lw(0.005);
        ctx.beginPath(); ctx.moveTo(X(ex - sd * 0.005), Y(cy - 0.001)); ctx.quadraticCurveTo(X(ex + sd * 0.006), Y(cy - 0.001), X(ex + sd * 0.012), Y(cy - 0.008)); ctx.stroke();
      } else {
        // 睁眼：深棕色的大眼珠 + 两点高光，上眼皮一道线，会眨
        const h = Math.max(0.004, 0.046 * (1 - blink * 0.95));
        ctx.fillStyle = hexCss(P.eye); ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), Lw(w * 0.36), Lw(h / 2), 0, 0, Math.PI * 2); ctx.fill();
        if (blink < 0.5) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(X(cx - 0.006), Y(cy + 0.009), Lw(0.0062), Lw(0.0075), 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(X(cx + 0.007), Y(cy - 0.01), Lw(0.003), 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = ink; ctx.lineWidth = Lw(0.007); ctx.beginPath(); ctx.moveTo(X(cx - w * 0.52), Y(cy + h * 0.25)); ctx.quadraticCurveTo(X(cx), Y(cy + h * 0.5 + 0.01), X(cx + w * 0.52), Y(cy + h * 0.25)); ctx.stroke();
      }
    }
    // 小鼻子：一点淡淡的影子
    { const x = X(0), y = Y(0.106), r = Lw(0.008), g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(190,110,90,0.35)"); g.addColorStop(1, "rgba(190,110,90,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    // 嘴：平时一道小小的微笑；说话时张开（深红色，里面一点粉色的舌头）
    const mw = F ? clamp(0.05 * (F.mw / 0.12), 0.04, 0.06) : 0.05, my = 0.078, opn = clamp(talk * 0.024 + happy * 0.004, 0, 0.026), curve = 0.008 + (F ? F.smile * 0.02 : 0.004) - think * 0.008;
    const lip = "#5c2a26", mx = look[0] * 0.003 + think * 0.008;
    if (opn < 0.003) {
      ctx.strokeStyle = lip; ctx.lineWidth = Lw(0.0048);
      ctx.beginPath(); ctx.moveTo(X(mx - mw / 2), Y(my + curve * 0.5)); ctx.quadraticCurveTo(X(mx), Y(my - curve), X(mx + mw / 2), Y(my + curve * 0.5)); ctx.stroke();
    } else {
      // 张开的嘴：上边几乎平、下边圆圆的（像小写的 D 倒过来），里面深红，底下一点粉色的舌头
      const w2 = mw * (0.72 + 0.12 * (1 - talk)), top = my + curve * 0.35, bot = my - opn * 1.9;
      const mouth = () => { ctx.beginPath(); ctx.moveTo(X(mx - w2 / 2), Y(top)); ctx.quadraticCurveTo(X(mx), Y(top - 0.003), X(mx + w2 / 2), Y(top)); ctx.bezierCurveTo(X(mx + w2 / 2), Y(bot), X(mx - w2 / 2), Y(bot), X(mx - w2 / 2), Y(top)); ctx.closePath(); };
      mouth(); ctx.fillStyle = "#6e1f2a"; ctx.fill();
      ctx.save(); mouth(); ctx.clip(); ctx.fillStyle = "#e57f8b"; ctx.beginPath(); ctx.ellipse(X(mx), Y(bot + opn * 0.35), Lw(w2 * 0.32), Lw(Math.max(0.003, opn * 0.55)), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      mouth(); ctx.strokeStyle = lip; ctx.lineWidth = Lw(0.003); ctx.stroke();
    }
    ctx.restore();
  }

  function buildDoll(T, P, opt, K) {
    const { glow, mesh, grp, lathe, limb, mats, geosOwn, texOwn } = K;
    const rig = P.rig === true, grid = P.grid !== false;   // 机器人骨架默认不要；衣服上的白格子默认有
    // 颜色按 sRGB 算（输出也是 sRGB），不然整体发灰发白；捞捞编程的舞台已经是这样，那里不用再换算
    const managed = !!(T.ColorManagement && T.ColorManagement.legacyMode === false);
    const C = (c) => { const k = new T.Color(c); if (!managed) k.convertSRGBToLinear(); return k; };
    const std = (col, o = {}) => { const e = o.emissive != null ? C(o.emissive) : undefined; return K.std(C(col), { ...o, ...(e ? { emissive: e } : {}) }); };
    const lum = (c) => { const k = new T.Color(c); return 0.3 * k.r + 0.59 * k.g + 0.11 * k.b; };
    // 白色细网格：深色布料 / 头发上是亮线（emissiveMap），浅色的上面是暗线（map）
    const gridCache = {};
    const gridTex = (rx, ry, light) => {
      const key = rx + "x" + ry + (light ? "L" : "D"); if (gridCache[key]) return gridCache[key];
      const c = typeof document !== "undefined" ? document.createElement("canvas") : null; if (!c) return null;
      c.width = c.height = 64; const g = c.getContext("2d");
      g.fillStyle = light ? "#ffffff" : "#000000"; g.fillRect(0, 0, 64, 64);
      g.fillStyle = light ? "#b9bcc4" : "#ffffff"; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);
      const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4; t.encoding = T.sRGBEncoding; texOwn.push(t);
      return (gridCache[key] = t);
    };
    // 毛线的凹凸（法线贴图）：一竖条一竖条的针脚，灯一照有起伏，看着是织出来的布
    const knitCache = {};
    const knitTex = (rx, ry, kind) => {
      const key = kind + rx + "x" + ry; if (knitCache[key]) return knitCache[key];
      const c = typeof document !== "undefined" ? document.createElement("canvas") : null; if (!c) return null;
      const N = 64; c.width = c.height = N; const g = c.getContext("2d"), img = g.createImageData(N, N);
      const hgt = (x, y) => kind === "knit"
        ? Math.pow(Math.abs(Math.sin((Math.PI * x) / 8)), 0.7) * (0.75 + 0.25 * Math.cos((Math.PI * 2 * (y + (Math.floor(x / 8) % 2) * 4)) / 8))   // 针脚：竖着一列列 V 字
        : 0.5 + 0.5 * Math.sin((Math.PI * 2 * (x + y)) / 8);   // 斜纹布
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = hgt((x + 1) % N, y) - hgt((x + N - 1) % N, y), dy = hgt(x, (y + 1) % N) - hgt(x, (y + N - 1) % N);
        const nx = -dx * 1.4, ny = dy * 1.4, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
        img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4; texOwn.push(t);
      return (knitCache[key] = t);
    };
    const physM = (col, o = {}) => { const m = new T.MeshPhysicalMaterial({ color: C(col), roughness: 0.5, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.5, ...o }); mats.push(m); return m; };
    // 布料：哑光、边上有一层绒绒的光（sheen），加针脚的凹凸；白格子和参考图一样（深色衣服上是亮线，浅色上是暗线）
    const cloth = (col, rx, ry, kind = "knit", o = {}) => {
      const m = physM(col, { roughness: 0.9, clearcoat: 0, sheen: 0.25, sheenRoughness: 0.5, sheenColor: C(new T.Color(col).lerp(new T.Color(0xffffff), 0.2).getHex()), ...o }); m.userData.envK = 0.7;
      const nt = kind === "rib" ? null : knitTex(kind === "knit" ? rx * 3 : rx * 2, kind === "knit" ? ry * 4 : ry * 2, kind); if (nt) { m.normalMap = nt; m.normalScale = new T.Vector2(0.55, 0.55); }
      if (grid && kind !== "rib") { if (lum(col) < 0.42) { const t = gridTex(rx, ry, false); if (t) { m.emissiveMap = t; m.emissive = C(0x9ca3af).multiplyScalar(0.32); } } else { const t = gridTex(rx, ry, true); if (t) m.map = t; } }
      return m;
    };
    // 皮肤：哑光的瓷，边上一点暖暖的透光（sheen）；颜色稍微饱和一点（捞捞编程的舞台有色调映射，会压灰一点）
    const skinMat = (col) => { const k = new T.Color(col), hsl = {}; k.getHSL(hsl); k.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), hsl.l); const m = physM(k.getHex(), { roughness: 0.55, clearcoat: 0.08, clearcoatRoughness: 0.55, sheen: 0.4, sheenRoughness: 0.5, sheenColor: C(0xffb8a0), emissive: C(k.getHex()).multiplyScalar(0.1) }); return m; };
    const skinM = skinMat(P.skin);
    // 头发：黑色、半哑光（不再是一块块白亮的高光），边上有柔柔的光，显出一缕缕的体积
    const hairM = physM(P.hair, { roughness: 0.46, clearcoat: 0.18, clearcoatRoughness: 0.4, sheen: 0.2, sheenRoughness: 0.4, sheenColor: C(new T.Color(P.hair).lerp(new T.Color(0x8890a8), 0.5).getHex()) });
    hairM.userData.envK = 0.45;
    const topM = cloth(P.top, 14, 6), sleeveM = cloth(P.top, 6, 5), ribM = cloth(new T.Color(P.top).multiplyScalar(0.85).getHex(), 1, 1, "rib");
    const pantsM = cloth(P.pants, 9, 7, "twill"), bootM = std(P.shoes, { roughness: 0.5, metalness: 0.05 }), soleM = std(new T.Color(P.shoes).multiplyScalar(0.55).getHex(), { roughness: 0.6, metalness: 0.0 });
    const redM = std(0xe0242f, { roughness: 0.22, metalness: 0.05, emissive: 0x330000 });
    const greenM = std(0x46b04a, { roughness: 0.45, metalness: 0.05, emissive: 0x0c2a0d });
    const silverM = std(0xdfe3e8, { roughness: 0.22, metalness: 0.85 });
    // 加竖条纹（毛衣的罗纹）：把旋转体的半径按角度一凸一凹
    const ribbed = (m, n, amp) => { const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z); if (r < 1e-5) continue; const a = Math.atan2(x, z), k = 1 + amp * Math.pow(Math.abs(Math.cos(a * n / 2)), 2); pos.setXYZ(i, x * k, pos.getY(i), z * k); } pos.needsUpdate = true; m.geometry.computeVertexNormals(); seam(m.geometry); return m; };
    // 旋转体首尾那一圈点是重合的，法线算出来两边不一样，背后会有一道亮条：把重合的点的法线取平均
    function seam(g) { const pos = g.attributes.position, nor = g.attributes.normal, at = new Map(); for (let i = 0; i < pos.count; i++) { const k = pos.getX(i).toFixed(5) + "," + pos.getY(i).toFixed(5) + "," + pos.getZ(i).toFixed(5); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } for (const ids of at.values()) { if (ids.length < 2) continue; let x = 0, y = 0, z = 0; for (const i of ids) { x += nor.getX(i); y += nor.getY(i); z += nor.getZ(i); } const l = Math.hypot(x, y, z) || 1; for (const i of ids) nor.setXYZ(i, x / l, y / l, z / l); } nor.needsUpdate = true; }
    // 一缕头发 / 一根线：沿一串点的管子，两头可以变细；out = 往外的方向（头发贴着头时用，管子横截面压扁成发片）
    const tube = (pts, w0, w1, th, m, parent, center, M = 12, N = 40, taperRoot = 0.08, tipLen = 0.18) => {
      const c = new T.CatmullRomCurve3(pts.map((q) => new T.Vector3(q[0], q[1], q[2])), false, "centripetal");
      const P0 = [], idx = [], uvs = [];
      const up = new T.Vector3(0, 0, 1), tmp = new T.Vector3();
      for (let i = 0; i <= N; i++) {
        const u = i / N, p = c.getPointAt(u), tg = c.getTangentAt(u).normalize();
        let out = center ? p.clone().sub(center).normalize() : (Math.abs(tg.z) > 0.9 ? new T.Vector3(1, 0, 0) : up.clone());
        const side = new T.Vector3().crossVectors(tg, out).normalize(); out = new T.Vector3().crossVectors(side, tg).normalize();
        let w = w0 + (w1 - w0) * u; w *= Math.min(1, Math.pow(Math.max(0, (1 - u) / tipLen), tipLen > 0.25 ? 0.75 : 0.5)) * (taperRoot > 0 ? Math.min(1, 0.55 + 0.45 * u / taperRoot) : 1);
        for (let j = 0; j <= M; j++) { const a = (j / M) * Math.PI * 2; tmp.copy(p).addScaledVector(side, Math.cos(a) * w).addScaledVector(out, Math.sin(a) * w * th); P0.push(tmp.x, tmp.y, tmp.z); uvs.push(j / M, u); }
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P0, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); geosOwn.push(g);
      return mesh(g, m, parent);
    };
    const wire = (pts, parent, r = 0.0026) => (rig ? tube(pts, r, r, 1, greenM, parent, null, 6, Math.max(8, pts.length * 6), 0) : null);
    const joint = (parent, x, y, z, r = 0.017) => { if (!rig) return null; const b = mesh(G.ball, redM, parent, false); b.scale.setScalar(r); b.position.set(x, y, z); return b; };

    const root3 = new T.Group(), body = grp(root3), A = { root: root3, body };
    const ring = mesh(G.torus(0.3, 0.005), glow(P.accent, { transparent: true, opacity: 0.5 }), root3, false); ring.rotation.x = Math.PI / 2; ring.position.y = 0.004;
    const ring2 = mesh(G.torus(0.23, 0.003), glow(P.accent, { transparent: true, opacity: 0.25 }), root3, false); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.004;
    const halo = new T.Mesh(new T.CircleGeometry(0.4, 40), new T.MeshBasicMaterial({ map: haloTex(T, P.accent), transparent: true, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.003; root3.add(halo); mats.push(halo.material);
    ring.visible = ring2.visible = halo.visible = !!P.stage;
    A.ring = ring; A.ring2 = ring2; A.halo = halo;

    // ---- 胯、腿、短靴 ----
    // Q版（默认，body "chibi"）：大约 2.4 头身——头放大 1.3 倍，腿缩短到 0.62、胳膊到 0.8（鞋和手不变，肉乎乎的）；"tall" 是原来 3.2 头身的比例
    const QB = P.body !== "tall", HS = QB ? 1.3 : 1, LS = QB ? 0.62 : 1, AS = QB ? 0.8 : 1;
    const sy = (pts, k) => pts.map(([a, y, z]) => (z === undefined ? [a, y * k] : [a, y * k, z]));
    const HIP = 0.47 - 0.33 * (1 - LS), hips = grp(body, 0, HIP, 0); A.hips = hips;
    lathe([[0.001, -0.075], [0.1, -0.085], [0.152, -0.045], [0.16, 0.03], [0.152, 0.075], [0.001, 0.08]], pantsM, hips, 0.8);
    const skirt = P.bottom === "skirt";
    if (skirt) lathe([[0.001, -0.2], [0.215, -0.2], [0.205, -0.15], [0.18, -0.04], [0.163, 0.05], [0.001, 0.07]], pantsM, hips, 0.82);
    const legM = skirt ? std(new T.Color(P.pants).lerp(new T.Color(0x22242c), 0.6).getHex(), { roughness: 0.6, metalness: 0.02 }) : pantsM;
    A.legs = [-1, 1].map((s) => {
      const hip = grp(hips, s * 0.078, -0.04, 0);
      mesh(G.ball, legM, hip).scale.setScalar(skirt ? 0.05 : 0.072);
      // 裤腿一整根（不在膝盖接缝，看不出一圈圈的）；膝盖只是个挂点，动作里弯得很少
      lathe(sy(skirt ? [[0.001, 0.01], [0.05, 0.0], [0.048, -0.09], [0.044, -0.17], [0.04, -0.3], [0.001, -0.31]] : [[0.001, 0.012], [0.072, 0.0], [0.0745, -0.08], [0.0765, -0.2], [0.079, -0.312], [0.073, -0.322], [0.001, -0.323]], LS), legM, hip, 0.95, 40, 48);
      const knee = grp(hip, 0, -0.17 * LS, 0);
      const ankle = grp(knee, 0, -0.16 * LS, 0);
      // 短靴：靴筒 + 圆头 + 深色鞋底
      lathe([[0.062, -0.1], [0.068, -0.06], [0.068, 0.0], [0.066, 0.03], [0.058, 0.035]], bootM, ankle, 1.0, 32);
      const toe = mesh(G.ball, bootM, ankle); toe.scale.set(0.072, 0.052, 0.105); toe.position.set(0, -0.078, 0.038);
      const sole = mesh(G.ball, soleM, ankle, false); sole.scale.set(0.075, 0.016, 0.112); sole.position.set(0, -0.112, 0.038);
      const heel = mesh(G.cyl(0.06, 0.062, 0.03, 24), soleM, ankle, false); heel.position.set(0, -0.11, -0.01);
      // 骨架：胯、膝、踝的红球，前面一道绿线，膝盖、脚踝是银色的小关节
      if (rig) {
        const zf = skirt ? 0.052 : 0.078;
        joint(hip, 0, 0, zf, 0.019); joint(knee, 0, 0, zf * 0.96, 0.018); joint(ankle, 0, -0.01, 0.07, 0.016);
        wire(sy([[0, -0.015, zf + 0.002], [0, -0.08, zf + 0.004], [0, -0.155, zf * 0.96 + 0.002]], LS), hip);
        wire(sy([[0, -0.015, zf * 0.96 + 0.002], [0, -0.08, zf + 0.003], [0, -0.15, 0.072]], LS), knee);
        for (const sx of [-1, 1]) { const k = mesh(G.cyl(0.006, 0.006, 0.01, 10), silverM, knee, false); k.rotation.z = Math.PI / 2; k.position.set(sx * 0.012, -0.022, zf * 0.96); }
      }
      return { s, hip, knee, ankle };
    });

    // ---- 毛衣：下摆罗纹、身子、高领 ----
    const spine = grp(hips, 0, 0.08, 0); A.spine = spine;
    ribbed(lathe([[0.001, -0.075], [0.166, -0.075], [0.17, -0.06], [0.17, -0.012], [0.163, 0.0], [0.001, 0.005]], ribM, spine, 0.82, 120), 80, 0.02);
    const chest = grp(spine, 0, 0.0, 0); A.chest = chest;
    const CH = [[0.001, -0.005], [0.164, -0.005], [0.17, 0.05], [0.172, 0.12], [0.168, 0.18], [0.155, 0.222], [0.118, 0.248], [0.07, 0.26], [0.001, 0.262]], CZ = 0.8;
    lathe(CH, topM, chest, CZ, 64);
    const neckR = 0.062;
    ribbed(lathe([[0.075, 0.236], [0.09, 0.244], [0.09, 0.27], [0.086, 0.29], [0.07, 0.296], [0.06, 0.29]], ribM, chest, 0.92, 72), 40, 0.04);
    // 胸前表面上的点（画线路、放关节球用）
    const chestR = (y) => { for (let i = 1; i < CH.length; i++) if (y <= CH[i][1]) { const [r0, y0] = CH[i - 1], [r1, y1] = CH[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1); } return 0.06; };
    const onChest = (x, y, out = 0.004) => { const r = chestR(y), z = Math.sqrt(Math.max(0, r * r - x * x)) * CZ; return [x, y, z + out]; };

    // ---- 胳膊：蓬蓬的毛衣袖子、罗纹袖口、银色骨架手 ----
    A.arms = [-1, 1].map((s) => {
      const sh = grp(chest, s * 0.158, 0.205, 0);
      // 袖子：肩膀一个圆、上臂和小臂差不多粗，弯胳膊时肘弯处一个圆补上（看不出一节一节的泡泡）
      mesh(G.ball, sleeveM, sh).scale.set(0.058, 0.06, 0.058);
      lathe(sy([[0.001, 0.02], [0.05, 0.012], [0.059, -0.02], [0.061, -0.09], [0.06, -0.15], [0.05, -0.175], [0.001, -0.18]], AS), sleeveM, sh, 1, 40);
      const el = grp(sh, 0, -0.155 * AS, 0);
      mesh(G.ball, sleeveM, el).scale.setScalar(0.0585);
      lathe(sy([[0.001, 0.02], [0.056, 0.012], [0.061, -0.02], [0.063, -0.08], [0.06, -0.112], [0.052, -0.124], [0.001, -0.126]], AS), sleeveM, el, 1, 40);
      ribbed(lathe([[0.046, -0.118 * AS], [0.05, -0.122 * AS], [0.05, -0.15 * AS], [0.046, -0.156 * AS], [0.04, -0.152 * AS]], ribM, el, 1, 48), 24, 0.05);
      const wr = grp(el, 0, -0.155 * AS, 0); wr.scale.setScalar(1.35);
      // 手：默认是皮肤色、肉乎乎的公仔手（手掌 + 四根两节的手指 + 大拇指，能握能指）；打开机器人骨架才是银色的骨头手
      let fingers, th;
      if (rig) {
        const bone = (len, r, parent, y0 = 0) => { const b = mesh(G.cap(r, len), silverM, parent, false); b.position.y = y0 - len / 2 - r; return b; };
        mesh(G.ball, silverM, wr, false).scale.set(0.022, 0.012, 0.016);
        fingers = [-1.5, -0.5, 0.5, 1.5].map((k, i) => {
          const len = [0.016, 0.019, 0.02, 0.018][s > 0 ? 3 - i : i];
          const mc = grp(wr, k * 0.0105, -0.008, 0); mc.rotation.z = k * 0.06;
          bone(0.03, 0.0035, mc);
          const f = grp(mc, 0, -0.042, 0);
          mesh(G.ball, silverM, f, false).scale.setScalar(0.0052);
          bone(len, 0.0033, f, -0.003);
          const f2 = grp(f, 0, -len - 0.01, 0); mesh(G.ball, silverM, f2, false).scale.setScalar(0.0045); bone(len * 0.75, 0.003, f2, -0.002);
          wire([[0, -0.004, 0.006], [0, -0.024, 0.0065], [0, -0.04, 0.006]], mc, 0.0016);
          f.userData.f2 = f2;
          return f;
        });
        th = grp(wr, -s * 0.024, -0.012, 0.008); th.rotation.z = -s * 0.7;
        bone(0.018, 0.0036, th); { const t2 = grp(th, 0, -0.03, 0); mesh(G.ball, silverM, t2, false).scale.setScalar(0.005); bone(0.014, 0.0033, t2, -0.002); }
      } else {
        const seg = (len, r, parent) => { const b = mesh(G.cap(r, len), skinM, parent); b.position.y = -len / 2 - r * 0.6; return b; };
        mesh(G.ball, skinM, wr).scale.set(0.021, 0.018, 0.017);   // 手腕
        const palm = mesh(G.ball, skinM, wr); palm.scale.set(0.03, 0.031, 0.0165); palm.position.set(0, -0.03, 0.001);
        fingers = [-1.5, -0.5, 0.5, 1.5].map((k, i) => {
          const len = [0.012, 0.0145, 0.015, 0.013][s > 0 ? 3 - i : i];
          const f = grp(wr, k * 0.0118, -0.05 + Math.abs(k) * 0.003, 0.001); f.rotation.z = k * 0.05;
          seg(len, 0.0069, f);
          const f2 = grp(f, 0, -len - 0.004, 0); seg(len * 0.8, 0.0064, f2);
          f.userData.f2 = f2;
          return f;
        });
        th = grp(wr, -s * 0.025, -0.022, 0.007); th.rotation.set(-0.35, 0, -s * 0.8);
        seg(0.013, 0.0076, th); { const t2 = grp(th, 0, -0.017, 0); seg(0.01, 0.007, t2); }
      }
      if (rig) {
        joint(sh, 0, 0.004, 0.058, 0.02); joint(el, 0, 0, 0.062, 0.018); joint(wr, 0, 0.018, 0.04, 0.014);
        wire(sy([[0, -0.018, 0.06], [0, -0.08, 0.066], [0, -0.14, 0.064]], AS), sh);
        wire(sy([[0, -0.018, 0.064], [0, -0.07, 0.068], [0, -0.13, 0.054]], AS), el);
      }
      return { s, sh, el, wr, fingers, th };
    });

    // ---- 骨架：银色脊椎、肋骨状的绿线、关节球 ----
    if (rig) {
      for (let y = 0.235, i = 0; y > -0.005; y -= 0.0215, i++) {
        const [x, yy, z] = onChest(0, y, 0.002);
        const v = mesh(G.cyl(0.02, 0.02, 0.011, 20), silverM, chest, false); v.scale.set(1.15, 1, 0.55); v.position.set(x, yy, z);
      }
      for (const y of [0.205, 0.105, 0.012]) joint(chest, ...onChest(0, y, 0.012), 0.02);
      joint(hips, 0, 0.0, 0.13, 0.02);
      // 锁骨：两边肩膀到胸口中间
      for (const sd of [-1, 1]) wire([onChest(sd * 0.13, 0.198), onChest(sd * 0.07, 0.205), onChest(sd * 0.02, 0.205)], chest);
      // 肋骨：几道往两边弯下去的线
      for (const y of [0.165, 0.135, 0.105]) for (const sd of [-1, 1]) wire([onChest(sd * 0.018, y), onChest(sd * 0.06, y - 0.004), onChest(sd * 0.1, y - 0.016), onChest(sd * 0.125, y - 0.032)], chest, 0.0022);
      // 腰到胯两边
      for (const sd of [-1, 1]) wire([[0, 0.0, 0.132], [sd * 0.04, -0.015, 0.128], [sd * 0.075, -0.035, 0.1]], hips);
    }

    // ---- 脖子（一小段银色脊椎）→ 头 ----
    const neck = grp(chest, 0, 0.27, 0);
    for (let i = 0; i < 3; i++) { const v = mesh(G.cyl(0.026, 0.026, 0.012, 20), i % 2 ? redM : silverM, neck, false); v.position.y = 0.008 + i * 0.014; v.scale.set(1, 1, 0.9); }
    lathe([[0.001, -0.01], [0.062, -0.01], [0.058, 0.03], [0.05, 0.055], [0.001, 0.062]], skinM, neck, 0.95, 32);
    const head = grp(neck, 0, 0.03, 0); head.scale.setScalar(HS); A.head = head;
    const HP = [[0.001, 0.0], [0.05, 0.006], [0.105, 0.032], [0.15, 0.08], [0.18, 0.135], [0.19, 0.19], [0.186, 0.24], [0.17, 0.285], [0.138, 0.325], [0.09, 0.352], [0.045, 0.362], [0.001, 0.364]];
    const headMesh = lathe(HP, skinM, head, 0.94, 96, 56);
    const headR = (y) => { for (let i = 1; i < HP.length; i++) if (y <= HP[i][1]) { const [r0, y0] = HP[i - 1], [r1, y1] = HP[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1); } return 0.001; };
    const onHead = (x, y, out = 0) => { const r = headR(y) + out, z = Math.sqrt(Math.max(0, r * r - x * x)) * 0.94; return new T.Vector3(x, y, z); };
    // 小鼻子
    { const n = mesh(G.ball, skinMat(new T.Color(P.skin).lerp(new T.Color(0xf2a08c), 0.2).getHex()), head, false); n.scale.set(0.0105, 0.009, 0.009); n.position.copy(onHead(0, 0.113, -0.004)); }
    // 耳朵（藏在头发边上）+ 小耳环
    for (const sd of [-1, 1]) {
      const e = mesh(G.ball, skinM, head); e.scale.set(0.018, 0.036, 0.028); e.position.set(sd * 0.183, 0.15, -0.012); e.rotation.y = sd * 0.35;
      const e2 = mesh(G.ball, std(new T.Color(P.skin).multiplyScalar(0.85).getHex(), { roughness: 0.6, metalness: 0 }), head, false); e2.scale.set(0.008, 0.022, 0.016); e2.position.set(sd * 0.195, 0.152, -0.006); e2.rotation.y = sd * 0.35;
      if (P.earrings) { const r = mesh(G.torus(0.009, 0.0022), silverM, head, false); r.position.set(sd * 0.19, 0.11, -0.004); r.rotation.y = Math.PI / 2; }
    }
    // 脸：一张透明的画布贴在脸的正面（眉毛、眼睛、腮红、鼻子的影子、嘴），每一帧画一次
    let face = null;
    { const S = opt.screenSize || 512, cv = typeof document !== "undefined" ? document.createElement("canvas") : null;
      if (cv) {
        cv.width = cv.height = S;
        const tex = new T.CanvasTexture(cv); tex.flipY = false; tex.anisotropy = 8; tex.encoding = T.sRGBEncoding; texOwn.push(tex);
        const g = headMesh.geometry.clone(); geosOwn.push(g);
        const pos = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (z < 0.02) uv.setXY(i, -1, -1); else uv.setXY(i, 0.5 + x / (2 * DOLL.FW), 0.5 - (y - DOLL.FY) / (2 * DOLL.FH)); }
        uv.needsUpdate = true;
        const fm = new T.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.58, metalness: 0, emissiveMap: tex, emissive: C(0xffffff).multiplyScalar(0.1), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        mats.push(fm);
        const fp = mesh(g, fm, head, false); fp.scale.copy(headMesh.scale); fp.renderOrder = 1;
        face = { ctx: cv.getContext("2d"), S, tex };
      } }
    if (P.glasses) {
      const gm = std(P.glassesColor, { metalness: 0.5, roughness: 0.3 });
      for (const sd of [-1, 1]) { const l = mesh(G.torus(0.041, 0.0034), gm, head, false); l.scale.set(1, 0.8, 1); l.position.copy(onHead(sd * 0.074, 0.153, 0.016)); l.lookAt(l.position.clone().add(new T.Vector3(sd * 0.3, 0, 1))); }
      const br = mesh(G.cap(0.0028, 0.03), gm, head, false); br.rotation.z = Math.PI / 2; br.position.copy(onHead(0, 0.16, 0.018));
    }

    // ---- 头发：一顶贴着头的发壳 + 刘海、两边的发丝 + 马尾 / 丸子 ----
    const hairOn = P.hairStyle !== "none";
    const HC = new T.Vector3(0, 0.19, -0.004), HRr = 0.198;
    const sph = (az, pol, r = HRr) => [HC.x + r * Math.sin(pol) * Math.sin(az), HC.y + r * Math.cos(pol), HC.z + r * Math.sin(pol) * Math.cos(az) * 0.95];
    if (hairOn) {
      const long = P.hairStyle === "long" || P.hairStyle === "flare", bob = P.hairStyle === "bob" || P.hairStyle === "curly", short = P.hairStyle === "short";
      const g = new T.SphereGeometry(1, 72, 44); geosOwn.push(g);
      const pos = g.attributes.position;
      const tied = P.hairStyle === "ponytail" || P.hairStyle === "bun", thF = P.bangs === "none" ? 0.95 : 0.62, thS = short ? 1.5 : 1.62, thB = short ? 2.05 : bob || long ? 2.35 : tied ? 2.5 : 2.2;
      const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), th = Math.acos(clamp(y, -1, 1)), az = Math.abs(Math.atan2(x, z)), t = az / Math.PI;
        const lim = t < 0.5 ? thF + (thS - thF) * sm(t / 0.5) : thS + (thB - thS) * sm((t - 0.5) / (tied ? 0.25 : 0.5));   // 扎起来的头发：后脑勺整个盖住
        const t2 = Math.min(th, lim), h = Math.hypot(x, z) || 1, r = Math.sin(t2);
        pos.setXYZ(i, (x / h) * r, Math.cos(t2), (z / h) * r);
      }
      g.computeVertexNormals();
      const cap = mesh(g, hairM, head); cap.scale.set(HRr * 1.06, HRr * 1.03, HRr * 1.0); cap.position.copy(HC);   // 比头大一圈，头发看着有厚度
      // 刘海：几缕又宽又厚的发片从头顶分缝的地方往前、再往下垂到眉毛上面，互相叠着，发梢收尖（像手办上雕出来的头发，有体积、不是一排尖刺）
      if (P.bangs !== "none") {
        const side = P.bangs === "side";
        const L = P.bangs === "full" ? [[-0.165, 0.258, 0.068], [-0.1, 0.245, 0.078], [-0.035, 0.24, 0.08], [0.03, 0.24, 0.08], [0.095, 0.245, 0.078], [0.16, 0.258, 0.068]]
          : P.bangs === "middle" ? [[-0.175, 0.232, 0.07], [-0.115, 0.252, 0.08], [-0.055, 0.282, 0.074], [0.055, 0.282, 0.074], [0.115, 0.252, 0.08], [0.175, 0.232, 0.07]]
          : [[-0.175, 0.232, 0.072], [-0.105, 0.262, 0.078], [-0.012, 0.258, 0.076], [0.058, 0.24, 0.088], [0.125, 0.228, 0.092], [0.188, 0.238, 0.08]];
        const partX = side ? -0.05 : 0, partAz = side ? -0.28 : 0;
        // 发根藏在发壳里面（头顶是光滑的一整块），一缕高一缕低地叠着（缕和缕之间有阴影），发梢离额头一点点、尖尖的
        L.forEach(([tx, ty, w], i) => {
          const up = i % 2 ? 0.012 : 0, az0 = partAz + (tx - partX) * 1.7, top = sph(partAz * 0.6 + (tx - partX) * 0.6, 0.3, HRr + 0.002), m1 = sph(partAz + (az0 - partAz) * 0.6, 0.58, HRr + 0.03 + up);
          const m2 = onHead(partX + (tx - partX) * 0.82, 0.31, 0.034 + up), tip = onHead(tx, ty, 0.02 + up * 0.6);
          tube([top, m1, [m2.x, m2.y, m2.z], [tip.x + tx * 0.05, tip.y - 0.006, tip.z]], w * 0.8, w * 0.84, 0.55, hairM, head, new T.Vector3(0, 0.17, -0.02), 16, 52, 0.1, 0.46);
        });
      }
      // 两边垂下来的发丝（耳朵前面一缕、后面一缕），长发更长
      const sideLen = short ? 0.0 : long ? -0.2 : bob ? -0.02 : -0.06;
      if (!short) for (const sd of [-1, 1]) {
        tube([sph(sd * 1.2, 1.0, HRr + 0.016), sph(sd * 1.32, 1.4, HRr + 0.02), [sd * 0.202, 0.11, 0.055], [sd * 0.208, 0.03, 0.06], [sd * 0.19, sideLen, 0.075]], 0.04, 0.044, 0.62, hairM, head, new T.Vector3(0, 0.1, -0.02), 12, 40, 0.2, 0.35);
        tube([sph(sd * 1.6, 1.2, HRr + 0.012), sph(sd * 1.75, 1.6, HRr + 0.016), [sd * 0.22, 0.08, -0.04], [sd * 0.224, sideLen + 0.02, -0.03]], 0.042, 0.046, 0.65, hairM, head, new T.Vector3(0, 0.1, -0.06), 12, 40, 0.2, 0.35);
      }
      if (bob || long) for (let k = 0; k < 7; k++) { const az = Math.PI * (0.62 + k * 0.127) * (k % 2 ? 1 : -1) * 0 + Math.PI * (0.55 + k * 0.15); tube([sph(az, 1.4, HRr + 0.004), sph(az, 1.9, HRr + 0.016), [Math.sin(az) * 0.21, long ? -0.12 : 0.0, Math.cos(az) * 0.2], [Math.sin(az) * 0.2, long ? -0.24 : -0.04, Math.cos(az) * 0.19]], 0.05, 0.045, 0.5, hairM, head, new T.Vector3(0, 0.05, 0), 12, 36, 0.2); }
      if (P.hairStyle === "ponytail") {
        // 高马尾：头顶偏后扎一个红色发圈，马尾往后翘一下再垂到背上
        const tp = new T.Vector3(...sph(Math.PI, 0.5, HRr + 0.01));
        const tie = mesh(G.torus(0.032, 0.012), redM, head, false); tie.position.copy(tp); tie.lookAt(tp.clone().add(new T.Vector3(0, 0.8, -1))); A.hairTie = tie;
        const base = mesh(G.ball, hairM, head); base.scale.set(0.045, 0.04, 0.045); base.position.copy(tp).add(new T.Vector3(0, 0.012, -0.012));
        const P0 = [[0, tp.y + 0.02, tp.z - 0.02], [0, tp.y + 0.035, tp.z - 0.065], [0.006, tp.y - 0.035, tp.z - 0.13], [0.012, 0.13, -0.24], [0.004, -0.04, -0.24], [0.022, -0.2, -0.2]];
        tube(P0, 0.05, 0.07, 0.8, hairM, head, null, 16, 60, 0.1);
        tube(P0.map(([x, y, z], i) => [x + 0.025 * Math.min(1, i / 2), y - 0.01, z + 0.01]), 0.03, 0.04, 0.8, hairM, head, null, 12, 50, 0.1);
        tube(P0.map(([x, y, z], i) => [x - 0.022 * Math.min(1, i / 2), y - 0.02 * i, z + 0.012]).slice(0, 5), 0.028, 0.034, 0.8, hairM, head, null, 12, 44, 0.1);
      }
      if (P.hairStyle === "bun") { const tp = new T.Vector3(...sph(Math.PI * 0.95, 0.35, HRr + 0.03)); const bn = mesh(G.ball, hairM, head); bn.scale.setScalar(0.07); bn.position.copy(tp); const tie = mesh(G.torus(0.045, 0.01), redM, head, false); tie.position.copy(tp).add(new T.Vector3(0, -0.05, 0.01)); tie.rotation.x = Math.PI / 2 - 0.3; }
      // 头上的骨架：头顶、两边太阳穴的红球，绿线连起来
      if (rig) {
        joint(head, ...sph(0, 0.12, HRr + 0.03), 0.02);
        for (const sd of [-1, 1]) { joint(head, ...sph(sd * 1.42, 0.95, HRr + 0.02), 0.017); const pts = []; for (let k = 0; k <= 8; k++) { const u = k / 8; pts.push(sph(sd * 1.42 * Math.min(1, u * 1.4), 0.12 + (0.95 - 0.12) * u, HRr + 0.026 - 0.006 * u)); } wire(pts, head, 0.0022); }
        const pb = []; for (let k = 0; k <= 8; k++) pb.push(sph(Math.PI, 0.12 + 0.36 * (k / 8), HRr + 0.026)); wire(pb, head, 0.0022);
      }
    } else if (rig) joint(head, 0, 0.375, 0, 0.02);

    const NECK_Y = HIP + 0.08 + 0.27 + 0.03;
    A.height = NECK_Y + (0.364 + (hairOn ? 0.03 : 0)) * HS;
    A.faceY = NECK_Y + 0.19 * HS; A.faceSpan = 0.52 * HS; A.srgb = !managed; A.fullTall = true;

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
          shX = lerp(shX, -1.3, W.think); shZ = lerp(shZ, -0.4, W.think); elX = lerp(elX, -2.1, W.think); elZ = lerp(elZ, 0.5, W.think); wrY = lerp(wrY, 0.5, W.think); wrZ = lerp(wrZ, 0.3, W.think); curl = lerp(curl, 1.1, W.think);
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
    function loop(now) { if (dead || manual) return; raf = requestAnimationFrame(loop); const dt = last ? (now - last) / 1000 : 0.016; last = now; A.update(dt); ren.render(scene, cam); }
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

  root.LaoAvatar = { sanitize, build, create, envFor, loadAi, drawAiFace: aiFaceDraw, drawScreen, drawDollFace: dollFaceDraw, defaultLines, cleanLines, STYLES, MOODS, FACE, SCREEN };
})(typeof window !== "undefined" ? window : globalThis);
