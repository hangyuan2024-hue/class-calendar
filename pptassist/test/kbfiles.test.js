// 知识库读学校自己的资料（core/kbfiles.js + ground.js 的 kb）：
//   Word、PPT（第几页）、PDF（第几页）、网页（抽正文、认日期）、校规按条切、视频听写成带时间的文字稿；「资料说明.json」里废止的不查；回答出处带页码 / 条款 / 时间
"use strict";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const JSZip = require("jszip");
const KF = require("../core/kbfiles");
const G = require("../core/ground");
const ok = (m) => console.log("✓", m);

// 手写一个最小的 PDF（两页，英文：PDF 自带字体只认英文）
function tinyPdf(pages) {
  const objs = [];
  const kids = pages.map((_, i) => 3 + i * 2);
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${pages.length} >>`);
  const font = 3 + pages.length * 2;
  pages.forEach((t, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbf-"));
  const kd = path.join(dir, "kb"); fs.mkdirSync(kd);
  // Word：学生手册（按条写）
  const rules = ["学生手册", "第一章 总则", "第一条 为规范学生管理，制定本手册。", "第二条 本手册适用于全日制本科生。", "第二章 请假",
    "第十二条 学生请假一天以内由辅导员批准，三天以内由学院副书记批准。", "超过三天报学生处备案。", "第十三条 病假需附校医院证明。"];
  const w = new JSZip();
  w.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${rules.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  fs.writeFileSync(path.join(kd, "学生手册.docx"), await w.generateAsync({ type: "nodebuffer" }));
  // PPT：两页
  const p = new JSZip();
  p.file("ppt/slides/slide1.xml", `<p:sld xmlns:a="a"><a:p><a:r><a:t>冒泡排序</a:t></a:r></a:p></p:sld>`);
  p.file("ppt/slides/slide2.xml", `<p:sld xmlns:a="a"><a:p><a:r><a:t>冒泡排序的时间复杂度是 O(n^2)，最好情况是 O(n)。</a:t></a:r></a:p></p:sld>`);
  fs.writeFileSync(path.join(kd, "数据结构第三讲.pptx"), await p.generateAsync({ type: "nodebuffer" }));
  // PDF：两页
  fs.writeFileSync(path.join(kd, "lab-guide.pdf"), tinyPdf(["Lab safety rules: wear goggles.", "The library closes at 22:00 on weekdays."]));
  // 官网文章（另存为的网页）
  fs.writeFileSync(path.join(kd, "校运会通知.html"), `<html><head><title>关于举办2026年秋季校运会的通知</title></head><body><nav>首页 新闻 通知 关于学校 联系我们</nav>
    <div class="v_news_content"><p>发布时间：2026-11-10</p><p>经研究，2026 年秋季校运会定于 11 月 28 日在东区田径场举行，请各学院做好准备。</p><p>报名截止时间为 11 月 20 日。</p></div><footer>版权所有</footer></body></html>`);
  // 视频（听写是假的）
  fs.writeFileSync(path.join(kd, "第五讲 指针.mp4"), "fake-video");
  // 一份过期的规定（资料说明里标了废止）
  fs.writeFileSync(path.join(kd, "旧请假规定.txt"), "学生请假三天以内由班主任批准，请假要交纸质申请。");
  fs.writeFileSync(path.join(kd, "资料说明.json"), JSON.stringify({ "旧请假规定.txt": { abolished: true }, "学生手册.docx": { date: "2025-09-01", source: "教务处" } }));

  const transcribed = [];
  const kb = G.kb(kd, { transcribe: async (file, say) => { transcribed.push(path.basename(file)); return [
    { start: 0, end: 20, text: "同学们好，今天讲指针。" }, { start: 25, end: 50, text: "指针就是存放地址的变量。" },
    { start: 750, end: 780, text: "野指针是指向已经释放的内存的指针，用之前要先赋值为空。" }]; } });

  // ---------- 读文件 ----------
  const r = await kb.refresh({});
  assert.deepEqual(r.errors, []); assert.deepEqual(r.pending, ["第五讲 指针.mp4"], "视频不点「整理」不听写（慢）");
  assert.equal(transcribed.length, 0);
  const arts = await KF.extract(path.join(kd, "学生手册.docx"));
  assert.equal(arts.kind, "rules");
  assert.deepEqual(arts.segs.map((x) => x.loc), ["开头", "第一章 第一条", "第一章 第二条", "第二章 第十二条", "第二章 第十三条"].filter((x) => x !== "开头" || arts.segs[0].loc === "开头"));
  assert.ok(/超过三天报学生处备案/.test(arts.segs.find((x) => /第十二条/.test(x.loc)).text), "一条写了好几行：都在这一条里");
  const pp = await KF.extract(path.join(kd, "数据结构第三讲.pptx"));
  assert.deepEqual(pp.segs.map((x) => x.loc), ["第 1 页", "第 2 页"]);
  const pdf = await KF.extract(path.join(kd, "lab-guide.pdf"));
  assert.deepEqual(pdf.segs.map((x) => x.loc), ["第 1 页", "第 2 页"]); assert.ok(/22:00/.test(pdf.segs[1].text));
  const web = await KF.extract(path.join(kd, "校运会通知.html"));
  assert.ok(/11 月 28 日/.test(web.segs[0].text) && !/首页 新闻/.test(web.segs[0].text) && !/版权所有/.test(web.segs[0].text), "网页只要正文");
  assert.equal(web.date, "2026-11-10");
  ok("读文件：Word 的校规按条切（第几章第几条，一条好几行都在一起）、PPT 和 PDF 按页、网页只要正文还认出发布日期；视频不点「整理」不听写");

  // ---------- 查 ----------
  const f = kb.find("请假三天要谁批准");
  assert.ok(/第十二条/.test(f[0].src) && /学院副书记/.test(f[0].text) && f[0].src === "知识库：学生手册.docx 第二章 第十二条", f.map((x) => x.src).join(" | "));
  assert.ok(!f.some((x) => /旧请假规定/.test(x.src)), "废止的规定不查");
  assert.ok(/第 2 页/.test(kb.find("冒泡排序的时间复杂度")[0].src));
  assert.ok(/library closes/.test(kb.find("library closes weekdays")[0].text));
  assert.equal(kb.find("校运会是哪天")[0].date, "2026-11-10");
  ok("查：校规回答出处到「第几章第几条」、PPT 到第几页；废止的不查；网页带日期");

  // ---------- 整理：视频听写成带时间的文字稿 ----------
  const r2 = await kb.refresh({ media: true });
  assert.equal(r2.done, 1); assert.deepEqual(transcribed, ["第五讲 指针.mp4"]);
  const v = kb.find("野指针是什么");
  assert.equal(v[0].src, "知识库：第五讲 指针.mp4 12:30"); assert.equal(v[0].t, 750);
  assert.equal(kb.status().media.length, 0);
  ok("整理：视频听写成一分钟一段、带开始时间的文字稿，回答出处是「第五讲 指针.mp4 12:30」");

  // ---------- 先核对再回答用上：出处带条款 ----------
  const g = G.create({ kb, llm: { chat: async (ms, o) => (o.mode === "ground" ? { content: "请假三天以内由学院副书记批准。[1]" } : { content: "第1句：有据[1]" }) } });
  const a = await g.answer("请假三天谁批");
  assert.equal(a.sources[0].src, "知识库：学生手册.docx 第二章 第十二条");
  assert.ok(/2025-09-01/.test(JSON.stringify(a.mats[0])), "带着资料说明里的日期");
  ok("先核对再回答：出处带到条款，资料带日期");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("知识库读学校资料：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
