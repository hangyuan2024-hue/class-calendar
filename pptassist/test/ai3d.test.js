// AI 3D 形象：找整合包、跑工坊（假的）、读进度、出错、停止
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const AI3D = require("../core/ai3d");
const ok = (m) => console.log("✓ " + m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai3d-"));
  assert.equal(AI3D.inspect(path.join(tmp, "nope")).ok, false);
  assert.equal(AI3D.inspect(tmp).ok, false);
  const hy = path.join(tmp, "Hunyuan3D-2", "hy3dgen", "shapegen"); fs.mkdirSync(hy, { recursive: true }); fs.writeFileSync(path.join(hy, "__init__.py"), "");
  const r = AI3D.inspect(tmp);
  assert.equal(r.ok, true); assert.equal(r.hy, path.join(tmp, "Hunyuan3D-2")); assert.equal(r.ownPython, false);
  assert.ok(AI3D.libDir().endsWith("ai3d") && fs.existsSync(path.join(AI3D.libDir(), "lao3d", "run.py")));
  assert.equal(path.join("x", "app.asar", "ai3d").replace(/app\.asar([\\/])/, "app.asar.unpacked$1"), path.join("x", "app.asar.unpacked", "ai3d"));
  ok("找整合包：要有 Hunyuan3D-2 的代码或 Python；打包后工坊在 app.asar.unpacked 里");

  const ai = AI3D.create({ cmd: process.execPath, argsPrefix: [path.join(__dirname, "fake-lao3d.js")], lib: tmp });
  const seen = [];
  const done = await ai.run(r, ["check"], (m) => seen.push(m));
  assert.equal(done.done, true); assert.equal(done.info.hy, true); assert.ok(seen.some((m) => m.p === 0.5));
  assert.ok(ai.log.some((l) => l.includes("普通日志")));
  await assert.rejects(ai.run(r, ["bad"]), /显存不够了/);
  await assert.rejects(ai.run(r, ["silent"]), /退出码 3[\s\S]*什么都没说/);
  ok("跑工坊：进度一条条收到；出错时报工坊说的原因，没说就带上最后几行日志");

  const p = ai.run(r, ["slow"]);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(ai.state().busy, true);
  await assert.rejects(ai.run(r, ["check"]), /还没做完/);
  ai.cancel();
  await assert.rejects(p, /停了/);
  assert.equal(ai.state().busy, false);
  await assert.rejects(ai.run(null, ["check"]), /整合包/);
  ok("一次只做一件；能停");
  console.log("AI 3D 形象：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
