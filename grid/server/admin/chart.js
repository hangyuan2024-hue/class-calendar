// 小折线图（训练曲线）：不用第三方库
window.LaoChart = function draw(cv, series, opt = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 400, H = cv.clientHeight || +cv.getAttribute("height") || 180;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const pts = (series || []).filter((p) => isFinite(p[0]) && isFinite(p[1]));
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
