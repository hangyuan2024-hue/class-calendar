// 捞小智（3D）：捞捞编程「冒泡排序」舞台上飞在上面讲解的那个小机器人（造型照 coder/renderer/stage3d.js 的 buildZhi），
// 单独拿出来放在成品展示里当主角：白色圆身子、黑色面罩、青色眼睛、头顶天线、两只小手、底下喷着光。
//   LaoZhi.create(容器) → { talk(音量 0~1) 说话时张嘴、mood(动作, 秒) 招手 / 开心 / 想 / 惊讶 / 难过 / 点头、dispose() }
//   眼睛跟着鼠标看，隔几秒眨一下眼，上下浮着，天线一闪一闪；窗口看不见时不画（不占显卡，电脑还要算任务）
// 用 three.js（vendor/three/three.min.js）；没有 WebGL 时 create() 返回 null，展示页退回一个「捞」字
"use strict";
(function (root) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  function webgl() { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } }

  function create(el, opt = {}) {
    const T = root.THREE;
    if (!T || !webgl()) return null;
    if (T.ColorManagement) T.ColorManagement.legacyMode = false;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.15, 4.2); camera.lookAt(0, 0.05, 0);

    // 灯光（和编程舞台一样的配方）：天光 + 主光 + 背后的青色、紫色轮廓光
    scene.add(new T.HemisphereLight(0xbfdcff, 0x1b1236, 0.85));
    const key = new T.DirectionalLight(0xffffff, 1.35); key.position.set(-4, 9, 7); scene.add(key);
    const rim = new T.PointLight(0x22d3ee, 1.4, 30); rim.position.set(0, 3, -4); scene.add(rim);
    const rim2 = new T.PointLight(0xa855f7, 0.9, 30); rim2.position.set(4, 1.5, -2); scene.add(rim2);

    // 发光贴图（天线尖、喷口）
    const gc = document.createElement("canvas"); gc.width = gc.height = 64;
    const gg = gc.getContext("2d"), gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
    const glow = new T.CanvasTexture(gc);
    const glowSprite = (color, sx, sy, op = 1) => { const s = new T.Sprite(new T.SpriteMaterial({ map: glow, color, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false })); s.scale.set(sx, sy || sx, 1); return s; };

    // ---------- 捞小智（造型和编程舞台上的一模一样） ----------
    const Z = { g: new T.Group(), head: new T.Group() };
    scene.add(Z.g); Z.g.add(Z.head);
    const shell = new T.MeshStandardMaterial({ color: 0xf1f5ff, roughness: 0.22, metalness: 0.1 });
    const body = new T.Mesh(new T.SphereGeometry(0.42, 48, 32), shell); body.scale.set(1, 0.92, 0.95); Z.head.add(body);
    const visor = new T.Mesh(new T.SphereGeometry(0.43, 48, 24, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.26, Math.PI * 0.36), new T.MeshStandardMaterial({ color: 0x060c1c, roughness: 0.05, metalness: 0.95 }));
    visor.scale.set(1, 0.92, 0.95); Z.head.add(visor);
    const eyeMat = new T.MeshBasicMaterial({ color: 0x5eead4 });
    const eg = new T.CapsuleGeometry(0.045, 0.07, 4, 12);
    const eyes = [new T.Mesh(eg, eyeMat), new T.Mesh(eg, eyeMat)];
    eyes[0].position.set(-0.13, 0.04, 0.4); eyes[1].position.set(0.13, 0.04, 0.4);
    const eyeG = new T.Group(); eyes.forEach((e) => eyeG.add(e)); Z.head.add(eyeG);
    // 嘴：不说话时是一道笑弧；说话时换成一个张开的小椭圆，跟着音量一张一合
    const smile = new T.Mesh(new T.TorusGeometry(0.06, 0.012, 6, 24, Math.PI), eyeMat); smile.position.set(0, -0.08, 0.41); smile.rotation.z = Math.PI; Z.head.add(smile);
    const open = new T.Mesh(new T.CircleGeometry(0.05, 24), eyeMat); open.position.set(0, -0.085, 0.418); open.scale.set(1, 0.01, 1); open.visible = false; Z.head.add(open);
    const ant = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.22, 8), new T.MeshStandardMaterial({ color: 0x9fb2d6, metalness: 0.6, roughness: 0.3 })); ant.position.y = 0.5; Z.head.add(ant);
    const tip = new T.Mesh(new T.SphereGeometry(0.05, 16, 12), new T.MeshBasicMaterial({ color: 0x22d3ee })); tip.position.y = 0.63; Z.head.add(tip);
    const tipGlow = glowSprite(0x22d3ee, 0.35); tipGlow.position.y = 0.63; Z.head.add(tipGlow);
    for (const s of [-1, 1]) { const ear = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.07, 24), new T.MeshStandardMaterial({ color: 0xc7d4ee, roughness: 0.3 })); ear.rotation.z = Math.PI / 2; ear.position.set(s * 0.42, 0.02, 0); Z.head.add(ear); }
    const hands = [-1, 1].map((s) => { const h = new T.Mesh(new T.SphereGeometry(0.08, 20, 14), shell); h.position.set(s * 0.56, -0.18, 0.08); Z.g.add(h); return h; });
    const jet = glowSprite(0x22d3ee, 0.5, 0.75, 0.9); jet.position.y = -0.5; Z.g.add(jet);
    const jl = new T.PointLight(0x22d3ee, 0.8, 3); jl.position.y = -0.45; Z.g.add(jl);
    // 脚下一圈淡淡的光（站在展示台上）
    const ring = new T.Mesh(new T.RingGeometry(0.34, 0.5, 48), new T.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.18, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.95; scene.add(ring);
    Z.g.scale.setScalar(1.25);

    // ---------- 表情、动作 ----------
    const COLORS = { "": 0x5eead4, happy: 0x5eead4, think: 0x5eead4, wow: 0xfde68a, sad: 0xfb7185, listen: 0x67e8f9, love: 0xf9a8d4, confused: 0xc4b5fd };
    let face = "", act = "", actUntil = 0, actAt = 0, level = 0, levelT = 0, mode = "";   // mode：一直保持的状态（在听 / 在想 / 在说），act：一下子的动作
    function setFace(m) {
      face = COLORS[m] != null ? m : "";
      const c = COLORS[face];
      eyeMat.color.setHex(c); tip.material.color.setHex(c); tipGlow.material.color.setHex(c); jet.material.color.setHex(c === 0x5eead4 ? 0x22d3ee : c);
      smile.scale.set(1, 1, 1); smile.rotation.z = Math.PI;
      if (face === "happy") smile.scale.set(1.3, 1.3, 1);
      else if (face === "wow") smile.scale.set(0.7, 1.4, 1);
      else if (face === "think") smile.scale.set(0.8, 0.3, 1);
      else if (face === "sad") smile.rotation.z = 0;
      else if (face === "love") smile.scale.set(1.4, 1.5, 1);
      else if (face === "confused") smile.scale.set(0.6, 0.35, 1);
      else if (face === "listen") smile.scale.set(0.9, 0.6, 1);
    }
    const MODE_FACE = { listen: "listen", think: "think", talk: "happy" };
    setFace("");
    // 展示页用的名字（和以前的公仔一样）→ 捞小智的动作
    const MOODS = { wave: ["wave", "happy"], point: ["point", ""], gesture: ["gesture", ""], nod: ["nod", "happy"], think: ["think", "think"], happy: ["hop", "happy"], wow: ["hop", "wow"], sad: ["droop", "sad"], idle: ["", ""],
      listen: ["listen", "listen"], explain: ["explain", ""], celebrate: ["spin", "happy"], confused: ["tilt", "confused"], love: ["hop", "love"], bow: ["bow", "happy"], shake: ["shake", ""] };
    function mood(m, secs) {
      const [a, f] = MOODS[m] || ["", ""];
      act = a; actAt = performance.now(); actUntil = actAt + clamp(+secs || 2, 0.5, 10) * 1000; setFace(f || MODE_FACE[mode] || "");
    }
    // 一直保持的状态：listen 在听（歪头、凑近、眼睛亮）、think 在想（往上看）、talk 在说、"" 平时
    function setMode(m) { mode = MODE_FACE[m] != null ? m : ""; if (!act) setFace(MODE_FACE[mode] || ""); }

    // 眼睛跟着鼠标
    let lookX = 0, lookY = 0, lookTX = 0, lookTY = 0;
    const onMove = (e) => { const r = el.getBoundingClientRect(); lookTX = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1.5, 1.5); lookTY = clamp(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1, -1.5, 1.5); };
    root.addEventListener("pointermove", onMove);

    // ---------- 大小、画 ----------
    let W = 1, H = 1;
    function fit() {
      const r = el.getBoundingClientRect(); W = Math.max(50, r.width); H = Math.max(50, r.height);
      renderer.setSize(W, H, false); camera.aspect = W / H;
      // 窄的时候往后退一点，整个都能看见
      camera.position.z = 4.2 * Math.max(1, 0.9 / camera.aspect);
      camera.updateProjectionMatrix();
    }
    fit();
    const ro = root.ResizeObserver ? new ResizeObserver(fit) : null; if (ro) ro.observe(el);

    let raf = 0, last = performance.now(), nextBlink = last + 2500, blinkT = -1, dead = false, lastDraw = 0;
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < 30) return;   // 最多 33 帧 / 秒：这台电脑的显卡还要算任务
      lastDraw = now;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
      if (act && now > actUntil) { act = ""; setFace(MODE_FACE[mode] || ""); }
      const ak = act ? (now - actAt) / 1000 : 0;   // 这个动作做了几秒
      // 浮着
      const bob = Math.sin(t * 1.6) * 0.06;
      Z.g.position.y = bob + (act === "hop" ? Math.abs(Math.sin((now / 1000) * 7)) * 0.15 : 0);
      Z.g.rotation.z = Math.sin(t * 0.9) * 0.04;
      // 转一圈（庆祝）、往前凑（在听）、垂头（难过）
      Z.g.rotation.y = act === "spin" ? Math.min(1, ak / 0.9) * Math.PI * 2 : lerp(Z.g.rotation.y % (Math.PI * 2), 0, 0.2);
      Z.g.position.z = lerp(Z.g.position.z, mode === "listen" || act === "listen" ? 0.35 : 0, 0.08);
      if (act === "droop") Z.g.position.y -= 0.08;
      // 看鼠标 / 想事情的时候往上看
      lookX = lerp(lookX, act === "think" ? 0.35 : lookTX, 0.08); lookY = lerp(lookY, act === "think" ? -0.6 : lookTY, 0.08);
      Z.head.rotation.y = lookX * 0.35 + (act === "shake" ? Math.sin(t * 11) * 0.3 : 0);
      Z.head.rotation.x = lookY * 0.18 + (act === "nod" ? Math.sin(t * 9) * 0.18 : 0) + (act === "bow" ? Math.sin(Math.min(1, ak / 1.2) * Math.PI) * 0.5 : 0) + (act === "droop" ? 0.25 : 0);
      // 歪头：在听的时候轻轻歪，没听懂的时候歪得多
      Z.head.rotation.z = lerp(Z.head.rotation.z, act === "tilt" ? -0.32 : mode === "listen" || act === "listen" ? 0.16 + Math.sin(t * 1.3) * 0.03 : 0, 0.1);
      eyeG.position.x = lookX * 0.03; eyeG.position.y = -lookY * 0.02;
      // 手：招手、指一下、比划；平时跟着身子轻轻晃
      const [hl, hr] = hands;
      hl.position.set(-0.56, -0.18 + Math.sin(t * 1.6 + 1) * 0.03, 0.08);
      if (act === "wave") hr.position.set(0.62 + Math.sin(t * 10) * 0.06, 0.18 + Math.cos(t * 10) * 0.05, 0.12);
      else if (act === "point") hr.position.set(0.7, 0.02, 0.3);
      else if (act === "gesture") { hr.position.set(0.58, -0.08 + Math.sin(t * 6) * 0.08, 0.2); hl.position.set(-0.58, -0.08 + Math.cos(t * 6) * 0.08, 0.2); }
      else if (act === "explain") { const k = Math.sin(t * 2.2); hr.position.set(0.6 + Math.max(0, k) * 0.12, -0.02 + k * 0.08, 0.22 + Math.max(0, k) * 0.12); hl.position.set(-0.58, -0.1 + Math.sin(t * 4.4) * 0.05, 0.16); }
      else if (act === "spin" || (act === "hop" && face === "love")) { hr.position.set(0.6, 0.25, 0.1); hl.position.set(-0.6, 0.25, 0.1); }
      else if (act === "tilt") { hr.position.set(0.32, 0.12, 0.34); }
      else if (act === "listen" || mode === "listen") { hr.position.set(0.5, 0.02, 0.26); }
      else hr.position.set(0.56, -0.18 + Math.sin(t * 1.6 + 2) * 0.03, 0.08);
      // 眨眼
      if (now > nextBlink) { blinkT = 0; nextBlink = now + 2600 + Math.random() * 3200; }
      let ey = face === "happy" && !level ? 0.35 : face === "think" ? 0.5 : 1;
      if (blinkT >= 0) { blinkT += dt; const k = blinkT / 0.14; ey *= k < 1 ? 1 - Math.sin(k * Math.PI) * 0.9 : 1; if (k >= 1) blinkT = -1; }
      const ex = face === "wow" ? 1.4 : face === "listen" ? 1.15 : 1;
      eyes.forEach((e, i) => e.scale.set(ex, ey * (face === "wow" ? 1.1 : face === "listen" ? 1.12 : face === "confused" ? (i ? 0.6 : 1.15) : 1), 1));
      // 说话：嘴跟着音量一张一合，眼睛亮一点
      level = lerp(level, levelT, 0.45);
      const talking = level > 0.04;
      open.visible = talking; smile.visible = !talking;
      if (talking) open.scale.set(1 + level * 0.3, clamp(0.25 + level * 1.4, 0.25, 1.4), 1);
      // 天线一闪一闪；说话时更亮
      const pulse = 0.75 + Math.sin(t * 3.2) * 0.25 + level * 0.6;
      tipGlow.scale.setScalar(0.3 + pulse * 0.12); tipGlow.material.opacity = clamp(pulse, 0.3, 1);
      jet.scale.set(0.5 + Math.sin(t * 18) * 0.04, 0.72 + Math.sin(t * 13) * 0.06, 1);
      ring.material.opacity = 0.14 + Math.sin(t * 1.6) * 0.04 + level * 0.12 + (mode === "listen" ? 0.1 + Math.sin(t * 4) * 0.06 : 0);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    return {
      ok: true,
      talk(v) { levelT = clamp(+v || 0, 0, 1); },
      mood, setMode,
      dispose() { dead = true; cancelAnimationFrame(raf); root.removeEventListener("pointermove", onMove); if (ro) ro.disconnect(); try { renderer.dispose(); } catch (e) {} renderer.domElement.remove(); },
    };
  }

  root.LaoZhi = { create, webgl };
})(typeof window !== "undefined" ? window : globalThis);
