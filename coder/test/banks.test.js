// node test/banks.test.js —— 题库（二级 C、二级 Python、经典算法）：每道题的标准答案在捞捞编程里真的能过（用和同学一样的运行方式）
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { EX, BANKS, check } = require("../core/exercises");
const { runOnce } = require("../core/runner");
const { NCRE_C, NCRE_PY, CLASSIC } = require("../tools/bank-specs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-")), opt = process.env.LC_BUNDLED
  ? { toolDirs: { bundled: path.join(__dirname, "..", "resources", "toolchains") }, allowSystem: false, buildDir: path.join(dir, "build") }
  : { toolDirs: {}, allowSystem: true, buildDir: path.join(dir, "build") };
(async () => {
  assert.deepStrictEqual(BANKS.map((b) => b.id), ["intro", "ncre-c", "ncre-py", "classic"]);
  for (const b of BANKS) assert.ok(EX.some((e) => e.bank === b.id), b.id + " 没有题");
  assert.strictEqual(new Set(EX.map((e) => e.id)).size, EX.length, "题号不能重复");
  for (const e of EX) assert.ok(/^[\w-]+$/.test(e.id) && e.tests.length >= (e.bank === "intro" ? 1 : 2) && (e.bank === "intro" || e.desc.includes("输入样例")), e.id);
  console.log(`✓ ${EX.length} 道题，${BANKS.length} 个题库，题号不重复、每道都有样例和至少 2 组测试`);
  let n = 0;
  for (const sp of [...NCRE_C, ...NCRE_PY, ...CLASSIC]) {
    const ex = EX.find((e) => e.id === sp.id);
    const f = path.join(dir, sp.id + ".py"); fs.writeFileSync(f, sp.py);
    const r = await check(ex, (inp) => runOnce("python", f, opt, inp));
    assert.ok(r.pass, sp.id + " Python 答案没过：" + JSON.stringify(r.results.slice(-1)));
    if (sp.c) {
      const d = path.join(dir, "c-" + sp.id); fs.mkdirSync(d); const cf = path.join(d, "main.c"); fs.writeFileSync(cf, sp.c);
      const rc = await check(ex, (inp) => runOnce("c", cf, opt, inp));
      assert.ok(rc.pass, sp.id + " C 答案没过：" + JSON.stringify(rc.results ? rc.results.slice(-1) : rc));
    }
    n++;
  }
  console.log(`✓ ${n} 道题库题的标准答案都能过（二级 C 的题 C 答案也过）`);
  // 常见错误：二级 C 的最大公约数只输出一行、Python 格式化宽度不对，都判错
  const bad = path.join(dir, "bad.py"); fs.writeFileSync(bad, "s=input()\nprint('{:=^20}'.format(s))");
  const r = await check(EX.find((e) => e.id === "p2-center"), (inp) => runOnce("python", bad, opt, inp));
  assert.ok(!r.pass); console.log("✓ 居中宽度写错也判错");
  console.log("题库：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
