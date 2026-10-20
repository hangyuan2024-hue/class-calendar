// 生成 core/banks.js：跑标准答案算出每个测试的正确输出；二级 C 的题再用 gcc 跑一遍 C 答案，两边必须一样
// 用法：node tools/build-banks.js（需要 python3 和 gcc）
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const { NCRE_C, NCRE_PY, CLASSIC } = require("./bank-specs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bank-"));
const runPy = (code, input) => execFileSync("python3", ["-c", code], { input, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, timeout: 20000 }).toString();
function runC(id, code, input) {
  const src = path.join(tmp, id + ".c"), exe = path.join(tmp, id);
  if (!fs.existsSync(exe)) { fs.writeFileSync(src, code); execFileSync("gcc", ["-O2", "-std=c11", "-Wall", "-o", exe, src, "-lm"], { stdio: ["ignore", "pipe", "pipe"] }); }
  return execFileSync(exe, [], { input, timeout: 20000 }).toString();
}
const norm = (s) => s.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
const sample = (label, s) => { s = s.replace(/\n$/, ""); return s.includes("\n") || !s ? `${label}：\n${s || "（空行）"}` : `${label}：${s}`; };
function build(list, bank) {
  return list.map((sp) => {
    const tests = sp.ins.map((inp) => {
      const out = norm(runPy(sp.py, inp));
      if (sp.c) { const co = norm(runC(sp.id, sp.c, inp)); if (co !== out) throw new Error(`${sp.id} C 和 Python 答案不一样：输入 ${JSON.stringify(inp)}\nC：${co}\nPy：${out}`); }
      return { in: inp, out };
    });
    const desc = sp.desc + "\n\n" + sample("输入样例", tests[0].in) + "\n" + sample("输出样例", tests[0].out);
    return { id: sp.id, bank, level: sp.level, title: sp.title, topic: sp.topic, desc, tests };
  });
}
const all = [...build(NCRE_C, "ncre-c"), ...build(NCRE_PY, "ncre-py"), ...build(CLASSIC, "classic")];
const ids = new Set(); for (const e of all) { if (ids.has(e.id)) throw new Error("重复的题号 " + e.id); ids.add(e.id); }
const out = `// 捞捞编程 · 题库（自动生成，别手改：改 tools/bank-specs.js 后运行 node tools/build-banks.js）
// 计算机二级 C / Python：按教育部考试中心全国计算机等级考试（NCRE）二级考试大纲的知识点原创的同类编程题，不是考试真题原题。
// 经典算法：程序设计入门常见题型（枚举、递归、二分、栈、动态规划……），题面原创。
"use strict";
module.exports = ${JSON.stringify(all, null, 1)};
`;
fs.writeFileSync(path.join(__dirname, "..", "core", "banks.js"), out);
console.log("题库生成好了：", all.length, "道（二级 C", NCRE_C.length, "· 二级 Python", NCRE_PY.length, "· 经典", CLASSIC.length, "）");
