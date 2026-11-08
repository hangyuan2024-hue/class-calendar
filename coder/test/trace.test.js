// node test/trace.test.js —— 「画出来」的一步步追踪（gdb / Python）、在软件里做题（本地判样例、力扣题套 main）、更新失败的提示
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { trace } = require("../core/trace");
const PB = require("../core/problems");
const { createService } = require("../core/service");
const { locate, byId } = require("../core/langs");
const ok = (s) => console.log("✓ " + s);
const warn = (s) => console.log("! " + s);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-trace-"));
const toolDirs = { bundled: path.join(__dirname, "..", "resources", "toolchains") };
const opt = { toolDirs, allowSystem: true, buildDir: path.join(dir, "build"), maxSteps: 1500 };
const W = (name, code) => { const f = path.join(dir, name); fs.writeFileSync(f, code); return f; };
const val = (step, name) => { for (const fr of step.f || []) for (const [n, v] of fr.v || []) if (n === name) return v; for (const [n, v] of step.g || []) if (n === name) return v; return null; };
const nums = (v) => v.v.map((x) => x.v);

(async () => {
  // ---------- 不用编译器的：判题比较、题面解析 ----------
  assert(PB.lcSame("[0,1]", "[0,1]") && PB.lcSame("[0, 1]", "[0,1]") && !PB.lcSame("[1,0]", "[0,1]"));
  assert(PB.lcSame("2.00000", "2.00000") && PB.lcSame("0.33333", "0.333333") && PB.lcSame("\"bab\"", "\"bab\"") && PB.lcSame("true", "true"));
  assert(PB.lcSame("2", "2, nums = [1,2,_]"), "只比返回值");
  assert(PB.cfSame("YES\n", "YES") && PB.cfSame("1 2  3\n", "1 2 3") && !PB.cfSame("1 2", "1 2 3") && PB.cfSame("yes", "YES"));
  assert.deepStrictEqual(PB.lcOutputs('<p><strong>输出：</strong><span class="example-io">[0,1]</span></p><pre><strong>输出：</strong>true\n</pre>'), ["[0,1]", "true"]);
  const cf = PB.parseCodeforces(`<div class="problem-statement"><div class="header"><div class="title">A. Watermelon</div><div class="time-limit"><div class="property-title">time limit per test</div>1 second</div><div class="memory-limit"><div class="property-title">memory limit per test</div>64 megabytes</div></div><div><p>Split $$$w$$$.</p></div><div class="sample-tests"><div class="section-title">Examples</div><div class="sample-test"><div class="input"><div class="title">Input</div><pre><div class="test-example-line test-example-line-even test-example-line-0">8</div></pre></div><div class="output"><div class="title">Output</div><pre>YES
</pre></div></div></div></div>`, "4", "A");
  assert.strictEqual(cf.title, "Watermelon"); assert.deepStrictEqual(cf.samples, [{ input: "8\n", output: "YES\n" }]); assert(/1 second/.test(cf.limits) && !/sample/.test(cf.html));
  assert(PB.harnessSupport({ name: "f", params: [{ type: "integer[]" }], return: { type: "integer" } }, "c") === "");
  assert(PB.harnessSupport({ systemdesign: true }, "c"));
  ok("判题比较、题面解析");

  // ---------- 更新失败：下次打开能看到原因 ----------
  {
    const updater = require("../core/updater");
    const tmp = path.join(dir, "upd"); fs.mkdirSync(tmp, { recursive: true });
    const inst = path.join(tmp, "LaolaoCode-Setup-1.0.9.exe"); fs.writeFileSync(inst, "x");
    fs.writeFileSync(path.join(tmp, "install.log"), "\uFEFF2026-11-08 10:00:01.000   Log opened.\n2026-11-08 10:00:03.000   DeleteFile failed; code 5. 拒绝访问。\n");
    fs.writeFileSync(path.join(tmp, "pending-install.json"), JSON.stringify({ version: "1.0.9", from: "1.0.8", file: inst, log: path.join(tmp, "install.log"), at: Date.now() }));
    const sent = [];
    const u = updater.create({ app: { getVersion: () => "1.0.8" }, fetch: async () => { throw new Error("no"); }, tmpDir: tmp, send: (s) => sent.push(s), spawn: () => ({ on() {}, unref() {} }), opt: { product: "code" } });
    const r = u.checkPending();
    assert(r && r.failed === "1.0.9" && /DeleteFile failed/.test(r.reason), JSON.stringify(r));
    assert.strictEqual(u.state().state, "failed");
    assert(!fs.existsSync(path.join(tmp, "pending-install.json")));
    // 装上了：显示「已经更新」
    fs.writeFileSync(path.join(tmp, "pending-install.json"), JSON.stringify({ version: "1.0.8", file: inst, log: "", at: Date.now() }));
    assert.deepStrictEqual(u.checkPending(), { updated: "1.0.8" });
    ok("更新没装上：下次打开说原因、给「手动安装」");
  }

  const gcc = locate(byId.c, toolDirs, true);
  if (!gcc) { console.log("- 跳过编译相关（没有 gcc）"); return; }

  // ---------- C：数组、字符串、二维数组、结构体链表、递归、指针、输出、崩溃 ----------
  const fc = W("综合.c", `#include <stdio.h>
#include <stdlib.h>
struct Node { int val; struct Node *next; };
int g = 1;
int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
void bubble(int a[], int n) {
    for (int i = 0; i < n - 1; i++)
        for (int j = 0; j < n - 1 - i; j++)
            if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
}
int main(void) {
    int a[6] = {5, 2, 9, 1, 7, 3};
    char s[8] = "abc";
    int m[2][2] = {{1, 2}, {3, 4}};
    struct Node *head = NULL;
    for (int k = 0; k < 3; k++) { struct Node *x = malloc(sizeof *x); x->val = k; x->next = head; head = x; }
    int *p = &a[2];
    *p = 100;
    bubble(a, 6);
    int f = fact(4);
    printf("%d %d %s\\n", a[0], f, s);
    m[1][1] = f;
    return 0;
}
`);
  const r1 = await trace("c", fc, "", opt).done;
  if (r1.noTracer) warn("这台电脑的 gdb 没有 Python：画出来会退回「只画数组」（" + (r1.why || "") + "）");
  else {
    assert(!r1.error && r1.steps.length > 30, JSON.stringify(r1.error) + " steps " + (r1.steps || []).length);
    assert.strictEqual(r1.output, "1 24 abc\n");
    const last = r1.steps[r1.steps.length - 1];
    assert.deepStrictEqual(nums(val(last, "a")), [1, 2, 3, 5, 7, 100]);
    assert.strictEqual(val(last, "s").v, "abc");
    assert.deepStrictEqual(val(last, "m").v.map(nums), [[1, 2], [3, 24]]);
    const h = val(last, "head"); assert(h.k === "p" && h.d.k === "o" && h.d.v.val.v === 2 && h.d.v.next.d.v.val.v === 1, JSON.stringify(h).slice(0, 300));
    assert(r1.steps.some((s) => s.f.length >= 4 && s.f.every((x, i) => i === s.f.length - 1 || x.fn === "fact")), "递归：调用栈里有好几层 fact");
    assert(r1.steps.some((s) => s.f[0].fn === "bubble" && val(s, "a") && val(s, "a").k === "a" && val(s, "a").ptr), "bubble 里的 a（指针 + n）当数组画");
    assert(r1.steps.some((s) => val(s, "p") && val(s, "p").k === "p"), "指针");
    assert(r1.steps.every((s) => s.l >= 1 && s.l <= 24));
    assert.deepStrictEqual(val(last, "g"), { k: "n", v: 1 });
    // 输出出现在 printf 那一步之后
    assert(r1.steps.some((s) => s.o === "1 24 abc\n"));
    ok(`C：数组、字符串、二维数组、链表、递归、指针、全局变量、输出（${r1.steps.length} 步）`);

    const r2 = await trace("c", W("崩.c", `#include <stdio.h>\nint main(void) {\n    int a[3] = {1, 2, 3};\n    int *q = NULL;\n    a[0] = 5;\n    *q = a[0];\n    return 0;\n}\n`), "", opt).done;
    assert(r2.error && r2.error.signal === "SIGSEGV" && r2.error.line === 6, JSON.stringify(r2.error));
    // 一行里的死循环：gdb 的 step 不会自己停，要戳停（每步 0.12 秒）
    const r3 = await trace("c", W("死循环.c", `int main(void) {\n    int x = 0;\n    while (1) x++;\n}\n`), "", { ...opt, maxSteps: 12 }).done;
    assert(r3.trunc && r3.steps.length === 12 && val(r3.steps[11], "x").v > val(r3.steps[5], "x").v, JSON.stringify(r3.steps.slice(-2)));
    const r4 = await trace("c", W("输入.c", `#include <stdio.h>\nint main(void) {\n    int n, s = 0;\n    scanf("%d", &n);\n    for (int i = 1; i <= n; i++) s += i;\n    printf("%d\\n", s);\n    return 0;\n}\n`), "4\n", opt).done;
    assert.strictEqual(r4.output, "10\n");
    const r5 = await trace("c", W("错.c", `int main(void) {\n    int a = 1\n    return a;\n}\n`), "", opt).done;
    assert(r5.compileFailed && r5.diags.length);
    ok("C：崩溃（空指针）报在第几行、死循环只画前面、读输入、编译出错");

    if (locate(byId.cpp, toolDirs, true)) {
      const r6 = await trace("cpp", W("stl.cpp", `#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n    vector<int> v = {3, 1, 2};\n    string s = "hi";\n    map<string, int> m;\n    m["a"] = 1;\n    sort(v.begin(), v.end());\n    cout << v[0] << s << m["a"] << endl;\n    return 0;\n}\n`), "", opt).done;
      assert(!r6.error, JSON.stringify(r6.error));
      const l6 = r6.steps[r6.steps.length - 1];
      assert.deepStrictEqual(nums(val(l6, "v")), [1, 2, 3]);
      assert.strictEqual(val(l6, "s").v, "hi");
      assert(val(l6, "m").k === "m" && val(l6, "m").v.length === 1);
      ok("C++：vector、string、map");
    }
  }

  // ---------- Python ----------
  if (locate(byId.python, toolDirs, true)) {
    const fp = W("综合.py", `class Node:\n    def __init__(self, v, nxt=None):\n        self.v = v\n        self.next = nxt\n\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\na = [5, 3, 8, 1]\nn = int(input())\nfor i in range(len(a)):\n    for j in range(len(a) - 1 - i):\n        if a[j] > a[j + 1]:\n            a[j], a[j + 1] = a[j + 1], a[j]\nhead = None\nfor x in a:\n    head = Node(x, head)\nd = {"k": [1, 2]}\nprint(a, fib(n))\nprint(1 / 0)\n`);
    const p1 = await trace("python", fp, "5\n", opt).done;
    assert(p1.steps.length > 20, JSON.stringify(p1).slice(0, 300));
    assert.strictEqual(p1.output, "[1, 3, 5, 8] 5\n");
    assert(p1.error && /ZeroDivisionError/.test(p1.error.msg) && p1.error.line === 20, JSON.stringify(p1.error));
    const lp = p1.steps[p1.steps.length - 1];
    assert.deepStrictEqual(nums(val(lp, "a")), [1, 3, 5, 8]);
    const hd = val(lp, "head"); assert(hd.k === "p" && hd.d.t === "Node" && hd.d.v.v.v === 8);
    assert(val(lp, "d").k === "m");
    assert(p1.steps.some((s) => s.f.filter((x) => x.fn === "fib").length >= 3), "递归 fib 有好几层");
    assert(!val(lp, "Node") && !val(lp, "fib"), "类、函数不当变量画");
    const p2 = await trace("python", W("语法错.py", "x = (1,\n"), "", opt).done;
    assert(p2.compileFailed);
    ok(`Python：列表、字典、对象链表、递归、输入输出、异常报在第几行（${p1.steps.length} 步）`);
  }

  // ---------- 服务：边打字边画（没保存的代码）、力扣题套 main 画你的函数、本地判样例 ----------
  const user = path.join(dir, "user");
  const svc = createService({ dev: true, res: path.join(__dirname, "..", "resources"), user, documents: path.join(dir, "docs"), version: "test", send() {}, trash: async () => {}, reveal() {}, openPath() {}, openExternal() {}, pickDir: async () => null, pickFile: async () => null });
  const ws = (await svc.H.state()).workspace;
  const fu = path.join(ws, "打字中.c"); fs.writeFileSync(fu, "int main(void) { return 0; }\n");
  const t1 = await svc.H.traceRun(fu, "", "float", `#include <stdio.h>\nint main(void) {\n    int a[3] = {3, 2, 1};\n    a[0] = a[2];\n    return 0;\n}\n`);
  assert(t1.steps && t1.steps.length >= 2 || t1.fallback, JSON.stringify(t1).slice(0, 300));
  assert.strictEqual(fs.readFileSync(fu, "utf8"), "int main(void) { return 0; }\n", "原文件不动");
  // 同一个 channel：后来的把前面的停掉
  const slow = svc.H.traceRun(fu, "", "float", `int main(void) { volatile long x = 0; for (;;) x++; }\n`);
  await new Promise((r) => setTimeout(r, 300));
  const fast = await svc.H.traceRun(fu, "", "float", `int main(void) { int y = 1; return y; }\n`);
  assert((await slow).cancelled && !fast.cancelled);
  ok("边打字边画：用编辑器里没保存的代码，新的来了旧的停掉");

  // 力扣题（题面用本机缓存，不联网）
  const prob = { id: "lc:two-sum", src: "lc", slug: "two-sum", questionId: "1", no: "1", title: "两数之和", level: "简单", html: "<p>找两个数</p>",
    samples: [{ input: "[2,7,11,15]\n9", output: "[0,1]" }, { input: "[3,2,4]\n6", output: "[1,2]" }, { input: "[3,3]\n6", output: "[0,1]" }],
    meta: { name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], return: { type: "integer[]" } },
    snippets: { c: "int* twoSum(int* nums, int numsSize, int target, int* returnSize) {\n    \n}", cpp: "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};", python3: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        " },
    tags: ["数组"], url: "https://leetcode.cn/problems/two-sum/", at: Date.now() + 1e9 };
  fs.mkdirSync(path.join(user, "problems"), { recursive: true });
  fs.writeFileSync(path.join(user, "problems", "lc_two-sum.json"), JSON.stringify(prob));
  const o = await svc.H.problemOpen("lc:two-sum", "c");
  assert(/刷题/.test(o.file) && /twoSum/.test(fs.readFileSync(o.file, "utf8")));
  assert.strictEqual(svc.H.problemOfFile(o.file).id, "lc:two-sum");
  const good = fs.readFileSync(o.file, "utf8").replace("{\n    \n}", "{\n    int *r = malloc(sizeof(int) * 2);\n    *returnSize = 2;\n    for (int i = 0; i < numsSize; i++)\n        for (int j = i + 1; j < numsSize; j++)\n            if (nums[i] + nums[j] == target) { r[0] = i; r[1] = j; return r; }\n    return r;\n}");
  const rr = await svc.H.problemRun(o.file, good);
  assert(rr.allPass && rr.cases.length === 3, JSON.stringify(rr).slice(0, 500));
  const bad = good.replace("r[0] = i; r[1] = j;", "r[0] = j; r[1] = i;");
  const rb = await svc.H.problemRun(o.file, bad);
  assert(!rb.allPass && rb.cases[0].got === "[1,0]" && rb.cases[0].want === "[0,1]");
  const ce = await svc.H.problemRun(o.file, good.replace("return r;\n}", "return r\n}"));
  assert(ce.compileFailed && ce.diags.every((d) => d.line > 0 && d.line < 30), JSON.stringify(ce.diags));
  // 没登录力扣：提交 = 样例全对就算做出来
  const sub = await svc.H.problemSubmit(o.file, good);
  assert(sub.offline && sub.allPass && sub.delta > 0);
  // 画你的函数：行号是你代码里的行号，自动生成的 main 不画
  const tr = await svc.H.traceRun(o.file, "", "float", good);
  if (!tr.fallback) {
    const lines = good.split("\n").length;
    assert(tr.harness && tr.steps.length > 3 && tr.steps.every((s) => s.l >= 1 && s.l <= lines && s.f.every((fr) => fr.fn === "twoSum")), JSON.stringify(tr.steps.slice(0, 3)));
    assert(tr.steps.some((s) => val(s, "nums") && val(s, "nums").k === "a" && nums(val(s, "nums")).join() === "2,7,11,15"), "nums 当数组画");
  }
  // Python / C++ 也能本地判
  const op = await svc.H.problemOpen("lc:two-sum", "python");
  const pyCode = fs.readFileSync(op.file, "utf8").replace(/ +\n$/, "") + "        for i in range(len(nums)):\n            for j in range(i + 1, len(nums)):\n                if nums[i] + nums[j] == target:\n                    return [i, j]\n";
  const pyBad = await svc.H.problemRun(op.file, fs.readFileSync(op.file, "utf8"));
  assert(!pyBad.allPass && /line [1-9]\b|line 1[0-9]\b/.test(pyBad.cases[0].error), "Python 报错的行号对回你的代码：" + pyBad.cases[0].error);
  const rpy = await svc.H.problemRun(op.file, pyCode); assert(rpy.allPass, JSON.stringify(rpy).slice(0, 800));
  if (locate(byId.cpp, toolDirs, true)) {
    const oc = await svc.H.problemOpen("lc:two-sum", "cpp");
    const cppCode = fs.readFileSync(oc.file, "utf8").replace("{\n        \n    }", "{\n        for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j};\n        return {};\n    }");
    assert((await svc.H.problemRun(oc.file, cppCode)).allPass);
  }
  // Codeforces 题：读输入写输出
  fs.writeFileSync(path.join(user, "problems", "cf_4A.json"), JSON.stringify({ ...cf, id: "cf:4A", at: Date.now() + 1e9 }));
  const oc2 = await svc.H.problemOpen("cf:4A", "c");
  const cfCode = `#include <stdio.h>\nint main(void) { int w; scanf("%d", &w); puts(w > 2 && w % 2 == 0 ? "YES" : "NO"); return 0; }\n`;
  const rc = await svc.H.problemRun(oc2.file, cfCode);
  assert(rc.allPass, JSON.stringify(rc));
  assert(!(await svc.H.problemRun(oc2.file, cfCode.replace('"YES" : "NO"', '"NO" : "YES"'))).allPass);
  const st = svc.H.judgeState();
  assert(st.skill.n >= 1);
  ok("在软件里做题：力扣 C / C++ / Python 本地判样例（行号对回你的代码）、画你的函数、Codeforces 判样例、没登录也能记水平");
})().catch((e) => { console.error("✗", e.stack || e.message); process.exit(1); });
