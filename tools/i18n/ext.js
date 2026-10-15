const acorn = require("acorn"); const walk = require("acorn-walk");
const fs = require("fs");
const CJK = /[一-鿿]/;
const out = new Map();
function add(s, f) {
  s = s.replace(/\s+/g, " ").trim();
  if (!CJK.test(s) || s.length > 300) return;
  if (!out.has(s)) out.set(s, new Set()); out.get(s).add(f);
}
function pieces(str, f) {
  // 去掉 HTML 标签，分成一段段文字（每段就是一个文本节点）；属性里的中文（title=、placeholder=）也取出来
  const attrRe = /\b(?:title|placeholder|aria-label|alt|data-tip)="([^"]*)"/g; let m;
  while ((m = attrRe.exec(str))) add(m[1], f);
  str.split(/<[^>]*>/).forEach((p) => { add(p.replace(/&nbsp;/g, " "), f); if (/\n/.test(p)) p.split(/\n+/).forEach((q) => add(q, f)); });
}
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8");
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true }); } catch (e) { console.error("parse fail", f, e.message); continue; }
  walk.full(ast, (n) => {
    if (n.type === "Literal" && typeof n.value === "string" && CJK.test(n.value)) pieces(n.value, f);
    if (n.type === "TemplateLiteral") {
      let s = ""; n.quasis.forEach((q, i) => { s += q.value.cooked; if (i < n.expressions.length) s += "{" + i + "}"; });
      if (CJK.test(s)) pieces(s, f);
    }
  });
}
const arr = [...out.entries()].map(([k, v]) => ({ k, f: [...v].map((x) => x.split("/").pop()) }));
fs.writeFileSync(process.env.OUT || "js.json", JSON.stringify(arr, null, 0));
console.log("unique", arr.length, "chars", arr.reduce((a, b) => a + b.k.length, 0));
