// 按要求改 PPT：大纲、改文字（保留格式）、替换、加页、删页、挪页、插公式、撤销、另存后还能打开
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const E = require("../core/pptedit");
const PPTX = require("../core/pptx");
const ok = (m) => console.log("✓ " + m);

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, "fixtures", "sample.pptx"));
  const d = await E.load(buf);
  const ol = await d.outline();
  assert.ok(ol.length >= 3, "页数"); assert.ok(ol[1].title.includes("冒泡排序"), JSON.stringify(ol[1]));
  const s2 = await d.slide(2);
  assert.equal(s2.shapes[0].kind, "title"); assert.ok(s2.shapes.length >= 2);
  ok("大纲：每页的标题、文字；一页上有哪些框");

  const i = s2.shapes.findIndex((x) => x.kind === "text") + 1;
  assert.ok(i > 0);
  await d.setText(2, i, ["第一点：相邻比较", "第二点：大的往后换"]);
  await d.setText(2, "title", "冒泡排序（改过）");
  let s = await d.slide(2);
  assert.deepStrictEqual(s.shapes[i - 1].text, ["第一点：相邻比较", "第二点：大的往后换"]); assert.deepStrictEqual(s.shapes[0].text, ["冒泡排序（改过）"]);
  await assert.rejects(d.setText(2, 99, "x"), /没有第 99 个框/);
  await assert.rejects(d.setText(99, 1, "x"), /没有第 99 页/);
  ok("改文字：标题、正文一行一段；框、页不存在时说清楚");

  const r = await d.replace("相邻", "挨着的两个");
  assert.equal(r.count, 1); assert.deepStrictEqual(r.pages, [2]);
  await assert.rejects(d.replace("不存在的词", "x"), /没找到/);
  ok("全文替换：几处、在哪几页；找不到时报出来");

  const a = await d.addSlide(2, "小结", ["相邻比较、大的往后换", "n 个数比 n-1 趟"]);
  assert.equal(a.no, 3);
  let o2 = await d.outline();
  assert.equal(o2.length, ol.length + 1); assert.equal(o2[2].title, "小结"); assert.deepStrictEqual(o2[2].texts, ["相邻比较、大的往后换", "n 个数比 n-1 趟"]);
  await d.moveSlide(3, 1);
  o2 = await d.outline(); assert.equal(o2[0].title, "小结");
  await d.deleteSlide(1);
  o2 = await d.outline(); assert.equal(o2.length, ol.length); assert.ok(o2[1].title.includes("改过"));
  ok("加一页（标题 + 要点）、挪到第 1 页、删掉");

  const f = await d.insertFormula(2, "$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$", { where: "bottom", size: 32 });
  assert.equal(f.text, "x=(-b±√(b^2-4ac))/2a");
  s = await d.slide(2); assert.equal(s.shapes[s.shapes.length - 1].kind, "formula");
  assert.equal((await d.outline())[1].formulas, 1);
  ok("插公式：PowerPoint 的公式（带文字后备），大纲里能数到");

  assert.deepStrictEqual(d.history().slice(-2), ["删掉第 1 页", "在第 2 页插公式"]);
  assert.equal(await d.undo(), "在第 2 页插公式");
  assert.equal((await d.outline())[1].formulas, 0);
  assert.equal(await d.undo(), "删掉第 1 页");
  assert.equal((await d.outline())[0].title, "小结");
  await d.insertFormula(2, "\\int_0^1 x^2 dx = \\frac13");
  ok("撤销：一步一步退回去");

  const out = await d.save();
  const back = await PPTX.read(out);
  assert.equal(back.slides.length, ol.length + 1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edit-")), f1 = path.join(tmp, "a.pptx");
  fs.writeFileSync(f1, out);
  // 结构检查：python-pptx 能打开，公式那页的 XML 合法
  let py = true; try { execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", "import pptx"], { stdio: "ignore" }); } catch (e) { py = false; }
  if (py) {
    const res = execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", "import sys,pptx;p=pptx.Presentation(sys.argv[1]);print(len(p.slides));import lxml.etree as E\nfor s in p.slides: E.tostring(s._element)", f1], { encoding: "utf8" });
    assert.equal(+res.trim(), ol.length + 1);
    ok("另存的文件 python-pptx 能打开，页数对");
  }
  // 老师的真课件（LibreOffice 转出来的、带动画）也能改
  const real = process.env.REAL_PPTX;   // 老师的真课件不放进仓库：本地测试时用环境变量给
  if (real && fs.existsSync(real)) {
    const r2 = await E.load(fs.readFileSync(real));
    const o = await r2.outline(); assert.ok(o.length > 40);
    await r2.insertFormula(19, "\\sum_{j=1}^{n-1}(n-j)=\\frac{n(n-1)}{2}");
    await r2.addSlide(21, "冒泡排序要比较几次", ["一共 n-1 趟，第 j 趟比 n-j 次"]);
    const b2 = await r2.save(); assert.equal((await PPTX.read(b2)).slides.length, o.length + 1);
    ok("老师的第五章课件：插公式、加页，另存后页数对");
  }
  console.log("改 PPT：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
