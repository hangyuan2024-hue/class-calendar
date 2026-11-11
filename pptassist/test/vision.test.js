// 认脸、认发型、挑视频帧、截声音（renderer/vision.js 里不碰浏览器的那部分）：用画出来的假人测
"use strict";
const assert = require("assert");
const V = require("../renderer/vision.js");
const ok = (m) => console.log("✓ " + m);

// 一个假人：脸（椭圆）+ 头发（按样式画）+ 肩膀和衣服；脸上的点按 MediaPipe 的编号放
function person({ W = 400, H = 520, hair = "long", bangs = "none", hairRGB = [28, 22, 20], skinRGB = [236, 196, 172], shirtRGB = [70, 110, 190] } = {}) {
  const cx = 200, cy = 200, rx = 70, ry = 92;   // 脸
  const data = new Uint8ClampedArray(W * H * 4), person = new Float32Array(W * H);
  const set = (x, y, c, p = 1) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = y * W + x; data.set([...c, 255], i * 4); person[i] = p; };
  for (let i = 0; i < W * H; i++) data.set([245, 245, 245, 255], i * 4);
  const inE = (x, y, ex, ey, ax, ay) => ((x - ex) / ax) ** 2 + ((y - ey) / ay) ** 2 <= 1;
  const chinY = cy + ry, topY = cy - ry;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // 肩膀和衣服（下巴往下 0.45 个脸高开始变宽）、脖子
    const sh = chinY + 0.45 * 2 * ry;
    if (y > sh && Math.abs(x - cx) < 170) set(x, y, shirtRGB);
    else if (y > chinY - 10 && y <= sh && Math.abs(x - cx) < 32) set(x, y, skinRGB);
    // 头发：头顶一顶「帽子」，长的话两边垂下来
    const capped = inE(x, y, cx, cy - 18, rx + 16, ry + 14) && y < cy;
    const len = { short: cy - 10, bob: chinY + 30, long: H }[hair];
    const side = Math.abs(x - cx) > rx - 6 && Math.abs(x - cx) < rx + 30 && y >= cy - 20 && y < len;
    if (hair !== "none" && (capped || side)) set(x, y, hairRGB);
    if (inE(x, y, cx, cy, rx, ry)) set(x, y, skinRGB);
    // 刘海
    const fy0 = topY, fy1 = cy - 45;
    if (y >= fy0 && y < fy1 && inE(x, y, cx, cy, rx, ry)) {
      const u = (x - (cx - rx)) / (2 * rx);
      if (bangs === "full" || (bangs === "side" && u < 0.62 - (y - fy0) / (fy1 - fy0) * 0.25) || (bangs === "middle" && (u < 0.3 || u > 0.7))) set(x, y, hairRGB);
    }
  }
  // 脸上的点
  const lm = Array.from({ length: 478 }, () => [cx, cy, 0]);
  V.LM.oval.forEach((k, j) => { const a = -Math.PI / 2 + (j / V.LM.oval.length) * Math.PI * 2; lm[k] = [cx + rx * Math.cos(a), cy + ry * Math.sin(a), 0]; });
  lm[V.LM.edgeR] = [cx - rx, cy, 0]; lm[V.LM.edgeL] = [cx + rx, cy, 0]; lm[V.LM.top] = [cx, topY, 0]; lm[V.LM.chin] = [cx, chinY, 0];
  const eyeY = cy - 22;
  for (const [k, x, y] of [[V.LM.eyeRo, cx - 50, eyeY], [V.LM.eyeRi, cx - 18, eyeY], [V.LM.eyeLo, cx + 50, eyeY], [V.LM.eyeLi, cx + 18, eyeY], [V.LM.eyeRt, cx - 34, eyeY - 6], [V.LM.eyeRb, cx - 34, eyeY + 6], [V.LM.eyeLt, cx + 34, eyeY - 6], [V.LM.eyeLb, cx + 34, eyeY + 6],
    [V.LM.irisR, cx - 34, eyeY], [V.LM.irisL, cx + 34, eyeY], [V.LM.lipT, cx, cy + 45], [V.LM.lipB, cx, cy + 49], [V.LM.mouthR, cx - 22, cy + 47], [V.LM.mouthL, cx + 22, cy + 47], [V.LM.nose, cx, cy + 15]]) lm[k] = [x, y, 0];
  V.LM.browR.forEach((k, j) => (lm[k] = [cx - 60 + j * 9, eyeY - 18, 0])); V.LM.browL.forEach((k, j) => (lm[k] = [cx + 60 - j * 9, eyeY - 18, 0]));
  V.LM.cheekR.forEach((k, j) => (lm[k] = [cx - 40 + j * 4, cy + 18, 0])); V.LM.cheekL.forEach((k, j) => (lm[k] = [cx + 40 - j * 4, cy + 18, 0]));
  return { im: { w: W, h: H, data }, lm, person };
}

