// 版式引擎和「老师让怎么改就怎么改」：12 种版式、换版式内容不丢、改字重排、换配色、字号、标重点、表格、图片、备注、自己检查、预览
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path");
const D = require("../core/deck");
const E = require("../core/pptedit");
const JSZip = require("jszip");
const ok = (m) => console.log("✓ " + m);

// XML 写得对不对：标签一开一关配得上、属性不重复（PowerPoint 遇到写坏的 XML 整份打不开）
function wellFormed(xml, where) {
  const stack = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z0-9:_.-]+)((?:\s+[A-Za-z0-9:_.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const names = [...m[3].matchAll(/\s([A-Za-z0-9:_.-]+)=/g)].map((x) => x[1]);
    assert.equal(new Set(names).size, names.length, `${where}：<${m[2]}> 的属性重复了`);
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `${where}：</${m[2]}> 配不上`); else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, `${where}：有没关上的标签 ${stack.join(",")}`);
  assert.ok(!/<[^>]*<|&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml.replace(/<[^>]+>/g, "")), `${where}：有没转义的 < 或 &`);
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEklEQVR4nGP8z8DAwMDAxAAGAA0GAQOWJcPxAAAAAElFTkSuQmCC", "base64");   // 4×3 的小图
const PAGES = [
  { layout: "cover", title: "冒泡排序", sub: "C 语言程序设计 · 第 5 章" },
  { title: "这节课讲什么", lines: ["什么是排序", "冒泡排序的想法", "写成代码"], takeaway: "学完能自己写出来" },
  { layout: "section", title: "一、先看想法", sub: "用 6 个数走一遍" },
  { layout: "cards", title: "三个要点", items: [{ head: "比较", body: "只比相邻的两个数" }, { head: "交换", body: "前面的大就换" }, { head: "重复", body: "n 个数比 n-1 趟" }] },
  { layout: "steps", title: "一趟怎么走", items: [{ head: "从头开始", body: "i 从 0 开始" }, { head: "比较相邻", body: "大的往后换" }, { head: "最大的沉底", body: "到了末尾" }] },
  { layout: "compare", title: "冒泡和选择", left: { head: "冒泡排序", lines: ["相邻比较", "可以提前结束"] }, right: { head: "选择排序", lines: ["和后面每个比", "一定比完"] }, takeaway: "都是 O(n²)" },
  { layout: "statement", title: "每一趟把最大的送到最后", sub: "记住这句话" },
  { layout: "code", title: "代码", lang: "C", code: "for (j = 1; j < 6; j++)\n    if (a[i] > a[i+1] && ok)\n    {   t = a[i]; }", lines: ["外层管趟数", "内层管次数"] },
  { layout: "table", title: "每一趟的结果", table: [["趟数", "结果"], ["第 1 趟", "3 5 2 8 1 9"], ["第 2 趟", "3 2 5 1 8 9"]] },
  { layout: "formula", title: "比较次数", formula: "\\frac{n(n-1)}{2}", lines: ["6 个数是 15 次"] },
  { layout: "summary", title: "小结", lines: ["相邻比较、大的后移", "时间复杂度 O(n²)"] },
  { layout: "end", title: "谢谢！", sub: "课后思考" },
];

