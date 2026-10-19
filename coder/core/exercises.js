// 捞捞编程 · 入门练习：每题给输入、看输出，任何语言都能做；写完点「检查」自动跑测试
"use strict";

const EX = [
  { id: "hello", level: 1, title: "Hello, World!", topic: "输出",
    desc: "让程序输出一行：\n\nHello, World!\n\n（注意大小写、逗号和感叹号都要一样）",
    tests: [{ in: "", out: "Hello, World!" }] },
  { id: "aplusb", level: 1, title: "两数之和", topic: "输入输出",
    desc: "输入两个整数 a 和 b（用空格隔开），输出它们的和。\n\n输入样例：3 4\n输出样例：7",
    tests: [{ in: "3 4\n", out: "7" }, { in: "-5 12\n", out: "7" }, { in: "1000000 2000000\n", out: "3000000" }] },
  { id: "oddeven", level: 1, title: "奇数还是偶数", topic: "if 判断",
    desc: "输入一个整数 n，是奇数就输出「奇数」，是偶数就输出「偶数」。\n\n输入样例：7\n输出样例：奇数\n\n提示：n % 2 是 n 除以 2 的余数。负数也要判断对哦。",
    tests: [{ in: "7\n", out: "奇数" }, { in: "10\n", out: "偶数" }, { in: "0\n", out: "偶数" }, { in: "-3\n", out: "奇数" }] },
  { id: "grade", level: 1, title: "成绩等级", topic: "if 判断",
    desc: "输入一个 0~100 的整数成绩，输出等级：\n90 及以上 A，80~89 B，70~79 C，60~69 D，60 以下 E。\n\n输入样例：85\n输出样例：B",
    tests: [{ in: "85\n", out: "B" }, { in: "100\n", out: "A" }, { in: "90\n", out: "A" }, { in: "60\n", out: "D" }, { in: "59\n", out: "E" }, { in: "0\n", out: "E" }] },
  { id: "max3", level: 1, title: "三个数里最大的", topic: "if 判断",
    desc: "输入三个整数，输出其中最大的那个。\n\n输入样例：3 9 5\n输出样例：9",
    tests: [{ in: "3 9 5\n", out: "9" }, { in: "-1 -7 -3\n", out: "-1" }, { in: "4 4 2\n", out: "4" }] },
  { id: "leap", level: 1, title: "闰年", topic: "if 判断",
    desc: "输入一个年份，是闰年输出「是」，不是输出「否」。\n能被 4 整除但不能被 100 整除，或者能被 400 整除的是闰年。\n\n输入样例：2024\n输出样例：是",
    tests: [{ in: "2024\n", out: "是" }, { in: "1900\n", out: "否" }, { in: "2000\n", out: "是" }, { in: "2023\n", out: "否" }] },
  { id: "sum1n", level: 2, title: "1 加到 n", topic: "循环",
    desc: "输入一个正整数 n（不超过 10000），输出 1 + 2 + … + n 的结果。\n\n输入样例：100\n输出样例：5050",
    tests: [{ in: "100\n", out: "5050" }, { in: "1\n", out: "1" }, { in: "10000\n", out: "50005000" }] },
  { id: "table", level: 2, title: "乘法口诀表", topic: "循环嵌套",
    desc: "输入 n（1~9），输出乘法口诀表的前 n 行，第 i 行是 1*i 到 i*i，中间用一个空格隔开。\n\n输入样例：3\n输出样例：\n1*1=1\n1*2=2 2*2=4\n1*3=3 2*3=6 3*3=9",
    tests: [{ in: "3\n", out: "1*1=1\n1*2=2 2*2=4\n1*3=3 2*3=6 3*3=9" }, { in: "1\n", out: "1*1=1" }] },
  { id: "revnum", level: 2, title: "数字倒过来", topic: "循环",
    desc: "输入一个正整数，把它的各位数字倒过来输出（开头的 0 不要）。\n\n输入样例：1230\n输出样例：321\n\n提示：n % 10 是个位，n / 10（整除）去掉个位。",
    tests: [{ in: "1230\n", out: "321" }, { in: "5\n", out: "5" }, { in: "987654\n", out: "456789" }] },
  { id: "gcd", level: 2, title: "最大公约数", topic: "循环",
    desc: "输入两个正整数，输出它们的最大公约数。\n\n输入样例：12 18\n输出样例：6\n\n提示：可以从小到大试，也可以用辗转相除法。",
    tests: [{ in: "12 18\n", out: "6" }, { in: "7 13\n", out: "1" }, { in: "100 75\n", out: "25" }] },
  { id: "prime", level: 2, title: "是不是素数", topic: "循环 + 判断",
    desc: "输入一个正整数 n，是素数输出「是」，不是输出「否」。（1 不是素数）\n\n输入样例：17\n输出样例：是",
    tests: [{ in: "17\n", out: "是" }, { in: "1\n", out: "否" }, { in: "2\n", out: "是" }, { in: "91\n", out: "否" }, { in: "9973\n", out: "是" }] },
  { id: "fib", level: 2, title: "斐波那契数列", topic: "循环",
    desc: "斐波那契数列：第 1、2 项都是 1，后面每一项是前两项之和（1 1 2 3 5 8 …）。\n输入 n（1~50），输出第 n 项。\n\n输入样例：10\n输出样例：55\n\n注意：第 50 项很大，int 装不下，要用 long long / long。",
    tests: [{ in: "10\n", out: "55" }, { in: "1\n", out: "1" }, { in: "50\n", out: "12586269025" }] },
  { id: "avg", level: 3, title: "平均分", topic: "数组",
    desc: "第一行输入人数 n，第二行输入 n 个整数成绩，输出平均分（保留两位小数）。\n\n输入样例：\n3\n80 90 95\n输出样例：88.33",
    tests: [{ in: "3\n80 90 95\n", out: "88.33" }, { in: "1\n100\n", out: "100.00" }, { in: "4\n1 2 3 4\n", out: "2.50" }] },
  { id: "sort", level: 3, title: "从小到大排序", topic: "数组",
    desc: "第一行输入 n，第二行输入 n 个整数，从小到大排好，用空格隔开输出。\n\n输入样例：\n5\n3 1 4 1 5\n输出样例：1 1 3 4 5\n\n先自己写一个冒泡排序试试！",
    tests: [{ in: "5\n3 1 4 1 5\n", out: "1 1 3 4 5" }, { in: "1\n42\n", out: "42" }, { in: "4\n-2 9 0 -7\n", out: "-7 -2 0 9" }] },
  { id: "revstr", level: 3, title: "字符串倒过来", topic: "字符串",
    desc: "输入一行英文（可能有空格），把它倒过来输出。\n\n输入样例：hello world\n输出样例：dlrow olleh",
    tests: [{ in: "hello world\n", out: "dlrow olleh" }, { in: "abc\n", out: "cba" }, { in: "A man a plan\n", out: "nalp a nam A" }] },
];

