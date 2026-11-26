// 回答的 Markdown + 公式：该加粗的加粗、公式用 KaTeX 画；模型回答里的 HTML 不执行；念出来时不念记号
"use strict";
const assert = require("assert"), path = require("path"), fs = require("fs");
global.window = global;
const kx = path.join(__dirname, "..", "app", "renderer", "vendor", "katex", "katex.min.js");
const kSrc = fs.existsSync(kx) ? kx : path.join(__dirname, "..", "..", "learn", "mindmap", "vendor", "katex", "katex.min.js");
global.katex = require(kSrc);
require("../app/renderer/md.js");
const { render, speech } = global.LaoMd;
const ok = (m) => console.log("✓", m);

let h = render("**第一步：** 设鸡有 $x$ 只。\n$$x + y = 35$$\n\n1. 一\n2. 二");
assert.ok(h.includes("<strong>第一步：</strong>")); assert.ok(/class="katex"/.test(h)); assert.ok(h.includes('<div class="md-math">')); assert.ok(/<ol><li>一<\/li><li>二<\/li><\/ol>/.test(h));
assert.ok(!h.includes("$$") && !h.includes("**"));
ok("加粗、行内公式、单独一行的公式、编号列表");

h = render("| a | b |\n|---|---|\n| 1 | $x^2$ |\n\n```js\nif (a<b) {}\n```\n> 注意");
assert.ok(/<table>[\s\S]*<th>a<\/th>[\s\S]*class="katex"/.test(h)); assert.ok(h.includes("<pre class=\"md-code\"><code>if (a&lt;b) {}</code></pre>")); assert.ok(h.includes("<blockquote>注意</blockquote>"));
ok("表格（格子里也能有公式）、代码块原样、引用");

h = render("<img src=x onerror=alert(1)> **<b>x</b>** `<script>`");
assert.ok(!/<img|<script|<b>/.test(h)); assert.ok(h.includes("&lt;img"));
ok("回答里的 HTML 只当文字显示，不执行");

assert.ok(!/katex/.test(render("价格 5$ 和 6$")), "价格里的 $ 不当公式");
assert.ok(render("$$x+").includes("$$x+"), "没写完的公式先原样显示");
ok("价格里的 $ 不当公式；正在打字、没写完的公式先原样显示");

const s = speech("**验算：** $23 + 12 = 35$，$\\frac{1}{2}$\n## 小结");
assert.ok(!/[*$#\\]/.test(s), s); assert.ok(s.includes("23 + 12 等于 35") && s.includes("2分之1"), s);
ok("念出来时去掉记号，公式换成说法");
console.log("回答排版：全部通过");
