// Q版动画：找背景、图层对齐、找出变了的嘴 / 眼睛、找脖子；动作（嘴不闪、会眨眼、各种动作的方向）
"use strict";
const assert = require("assert");
const P = require("../renderer/puppet");
const ok = (m) => console.log("✓ " + m);

// 画一个假的 Q版小人：白底、大圆头、两只眼睛、嘴、细脖子、身子、两条腿
function chibi(w, h, o = {}) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  const dx = o.dx || 0, dy = o.dy || 0;
  const put = (x, y, c) => { x += dx; y += dy; if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; };
  const circle = (cx, cy, r, c) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, c); };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c); };
  const skin = [246, 211, 191], hair = [60, 40, 30], shirt = [70, 110, 200];
  rect(80, 205, 120, 225, skin);              // 脖子
  rect(55, 222, 145, 320, shirt);             // 身子
  rect(70, 320, 95, 380, [50, 50, 60]); rect(105, 320, 130, 380, [50, 50, 60]);   // 腿
  circle(100, 120, 90, hair); circle(100, 130, 80, skin);   // 头发、脸
  if (o.blink) { rect(62, 128, 82, 132, [40, 30, 30]); rect(118, 128, 138, 132, [40, 30, 30]); }
  else { circle(72, 130, 10, [40, 30, 30]); circle(128, 130, 10, [40, 30, 30]); circle(75, 126, 3, [255, 255, 255]); circle(131, 126, 3, [255, 255, 255]); }
  if (o.open) { rect(85, 160, 115, 185, [150, 40, 50]); rect(90, 175, 110, 183, [240, 120, 130]); }
  else rect(88, 168, 112, 172, [150, 40, 50]);
  return { data: d, width: w, height: h };
}

const W = 200, H = 400;
const fig = chibi(W, H);
const bg = P.bgOf(fig); assert.deepStrictEqual(bg, [255, 255, 255]);
const fg = P.fgMask(fig, bg);
assert.equal(fg[5 * W + 5], 0); assert.equal(fg[130 * W + 100], 1); assert.equal(fg[126 * W + 75], 1);   // 眼睛里的白点不算背景
ok("背景：从四边连成一片的白色才是背景，脸上的白色高光不算");

const rig = P.analyze(fig, { mouthOpen: chibi(W, H, { open: true, dx: 3, dy: -2 }), eyesClosed: chibi(W, H, { blink: true, dx: -1, dy: 1 }), mouthHalf: chibi(W, H, { open: true }) });
assert.ok(rig.ok, JSON.stringify(rig.warn));
const mo = rig.layers.mouthOpen;
assert.deepStrictEqual([mo.dx, mo.dy], [3, -2]);
assert.ok(mo.box[0] <= 85 && mo.box[2] >= 115 && mo.box[1] <= 160 && mo.box[3] >= 185 && mo.box[3] < 205, JSON.stringify(mo.box));
assert.ok(mo.box[1] > 140, "嘴的范围不该到眼睛");
const ey = rig.layers.eyesClosed;
assert.deepStrictEqual([ey.dx, ey.dy], [-1, 1]);
assert.ok(ey.box[0] <= 62 && ey.box[2] >= 138 && ey.box[1] <= 120 && ey.box[3] < 160, JSON.stringify(ey.box));
ok("图层对齐：AI 改图时挪了几个像素也能对上；找出张嘴的那块、两只眼睛那块（不多拿）");
assert.ok(Math.abs(rig.neck - 212) < 12, "脖子 " + rig.neck); assert.ok(Math.abs(rig.pivot[0] - 100) < 4);
ok("脖子：大头下面最窄的地方；头绕着脖子转");

// 改动太大的图层不用
const bad = chibi(W, H, { open: true }); for (let i = 0; i < bad.data.length; i += 4) if (bad.data[i + 2] === 200 || bad.data[i] === 50 || bad.data[i] === 60) { bad.data[i] = 220; bad.data[i + 1] = 40; bad.data[i + 2] = 40; }
const r2 = P.analyze(fig, { mouthOpen: bad });
assert.ok(!r2.layers.mouthOpen && r2.warn.some((w) => /改动太大/.test(w)));
const r3 = P.analyze(fig, { mouthOpen: chibi(W, H) });
assert.ok(!r3.layers.mouthOpen && r3.warn.some((w) => /几乎一样/.test(w)));
ok("图层改得太多（衣服都变了）或者根本没改：不用，提示重新画");

const pk = P.pack(rig);
assert.equal(typeof pk.layers.mouthOpen.mask, "string");
const m = P.unpackMask(pk.layers.mouthOpen.mask, mo.mw * mo.mh);
assert.ok(Math.abs(m[Math.floor(mo.mh / 2) * mo.mw + Math.floor(mo.mw / 2)] - 1) < 0.01 && m[0] < 0.2);
assert.ok(JSON.stringify(pk).length < 2e5);
ok("动画数据能存：遮罩压成 base64，中间实、边上虚");

// 动作
const mt = P.motion({ side: "right" });
let flips = 0, last = 0, blinks = 0, prevBlink = false;
for (let f = 0; f < 25 * 20; f++) { mt.talk(f % 2 ? 0.9 : 0); const s = mt.step(0.04); if (s.mouth !== last) flips++; last = s.mouth; if (s.blink && !prevBlink) blinks++; prevBlink = s.blink; }
assert.ok(flips < 260, "嘴换得太勤 " + flips);
assert.ok(blinks >= 4 && blinks <= 12, "20 秒眨了 " + blinks + " 次");
const mt2 = P.motion({ side: "right" }); mt2.mood("point"); let s; for (let i = 0; i < 50; i++) s = mt2.step(0.04);
assert.ok(s.lean < 0 && s.rot < 0, "形象在右边：往左边（幻灯片那边）侧身");
const mt3 = P.motion({ side: "left" }); mt3.mood("point"); for (let i = 0; i < 50; i++) s = mt3.step(0.04);
assert.ok(s.lean > 0);
const mt4 = P.motion(); mt4.mood("think"); for (let i = 0; i < 50; i++) s = mt4.step(0.04); assert.ok(s.rot > 0.08);
const mt5 = P.motion(); mt5.mood("wave"); let hop = 0; for (let i = 0; i < 50; i++) hop = Math.max(hop, mt5.step(0.04).hop); assert.ok(hop > 0.008);
ok("动作：嘴不乱闪、20 秒眨 4～12 次；指幻灯片往幻灯片那边侧身、想一想歪头、挥手轻轻蹦");
console.log("Q版动画：全部通过");
