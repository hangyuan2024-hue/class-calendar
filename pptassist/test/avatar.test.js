// 公仔（国潮手办）：距离场捏出来的头和头发（renderer/avatar3d.js 里不碰浏览器的那部分）
"use strict";
const assert = require("assert");
require("../renderer/avatar3d.js");
const L = globalThis.LaoAvatar, SC = L.sculpt;
const ok = (m) => console.log("✓ " + m);

// 网格：每个三角形的法线朝外、点都在表面上
{
  const m = SC.mesh(SC.sphere(0, 0, 0, 0.2), [-0.25, -0.25, -0.25], [0.25, 0.25, 0.25], 0.01);
  let out = 0, all = 0, err = 0;
  for (let i = 0; i < m.idx.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.pos[m.idx[i + k] * 3 + j]));
    const u = a.map((x, j) => b[j] - x), v = a.map((x, j) => c[j] - x), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    all++; if (n[0] * (a[0] + b[0] + c[0]) + n[1] * (a[1] + b[1] + c[1]) + n[2] * (a[2] + b[2] + c[2]) > 0) out++;
  }
  for (let i = 0; i < m.pos.length; i += 3) err = Math.max(err, Math.abs(Math.hypot(m.pos[i], m.pos[i + 1], m.pos[i + 2]) - 0.2));
  assert.equal(out, all); assert.ok(err < 1e-4, err);
  ok("距离场 → 网格：面都朝外，点都在表面上");
}
// 每种发型 × 刘海都捏得出来，头发在头的周围（不会飞出去）、脸前面是空的（不挡眼睛）
{
  for (const st of L.STYLES) for (const b of ["full", "side", "middle", "none"]) {
    const s = L.figShapes(st, b, "oval");
    assert.ok(s.head.pos.length > 3000);
    if (st === "none") { assert.equal(s.hair.length, 0); continue; }
    assert.ok(s.hair.length >= 1 && s.hair.every((h) => h.pos.length > 300), st + b);
    for (const h of s.hair) for (let i = 0; i < h.pos.length; i += 3) {
      const x = h.pos[i], y = h.pos[i + 1], z = h.pos[i + 2];
      assert.ok(Math.abs(x) < 0.34 && y > -0.33 && y < 0.5 && z > -0.4 && z < 0.27, `${st}/${b}: ${x},${y},${z}`);
      assert.ok(!(Math.abs(x) < 0.09 && y > 0.09 && y < 0.17 && z > 0.12), `${st}/${b} 头发挡住了眼睛：${x},${y},${z}`);
    }
  }
  ok("8 种发型 × 4 种刘海都捏得出来；头发不挡眼睛");
}
// 衣服颜色归到中国传统色
{
  assert.equal(L.guoColor(0x111111).name, "玄青"); assert.equal(L.guoColor(0xffffff).name, "月白");
  assert.equal(L.guoColor(0xd03020).name, "朱红"); assert.equal(L.guoColor(0x2050a0).name, "靛青");
  assert.equal(L.guoColor(0x3a8a6a).name, "松绿");
  const p = L.sanitize({ faceShape: "long", part: "right" }); assert.equal(p.faceShape, "long"); assert.equal(p.part, "right");
  const q = L.sanitize({ faceShape: "<x>", part: 3 }); assert.equal(q.faceShape, "round"); assert.equal(q.part, "left");
  ok("衣服颜色归到中国传统色；脸型、分缝洗一遍再用");
}
console.log("公仔：全部通过");