(async () => {
  // ---------- 1. 整份从头生出来：12 种版式 ----------
  const d = await E.load(await D.blank({ theme: "blue", title: "冒泡排序" }));
  for (const [i, p] of PAGES.entries()) { const r = await d.addDesigned(i, p); assert.equal(r.no, i + 1); assert.equal(r.layout, p.layout || "bullets"); assert.ok(!r.warn, `第 ${i + 1} 页不该放不下：${r.warn}`); }
  let buf = await d.save(), zip = await JSZip.loadAsync(buf);
  assert.equal(Object.keys(zip.files).filter((f) => zip.files[f].dir).length, 0);
  for (const f of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(f)) wellFormed(await zip.file(f).async("string"), f);
  const ct = await zip.file("[Content_Types].xml").async("string");
  for (let i = 1; i <= 12; i++) {
    assert.ok(ct.includes(`/ppt/slides/slide${i}.xml`));
    const x = await zip.file(`ppt/slides/slide${i}.xml`).async("string"), ids = [...x.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    assert.ok(new Set(ids).size >= ids.length - (x.includes("mc:Fallback") ? 1 : 0), `第 ${i} 页形状编号重复`);   // 公式的后备形状和正式的同一个编号
    assert.ok(!/<a:srgbClr val="(?!FFFFFF|F2F5FA|FF5F57|FEBC2E|28C840)/.test(x), `第 ${i} 页有写死的颜色（换配色不会跟着变）`);
    assert.ok(/<p:ph type="title"\/>/.test(x), `第 ${i} 页要有真正的标题占位符（大纲、读屏都靠它）`);
  }
  const theme1 = await zip.file("ppt/theme/theme1.xml").async("string");
  assert.match(theme1, /<a:clrScheme name="捞小智·学院蓝"><a:dk1>/);
  const ol = await d.outline();
  assert.deepStrictEqual(ol.map((s) => s.layout), PAGES.map((p) => p.layout || "bullets"));
  assert.deepStrictEqual(ol.map((s) => s.title), PAGES.map((p) => p.title));
  assert.ok(ol[3].texts.join("|").includes("只比相邻的两个数") && !ol[3].texts.includes("1") && ol[8].tables === 1 && ol[9].formulas === 1);
  assert.equal((await d.check()).ok, true);
  ok("整份从头生出来：12 种版式各一页，XML 都写对了、颜色全用主题色、每页有真标题；大纲里看不到装饰（编号、圆点、页码）");

  // ---------- 2. 页面读回来和写进去的一样；换版式内容不丢 ----------
  const s4 = await d.slide(4);
  assert.equal(s4.layout, "cards"); assert.deepStrictEqual(s4.shapes.map((x) => x.name), ["标题", "第 1 项", "第 2 项", "第 3 项"]);
  assert.deepStrictEqual(s4.shapes[1].text, ["比较", "只比相邻的两个数"]);
  const texts = async (no) => (await d.outline())[no - 1].texts.join("|");
  for (const L of ["steps", "bullets", "compare", "summary", "cards"]) { const r = await d.editSlide(4, { layout: L }); assert.equal(r.layout, L); const t = await texts(4); for (const w of ["比较", "只比相邻的两个数", "交换", "前面的大就换", "重复", "n 个数比 n-1 趟"]) assert.ok(t.includes(w), `换成 ${L} 以后「${w}」不见了：${t}`); }
  assert.deepStrictEqual((await d.slide(4)).shapes[1].text, ["比较", "只比相邻的两个数"]);
  // 代码、表格、公式读回来一个字不差
  const sp = (no) => zip.file(`ppt/slides/slide${no}.xml`).async("string").then((x) => D.specOf(E.shapeList(x)));
  assert.equal((await sp(8)).spec.code, PAGES[7].code); assert.deepStrictEqual((await sp(9)).spec.table, PAGES[8].table); assert.equal((await sp(10)).spec.formula, "\\frac{n(n-1)}{2}");
  assert.deepStrictEqual((await sp(6)).spec.left, { head: "冒泡排序", lines: ["相邻比较", "可以提前结束"] });
  await assert.rejects(d.editSlide(4, { layout: "code" }), /代码页要有代码/);
  assert.deepStrictEqual((await d.slide(4)).shapes[1].text, ["比较", "只比相邻的两个数"]);   // 没改成的那一步不留痕迹
  ok("换版式：卡片 → 步骤 → 要点 → 两栏 → 小结 → 卡片，内容一个字没丢；代码 / 表格 / 公式从页面上读回来和写进去的一样；改不成的不留半截");

  // ---------- 3. 改内容：整页重排，字多了自动缩、放不下自动拆页 ----------
  let r = await d.editSlide(2, { lines: ["什么是排序", "冒泡排序的想法", "写成代码", "想想能不能更快"] });
  assert.equal(r.layout, "bullets"); assert.deepStrictEqual((await d.slide(2)).shapes.filter((x) => /要点/.test(x.name)).map((x) => x.text[0]), ["什么是排序", "冒泡排序的想法", "写成代码", "想想能不能更快"]);
  assert.ok((await texts(2)).includes("学完能自己写出来"));   // 没提到的块（结论）留着
  const szOf = async (no, name) => { const z = await JSZip.loadAsync(await d.save()), all = await d.outline(); void all; const x = await z.file((await partOf(d, no))).async("string"); const sh = E.shapeList(x).find((q) => q.name.startsWith(name)); return +/<a:defRPr sz="(\d+)"/.exec(sh.xml)[1]; };
  const partOf = async (dk, no) => { const z = await JSZip.loadAsync(await dk.save()), p = await z.file("ppt/presentation.xml").async("string"), rels = await z.file("ppt/_rels/presentation.xml.rels").async("string"); const rid = [...p.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)][no - 1][1]; return "ppt/" + new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)[1]; };
  const z1 = await szOf(2, "lz:bullets|lines.0");
  const sh2 = await d.slide(2);
  await d.setText(2, String(sh2.shapes.find((q) => q.name === "第 1 条要点").shape), ["什么是排序：把一组没有顺序的数据，按照从小到大或者从大到小重新排列，方便后面查找和比较，这一条故意写得特别长看它会不会自动缩小字号放进去而不是溢出页面"]);
  const z2 = await szOf(2, "lz:bullets|lines.0");
  assert.ok(z2 < z1, `字多了应该自动缩小（${z1} → ${z2}）`);
  await d.setText(2, "title", ["这节课学什么"]); assert.equal((await d.outline())[1].title, "这节课学什么");
  r = await d.addSlide(12, "很多条", Array.from({ length: 11 }, (_, i) => `第 ${i + 1} 条要点，说一件比较长的事情`));
  assert.equal(r.pages, 2); assert.match(r.note, /拆成了 2 页/);
  const o3 = await d.outline(); assert.equal(o3.length, 14); assert.equal(o3[13].title, "很多条（续）"); assert.equal(o3[12].texts.length + o3[13].texts.length, 11);
  ok("改内容：加一条要点别的块都留着；一条写得特别长 → 整页字号自动缩小；11 条要点 → 自动拆成两页");

  // ---------- 4. 标重点：加粗 / 上色 / 底色，重排、换版式以后还在 ----------
  r = await d.formatText(5, "最大的", { bold: true, color: "红" }); assert.equal(r.count, 1);
  r = await d.formatText(5, "相邻", { highlight: "黄", underline: true });
  const x5 = async () => (await JSZip.loadAsync(await d.save())).file(await partOf(d, 5)).async("string");
  let x = await x5();
  assert.match(x, /<a:rPr[^>]* b="1"[^>]*><a:solidFill><a:srgbClr val="D92D20"\/><\/a:solidFill><\/a:rPr><a:t>最大的<\/a:t>/);
  assert.match(x, /<a:rPr[^>]* u="sng"[^>]*><a:highlight><a:srgbClr val="FFF176"\/><\/a:highlight><\/a:rPr><a:t>相邻<\/a:t>/);
  wellFormed(x, "标重点以后");
  await d.editSlide(5, { layout: "cards" }); await d.scaleFont(5, { scale: 1.15 }); await d.editSlide(5, { layout: "bullets" });
  x = await x5();
  assert.match(x, /D92D20[\s\S]{0,60}<a:t>最大的<\/a:t>/); assert.match(x, /FFF176[\s\S]{0,60}<a:t>相邻<\/a:t>/);
  assert.match(x, /name="lz:bullets\|title\?fs=1\.15"/);   // 老师调过的字号也记着
  await assert.rejects(d.formatText(5, "没有这几个字", { bold: true }), /没找到/);
  await assert.rejects(d.formatText(5, "相邻", { color: "彩虹" }), /不认识这个颜色/);
  await assert.rejects(d.formatText(5, "相邻", {}), /要怎么标/);
  r = await d.formatText(0, "排序", { bold: true }); assert.deepStrictEqual(r.pages, [1, 2, 6]);
  ok("标重点：某几个字加粗标红、标黄加下划线（rPr 里的先后顺序对）；之后换版式、调字号再换回来，标的还在；整份一起标也行");

  // ---------- 5. 换配色、字号 ----------
  r = await d.setTheme({ theme: "board" }); assert.equal(r.name, "黑板");
  assert.equal((await d.theme()).key, "board"); assert.equal((await d.theme()).colors.lt1, "1F3B33");
  r = await d.setTheme({ color: "#8b1a1a" }); assert.equal((await d.theme()).colors.accent1, "8B1A1A"); assert.match(r.name, /自定义/);
  await assert.rejects(async () => d.setTheme({ theme: "彩虹" }), /没有这套配色/);
  await d.undo(); assert.equal((await d.theme()).key, "board");
  r = await d.scaleFont(2, { scale: 0.87 }); assert.equal(r.font_scale, 0.87);
  r = await d.scaleFont(2, { shape: "title", size: 40 }); x = await (await JSZip.loadAsync(await d.save())).file(await partOf(d, 2)).async("string");
  assert.match(x, /sz="4000"[^>]*\/?>(<[^t][^>]*>)*<a:t>这节课学什么/);
  ok("换配色：8 套里挑一套 / 给一个颜色自己配；撤销退回上一套。字号：整页放大缩小（重排），单个框定成多少磅");

  // ---------- 6. 表格、图片、公式、删一个框 ----------
  r = await d.insertImage(11, PNG); assert.match(r.placed, /右边一栏/);
  let s11 = await d.slide(11); assert.equal(s11.shapes.filter((q) => q.kind === "picture").length, 1); assert.equal(s11.shapes.find((q) => q.kind === "picture").name, "图片");
  await d.editSlide(11, { layout: "cards" }); assert.equal((await d.slide(11)).shapes.filter((q) => q.kind === "picture").length, 1);   // 换成放不了图片的版式，图片也不丢
  await d.editSlide(11, { layout: "summary" });
  s11 = await d.slide(11); assert.equal(s11.shapes.find((q) => q.kind === "picture").name, "图片");
  zip = await JSZip.loadAsync(await d.save());
  assert.ok(zip.file("ppt/media/lz-image1.png")); assert.match(await zip.file("[Content_Types].xml").async("string"), /Extension="png"/);
  r = await d.insertImage(7, PNG, { where: "full" }); assert.match(r.placed, /铺满/);
  r = await d.insertTable(7, [["版本", "比较次数"], ["普通", "15"], ["优化", "5～15"]]); assert.equal(r.rows, 3);
  r = await d.insertFormula(7, "a^2+b^2=c^2");
  let s7 = await d.slide(7); assert.deepStrictEqual(s7.shapes.map((q) => q.kind).sort(), ["formula", "picture", "table", "text", "title"]);
  r = await d.deleteShape(7, s7.shapes.find((q) => q.kind === "table").shape); assert.equal(r.deleted, "表格");
  await assert.rejects(d.insertTable(7, [["只有表头"]]), /至少要有表头和一行/);
  await assert.rejects(d.insertImage(7, Buffer.from("不是图片")), /格式不认识/);
  // 删掉一条要点：整页重排
  const s2 = await d.slide(2); r = await d.deleteShape(2, s2.shapes[s2.shapes.length - 2].shape);
  assert.equal((await d.slide(2)).shapes.filter((q) => /要点/.test(q.name)).length, 3);
  await assert.rejects(d.deleteShape(2, 2), /装饰/);
  ok("图片：要点页自动腾出右边一栏，换版式图片不丢；表格、公式放到现成的页上；删一个框（删的是要点就整页重排，装饰不让删）");

  // ---------- 7. 备注、复制、删页 ----------
  await d.setNotes(2, "先问：通讯录为什么按字母排？\n引出排序 & <重点>"); assert.equal(await d.notes(2), "先问：通讯录为什么按字母排？\n引出排序 & <重点>");
  await d.setNotes(2, "改过的讲稿"); assert.equal((await d.slide(2)).notes, "改过的讲稿");
  await d.setNotes(3, "第二份"); r = await d.addDesigned(14, { title: "带讲稿的一页", lines: ["a", "b"], notes: "这一页这样讲" }); assert.equal(await d.notes(15), "这一页这样讲");
  zip = await JSZip.loadAsync(await d.save());
  const pres = await zip.file("ppt/presentation.xml").async("string");
  assert.match(pres, /<\/p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId\d+"\/><\/p:notesMasterIdLst><p:sldIdLst>/);   // 这几样的先后是规定死的
  assert.equal(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).length, 3);
  assert.equal(Object.keys(zip.files).filter((f) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(f)).length, 1);
  r = await d.duplicateSlide(2); assert.equal(r.no, 3); assert.equal((await d.outline())[2].title, "这节课学什么"); assert.equal(await d.notes(3), "");
  const chk = await d.check(); assert.ok(chk.issues.some((q) => q.slide === 3 && /标题和第 2 页一样/.test(q.problem)));
  await d.deleteSlide(2); zip = await JSZip.loadAsync(await d.save());
  assert.equal(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).length, 2);
  for (const f of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(f)) wellFormed(await zip.file(f).async("string"), f);
  await d.undo(); assert.equal(await d.notes(2), "改过的讲稿");
  ok("备注：第一次写自动补上备注母版，再写是改；加页时可以直接带讲稿；复制的页不带备注，删页连备注一起删，撤销回得来");

  // ---------- 8. 自己检查 ----------
  await d.editSlide(4, { layout: "cards", items: Array.from({ length: 6 }, (_, i) => ({ head: `第 ${i + 1} 个概念`, body: "这一段说明故意写得非常非常长，".repeat(40) })) });
  await d.addDesigned(0, { layout: "bullets", title: "", lines: ["没有标题的一页 **没清干净"] });
  const c2 = await d.check();
  assert.ok(c2.issues.some((q) => /放不下/.test(q.problem)) && c2.issues.some((q) => q.slide === 1 && /没有标题/.test(q.problem)) && c2.issues.every((q) => q.fix));
  await d.undo(); await d.undo();
  ok("自己检查：卡片里字太多放不下、没标题、标题重复，都查得出来，每一条带页码和改法");

  // ---------- 9. 预览（SVG） ----------
  await d.editSlide(2, { takeaway: "<script>alert(1)</script> & \"引号\"" });
  const sv = await d.preview(2);
  assert.ok(sv.startsWith("<svg") && sv.includes("这节课学什么") && sv.includes("&lt;script&gt;") && !/<script/i.test(sv) && !/\son\w+=/i.test(sv));
  const noOf = async (t) => (await d.outline()).find((q) => q.title === t).no;
  assert.match(await d.preview(await noOf("小结")), /<image [^>]*href="data:image\/png;base64,/);
  assert.match(await d.preview(await noOf("每一趟的结果")), /第 1 趟/); assert.match(await d.preview(await noOf("代码")), /Consolas/);
  assert.match(await d.preview(1), /<rect width="1280" height="720" fill="#152A24"\/>/);   // 封面的深色底跟着「黑板」配色
  ok("预览：每一页画成 SVG（文字、底色、表格、图片、代码都在），页面上的 < & 都转义了、没有能执行的东西");

  // ---------- 10. 老师自己的 PPT（不是捞小智排的） ----------
  const f = await E.load(fs.readFileSync(path.join(__dirname, "fixtures", "sample.pptx")));
  assert.equal(await f.designed(), false);
  const n0 = (await f.outline()).length, t2 = (await f.outline())[1];
  r = await f.addSlide(1, "老办法加的一页", ["a", "b"]); assert.equal(r.layout, undefined);   // 没说版式：还是用她母版里的「标题和内容」
  await f.undo();
  r = await f.scaleFont(2, { scale: 1.25 }); assert.ok(r.shapes >= 1);
  r = await f.formatText(0, "冒泡", { bold: true, color: "#ff0000" }); assert.ok(r.count >= 1);
  r = await f.setTheme({ theme: "warm" }); assert.match(r.note, /只换了主题色/);
  r = await f.editSlide(2, { layout: "cards" }); assert.match(r.converted, /重新排了/);
  const t2b = (await f.outline())[1]; assert.equal(t2b.title, t2.title); assert.equal(t2b.layout, "cards"); for (const w of t2.texts) assert.ok(t2b.texts.join("|").includes(w.slice(0, 6)));
  r = await f.addSlide(2, "对比一下", [], { layout: "compare", left: { head: "冒泡", lines: ["稳定"] }, right: { head: "快排", lines: ["快"] } }); assert.equal(r.layout, "compare");
  await f.setNotes(1, "开场白");
  assert.equal((await f.outline()).length, n0 + 1); assert.ok((await f.preview(1)).length > 300);
  zip = await JSZip.loadAsync(await f.save());
  for (const k of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(k)) wellFormed(await zip.file(k).async("string"), k);
  ok("老师自己的 PPT：调字号（没写字号的去母版里找原来多大）、标重点、换主题色、把一页重排成卡片、加一页排好版的、写备注，都行");

  // ---------- 11. 内容整理 ----------
  const n = D.normalize({ title: "  1. 标题  ", lines: ["- 第一条", "2、第二条", "(3) 第三条 $x^2$", "3.14 是圆周率", "-5 是负数", "`代码`样子"] });
  assert.equal(D.plain(n.title), "标题"); assert.deepStrictEqual(n.lines, ["第一条", "第二条", "第三条 x^2", "3.14 是圆周率", "-5 是负数", "代码样子"]);
  assert.equal(D.normalize({ title: "概念", lines: ["栈：先进后出", "队列：先进先出", "堆：按大小出"] }).layout, "cards");   // 「名词：解释」自动排成卡片
  assert.equal(D.normalize({ title: "小结", lines: ["a", "b"] }).layout, "summary"); assert.equal(D.normalize({ title: "x", code: "int a;" }).layout, "code");
  assert.equal(D.normalize({ layout: "两栏", title: "x", lines: ["甲：好；快", "乙：慢"] }).left.head, "甲"); assert.equal(D.normalize({ layout: "不存在的", title: "x", lines: ["a"] }).layout, "bullets");
  assert.equal(D.normalize({ title: "x", image: "<script>" }).image, null);
  assert.throws(() => D.normalize({ layout: "table", title: "x" }), /表格页要有表格/);
  ok("内容整理：模型写的序号、短横线、$公式$、反引号都清掉（3.14、-5 这种不动）；没写版式按内容挑；乱写的版式名、乱塞的字段不会出事");

  console.log("版式引擎：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