const cases = [
  [{ hair: "long", bangs: "none" }, "long"], [{ hair: "bob", bangs: "none" }, "bob"], [{ hair: "short", bangs: "none" }, "short"],
  [{ hair: "long", bangs: "full" }, "long", "full"], [{ hair: "bob", bangs: "side" }, "bob", "side"], [{ hair: "long", bangs: "middle" }, "long", "middle"],
];
for (const [o, style, bangs] of cases) {
  const p = person(o), r = V.hairFront(p.im, p.lm, p.person);
  assert.ok(r.ok, JSON.stringify(o));
  assert.equal(r.style, style, `${JSON.stringify(o)} → ${r.style}（${r.text}）`);
  if (bangs) assert.equal(r.bangs, bangs, `${JSON.stringify(o)} → 刘海 ${r.bangs}（${JSON.stringify(r.detail)}）`);
}
ok("认发型：长发 / 齐肩 / 短发，齐刘海 / 斜刘海 / 中分刘海");
{
  const p = person({ hair: "long" }), r = V.hairFront(p.im, p.lm, p.person);
  assert.equal(r.text.slice(0, 2), "黑色"); assert.equal(r.top, "#466ebe");
  const b = person({ hair: "bob", hairRGB: [214, 180, 120] }), rb = V.hairFront(b.im, b.lm, b.person);
  assert.ok(/金色|浅棕色/.test(rb.text), rb.text);
  const s = person({ hair: "short" }), rs = V.hairFront(s.im, s.lm, s.person);
  assert.ok(rs.tiedPossible && rs.notes.some((n) => /扎起来/.test(n)));
  const bald = person({ hair: "none" }), rn = V.hairFront(bald.im, bald.lm, bald.person);
  assert.equal(rn.ok, false);
  ok("颜色：头发黑色 / 金色、上衣的颜色；短发提醒可能是扎起来的；看不到头发就不乱认");
  const sc = person({ hair: "short", hairRGB: [244, 206, 186] }), rsc = V.hairFront(sc.im, sc.lm, sc.person);
  assert.equal(rsc.style, "none", JSON.stringify(rsc.detail)); assert.ok(/光头/.test(rsc.text));
  ok("光头：头顶是皮肤色（头皮）→ 公仔不要头发");
  const back = { ok: true, style: "ponytail" }, m = V.mergeHair(rs, back);
  assert.equal(m.style, "ponytail"); assert.ok(/马尾/.test(m.text) && !m.notes.some((n) => /扎起来/.test(n)));
  ok("正脸 + 后脑勺：后脑勺看到马尾就改成马尾");
}
{
  assert.equal(V.faceShapeOf({ fw: 100, fh: 145, jaw: 0.8 }), "long"); assert.equal(V.faceShapeOf({ fw: 100, fh: 128, jaw: 0.9 }), "square");
  assert.equal(V.faceShapeOf({ fw: 100, fh: 112, jaw: 0.8 }), "round"); assert.equal(V.faceShapeOf({ fw: 100, fh: 125, jaw: 0.8 }), "oval");
  ok("脸型：长脸 / 方脸 / 圆脸 / 鹅蛋脸");
  const p = person({}), P = V.pose(p.lm);
  assert.ok(Math.abs(P.yaw) < 1 && P.eyeOpen > 0.3);
  const m = V.marksOf(p.lm); assert.deepStrictEqual(m.e1, [166, 178]); assert.deepStrictEqual(m.mouth, [200, 247]);
  const turned = p.lm.map((q) => [...q]); turned[V.LM.edgeL][2] = 60; turned[V.LM.edgeR][2] = -60;
  assert.ok(V.pose(turned).yaw > 35);
  const f = (yaw, sharp = 50, eye = 0.3) => ({ face: { yaw, pitch: 0, eyeOpen: eye, mouthOpen: 0, sharp, fw: 200 }, person: 0.3 });
  assert.ok(V.frameScore(f(0)) > V.frameScore(f(20)) && V.frameScore(f(0)) > V.frameScore(f(0, 50, 0.05)) && V.frameScore({ face: null }) === 0);
  const pv = V.pickViews([{ t: 0, ...f(25) }, { t: 1, ...f(2) }, { t: 2, ...f(55) }, { t: 3, ...f(-60) }, { t: 4, face: null, person: 0.3, headHair: 0.9 }]);
  assert.equal(pv.front.t, 1); assert.equal(pv.left.t, 2); assert.equal(pv.right.t, 3); assert.equal(pv.back.t, 4);
  ok("头朝哪边、三个点、给帧打分：正脸、两边侧脸、后脑勺各挑一帧");
}
{
  const sr = 16000, x = new Float32Array(sr * 12);
  for (let i = sr; i < sr * 7.5; i++) x[i] = 0.3 * Math.sin(i / 9) * (0.6 + 0.4 * Math.sin(i / 3000));
  for (let i = sr * 9; i < sr * 9.6; i++) x[i] = 0.3 * Math.sin(i / 9);
  const [a, b] = V.speechSpan(x, sr);
  assert.ok(a > 0.7 && a < 1.0 && b > 7.5 && b < 7.8, [a, b].join(","));
  assert.equal(V.speechSpan(new Float32Array(sr * 5), sr), null);
  ok("截配音参考：挑连着说话的 3～10 秒，两头留一点点空；全是静音就不截");
}
{
  // 后脑勺：头是一团头发，脖子、肩膀是衣服；马尾 = 脖子后面垂下来窄窄一条，丸子头 = 头顶一个小球，长发 = 宽宽一片垂到背上
  const back = (kind) => {
    const W = 300, H = 600, data = new Uint8ClampedArray(W * H * 4), person = new Float32Array(W * H), cx = 150, cy = 130, R = 60;
    for (let i = 0; i < W * H; i++) data.set([245, 245, 245, 255], i * 4);
    const set = (x, y, c) => { const i = y * W + x; data.set([...c, 255], i * 4); person[i] = 1; };
    const hairC = [25, 20, 18], shirt = [200, 205, 215], skin = [230, 190, 170];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      if (y > cy + R + 40 && Math.abs(dx) < 130) set(x, y, shirt);
      else if (y > cy + 20 && y <= cy + R + 40 && Math.abs(dx) < 28) set(x, y, skin);
      if (dx * dx + (dy * 1.1) ** 2 <= R * R) set(x, y, hairC);
      if (kind === "bun" && dx * dx + (y - (cy - R - 12)) ** 2 <= 22 * 22) set(x, y, hairC);
      if (kind === "ponytail" && y > cy && y < cy + R + 170 && Math.abs(dx) < 14) set(x, y, hairC);
      if (kind === "long" && y > cy && y < cy + R + 260 && Math.abs(dx) < R + 4) set(x, y, hairC);
    }
    return V.hairBack({ w: W, h: H, data }, person, "#191412");
  };
  for (const k of ["ponytail", "bun", "long", "short"]) { const r = back(k); assert.equal(r.style, k, k + " → " + JSON.stringify(r)); }
  ok("后脑勺：认出马尾、丸子头、披着的长发、短发");
}
console.log("认脸和发型：全部通过");
