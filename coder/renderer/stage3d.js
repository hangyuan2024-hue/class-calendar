// 捞捞编程 · 3D 舞台：把数组画成一排「数据小兵」，捞小智飞在上面当讲解员
//   每个数是一个小机器人，越大越高，肚子上的屏幕显示这个数；
//   比较：捞小智飞过去，用扫描光照着这两个，它俩互相看一眼；
//   交换：大的蹲一下、跳起来从小的头顶翻过去，小的缩着身子从下面滑过去，落地压一下、扬起一点灰；
//   改值：身体长高 / 变矮（带弹性），屏幕上的数字跟着变；排好：变成绿色、跳一下；全部完成：挨个蹦起来，捞小智转圈、撒彩带。
// 用的是 three.js（renderer/vendor/three/three.min.js），没有 WebGL 时 create() 返回 null，界面退回平面柱子。
"use strict";
(function (root) {
  const T = root.THREE;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const E = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    lin: (t) => t,
  };
  const COL = {
    body: 0x4f7cf0, cmp: 0x22d3ee, swap: 0xf472b6, sorted: 0x84cc16, pivot: 0xf59e0b, found: 0x84cc16, mark: 0x8b5cf6,
    eye: 0x7dd3fc, eyeCmp: 0xa5f3fc, eyeSwap: 0xfbcfe8, eyeSorted: 0xd9f99d,
  };
  const MARK_COL = { i: "#22d3ee", j: "#f472b6", k: "#a78bfa", lo: "#fbbf24", hi: "#fbbf24", mid: "#84cc16", l: "#fbbf24", r: "#fbbf24", left: "#fbbf24", right: "#fbbf24", low: "#fbbf24", high: "#fbbf24", min: "#f59e0b", max: "#f59e0b", p: "#38bdf8", q: "#38bdf8" };

  function webgl() { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } }

  // ---------- 皮肤：数据小兵长什么样 ----------
  // 皮肤只是一份数据（JSON），不带代码：model 选「robot」（原来的小机器人）或「person」（老师的分身：公仔 / 机器人屏幕脸 / 照片脸），再配颜色、发型、眼镜……
  // 皮肤商店里的皮肤放在官网 code-skins/ 下，格式见 code-skins/README.md；这里把它洗一遍，不认识的字段一律丢掉。
  const ROBOT = { id: "robot", name: "数据小兵", author: "捞捞", desc: "原版的小机器人", version: "1.0.0", model: "robot", colors: {} };
  const HAIR_STYLES = ["none", "short", "bob", "long", "flare", "ponytail", "bun", "curly"];
  // 颜色写成 "#rrggbb"；洗过一遍的皮肤里是数字，再洗一遍也认（所以 sanitizeSkin 洗几遍都一样）
  const hexOf = (s, d) => (typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s) ? parseInt(s.slice(1), 16) : Number.isInteger(s) && s >= 0 && s <= 0xffffff ? s : d);
  function sanitizeSkin(s) {
    if (!s || typeof s !== "object") return ROBOT;
    const str = (x, n) => String(x == null ? "" : x).replace(/[<>]/g, "").slice(0, n);
    const colors = {};
    for (const k of ["body", "cmp", "swap", "sorted", "pivot", "mark"]) { const v = hexOf(s.colors && s.colors[k]); if (v != null) colors[k] = v; }
    const out = { id: str(s.id, 40).replace(/[^\w-]/g, "") || "custom", name: str(s.name, 24) || "自定义皮肤", author: str(s.author, 24), desc: str(s.desc, 120), version: str(s.version, 16), model: s.model === "person" ? "person" : "robot", colors };
    if (out.model === "person") {
      const p = s.person && typeof s.person === "object" ? s.person : {};
      out.person = {
        skin: hexOf(p.skin, 0xf3c2a2), hair: hexOf(p.hair, 0x2a1b14), hairStyle: HAIR_STYLES.includes(p.hairStyle) ? p.hairStyle : "bob",
        bangs: ["side", "none", "middle"].includes(p.bangs) ? p.bangs : "full", eyeStyle: p.eyeStyle === "smile" ? "smile" : "open",
        glasses: !!p.glasses, glassesColor: hexOf(p.glassesColor, 0x3b3b46), top: hexOf(p.top, 0x6d8cf0), collar: hexOf(p.collar, null),
        shoes: hexOf(p.shoes, 0x3a3049), eye: hexOf(p.eye, 0x2b1d18), blush: p.blush !== false, earrings: !!p.earrings, accent: hexOf(p.accent, 0x22d3ee),
        bottom: p.bottom === "skirt" ? "skirt" : "pants", pants: hexOf(p.pants, 0x3b4a6b), antenna: !!p.antenna, earpods: p.earpods !== false,
        // 照片做的脸（捞捞PPT助手导出的皮肤里带着）：只认 data:image 的 jpg / png，不超过 60KB
        faceImage: typeof p.faceImage === "string" && p.faceImage.length < 60000 && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(p.faceImage) ? p.faceImage : undefined, photoFace: p.photoFace !== false,
        tech: p.tech !== false, faceStyle: ["doll", "screen", "cyber", "photo", "soft", "cartoon"].includes(p.faceStyle) ? p.faceStyle : "doll", rig: p.rig === true, grid: p.grid !== false, body: p.body === "tall" ? "tall" : "chibi", shell: hexOf(p.shell, 0xeef1f6), stage: false,
        // 公仔脸 / 屏幕脸的线条（捞捞PPT助手从照片里量出来的五官形状）：交给 LaoAvatar 洗（没加载就不要）
        faceLines: root.LaoAvatar && root.LaoAvatar.cleanLines ? root.LaoAvatar.cleanLines(p.faceLines) : undefined,
      };
    }
    return out;
  }
  let SKIN = ROBOT;
  const LIVE = new Set();   // 跟着全局皮肤走的舞台

  // ---------- 小工具：文字贴图 ----------
  function textTex(draw, w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); draw(g, w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; t.needsUpdate = true;
    t.__canvas = c; t.__draw = draw;
    return t;
  }
  function redraw(t, draw) { const c = t.__canvas, g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); draw(g, c.width, c.height); t.needsUpdate = true; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const fmt = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));
  function screenDraw(v, state) {
    return (g, w, h) => {
      rr(g, 3, 3, w - 6, h - 6, 16); g.fillStyle = "#07101f"; g.fill();
      g.lineWidth = 4; g.strokeStyle = state === "swap" ? "#f9a8d4" : state === "cmp" ? "#67e8f9" : state === "sorted" ? "#bef264" : state === "pivot" ? "#fde68a" : "#3b82f6"; g.stroke();
      const s = fmt(v);
      g.font = `800 ${s.length > 4 ? 30 : s.length > 2 ? 42 : 56}px Consolas, "Cascadia Mono", monospace`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = g.strokeStyle; g.shadowBlur = 14; g.fillStyle = "#ffffff"; g.fillText(s, w / 2, h / 2 + 3);
    };
  }
  let GLOW = null;
  function glowTex() {
    if (GLOW) return GLOW;
    GLOW = textTex((g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); }, 64, 64);
    return GLOW;
  }
  function labelSprite(text, color, scale) {
    const tex = textTex((g, w, h) => {
      rr(g, 4, 4, w - 8, h - 8, (h - 8) / 2); g.fillStyle = "rgba(6,11,24,.85)"; g.fill();
      g.lineWidth = 4; g.strokeStyle = color; g.stroke();
      g.font = "800 40px Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2);
    }, 128, 64);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(0.6 * scale, 0.3 * scale, 1);
    sp.__tex = tex;
    return sp;
  }

  // =====================================================================
  function create(el, opt = {}) {
    if (!T || !webgl()) return null;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;   // 颜色按 sRGB 算（不然整体发白）
    const mini = !!opt.mini;
    const SFX = opt.sfx === false ? null : root.LaoSfx || null;
    const wrap = document.createElement("div"); wrap.className = "st3" + (mini ? " mini" : "");
    wrap.innerHTML = `<div class="st3-bubble" hidden><span></span></div>`;
    el.appendChild(wrap);
    const bubble = wrap.querySelector(".st3-bubble");
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch (e) { wrap.remove(); return null; }
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    wrap.prepend(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(mini ? 34 : 32, 1, 0.1, 200);

    // 灯光：天光 + 主光（有影子）+ 背后的青色轮廓光 + 捞小智的扫描聚光
    scene.add(new T.HemisphereLight(0xbfdcff, 0x1b1236, 0.85));
    const key = new T.DirectionalLight(0xffffff, 1.35); key.position.set(-4, 9, 7); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 1; key.shadow.camera.far = 40; key.shadow.bias = -0.0008; key.shadow.radius = 4;
    scene.add(key); scene.add(key.target);
    const rim = new T.PointLight(0x22d3ee, 1.4, 30); rim.position.set(0, 4, -5); scene.add(rim);
    const rim2 = new T.PointLight(0xa855f7, 0.9, 30); rim2.position.set(6, 2, -3); scene.add(rim2);
    const spot = new T.SpotLight(0x67e8f9, 0, 18, 0.32, 0.65, 1.2); spot.castShadow = false; scene.add(spot); scene.add(spot.target);

    // 悬浮平台 + 地面网格 + 影子
    const world = new T.Group(); scene.add(world);
    const platMat = new T.MeshStandardMaterial({ color: 0x111a33, roughness: 0.45, metalness: 0.6 });
    const plat = new T.Mesh(new T.BoxGeometry(1, 0.22, 2.4), platMat); plat.position.y = -0.11; plat.receiveShadow = true; world.add(plat);
    const edgeMat = new T.MeshBasicMaterial({ color: 0x22d3ee });
    const edge = new T.Mesh(new T.BoxGeometry(1, 0.035, 0.035), edgeMat); edge.position.set(0, -0.02, 1.2); world.add(edge);
    const edge2 = new T.Mesh(new T.BoxGeometry(1, 0.025, 0.025), new T.MeshBasicMaterial({ color: 0x8b5cf6 })); edge2.position.set(0, -0.22, 1.21); world.add(edge2);
    const shadowPlane = new T.Mesh(new T.PlaneGeometry(1, 2.4), new T.ShadowMaterial({ opacity: 0.35 })); shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.002; shadowPlane.receiveShadow = true; world.add(shadowPlane);
    const grid = new T.GridHelper(1, 1, 0x2b4a8a, 0x1a2b55); grid.material.transparent = true; grid.material.opacity = 0.35; grid.position.y = 0.003; world.add(grid);
    const underGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0x2563eb, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false })); underGlow.position.set(0, -0.6, 0.4); world.add(underGlow);
    // 星星（背景有一点景深）
    const starG = new T.BufferGeometry(); const sp = [];
    for (let i = 0; i < 260; i++) sp.push((Math.random() - 0.5) * 60, Math.random() * 18 - 2, -12 - Math.random() * 25);
    starG.setAttribute("position", new T.Float32BufferAttribute(sp, 3));
    const stars = new T.Points(starG, new T.PointsMaterial({ color: 0x9cc7ff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false })); scene.add(stars);

    // ---------- 数据小兵 ----------
    const R0 = 0.3;
    const geo = {
      cyl: new T.CylinderGeometry(1, 1, 1, 28, 1, true),
      hemiTop: new T.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      hemiBot: new T.SphereGeometry(1, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      visor: new T.SphereGeometry(1.015, 28, 12, Math.PI / 2 - Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.12, Math.PI * 0.3),
      eye: new T.CapsuleGeometry(0.035, 0.05, 4, 10),
      foot: new T.SphereGeometry(0.11, 14, 10),
      arm: new T.CapsuleGeometry(0.045, 0.16, 4, 8),
      screen: new T.PlaneGeometry(1, 0.5),
      ring: new T.RingGeometry(0.34, 0.42, 40),
      halo: new T.TorusGeometry(0.22, 0.03, 8, 32),
    };
    const visorMat = new T.MeshStandardMaterial({ color: 0x050b18, roughness: 0.08, metalness: 0.9 });
    const footMat = new T.MeshStandardMaterial({ color: 0x1e2a4a, roughness: 0.5, metalness: 0.4 });
    // Q 版小人用的形状：大脑袋（头发是一个球，脸是往前探出来一点的另一个球，两个球的交线就是发际线）
    const HR = 0.4;
    const AV_S = 0.44, AV_H = 1.87;   // 机器人分身：缩放、原来的身高
    Object.assign(geo, {
      ball: new T.SphereGeometry(1, 48, 32),
      hairShell: (w, t0, t1) => new T.SphereGeometry(1, 48, 24, Math.PI / 2 + w / 2, Math.PI * 2 - w, t0, t1 - t0),
      collar: new T.TorusGeometry(0.2, 0.035, 8, 28),
      smile: new T.TorusGeometry(0.045, 0.011, 6, 18, Math.PI),
      lens: new T.TorusGeometry(0.068, 0.011, 8, 28),
      bridge: new T.CylinderGeometry(0.008, 0.008, 0.07, 6),
      pony: new T.CapsuleGeometry(0.085, 0.2, 6, 12),
    });
    const hairGeoCache = {};
    const hairGeo = (k, w, t0, t1) => hairGeoCache[k] || (hairGeoCache[k] = geo.hairShell(w, t0, t1));

    let skin = opt.skin ? sanitizeSkin(opt.skin) : SKIN;
    let PAL = palette();
    function palette() { const P = skin.person; return { ...COL, ...skin.colors, body: skin.colors.body != null ? skin.colors.body : P ? P.top : COL.body }; }
    // 小人的头比机器人高出来多少（摆镜头、捞小智飞多高要用）
    const headExtra = () => (skin.person ? (root.LaoAvatar ? R0 * 0.2 + AV_H * AV_S + 0.1 - R0 : HR * 2.15 + 0.2 - R0) : 0);

    let chars = [], n = 0, lo = 0, hi = 1, spacing = 1, scaleK = 1, hMin = 0.25, hMax = 2.2;
    const heightOf = (v) => (hi > lo ? lerp(hMin, hMax, (v - lo) / (hi - lo)) : (hMin + hMax) / 2);

    // 在脸（球心 fc、半径 fr）表面上摆一个小东西：dx、dy 是往右、往上偏多少（-1..1）
    function onFace(m, fc, fr, dx, dy, out = 1) {
      const dz = Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy));
      m.position.set(fc.x + dx * fr * out, fc.y + dy * fr * out, fc.z + dz * fr * out);
      m.lookAt(fc.x + dx * 3, fc.y + dy * 3, fc.z + dz * 3);
      return m;
    }
    function personHead(c, top, P) {
      const std = (col, o = {}) => { const m = new T.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.02, transparent: true, ...o }); c.extra.push(m); return m; };
      const skinM = std(P.skin, { roughness: 0.62 }), hairM = std(P.hair, { roughness: 0.45 });
      const mat = c.mat;
      // 肩膀（衣服）+ 白领子
      const sh = new T.Mesh(geo.hemiTop, mat); sh.scale.set(R0, R0 * 0.55, R0); sh.castShadow = true; top.add(sh);
      const col = new T.Mesh(geo.collar, std(P.collar)); col.rotation.x = Math.PI / 2; col.position.y = R0 * 0.5; col.scale.set(1, 1, 0.8); top.add(col);
      const hy = R0 * 0.5 + HR * 0.95;                         // 脑袋中心
      const fc = new T.Vector3(0, hy - 0.015, 0.045), fr = HR; // 脸
      const face = new T.Mesh(geo.ball, skinM); face.scale.setScalar(fr); face.position.copy(fc); face.castShadow = true; top.add(face);
      // 头发：一个比脸大一点、往后上方挪一点的球；刘海样式决定它往前盖多少
      const hc = new T.Vector3(0, hy + 0.035, P.bangs === "none" ? -0.07 : -0.03);
      const hairR = HR * 1.04;
      const hair = new T.Mesh(geo.ball, hairM); hair.scale.setScalar(hairR); hair.position.copy(hc); hair.castShadow = true; top.add(hair);
      if (P.bangs === "side") { const sb = new T.Mesh(geo.ball, hairM); sb.scale.set(HR * 0.62, HR * 0.34, HR * 0.5); sb.position.set(-0.13, hy + 0.17, 0.2); sb.rotation.z = 0.5; top.add(sb); }
      const shell = (k, w, t0, t1, sy = 1, r = hairR * 1.01) => { const m = new T.Mesh(hairGeo(k, w, t0, t1), hairM); m.material.side = T.DoubleSide; m.scale.set(r, r * sy, r); m.position.copy(hc); m.castShadow = true; top.add(m); return m; };
      // 波波头 / 长发：外面再罩一层「壳」，头顶一整片，往下在脸前面开个口子
      if (P.hairStyle === "bob" || P.hairStyle === "long") {
        const long = P.hairStyle === "long", R = hairR * 1.07, cut = Math.PI * 0.32;
        shell("cap", 0, 0, cut, 1, R);
        const sd = shell(long ? "long" : "bob", long ? 1.25 : 1.3, cut, Math.PI * (long ? 0.93 : 0.74), 1, R);
        // 下半截往下拉长一点（不动上沿，接得上头顶那片）
        const pos = sd.geometry.attributes.position;
        if (!sd.geometry.__stretched) { for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), y0 = Math.cos(cut); if (y < y0) pos.setY(i, y0 + (y - y0) * (long ? 1.5 : 1.12)); } pos.needsUpdate = true; sd.geometry.computeVertexNormals(); sd.geometry.__stretched = true; }
      }
      if (P.hairStyle === "ponytail") { const pt = new T.Mesh(geo.pony, hairM); pt.position.set(0, hy - 0.05, -hairR - 0.05); pt.rotation.x = 0.35; pt.castShadow = true; top.add(pt); const tie = new T.Mesh(geo.ball, std(P.accent)); tie.scale.setScalar(0.05); tie.position.set(0, hy + 0.08, -hairR + 0.01); top.add(tie); }
      if (P.hairStyle === "bun") { const bn = new T.Mesh(geo.ball, hairM); bn.scale.setScalar(0.14); bn.position.set(0, hy + hairR + 0.06, -0.06); bn.castShadow = true; top.add(bn); }
      if (P.hairStyle === "curly") for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const cu = new T.Mesh(geo.ball, hairM); cu.scale.setScalar(0.1); cu.position.set(Math.cos(a) * hairR * 0.92, hy + 0.05 + Math.sin(i * 1.7) * 0.06, -0.04 + Math.sin(a) * hairR * 0.92 * (Math.sin(a) > 0.3 ? 0.4 : 1)); top.add(cu); }
      // 耳朵、耳环
      for (const s of [-1, 1]) {
        const ear = new T.Mesh(geo.ball, skinM); ear.scale.set(0.045, 0.06, 0.035); ear.position.set(s * fr * 0.98, hy - 0.03, fc.z - 0.02); top.add(ear);
        if (P.earrings) { const er = new T.Mesh(geo.ball, std(P.accent, { metalness: 0.5, roughness: 0.3 })); er.scale.setScalar(0.022); er.position.set(s * fr * 0.99, hy - 0.1, fc.z - 0.01); top.add(er); }
      }
      // 眼睛（会眨）+ 高光
      const eyeMat = new T.MeshBasicMaterial({ color: P.eye, transparent: true }); c.eyeMat = eyeMat;
      const hlM = std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1 });
      c.eyes = [-1, 1].map((s) => {
        const e = new T.Mesh(geo.eye, eyeMat); e.scale.set(1.25, 1.1, 0.6); onFace(e, fc, fr, s * 0.33, -0.02, 0.99); e.rotation.z = 0; top.add(e);
        const hl = new T.Mesh(geo.ball, hlM); hl.scale.setScalar(0.014); onFace(hl, fc, fr, s * 0.33 + 0.04, 0.05, 1.035); top.add(hl);
        return e;
      });
      if (P.blush) { const bm = std(0xff9db0, { opacity: 0.55, roughness: 0.9, depthWrite: false }); bm.__alpha = 0.55; for (const s of [-1, 1]) { const b = new T.Mesh(geo.ball, bm); b.scale.set(0.05, 0.028, 0.012); onFace(b, fc, fr, s * 0.48, -0.22, 0.995); top.add(b); } }
      const mouth = new T.Mesh(geo.smile, std(0xb4505a, { roughness: 0.6 })); onFace(mouth, fc, fr, 0, -0.3, 1.0); mouth.rotateZ(Math.PI); top.add(mouth); c.mouth = mouth;
      const mo = new T.Mesh(geo.ball, std(0x7a2232, { roughness: 0.7 })); onFace(mo, fc, fr, 0, -0.33, 0.985); mo.scale.set(0.035, 0.002, 0.02); top.add(mo); c.mouthO = mo;
      if (P.glasses) {
        const gm = std(P.glassesColor, { metalness: 0.4, roughness: 0.35 });
        for (const s of [-1, 1]) { const l = new T.Mesh(geo.lens, gm); onFace(l, fc, fr, s * 0.33, -0.02, 1.06); top.add(l); }
        const br = new T.Mesh(geo.bridge, gm); onFace(br, fc, fr, 0, 0.0, 1.07); br.rotateZ(Math.PI / 2); top.add(br);
      }
      c.headTop = hy + hairR + (P.hairStyle === "bun" ? 0.2 : 0.02);
    }

    // 老师的分身（有身子）：柱子的高矮还是表示数的大小，形象站在柱子顶上的小平台上（形象见 avatar3d.js）
    function personBody(c, top, P) {
      const A = root.LaoAvatar.build(P, { face: P.faceImage }); c.av = A;
      const plat = new T.Mesh(geo.hemiTop, c.mat); plat.scale.set(R0 * 1.05, R0 * 0.22, R0 * 1.05); plat.castShadow = true; top.add(plat);
      const k = A.fullTall ? 0.56 : AV_S;   // 公仔矮、头大，放大一点（宽度和原来的差不多）
      A.root.scale.setScalar(k); A.root.position.y = R0 * 0.2; A.halo.visible = false; top.add(A.root);
      c.eyes = []; c.eyeMat = new T.MeshBasicMaterial();
      c.headTop = R0 * 0.2 + A.height * k;
    }

    function makeChar(v, idx) {
      const P = skin.person;
      const c = { v, h: heightOf(v), hT: heightOf(v), x: 0, state: "", color: new T.Color(PAL.body), colorT: new T.Color(PAL.body), eyeC: new T.Color(P ? P.eye : COL.eye), eyeT: new T.Color(P ? P.eye : COL.eye), dim: 0, dimT: 0, look: 0, lookT: 0, blink: Math.random() * 4, squash: 1, jump: 0, spin: 0, arms: 0, bob: Math.random() * 6, extra: [] };
      const g = new T.Group(); c.g = g;
      const body = new T.Group(); g.add(body); c.body = body;
      const mat = new T.MeshStandardMaterial({ color: PAL.body, roughness: P ? 0.6 : 0.32, metalness: P ? 0.02 : 0.18, emissive: 0x000000, transparent: true, opacity: 1 }); c.mat = mat;
      const bot = new T.Mesh(geo.hemiBot, mat); bot.scale.setScalar(R0); bot.castShadow = true; body.add(bot); c.bot = bot;
      const cyl = new T.Mesh(geo.cyl, mat); cyl.scale.set(R0, 1, R0); cyl.castShadow = true; body.add(cyl); c.cyl = cyl;
      const top = new T.Group(); body.add(top); c.top = top;
      if (P && root.LaoAvatar) personBody(c, top, P);
      else if (P) personHead(c, top, P);
      else {
        const head = new T.Mesh(geo.hemiTop, mat); head.scale.setScalar(R0); head.castShadow = true; top.add(head);
        const visor = new T.Mesh(geo.visor, visorMat); visor.scale.setScalar(R0); top.add(visor);
        const eyeMat = new T.MeshBasicMaterial({ color: COL.eye }); c.eyeMat = eyeMat;
        const e1 = new T.Mesh(geo.eye, eyeMat), e2 = new T.Mesh(geo.eye, eyeMat);
        e1.position.set(-0.09, R0 * 0.42, R0 * 0.93); e2.position.set(0.09, R0 * 0.42, R0 * 0.93);
        top.add(e1, e2); c.eyes = [e1, e2];
        c.headTop = R0;
      }
      const halo = new T.Mesh(geo.halo, new T.MeshBasicMaterial({ color: PAL.pivot, transparent: true, opacity: 0, depthWrite: false })); halo.visible = false; halo.rotation.x = Math.PI / 2; halo.position.y = c.headTop + 0.22; top.add(halo); c.halo = halo;
      const scrTex = textTex(screenDraw(v, ""), 160, 80); c.scrTex = scrTex;
      const scr = new T.Mesh(geo.screen, new T.MeshBasicMaterial({ map: scrTex, transparent: true })); scr.scale.set(0.44, 0.44, 1); scr.position.z = R0 + 0.012; body.add(scr); c.scr = scr;
      const a1 = new T.Mesh(geo.arm, mat), a2 = new T.Mesh(geo.arm, mat);
      a1.castShadow = a2.castShadow = true; body.add(a1, a2); c.armsM = [a1, a2];
      if (c.av) for (const a of c.armsM) a.visible = false;
      if (P && !c.av) { const hm = c.extra[0]; for (const a of c.armsM) { const hand = new T.Mesh(geo.ball, hm); hand.scale.setScalar(0.055); hand.position.y = -0.13; a.add(hand); } }
      const fMat = P ? (() => { const m = new T.MeshStandardMaterial({ color: P.shoes, roughness: 0.5, metalness: 0.1, transparent: true }); c.extra.push(m); return m; })() : footMat;
      const f1 = new T.Mesh(geo.foot, fMat), f2 = new T.Mesh(geo.foot, fMat);
      f1.scale.set(1, 0.55, 1.3); f2.scale.set(1, 0.55, 1.3); f1.position.set(-0.12, 0.05, 0.08); f2.position.set(0.12, 0.05, 0.08); g.add(f1, f2);
      if (c.av) f1.visible = f2.visible = false;
      // 地上的光圈（i、j 指着的时候亮）
      const ring = new T.Mesh(geo.ring, new T.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; c.ring = ring; world.add(ring);
      const ix = labelSprite(String(idx), "#5b6f99", 0.9); ix.position.set(0, 0.03, 0.95); c.ix = ix; world.add(ix);
      c.tag = null; c.tagText = "";
      world.add(g);
      layoutChar(c);
      return c;
    }
    function layoutChar(c) {
      const h = Math.max(0.05, c.h), r = R0;
      c.bot.position.y = r + 0.04;
      c.cyl.scale.y = h; c.cyl.position.y = r + 0.04 + h / 2;
      c.top.position.y = r + 0.04 + h;
      c.scr.position.y = r + 0.04 + Math.max(h * 0.5, 0.0) + (h < 0.5 ? 0.08 : 0);
      const ay = r + 0.04 + Math.min(h * 0.42, 0.55);
      c.armsM[0].position.set(-r - 0.03, ay, 0.03); c.armsM[1].position.set(r + 0.03, ay, 0.03);
      c.armsM[0].rotation.z = -0.18 - c.arms * 2.4; c.armsM[1].rotation.z = 0.18 + c.arms * 2.4;
    }
    function disposeChar(c) {
      world.remove(c.g); world.remove(c.ring); world.remove(c.ix); if (c.tag) world.remove(c.tag);
      c.mat.dispose(); c.eyeMat.dispose(); for (const m of c.extra) m.dispose(); if (c.av) c.av.dispose(); c.scrTex.dispose(); c.scr.material.dispose(); c.ring.material.dispose(); c.ix.material.map.dispose(); c.ix.material.dispose(); c.halo.material.dispose();
      if (c.tag) { c.tag.material.map.dispose(); c.tag.material.dispose(); }
    }
    const slotX = (i) => (i - (n - 1) / 2) * spacing;

    // ---------- 捞小智（3D） ----------
    const Z = { g: new T.Group(), x: 0, y: 3, tx: 0, ty: 3, vx: 0, vy: 0, mood: "", beam: 0, beamT: 0, spin: 0, cheer: 0, shake: 0 };
    (function buildZhi() {
      const g = Z.g; scene.add(g);
      const shell = new T.MeshStandardMaterial({ color: 0xf1f5ff, roughness: 0.22, metalness: 0.1 });
      const body = new T.Mesh(new T.SphereGeometry(0.42, 32, 24), shell); body.scale.set(1, 0.92, 0.95); g.add(body);
      const visor = new T.Mesh(new T.SphereGeometry(0.43, 32, 16, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.26, Math.PI * 0.36), new T.MeshStandardMaterial({ color: 0x060c1c, roughness: 0.05, metalness: 0.95 }));
      visor.scale.set(1, 0.92, 0.95); g.add(visor);
      const eyeMat = new T.MeshBasicMaterial({ color: 0x5eead4 }); Z.eyeMat = eyeMat;
      const eg = new T.CapsuleGeometry(0.045, 0.07, 4, 10);
      const e1 = new T.Mesh(eg, eyeMat), e2 = new T.Mesh(eg, eyeMat); e1.position.set(-0.13, 0.04, 0.4); e2.position.set(0.13, 0.04, 0.4); g.add(e1, e2); Z.eyes = [e1, e2];
      const mouth = new T.Mesh(new T.TorusGeometry(0.06, 0.012, 6, 20, Math.PI), eyeMat); mouth.position.set(0, -0.08, 0.41); mouth.rotation.z = Math.PI; g.add(mouth); Z.mouth = mouth;
      const ant = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.22, 8), new T.MeshStandardMaterial({ color: 0x9fb2d6, metalness: 0.6, roughness: 0.3 })); ant.position.y = 0.5; g.add(ant);
      const tip = new T.Mesh(new T.SphereGeometry(0.05, 14, 10), new T.MeshBasicMaterial({ color: 0x22d3ee })); tip.position.y = 0.63; g.add(tip); Z.tip = tip;
      const tipGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0x22d3ee, transparent: true, blending: T.AdditiveBlending, depthWrite: false })); tipGlow.scale.setScalar(0.35); tipGlow.position.y = 0.63; g.add(tipGlow); Z.tipGlow = tipGlow;
      for (const s of [-1, 1]) { const ear = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.07, 20), new T.MeshStandardMaterial({ color: 0xc7d4ee, roughness: 0.3 })); ear.rotation.z = Math.PI / 2; ear.position.set(s * 0.42, 0.02, 0); g.add(ear); const el = new T.Mesh(new T.TorusGeometry(0.055, 0.012, 6, 20), new T.MeshBasicMaterial({ color: 0x22d3ee })); el.rotation.y = Math.PI / 2; el.position.set(s * 0.46, 0.02, 0); g.add(el); }
      Z.hands = [-1, 1].map((s) => { const h = new T.Mesh(new T.SphereGeometry(0.08, 16, 12), shell); h.position.set(s * 0.56, -0.18, 0.08); g.add(h); return h; });
      const jet = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0x22d3ee, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false })); jet.scale.set(0.5, 0.75, 1); jet.position.y = -0.5; g.add(jet); Z.jet = jet;
      const jl = new T.PointLight(0x22d3ee, 0.8, 3); jl.position.y = -0.45; g.add(jl);
      // 扫描光（锥形，半透明）
      const beam = new T.Mesh(new T.ConeGeometry(1, 1, 32, 1, true), new T.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      beam.geometry.translate(0, -0.5, 0); scene.add(beam); Z.beam = beam;
      g.scale.setScalar(mini ? 0.75 : 0.85);
    })();
    function zhiMood(m) {
      Z.mood = m || "";
      const c = m === "sad" ? 0xfb7185 : m === "wow" ? 0xfde68a : 0x5eead4;
      Z.eyeMat.color.setHex(c); Z.tip.material.color.setHex(c); Z.tipGlow.material.color.setHex(c);
      const [e1, e2] = Z.eyes;
      e1.scale.set(1, 1, 1); e2.scale.set(1, 1, 1);
      if (m === "happy") { e1.scale.y = e2.scale.y = 0.35; Z.mouth.scale.set(1.3, 1.3, 1); Z.mouth.rotation.z = Math.PI; }
      else if (m === "wow") { e1.scale.set(1.4, 1.1, 1); e2.scale.set(1.4, 1.1, 1); Z.mouth.scale.set(0.7, 1.4, 1); Z.mouth.rotation.z = Math.PI; }
      else if (m === "think") { e1.scale.y = 0.5; Z.mouth.scale.set(0.8, 0.3, 1); }
      else if (m === "sad") { Z.mouth.scale.set(1, 1, 1); Z.mouth.rotation.z = 0; }
      else { Z.mouth.scale.set(1, 1, 1); Z.mouth.rotation.z = Math.PI; }
    }
    zhiMood("");

    // ---------- 粒子：灰尘、闪光、彩带 ----------
    const parts = [];
    function burst(x, y, z, { count = 10, color = 0xffffff, speed = 1.6, up = 1.2, size = 0.12, life = 0.6, grav = -4, confetti = false } = {}) {
      for (let i = 0; i < count; i++) {
        let m;
        if (confetti) { m = new T.Mesh(new T.PlaneGeometry(0.07, 0.12), new T.MeshBasicMaterial({ color: [0x22d3ee, 0xf472b6, 0x84cc16, 0xfbbf24, 0xa78bfa][i % 5], side: T.DoubleSide, transparent: true })); }
        else { m = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color, transparent: true, blending: T.AdditiveBlending, depthWrite: false })); m.scale.setScalar(size); }
        m.position.set(x, y, z); scene.add(m);
        const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
        parts.push({ m, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * s * 0.6, life, t: 0, grav, spin: confetti ? (Math.random() - 0.5) * 12 : 0, confetti });
      }
    }

    // ---------- 动画（补间） ----------
    let tweens = [];
    function tween(dur, fn, ease = E.inOut, delay = 0) {
      return new Promise((res) => tweens.push({ t0: now() + delay, dur: Math.max(1, dur), fn, ease, res }));
    }
    const now = () => performance.now();
    function finishAll() { const ts = tweens; tweens = []; for (const t of ts) { try { t.fn(1, 1); } catch (e) {} t.res(); } }

    // ---------- 布局 ----------
    let W = 1, H = 1, lastState = null;
    function fit() {
      const r = wrap.getBoundingClientRect(); W = Math.max(50, r.width); H = Math.max(50, r.height);
      renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
      const rowW = Math.max(3, n * spacing + 1.2);
      const vfov = (camera.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      const zTop = (hMax + headExtra()) * scaleK + R0 * 2 + (mini ? 1.0 : 1.25) + 0.9;   // 捞小智头顶（天线）
      const needH = zTop + 0.4;
      const dW = rowW / 2 / Math.tan(hfov / 2) + 1.2, dH = needH / 2 / Math.tan(vfov / 2) + 1.2;
      const d = Math.max(dW, dH, 4.5);
      camBase.set(0, needH * 0.5 + d * 0.12, d);
      camLook.set(0, needH * 0.46, 0);
      plat.scale.x = rowW + 0.4; edge.scale.x = rowW + 0.4; edge2.scale.x = rowW + 0.3; shadowPlane.scale.x = rowW + 0.4; grid.scale.set(rowW + 0.4, 1, 2.4); underGlow.scale.set(rowW * 1.3, 1.6, 1);
      key.shadow.camera.left = -rowW / 2 - 1; key.shadow.camera.right = rowW / 2 + 1; key.shadow.camera.top = 6; key.shadow.camera.bottom = -3; key.shadow.camera.updateProjectionMatrix();
      key.position.set(-rowW * 0.3 - 2, 9, 7);
    }
    const camBase = new T.Vector3(0, 3, 9), camLook = new T.Vector3(0, 1, 0);

    function rebuild(a) {
      for (const c of chars) disposeChar(c);
      chars = []; n = a.length;
      lo = Math.min(0, ...a); hi = Math.max(1, ...a);
      if (lo < 0) lo = Math.min(...a);
      spacing = n > 16 ? Math.max(0.62, 16 / n) : 0.95;
      scaleK = spacing / 0.95;
      hMax = n > 16 ? 2.4 : 2.2;
      chars = a.map((v, i) => { const c = makeChar(v, i); c.x = slotX(i); c.g.position.x = c.x; c.g.scale.setScalar(scaleK); c.ring.position.x = c.x; c.ix.position.x = c.x; c.ix.scale.multiplyScalar(scaleK); return c; });
      fit();
    }
    function rescale(a) {
      const nlo = Math.min(0, ...a) < 0 ? Math.min(...a) : 0, nhi = Math.max(1, ...a);
      if (nlo !== lo || nhi !== hi) { lo = nlo; hi = nhi; for (const c of chars) c.hT = heightOf(c.v); }
    }

    // ---------- 一步的样子（颜色、标记） ----------
    function applyLook(st) {
      const S = new Set(st.sorted || []), cmp = st.cmp || [], swp = st.swap || [];
      const range = st.range;
      const marks = st.marks || {};
      chars.forEach((c, i) => {
        let s = "";
        if (S.has(i)) s = "sorted";
        if (st.mark && st.mark.includes(i)) s = "mark";
        if (st.pivot === i) s = "pivot";
        if (cmp.includes(i)) s = "cmp";
        if (swp.includes(i)) s = "swap";
        if (st.found === i) s = "found";
        c.state = s;
        c.colorT.setHex({ sorted: PAL.sorted, mark: PAL.mark, pivot: PAL.pivot, cmp: PAL.cmp, swap: PAL.swap, found: PAL.sorted }[s] || PAL.body);
        if (c.av) c.av.mood(s === "cmp" ? "think" : s === "swap" ? "wave" : "idle");
        c.eyeT.setHex(skin.person ? skin.person.eye : { sorted: COL.eyeSorted, cmp: COL.eyeCmp, swap: COL.eyeSwap, found: COL.eyeSorted }[s] || COL.eye);
        c.dimT = range && (i < range[0] || i > range[1]) ? 1 : 0;
        c.halo.material.opacity = s === "pivot" ? 0.95 : 0; c.halo.visible = s === "pivot";
        if (c.scrState !== s) { c.scrState = s; redraw(c.scrTex, screenDraw(c.v, s)); }
        // 地上的光圈 + 名字牌（i、j、lo、hi…）
        const m = marks[i];
        const txt = m ? m.join(",") : "";
        c.ring.material.opacity = txt ? 0.85 : 0; c.ring.visible = !!txt;
        if (txt) c.ring.material.color.set(MARK_COL[m[0]] || "#22d3ee");
        if (txt !== c.tagText) {
          if (c.tag) { world.remove(c.tag); c.tag.material.map.dispose(); c.tag.material.dispose(); c.tag = null; }
          if (txt) { c.tag = labelSprite(txt.length > 7 ? txt.slice(0, 7) + "…" : txt, MARK_COL[m[0]] || "#22d3ee", (txt.length > 3 ? 1.2 : 0.9) * Math.max(0.8, scaleK)); c.tag.position.set(c.x, 0.03, 1.45); world.add(c.tag); }
          c.tagText = txt;
        }
        // 互相看：比较的两个转向对方
        c.lookT = cmp.length === 2 && cmp.includes(i) ? (i === Math.min(...cmp) ? 0.45 : -0.45) : 0;
      });
      // 捞小智飞到要看的地方
      const focus = cmp.length ? cmp : swp.length ? swp : Object.keys(marks).map(Number).filter((k) => k >= 0 && k < n).slice(0, 2);
      if (focus.length) { const xs = focus.map(slotX); Z.tx = (Math.min(...xs) + Math.max(...xs)) / 2; Z.beamT = cmp.length || swp.length ? 1 : 0.45; Z.beamW = (Math.max(...xs) - Math.min(...xs)) / 2 + 0.45; }
      else { Z.tx = 0; Z.beamT = 0; }
      if (st.found != null) { Z.tx = slotX(st.found); Z.beamT = 1; Z.beamW = 0.5; }
      Z.ty = (hMax + headExtra()) * scaleK + R0 * 2 + (mini ? 1.0 : 1.25);
      zhiMood(st.mood || (st.found != null ? "happy" : st.error ? "sad" : cmp.length ? "think" : ""));
      say(st.note);
    }

    // ---------- 说话（气泡） ----------
    let sayText = "";
    function say(t) {
      if (mini) return;
      t = String(t || "").replace(/<[^>]+>/g, "");
      if (t === sayText) return;
      sayText = t;
      bubble.hidden = !t;
      if (t) { bubble.firstElementChild.textContent = t; bubble.classList.remove("in"); void bubble.offsetWidth; bubble.classList.add("in"); }
    }

    // ---------- 从上一步到这一步：找出谁换了位置、谁的值变了 ----------
    function match(a, b) {
      // a、b 是同一堆数（只是换了位置）：给每个新位置找原来的人（同一个值优先留在原地，其次找最近的）
      const used = new Array(a.length).fill(false), map = new Array(b.length).fill(-1);
      for (let j = 0; j < b.length; j++) if (a[j] === b[j]) { map[j] = j; used[j] = true; }
      for (let j = 0; j < b.length; j++) {
        if (map[j] >= 0) continue;
        let best = -1;
        for (let i = 0; i < a.length; i++) if (!used[i] && a[i] === b[j] && (best < 0 || Math.abs(i - j) < Math.abs(best - j))) best = i;
        if (best < 0) return null;
        map[j] = best; used[best] = true;
      }
      return map;
    }
    const sameBag = (a, b) => a.length === b.length && a.slice().sort((x, y) => x - y).join() === b.slice().sort((x, y) => x - y).join();

    async function animSwap(i, j, dur, snd) {
      const A = chars[i], B = chars[j];
      const jumper = A.v >= B.v ? A : B, ducker = jumper === A ? B : A;
      const xA = A.x, xB = B.x;
      chars[i] = B; chars[j] = A;
      const jx0 = jumper.x, jx1 = jumper === A ? xB : xA, dx0 = ducker.x, dx1 = ducker === A ? xB : xA;
      const peak = Math.max(jumper.h, ducker.h) * 0.55 + 0.9;
      const sfxArgs = { v: jumper.v, lo, hi };
      // 预备：蹲
      await tween(dur * 0.18, (p) => { jumper.squash = 1 - 0.18 * Math.sin(p * Math.PI / 2); ducker.squash = 1 - 0.12 * p; });
      snd("jump", sfxArgs); snd("duck");
      // 跳：抛物线，空中转半圈；矮的从下面滑过去
      await tween(dur * 0.6, (p, raw) => {
        const e = E.inOut(raw);
        jumper.x = lerp(jx0, jx1, e); jumper.jump = Math.sin(Math.PI * raw) * peak; jumper.squash = 1 + 0.15 * Math.sin(Math.PI * raw);
        jumper.spin = (jx1 > jx0 ? -1 : 1) * Math.PI * 2 * E.inOut(raw) * 0; jumper.tilt = (jx1 > jx0 ? -1 : 1) * Math.sin(Math.PI * raw) * 0.5; jumper.arms = Math.sin(Math.PI * raw);
        ducker.x = lerp(dx0, dx1, e); ducker.squash = 0.72 + 0.1 * Math.abs(Math.cos(Math.PI * raw)); ducker.tilt = (dx1 > dx0 ? -1 : 1) * 0.15 * Math.sin(Math.PI * raw);
      }, E.lin);
      // 落地：压扁一下、扬灰
      jumper.x = jx1; ducker.x = dx1; jumper.jump = 0; jumper.tilt = 0; ducker.tilt = 0; jumper.arms = 0;
      snd("land");
      burst(jx1, 0.05, 0.1, { count: 9, color: 0xc7d2fe, speed: 1.4, up: 0.6, size: 0.16, life: 0.5, grav: -1.5 });
      await tween(dur * 0.22, (p) => { jumper.squash = 1 - 0.22 * Math.sin(Math.PI * p); ducker.squash = lerp(0.8, 1, E.back(p)); });
      jumper.squash = 1; ducker.squash = 1;
    }
    async function animMove(map, dur, snd) {
      // 好几个一起换位置（比如插入排序整体后移、或者一下子变了很多）：每个按距离跳过去
      const old = chars.slice();
      const moves = map.map((from, to) => ({ c: old[from], x0: old[from].x, x1: slotX(to), d: Math.abs(from - to) }));
      chars = map.map((from) => old[from]);
      snd("slide");
      await tween(dur, (p, raw) => { for (const m of moves) { m.c.x = lerp(m.x0, m.x1, E.inOut(raw)); m.c.jump = m.d ? Math.sin(Math.PI * raw) * (0.3 + 0.25 * Math.min(4, m.d)) : 0; m.c.squash = m.d ? 1 + 0.08 * Math.sin(Math.PI * raw) : 1; } }, E.lin);
      for (const m of moves) { m.c.x = m.x1; m.c.jump = 0; m.c.squash = 1; }
    }
    async function animMorph(idx, b, dur, snd) {
      const tasks = idx.map((i) => {
        const c = chars[i], v = b[i], up = v > c.v;
        const h0 = c.h; c.v = v; c.hT = heightOf(v);
        redraw(c.scrTex, screenDraw(v, c.scrState || ""));
        snd("morph", { v, lo, hi, up, gap: 30 });
        burst(c.x, c.h * scaleK * 0.6 + 0.4, 0.35, { count: 6, color: up ? 0x67e8f9 : 0xf9a8d4, speed: 0.9, up: 0.9, size: 0.1, life: 0.45, grav: -1 });
        return tween(dur, (p) => { c.h = lerp(h0, c.hT, p); c.squash = 1 + 0.06 * Math.sin(p * Math.PI); }, E.elastic);
      });
      await Promise.all(tasks);
    }

    // ---------- 对外 ----------
    let busy = Promise.resolve(), seq = 0;
    const api = {
      ok: true,
      el: wrap,
      // 直接摆成这一步（拖进度条、刚打开）
      set(st) {
        finishAll(); seq++;
        const a = (st.a || []).map(Number);
        if (a.length !== n || !chars.length) rebuild(a);
        else { chars.forEach((c, i) => { c.v = a[i]; }); lo = Math.min(0, ...a) < 0 ? Math.min(...a) : 0; hi = Math.max(1, ...a); }
        chars.forEach((c, i) => { c.x = slotX(i); c.h = c.hT = heightOf(c.v); c.jump = 0; c.squash = 1; c.tilt = 0; c.scrState = null; redraw(c.scrTex, screenDraw(c.v, "")); c.ix.position.x = c.x; redrawIx(c, i); });
        applyLook(st);
        lastState = st;
      },
      // 动画过去
      step(st, o = {}) {
        const dur = clamp(o.dur || 620, 120, 900);
        const a = (st.a || []).map(Number);
        const prev = chars.map((c) => c.v);
        finishAll();
        const my = ++seq;
        const snd = o.sound === false || !SFX ? () => {} : (nm, x) => SFX.play(nm, x);
        if (!chars.length || a.length !== prev.length || a.length === 0) { api.set(st); return; }
        rescale(a);
        let p = null;
        const changed = a.map((v, i) => (v !== prev[i] ? i : -1)).filter((i) => i >= 0);
        if (changed.length && sameBag(prev, a)) {
          const map = match(prev, a);
          if (map) {
            const moved = map.map((f, t) => (f !== t ? t : -1)).filter((t) => t >= 0);
            if (moved.length === 2) p = animSwap(moved[0], moved[1], dur, snd);
            else p = animMove(map, dur, snd);
          }
        }
        if (!p && changed.length) p = animMorph(changed, a, dur * 1.1, snd);
        applyLook(st);
        // 比较：两个音（音高 = 数的大小）
        const cmp = st.cmp || [];
        if (cmp.length === 2 && !changed.length) snd("compare", { a: a[cmp[0]], b: a[cmp[1]], lo, hi });
        // 新排好的：一声铃
        const was = new Set((lastState && lastState.sorted) || []);
        const fresh = (st.sorted || []).filter((i) => !was.has(i));
        if (fresh.length && fresh.length < a.length) { snd("sorted", { v: a[fresh[0]], lo, hi }); for (const i of fresh) hop(chars[i], 0.25); }
        if (st.found != null && (!lastState || lastState.found == null)) { snd("found"); api.celebrate(snd, true); }
        if (st.done && !(lastState && lastState.done)) api.celebrate(snd);
        if (st.error && !(lastState && lastState.error)) { snd("error"); Z.shake = 1; }
        lastState = st;
        busy = (p || Promise.resolve()).then(() => { if (my === seq) chars.forEach((c, i) => { c.ix.position.x = slotX(i); redrawIx(c, i); }); });
        return busy;
      },
      celebrate(snd, quiet) {
        if (!quiet) (snd || ((nm) => SFX && SFX.play(nm)))("done");
        zhiMood("happy"); Z.spin = 1; Z.cheer = 1;
        chars.forEach((c, i) => setTimeout(() => hop(c, 0.45), i * 70));
        burst(Z.x, Z.y + 0.3, 0.3, { count: 40, confetti: true, speed: 2.4, up: 2.6, life: 1.6, grav: -3 });
      },
      say,
      mood: zhiMood,
      // 换皮肤：现在站着的这排数重新造一遍，颜色、标记照旧
      setSkin(s) {
        skin = sanitizeSkin(s); PAL = palette();
        const vals = chars.map((c) => c.v);
        finishAll();
        if (vals.length) { rebuild(vals); chars.forEach((c, i) => { c.h = c.hT; redrawIx(c, i); }); if (lastState) applyLook(lastState); }
        Z.ty = (hMax + headExtra()) * scaleK + R0 * 2 + (mini ? 1.0 : 1.25);
        fit();
        return skin;
      },
      get skin() { return skin; },
      // 说话时嘴巴张合（0..1，按音量给）；i 不给就是全部小人
      talk(level, i) { for (const [k, c] of chars.entries()) if (i == null || i === k) c.talkT = clamp(+level || 0, 0, 1); },
      resize: fit,
      setPaused(p) { paused = !!p; if (!paused) loop(); },
      dispose() { LIVE.delete(api); disposed = true; cancelAnimationFrame(raf); ro.disconnect(); for (const c of chars) disposeChar(c); renderer.dispose(); wrap.remove(); },
    };
    function redrawIx(c, i) { if (c.ixI === i) return; c.ixI = i; redraw(c.ix.__tex, (g, w, h) => { rr(g, 4, 4, w - 8, h - 8, (h - 8) / 2); g.fillStyle = "rgba(6,11,24,.6)"; g.fill(); g.font = "700 38px Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#6b7fa8"; g.fillText(String(i), w / 2, h / 2 + 2); }); }
    function hop(c, hgt) { const h0 = 0; tween(380, (p) => { c.jump = Math.sin(Math.PI * p) * hgt; c.squash = 1 + 0.1 * Math.sin(Math.PI * p); c.arms = Math.sin(Math.PI * p) * 0.8; }, E.lin).then(() => { c.jump = h0; c.arms = 0; c.squash = 1; }); }

    // ---------- 每一帧 ----------
    let raf = 0, last = now(), paused = false, disposed = false, visible = true;
    const tmp = new T.Vector3();
    function loop() {
      if (disposed) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
    function frame() {
      if (disposed) return;
      const t = now(), dt = Math.min(0.12, (t - last) / 1000); last = t;
      // 跟帧率无关的平滑（电脑慢、帧数低时也一样快）
      const f12 = 1 - Math.exp(-dt * 12), f10 = 1 - Math.exp(-dt * 10), f9 = 1 - Math.exp(-dt * 9);
      // 补间
      for (const tw of tweens.slice()) { const raw = clamp((t - tw.t0) / tw.dur, 0, 1); if (t < tw.t0) continue; tw.fn(tw.ease(raw), raw); if (raw >= 1) { tweens.splice(tweens.indexOf(tw), 1); tw.res(); } }
      const time = t / 1000;
      for (const c of chars) {
        c.h = tweens.length ? c.h : lerp(c.h, c.hT, f12);
        c.color.lerp(c.colorT, f10); c.mat.color.copy(c.color);
        c.mat.emissive.copy(c.color).multiplyScalar(c.state ? 0.28 : 0.06);
        c.eyeC.lerp(c.eyeT, f12); c.eyeMat.color.copy(c.eyeC);
        c.dim = lerp(c.dim, c.dimT, f9); c.mat.opacity = 1 - c.dim * 0.65; c.scr.material.opacity = 1 - c.dim * 0.7;
        c.mat.depthWrite = c.dim < 0.5;
        for (const m of c.extra) { m.opacity = (m.__alpha || 1) * (1 - c.dim * 0.65); if (!m.__alpha) m.depthWrite = c.dim < 0.5; }
        if (c.av) { c.av.talk(c.talkT || 0); c.av.update(dt); }
        if (c.mouthO) { c.talkS = lerp(c.talkS || 0, c.talkT || 0, 1 - Math.exp(-dt * 25)); c.mouthO.scale.set(0.035 + c.talkS * 0.012, 0.002 + c.talkS * 0.05, 0.02); c.mouth.visible = c.talkS < 0.25; }
        c.look = lerp(c.look, c.lookT, f9);
        // 待机：轻轻呼吸、眨眼
        c.bob += dt;
        const breathe = 1 + Math.sin(c.bob * 2.2) * 0.012;
        c.blink -= dt; let eyeS = 1; if (c.blink < 0) { eyeS = 0.15; if (c.blink < -0.12) c.blink = 2 + Math.random() * 4; }
        if (c.state === "sorted" || c.state === "found") eyeS = Math.min(eyeS, 0.45);
        for (const e of c.eyes) e.scale.y = eyeS * (c.state === "cmp" ? 1.25 : 1);
        layoutChar(c);
        c.g.position.set(c.x, c.jump * scaleK, 0);
        c.body.scale.set(1 / Math.sqrt(c.squash * breathe), c.squash * breathe, 1 / Math.sqrt(c.squash * breathe));
        c.body.rotation.y = c.look; c.body.rotation.z = c.tilt || 0;
        c.ring.position.x = c.x; c.ring.scale.setScalar(scaleK * (1 + Math.sin(time * 4) * 0.04));
        if (c.tag) c.tag.position.x = c.x;
      }
      // 捞小智：弹簧跟随、上下浮动、天线闪
      const k = 22, d = 2 * Math.sqrt(k);
      for (let sub = 0, h = dt / 4; sub < 4; sub++) { Z.vx += (k * (Z.tx - Z.x) - d * Z.vx) * h; Z.x += Z.vx * h; Z.vy += (k * (Z.ty - Z.y) - d * Z.vy) * h; Z.y += Z.vy * h; }
      const shake = Z.shake > 0 ? Math.sin(time * 60) * 0.06 * Z.shake : 0; Z.shake = Math.max(0, Z.shake - dt * 2);
      Z.g.position.set(Z.x + shake, Z.y + Math.sin(time * 2.1) * 0.08, 0.35);
      Z.g.rotation.z = clamp(-Z.vx * 0.08, -0.35, 0.35);
      if (Z.spin > 0) { Z.spin = Math.max(0, Z.spin - dt * 1.2); Z.g.rotation.y = (1 - Z.spin) * Math.PI * 2; } else Z.g.rotation.y = lerp(Z.g.rotation.y % (Math.PI * 2), 0, f9);
      Z.cheer = Math.max(0, Z.cheer - dt * 0.8);
      Z.hands[0].position.y = -0.18 + Math.sin(time * 3) * 0.03 + Z.cheer * 0.5; Z.hands[1].position.y = -0.18 + Math.cos(time * 3) * 0.03 + Z.cheer * 0.5;
      Z.tipGlow.scale.setScalar(0.3 + Math.sin(time * 5) * 0.06);
      Z.jet.scale.set(0.45 + Math.sin(time * 18) * 0.04, 0.7 + Math.sin(time * 23) * 0.08, 1);
      Z.beam.visible = Z.beam.material.opacity > 0.01;
      Z.beam.material.opacity = lerp(Z.beam.material.opacity, Z.beamT * 0.16, f9);
      const bh = Z.y - 0.3;
      Z.beam.position.set(Z.g.position.x, Z.y - 0.35, 0.3); Z.beam.scale.set((Z.beamW || 0.5) * scaleK, bh, 0.55 * scaleK);
      spot.intensity = lerp(spot.intensity, Z.beamT * 2.4, f9); spot.position.set(Z.g.position.x, Z.y, 1.2); spot.target.position.set(Z.tx, 0.6, 0);
      // 粒子
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]; q.t += dt;
        q.vy += q.grav * dt; q.m.position.x += q.vx * dt; q.m.position.y += q.vy * dt; q.m.position.z += q.vz * dt;
        if (q.confetti) { q.m.rotation.x += q.spin * dt; q.m.rotation.y += q.spin * 0.7 * dt; q.vx *= 0.985; q.vz *= 0.985; if (q.vy < -1.2) q.vy = -1.2; }
        q.m.material.opacity = 1 - q.t / q.life;
        if (q.t >= q.life) { scene.remove(q.m); q.m.material.dispose(); if (q.m.geometry) q.m.geometry.dispose(); parts.splice(i, 1); }
      }
      // 镜头：轻轻晃，跟着捞小智偏一点
      camera.position.set(camBase.x + Math.sin(time * 0.35) * 0.25 + Z.x * 0.06, camBase.y + Math.sin(time * 0.27) * 0.08, camBase.z);
      tmp.copy(camLook); tmp.x += Z.x * 0.05; camera.lookAt(tmp);
      stars.rotation.y = Math.sin(time * 0.05) * 0.05;
      edgeMat.color.setHSL(0.52 + Math.sin(time * 0.8) * 0.03, 0.85, 0.55);
      renderer.render(scene, camera);
      // 气泡跟着捞小智
      if (!bubble.hidden) {
        tmp.set(Z.g.position.x, Z.g.position.y + 0.25, Z.g.position.z).project(camera);
        const bx = (tmp.x * 0.5 + 0.5) * W, by = (-tmp.y * 0.5 + 0.5) * H;
        bubble.style.transform = `translate(${Math.round(bx + 34)}px, ${Math.round(by - 30)}px)`;
        bubble.classList.toggle("left", bx > W * 0.62);
        if (bubble.classList.contains("left")) bubble.style.transform = `translate(${Math.round(bx - 34)}px, ${Math.round(by - 30)}px) translateX(-100%)`;
      }
      if (!paused && visible && !document.hidden) raf = requestAnimationFrame(frame);
      else raf = 0;
    }
    const ro = new ResizeObserver(() => { fit(); });
    ro.observe(wrap);
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible && !raf) { last = now(); loop(); } });
    io.observe(wrap);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf) { last = now(); loop(); } });
    fit(); loop();
    if (SFX && opt.hello) SFX.play("hello");
    if (!opt.skin) LIVE.add(api);
    return api;
  }

  // 换全局皮肤：所有跟着全局走的舞台马上换，之后新开的舞台也用它
  function setSkin(s) { const nx = sanitizeSkin(s); if (JSON.stringify(nx) === JSON.stringify(SKIN)) return SKIN; SKIN = nx; for (const a of LIVE) a.setSkin(SKIN); return SKIN; }
  root.LaoStage = { create, webgl, setSkin, getSkin: () => SKIN, sanitizeSkin, ROBOT };
})(typeof window !== "undefined" ? window : globalThis);