// 新开一道题时的代码：只放一个架子，让同学自己写
const STARTER = {
  c: "#include <stdio.h>\n\nint main(void) {\n    // 在这里写代码\n\n    return 0;\n}\n",
  cpp: "#include <iostream>\nusing namespace std;\n\nint main() {\n    // 在这里写代码\n\n    return 0;\n}\n",
  python: "# 在这里写代码\n",
  java: "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        // 在这里写代码\n\n    }\n}\n",
  javascript: "// 读入全部输入：const input = require(\"fs\").readFileSync(0, \"utf8\");\n// 在这里写代码\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\t// 在这里写代码\n\tfmt.Print(\"\")\n}\n",
};
function starter(ex, langId) {
  const head = { c: "//", cpp: "//", java: "//", javascript: "//", go: "//", python: "#" }[langId] || "//";
  const desc = ex.desc.split("\n").filter(Boolean).slice(0, 3).map((l) => `${head} ${l}`).join("\n");
  return `${head} 练习：${ex.title}\n${desc}\n\n` + (STARTER[langId] || "");
}

// 比较输出：去掉行尾空格和最后的空行；前面多打了「请输入：」之类的提示也算对
const norm = (s) => String(s || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
function same(actual, expected) {
  const a = norm(actual), e = norm(expected);
  if (a === e) return true;
  if (!e) return false;
  if (a.endsWith("\n" + e)) return true;
  // 提示和答案在同一行（「请输入两个数：7」）：按空白、冒号拆开，比最后几个
  const tok = (s) => s.split(/[\s:：,，]+/).filter(Boolean);
  const at = tok(a), et = tok(e);
  return at.length >= et.length && et.every((t, i) => at[at.length - et.length + i] === t);
}

// run(input) → { compileFailed, stdout, stderr, timedOut, code, diags }
async function check(ex, run) {
  const results = [];
  for (let i = 0; i < ex.tests.length; i++) {
    const t = ex.tests[i];
    const r = await run(t.in);
    if (r.compileFailed) return { pass: false, compileFailed: true, diags: r.diags, stderr: r.stderr, results };
    const ok = !r.timedOut && same(r.stdout, t.out);
    results.push({ i, ok, input: t.in, expected: t.out, got: r.stdout, stderr: r.stderr, timedOut: r.timedOut, code: r.code, diags: r.diags });
    if (!ok) break;   // 第一个不对就停：先看这一个
  }
  return { pass: results.length === ex.tests.length && results.every((x) => x.ok), results };
}

module.exports = { EX, starter, check, same, norm };
