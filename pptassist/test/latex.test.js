// LaTeX → PowerPoint 公式（OMML）：常见写法都转成对应的公式结构，XML 合法，认不出的也不出错
"use strict";
const assert = require("assert");
const L = require("../core/latex2omml");
const ok = (m) => console.log("✓ " + m);
const has = (latex, ...tags) => { const o = L.toOmml(latex); for (const t of tags) assert.ok(o.includes(t), `${latex} 里应该有 ${t}\n${o}`); return o; };
// 粗查 XML 是否配对
function wellFormed(x) {
  const st = [];
  for (const m of x.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) { assert.equal(st.pop(), m[2], "标签没配对：" + m[2]); } else st.push(m[2]);
  }
  assert.equal(st.length, 0);
}

let o = has("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", "<m:f>", "<m:num>", "<m:den>", "<m:rad>", '<m:degHide m:val="1"/>', "<m:sSup>", "±");
wellFormed(o);
ok("求根公式：分式、根号、上标、±");
has("\\sum_{i=1}^{n} i^2", '<m:chr m:val="∑"/>', '<m:limLoc m:val="undOvr"/>', "<m:sub>", "<m:sup>");
has("\\int_0^1 x^2\\,dx", '<m:chr m:val="∫"/>', '<m:limLoc m:val="subSup"/>');
has("\\lim_{x\\to 0}\\frac{\\sin x}{x}", "<m:limLow>", "<m:func>", "<m:t>lim</m:t>", "→");
ok("求和、积分（上下限）、极限（下标写在 lim 正下方）");
has("\\sqrt[3]{27}", "<m:deg><m:r>");
has("f(x)=\\begin{cases}x^2, & x\\ge 0\\\\ -x, & x<0\\end{cases}", "<m:eqArr>", '<m:begChr m:val="{"/>', '<m:endChr m:val=""/>', "≥");
has("A=\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}", "<m:m>", '<m:count m:val="2"/>', "<m:mr>", '<m:begChr m:val="("/>');
assert.equal((L.toOmml("\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}").match(/<m:mr>/g) || []).length, 2);
ok("n 次根、分段函数、矩阵（两行两列）");
has("\\vec{a}\\cdot\\vec{b}", "<m:acc>", "⃗", "⋅");
has("\\overline{AB}", "<m:bar>", '<m:pos m:val="top"/>');
has("\\left(\\frac{a}{b}\\right)^2", "<m:d>", '<m:begChr m:val="("/>', '<m:endChr m:val=")"/>');
has("\\sin^2\\alpha", "<m:func>", "<m:sSup>", "α");
has("\\text{面积}S", "<m:nor/>", "面积");
ok("向量、上划线、可伸缩括号、三角函数、中文文字");
assert.equal(L.linear("\\frac12+\\frac{1}{2}"), "1/2+1/2");
assert.equal(L.linear("$$E=mc^2$$"), "E=mc^2");
assert.equal(L.linear("```latex\na^2+b^2=c^2\n```"), "a^2+b^2=c^2");
assert.equal(L.linear("\\[x\\]"), "x");
ok("照片 / 模型给的 LaTeX 带 $…$、\\[…\\]、```latex 也认；\\frac12 是二分之一");
for (const bad of ["\\frac{", "x^", "\\left(", "\\begin{cases}", "}}{{", "\\foo\\bar{", "", "a_{_{_{"]) wellFormed(L.toOmml(bad));
assert.ok(L.toOmml("a<b\\&c").includes("&lt;") && L.toOmml("a<b\\&c").includes("&amp;"));
ok("写错的、没写完的：不出错，XML 照样合法；特殊字符转义");
assert.ok(L.toOmml("x").includes('i="1"') && L.toOmml("2").match(/<m:sty m:val="p"\/>/));
ok("字母斜体、数字正体（和 PowerPoint 自己的公式一样）");
console.log("公式：全部通过");
