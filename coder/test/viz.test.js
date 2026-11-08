// node test/viz.test.js —— 「画出来」：
// 1) 内置算法动画：每种算法的 C 代码真的编译运行，输出要和动画最后一步一样（动画没有骗人）
// 2) 你自己的代码：自动加 SHOW 后能编译、能画出每一步、普通输出照常、行号不变
// 3) 估水平 + 推荐：做对涨分、做错降分，推荐难度跟着变
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { runOnce } = require("../core/runner");
const { locate, byId } = require("../core/langs");
const V = require("../renderer/viz-algos");
const VIZ = require("../core/viz");
const { createService } = require("../core/service");
const { Skill, expect: E } = require("../core/skill");
const { seed, lcDiff } = require("../core/judge");
const ok = (s) => console.log("✓ " + s);
// 打包前的 CI 上用安装包自带的编译器（resources/toolchains），平时用电脑上装好的
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-viz-")), opt = { toolDirs: { bundled: path.join(__dirname, "..", "resources", "toolchains") }, allowSystem: true, buildDir: path.join(dir, "build") };

(async () => {
  // ---------- 3) 先测不用编译器的 ----------
  {
    const sk = new Skill(path.join(dir, "skill.json"));
    assert.strictEqual(sk.d.r, 1000);
    const list = seed();
    assert(list.length >= 60 && list.every((p) => p.url.startsWith("https://leetcode.cn/problems/") && p.tags.length), "自带题库每题都有链接、知识点");
    const r0 = sk.recommend(list, 6);
    assert.strictEqual(r0.length, 6);
    assert(r0.every((p) => p.diff <= 1500), "1000 分的新手不该推困难题：" + r0.map((p) => p.title + p.diff));
    assert(r0.every((p) => p.why), "每道推荐都说为什么");
    // 一路做对中等题 → 分数涨，推荐变难
    const mids = list.filter((p) => p.level === "中等").slice(0, 8);
    let up = 0; for (const p of mids) up += sk.external(p, "solved");
    assert(up > 150 && sk.d.r > 1150, "连续做出中等题要涨分：" + sk.d.r);
    const r1 = sk.recommend(list, 6);
    const avg = (l) => l.reduce((s, p) => s + p.diff, 0) / l.length;
    assert(avg(r1) > avg(r0) + 80, `涨分后推荐要变难：${avg(r0)} → ${avg(r1)}`);
    assert(!r1.some((p) => mids.includes(p) || sk.isDone(p.id)), "做过的不再推");
    // 某个知识点一直做不出来 → 它变成弱项，推荐里优先出现
    const dp = list.filter((p) => p.tags.includes("动态规划")).slice(0, 3);
    for (const p of dp) sk.external(p, "failed");
    const s = sk.summary();
    assert(s.weak.includes("动态规划"), "做不出来的知识点是弱项：" + s.weak);
    assert(sk.recommend(list, 6).some((p) => p.tags.includes("动态规划")), "弱项要推");
    // 跳过的不推
    const top = sk.recommend(list, 1)[0]; sk.skip(top.id);
    assert(!sk.recommend(list, 20).some((p) => p.id === top.id), "跳过的不推");
    // 存下来再读出来一样
    const sk2 = new Skill(path.join(dir, "skill.json")); assert.strictEqual(sk2.d.r, sk.d.r);
    // 软件里的练习
    const ex = { id: "t1", title: "测试", level: 1, topic: "数组 · 循环" };
    const d1 = sk.exercise(ex, true, 1, false); assert(typeof d1 === "number");
    assert(sk.isDone("ex:t1"));
    assert(Math.abs(E(1000, 1000) - 0.5) < 1e-9 && E(1000, 1400) < 0.1);
    assert(lcDiff("EASY", 70) < lcDiff("EASY", 40), "通过率低的题更难");
    ok("估水平 + 推荐：涨分推难题、弱项优先、做过 / 跳过的不推");
  }

  const gcc = locate(byId.c, opt.toolDirs, true);
  if (!gcc) { console.log("- 跳过编译相关（这台电脑没装 gcc）"); return; }

  // ---------- 1) 内置算法的 C 代码和动画一致 ----------
  for (const A of V.ALGOS) {
    const cases = [[5, 3, 8, 1, 9, 2], [1], [2, 1], [4, 4, 4], [10, -3, 7, 0, -3, 15, 2, 8, 1, 6, 11, 5], V.randomData(9), V.randomData(16)];
    for (const data of cases) {
      const x = A.kind === "search" ? (data.length > 2 ? data[1] : 999) : undefined;
      const tr = A.trace(data, x);
      assert(tr.steps.length > 0);
      const code = tr.code.split("\n");
      for (const st of tr.steps) assert(st.line >= 1 && st.line <= code.length, `${A.name} 的步骤行号超出代码：${st.line}`);
      const f = path.join(dir, A.id + ".c"); fs.writeFileSync(f, tr.code);
      const r = await runOnce("c", f, opt, "");
      assert(!r.compileFailed, A.name + " 的 C 代码编译不过：" + r.stderr);
      if (A.kind === "search") {
        const got = +r.stdout.trim();
        assert.strictEqual(got, tr.result, `${A.name} [${data}] 找 ${tr.x}：程序输出 ${got}，动画说 ${tr.result}`);
        if (got >= 0) assert.strictEqual(tr.steps[0].a[got], tr.x);
      } else {
        const last = tr.steps[tr.steps.length - 1].a;
        assert.deepStrictEqual(last, data.slice().sort((p, q) => p - q), A.name + " 动画最后没排好");
        assert.strictEqual(r.stdout.trim(), last.join(" "), `${A.name} [${data}]：程序输出和动画最后一步不一样`);
      }
    }
  }
  ok(`内置 ${V.ALGOS.length} 种算法：C 代码真跑出来的结果 = 动画最后一步（每种 7 组数据）`);

  // ---------- 2) 你自己的代码 ----------
  const svc = createService({ dev: true, res: path.join(__dirname, "..", "resources"), user: path.join(dir, "user"), documents: path.join(dir, "docs"), version: "test", send() {}, trash: async () => {}, reveal() {}, openPath() {}, openExternal() {}, pickDir: async () => null, pickFile: async () => null });
  const ws = (await svc.H.state()).workspace;
  const W = (name, code) => { const f = path.join(ws, name); fs.writeFileSync(f, code); return f; };

  // 函数里排序（参数数组），带 scanf 输入、普通输出、注释里的假赋值、字符串里的假赋值
  const f1 = W("我的冒泡.c", `#include <stdio.h>
#define N 6
// a[0] = 99; 注释里的不算
void sort(int a[], int n) {
    for (int i = 0; i < n - 1; i++)
        for (int j = 0; j < n - 1 - i; j++)
            if (a[j] > a[j + 1]) {
                int t = a[j];
                a[j] = a[j + 1];
                a[j + 1] = t;
            }
}
int main() {
    int a[N];
    for (int i = 0; i < N; i++) scanf("%d", &a[i]);
    printf("a[i] = 排序前\\n");
    sort(a, N);
    for (int i = 0; i < N; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}
`);
  const r1 = await svc.H.vizRun(f1, "5 1 4 2 8 0\n");
  assert(!r1.error && !r1.compileFailed, JSON.stringify(r1).slice(0, 600));
  assert(r1.frames.length >= 5, "要画出好几帧：" + r1.frames.length);
  assert.deepStrictEqual(r1.frames[r1.frames.length - 1].a, [0, 1, 2, 4, 5, 8], "最后一帧是排好的");
  assert(r1.frames.every((fr) => fr.a.length === 6 && fr.name === "a"));
  const src1 = fs.readFileSync(f1, "utf8").split("\n");
  assert(r1.frames.every((fr) => /a\[/.test(src1[fr.line - 1])), "每一帧的行号都指向原文件里给数组赋值的那一行");
  assert(/a\[i\] = 排序前/.test(r1.output) && /0 1 2 4 5 8/.test(r1.output), "程序自己的输出照常：" + r1.output);
  assert(!/LLVIZ/.test(r1.output));
  assert(!fs.readFileSync(f1, "utf8").includes("SHOW"), "原文件不动");

  // 全局数组 + swap 函数 + if/else 单句
  const f2 = W("swap.c", `#include <stdio.h>
int b[] = {3, 9, 1, 7};
void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }
int main(void) {
    int n = 4;
    for (int i = 0; i < n; i++)
        for (int j = i + 1; j < n; j++)
            if (b[j] < b[i])
                swap(&b[i], &b[j]);
            else
                b[i] = b[i];
    for (int i = 0; i < n; i++) printf("%d ", b[i]);
    return 0;
}
`);
  const r2 = await svc.H.vizRun(f2, "");
  assert(!r2.compileFailed, (r2.stderr || "") + "\n" + VIZ.instrument(fs.readFileSync(f2, "utf8")).src);
  assert.deepStrictEqual(r2.frames[r2.frames.length - 1].a, [1, 3, 7, 9]);
  assert(/1 3 7 9/.test(r2.output));

  // 自己写 SHOW2（标出 i、j）
  const f3 = W("手动.c", `#include <stdio.h>
int main(void) {
    int a[5] = {4, 2, 5, 1, 3};
    for (int i = 1; i < 5; i++) {
        int k = a[i], j = i - 1;
        while (j >= 0 && a[j] > k) { a[j + 1] = a[j]; j--; SHOW2(a, 5, j + 1, i); }
        a[j + 1] = k; SHOW2(a, 5, j + 1, i);
    }
    return 0;
}
`);
  const r3 = await svc.H.vizRun(f3, "");
  assert(r3.manual && r3.frames.length > 3 && r3.frames.some((fr) => fr.i >= 0 && fr.j >= 0));
  assert.deepStrictEqual(r3.frames[r3.frames.length - 1].a, [1, 2, 3, 4, 5]);

  // 编译出错：报错里是原文件名、行号不变
  const f4 = W("错.c", `#include <stdio.h>\nint main(void) {\n    int a[3] = {3, 1, 2};\n    a[0] = 1\n    return 0;\n}\n`);
  const r4 = await svc.H.vizRun(f4, "");
  assert(r4.compileFailed && /错\.c/.test(r4.stderr) && !/viz-/.test(r4.stderr), JSON.stringify(r4));
  assert(r4.diags.some((d) => d.line === 4 || d.line === 5), JSON.stringify(r4.diags));

  // 没有数组
  const r5 = await svc.H.vizRun(W("无.c", `#include <stdio.h>\nint main(void){ printf("hi"); return 0; }\n`), "");
  assert(r5.noArray && !r5.frames.length);

  // 死循环：超时停掉，前面的帧还在
  const r6 = await svc.H.vizRun(W("死.c", `int a[2];\nint main(void){ for(;;) { a[0] = a[0] + 1; } }\n`), "");
  assert(r6.timedOut || r6.tooMuch || r6.frames.length > 0);
  ok("你自己的代码：自动加 SHOW、函数里 / 全局数组 / swap / if-else、手动 SHOW2、报错行号、原文件不动");

  // 练习检查会更新水平
  const st = await svc.H.judgeState();
  assert(st.skill && st.bank.lc >= 60);
  const rec = svc.H.judgeRecommend({ n: 5 });
  assert.strictEqual(rec.length, 5);
  const m = svc.H.judgeMark(rec[0].id, "solved");
  assert(m.delta > 0 && m.skill.n === 1);
  ok("刷题接口：题库状态、推荐、标记做出来了");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
