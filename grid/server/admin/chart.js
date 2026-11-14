// 小折线图（训练曲线）：不用第三方库
window.LaoChart = function draw(cv, series, opt = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 400, H = cv.clientHeight || +cv.getAttribute("height") || 180;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const pts = (series || []).filter((p) => isFinite(p[0]) && isFinite(p[1])).slice().sort((a, b) => a[0] - b[0]);
  const L = 52, R = 10, T = 10, B = 22;
  g.font = "11px Consolas, monospace";
  if (pts.length < 2) { g.fillStyle = "#5b6a8c"; g.textAlign = "center"; g.fillText(opt.empty || "等第一批数据…", W / 2, H / 2); return; }
  const log = opt.log !== false && pts.every((p) => p[1] > 0);
  const fy = (v) => (log ? Math.log10(v) : v);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => fy(p[1]));
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 === x0) x1 = x0 + 1; if (y1 === y0) { y1 += 0.5; y0 -= 0.5; }
  const px = (x) => L + (x - x0) / (x1 - x0) * (W - L - R), py = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  g.strokeStyle = "rgba(120,170,255,.1)"; g.fillStyle = "#5b6a8c"; g.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = y0 + (y1 - y0) * i / 4, Y = py(y);
    g.beginPath(); g.moveTo(L, Y); g.lineTo(W - R, Y); g.stroke();
    const v = log ? Math.pow(10, y) : y;
    g.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : Math.abs(v) >= 0.01 || v === 0 ? v.toFixed(3) : v.toExponential(1), L - 6, Y + 4);
  }
  g.textAlign = "center"; g.fillText(String(Math.round(x0)), L, H - 6); g.fillText(String(Math.round(x1)), W - R - 10, H - 6);
  const grad = g.createLinearGradient(0, T, 0, H - B);
  const c = opt.color || "#36e2ff";
  grad.addColorStop(0, c + "55"); grad.addColorStop(1, c + "00");
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, px(p[0]), py(fy(p[1]))));
  g.lineTo(px(pts[pts.length - 1][0]), H - B); g.lineTo(px(pts[0][0]), H - B); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, px(p[0]), py(fy(p[1]))));
  g.strokeStyle = c; g.lineWidth = 2; g.shadowColor = c; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
  const last = pts[pts.length - 1];
  g.beginPath(); g.arc(px(last[0]), py(fy(last[1])), 4, 0, 7); g.fillStyle = "#fff"; g.fill();
};

// 平滑（指数滑动平均）：训练曲线抖得厉害时看趋势；k 越大越平
window.LaoChart.smooth = (pts, k = 0.9) => { let m = null; return pts.map((p) => { m = m == null ? p[1] : m * k + p[1] * (1 - k); return [p[0], m]; }); };

// 好几条线画在一起（比如模型每一版的几项评测）：series = [{ name, color, pts: [[x, y]...] }]，带图例；xLabel(x) 画横轴字
window.LaoChart.multi = function (cv, series, opt = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 400, H = cv.clientHeight || 200;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.font = "11px Consolas, monospace";
  const all = series.flatMap((s) => s.pts.filter((p) => isFinite(p[0]) && isFinite(p[1])));
  if (!all.length) { g.fillStyle = "#5b6a8c"; g.textAlign = "center"; g.fillText(opt.empty || "还没有数据", W / 2, H / 2); return; }
  const L = 52, R = 12, T = 22, B = 22;
  let x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  if (opt.y0 != null) y0 = Math.min(y0, opt.y0);
  if (x1 === x0) { x0 -= 1; x1 += 1; } if (y1 === y0) { y1 += Math.abs(y1) * 0.1 || 0.5; y0 -= Math.abs(y0) * 0.1 || 0.5; }
  const px = (x) => L + (x - x0) / (x1 - x0) * (W - L - R), py = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  g.strokeStyle = "rgba(120,170,255,.1)"; g.fillStyle = "#5b6a8c"; g.textAlign = "right";
  for (let i = 0; i <= 4; i++) { const y = y0 + (y1 - y0) * i / 4, Y = py(y); g.beginPath(); g.moveTo(L, Y); g.lineTo(W - R, Y); g.stroke(); g.fillText(Math.abs(y) >= 100 ? y.toFixed(0) : Math.abs(y) >= 1 ? y.toFixed(2) : y.toFixed(3), L - 6, Y + 4); }
  g.textAlign = "center";
  const xs = [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(xs.length / 8));
  xs.forEach((x, i) => { if (i % step === 0 || i === xs.length - 1) g.fillText(opt.xLabel ? opt.xLabel(x) : String(x), px(x), H - 6); });
  let lx = L;
  for (const s of series) {
    const pts = s.pts.filter((p) => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
    g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = 2;
    if (pts.length > 1) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, px(p[0]), py(p[1]))); g.setLineDash(s.dash ? [5, 4] : []); g.stroke(); g.setLineDash([]); }
    for (const p of pts) { g.beginPath(); g.arc(px(p[0]), py(p[1]), p[2] === "bad" ? 4 : 3, 0, 7); if (p[2] === "bad") { g.strokeStyle = "#ff6b8b"; g.stroke(); g.strokeStyle = s.color; } else g.fill(); }
    g.textAlign = "left"; g.fillRect(lx, 6, 10, 3); g.fillStyle = "#9fb0d8"; g.fillText(s.name, lx + 14, 11); lx += 22 + g.measureText(s.name).width;
  }
};

// 堆叠柱状图（每天每台电脑算了多久）：days = ["11-01", ...]，stacks = [{ name, color, vals: [...] }]
window.LaoChart.bars = function (cv, days, stacks, opt = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 400, H = cv.clientHeight || 200;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.font = "11px Consolas, monospace";
  const L = 44, R = 10, T = 22, B = 22;
  const tot = days.map((_, i) => stacks.reduce((s, x) => s + (x.vals[i] || 0), 0));
  const max = Math.max(1e-9, ...tot);
  if (!days.length || max <= 1e-9) { g.fillStyle = "#5b6a8c"; g.textAlign = "center"; g.fillText(opt.empty || "还没有数据", W / 2, H / 2); return; }
  const bw = (W - L - R) / days.length;
  g.strokeStyle = "rgba(120,170,255,.1)"; g.fillStyle = "#5b6a8c"; g.textAlign = "right";
  for (let i = 0; i <= 4; i++) { const v = max * i / 4, Y = T + (1 - v / max) * (H - T - B); g.beginPath(); g.moveTo(L, Y); g.lineTo(W - R, Y); g.stroke(); g.fillText(opt.fmt ? opt.fmt(v) : v.toFixed(1), L - 6, Y + 4); }
  days.forEach((d, i) => {
    let y = H - B;
    for (const s of stacks) { const v = s.vals[i] || 0, h = v / max * (H - T - B); g.fillStyle = s.color; g.fillRect(L + i * bw + bw * 0.15, y - h, bw * 0.7, h); y -= h; }
    const every = Math.max(1, Math.ceil(44 / bw));
    if (i % every === 0 || i === days.length - 1) { g.fillStyle = "#5b6a8c"; g.textAlign = "center"; g.fillText(d, L + i * bw + bw / 2, H - 6); }
  });
  let lx = L; g.textAlign = "left";
  for (const s of stacks) { g.fillStyle = s.color; g.fillRect(lx, 6, 10, 8); g.fillStyle = "#9fb0d8"; g.fillText(s.name, lx + 14, 13); lx += 24 + g.measureText(s.name).width; if (lx > W - 80) break; }
};
window.LaoChart.COLORS = ["#36e2ff", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#4ade80", "#e879f9", "#38bdf8"];
