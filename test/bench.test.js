// 6.16 本地整理准确率不能往下掉：test/bench-cases.js 里 150 多条真实风格的消息，总体准确率要 ≥ 98%
// 1.29.2 再加三套留出集（bench-hard / hard2 / hard3，共 200 多条没针对调过的说法），每套也要 ≥ 98%
const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");
for (const flag of ["", "--hard", "--hard2", "--hard3"]) {
  const out = execFileSync(process.execPath, [path.join(__dirname, "parse-bench.js")].concat(flag ? [flag] : []), { encoding: "utf8" });
  const m = out.match(/总体 (\d+)%/), pct = m ? +m[1] : 0;
  assert.ok(pct >= 98, "本地整理准确率掉到了 " + pct + "%（node test/parse-bench.js " + flag + " --v 看哪些没对上）");
  console.log("✓ 本地整理准确率" + (flag ? "（" + flag.slice(2) + "）" : "") + " " + pct + "%");
}
