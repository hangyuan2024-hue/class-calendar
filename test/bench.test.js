// 6.16 本地整理准确率不能往下掉：test/bench-cases.js 里 150 多条真实风格的消息，总体准确率要 ≥ 98%
const assert = require("assert");
const r = require("./parse-bench.js");
assert.ok(r.score >= 0.98, "本地整理准确率掉到了 " + Math.round(r.score * 100) + "%（node test/parse-bench.js --v 看哪些没对上）");
console.log("✓ 本地整理准确率 " + Math.round(r.score * 1000) / 10 + "%");
