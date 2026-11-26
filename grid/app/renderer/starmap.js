// 星图：中间是调度中心，每台电脑是一颗星；在算的电脑和中心之间有光点来回流动（传存档、交结果）。
// 背景：慢慢闪的星空。
(function () {
  const rnd = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296); };

  window.LaoBg = function (cv) {
    const g = cv.getContext("2d");
    let stars = [];
    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; stars = Array.from({ length: 160 }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.2 + 0.2, p: Math.random() * 6 })); };
    resize(); addEventListener("resize", resize);
    (function loop(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      for (const s of stars) { g.globalAlpha = 0.25 + 0.35 * Math.sin(t / 900 + s.p) ** 2; g.fillStyle = "#9cc4ff"; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      requestAnimationFrame(loop);
    })(0);
  };

  window.LaoStar = function (cv) {
    const g = cv.getContext("2d");
    let devices = [], me = null, W = 0, H = 0, dpr = 1;
    const parts = [];
    const pos = {};
    const resize = () => { dpr = devicePixelRatio || 1; W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; };
    resize(); addEventListener("resize", resize);
    function place(list) {
      const n = list.length;
      list.forEach((d, i) => {
        const r = rnd(d.id + d.name);
        const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2 + (r() - 0.5) * 0.4;
        const rad = 0.62 + r() * 0.3;
        pos[d.id] = pos[d.id] || { a, rad, x: 0, y: 0, glow: 0 };
        pos[d.id].a = pos[d.id].a * 0.9 + a * 0.1;
      });
    }
    // 捞小智版是白底：换一套浅色的配色（通用版照旧深色星空）
    const DARK = { orbit: "rgba(120,170,255,.08)", hub0: "rgba(140,200,255,.95)", hub1: "rgba(90,120,255,.45)", hub2: "rgba(90,120,255,0)", hubTx: "#dbe8ff", lnBusy: "rgba(62,240,161,.35)", lnOn: "rgba(54,226,255,.16)", lnOff: "rgba(255,255,255,.04)", busy: "62,240,161", on: "54,226,255", off: "120,130,160", ring: "rgba(255,255,255,.8)", nameOn: "#e6eeff", nameOff: "#6a7796", subBusy: "#3ef0a1", sub: "#7d8bab", up: "rgba(62,240,161,.95)", down: "rgba(54,226,255,.95)", glow: 0.6 };
    const LIGHT = { orbit: "rgba(23,120,90,.12)", hub0: "rgba(23,147,106,.9)", hub1: "rgba(23,147,106,.28)", hub2: "rgba(23,147,106,0)", hubTx: "#33413b", lnBusy: "rgba(23,147,106,.45)", lnOn: "rgba(60,110,200,.22)", lnOff: "rgba(0,0,0,.08)", busy: "23,160,110", on: "64,120,220", off: "160,170,168", ring: "rgba(31,43,39,.55)", nameOn: "#1f2b27", nameOff: "#9aa5a0", subBusy: "#12865d", sub: "#7d8a85", up: "rgba(23,160,110,.95)", down: "rgba(64,120,220,.95)", glow: 0.28 };
    function draw(t) {
      const C = document.body.classList.contains("clean") ? LIGHT : DARK;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cx = W * 0.62, cy = H * 0.5, R = Math.min(W * 0.34, H * 0.42);
      // 轨道
      g.strokeStyle = C.orbit; g.lineWidth = 1;
      for (const k of [0.62, 0.92]) { g.beginPath(); g.ellipse(cx, cy, R * k * 1.25, R * k, 0, 0, 7); g.stroke(); }
      // 中心
      const pulse = 1 + 0.06 * Math.sin(t / 400);
      const hub = g.createRadialGradient(cx, cy, 0, cx, cy, 46 * pulse);
      hub.addColorStop(0, C.hub0); hub.addColorStop(0.35, C.hub1); hub.addColorStop(1, C.hub2);
      g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 46 * pulse, 0, 7); g.fill();
      g.fillStyle = C.hubTx; g.font = "12px 'Microsoft YaHei UI', sans-serif"; g.textAlign = "center"; g.fillText("调度中心", cx, cy + 62);
      for (const d of devices) {
        const p = pos[d.id]; if (!p) continue;
        const a = p.a + t / 60000;
        p.x = cx + Math.cos(a) * R * p.rad * 1.25; p.y = cy + Math.sin(a) * R * p.rad;
        const on = d.online, busy = d.state === "busy";
        // 连线
        g.strokeStyle = busy ? C.lnBusy : on ? C.lnOn : C.lnOff;
        g.setLineDash(on ? [] : [3, 6]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke(); g.setLineDash([]);
        if (busy && Math.random() < 0.08) parts.push({ id: d.id, k: 0, up: Math.random() < 0.5 });
        // 星
        const col = busy ? C.busy : on ? C.on : C.off;
        const rr = (busy ? 9 : on ? 7 : 5) * (d.id === me ? 1.25 : 1);
        const gl = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 4);
        gl.addColorStop(0, `rgba(${col},${on ? C.glow : C.glow / 3})`); gl.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gl; g.beginPath(); g.arc(p.x, p.y, rr * 4, 0, 7); g.fill();
        g.fillStyle = `rgb(${col})`; g.beginPath(); g.arc(p.x, p.y, rr * (busy ? 1 + 0.15 * Math.sin(t / 200 + p.a * 9) : 1), 0, 7); g.fill();
        if (d.id === me) { g.strokeStyle = C.ring; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, rr + 6, 0, 7); g.stroke(); }
        g.fillStyle = on ? C.nameOn : C.nameOff; g.font = "12px 'Microsoft YaHei UI', sans-serif";
        g.fillText(`${d.member} · ${d.name}`, p.x, p.y + rr + 18);
        g.fillStyle = busy ? C.subBusy : C.sub; g.font = "11px 'Microsoft YaHei UI', sans-serif";
        g.fillText(busy && d.task ? `${d.task.name} ${Math.round((d.task.progress || 0) * 100)}%` : on ? (d.gpu || "在线") : "离线", p.x, p.y + rr + 33);
      }
      // 光点
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i], p = pos[q.id];
        q.k += 0.018;
        if (!p || q.k >= 1) { parts.splice(i, 1); continue; }
        const k = q.up ? q.k : 1 - q.k;
        const x = p.x + (cx - p.x) * k, y = p.y + (cy - p.y) * k;
        g.fillStyle = q.up ? C.up : C.down; g.shadowColor = g.fillStyle; g.shadowBlur = 10;
        g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); g.shadowBlur = 0;
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    return { set(list, myId) { devices = list || []; me = myId; place(devices); }, resize };
  };
})();
