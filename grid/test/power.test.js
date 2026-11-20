// 训练时临时「最佳性能」：切之前记下原来的，算完按原样切回；没有电源模式滑块的老电脑换成「高性能」计划
"use strict";
const assert = require("assert");
const Power = require("../app/power");
const ok = (m) => console.log("✓", m);
(async () => {
  const mk = (over) => { const calls = []; const p = Power.create({ platform: "win32", spawn: () => { throw new Error("no"); }, execFile: async (cmd, args) => { calls.push([cmd, ...args].join(" ")); if (cmd === "reg") return "    ActiveOverlayAcPowerScheme    REG_SZ    961cc777-2547-4f9d-8174-7d86181b8a7a"; if (args[0] === "/getactivescheme") return "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)"; if (over && args[0] === "/overlaysetactive" && args[1].startsWith("ded5")) throw new Error("Invalid Parameters"); return ""; } }); return { p, calls }; };
  {
    const { p, calls } = mk(false);
    const r = await p.perfBoost(true);
    assert.ok(r.ok && r.saved.how === "overlay" && r.saved.overlay === "961cc777-2547-4f9d-8174-7d86181b8a7a");
    assert.ok(calls.includes("powercfg /overlaysetactive ded574b5-45a0-4f42-8737-46345c09c238"));
    await p.perfBoost(false, r.saved);
    assert.strictEqual(calls[calls.length - 1], "powercfg /overlaysetactive 961cc777-2547-4f9d-8174-7d86181b8a7a", "切回原来的「最省电」");
    ok("有电源模式滑块：切到「最佳性能」，算完切回原来的那一档（不是一律切回平衡）");
  }
  {
    const { p, calls } = mk(true);
    const r = await p.perfBoost(true);
    assert.ok(r.ok && r.saved.how === "scheme");
    assert.ok(calls.includes("powercfg /setactive SCHEME_MIN"));
    await p.perfBoost(false, r.saved);
    assert.strictEqual(calls[calls.length - 1], "powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e");
    ok("老电脑没有滑块：换成「高性能」电源计划，算完切回原来的计划");
  }
  assert.strictEqual((await Power.create({ platform: "linux" }).perfBoost(true)).ok, false);
  ok("不是 Windows：不动");
  console.log("电源模式：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
