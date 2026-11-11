// 读 PPT、往里面加讲解视频和问答：加完再读一遍，结构对、原来的动画还在、回答页是隐藏的
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const JSZip = require("jszip");
const PPTX = require("../core/pptx");
const MEDIA = require("../core/media");
const ok = (m) => console.log("✓ " + m);
// XML 标签配不配得上（不用装 XML 库：一个栈就够）
function wellFormed(xml, name) {
  const st = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, "").matchAll(/<(\/?)([\w:.-]+)\b[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) st.push(m[2]);
    else { const t = st.pop(); assert.equal(t, m[2], `${name}：</${m[2]}> 对不上 <${t}>`); }
  }
  assert.equal(st.length, 0, name + "：有标签没关");
}

// 一个小视频：几帧纯色 png + 一秒的声音
async function tinyVideo(dir, name) {
  const wav = path.join(dir, name + ".wav");
  const sr = 16000, s = new Float32Array(sr); for (let i = 0; i < sr; i++) s[i] = Math.sin(i / 8) * 0.3;
  fs.writeFileSync(wav, MEDIA.writeWav(s, sr));
  const png = path.join(dir, name + ".png");
  await MEDIA.run(["-f", "lavfi", "-i", "color=c=0x22d3ee:s=120x160", "-frames:v", "1", png]);
  const enc = MEDIA.encoder(path.join(dir, name + ".mp4"), { fps: 25, wav });
  const frame = fs.readFileSync(png);
  for (let i = 0; i < 25; i++) await enc.write(frame);
  await enc.end();
  return { video: fs.readFileSync(path.join(dir, name + ".mp4")), poster: frame, ms: 1000 };
}

(async () => {
  const src = fs.readFileSync(path.join(__dirname, "fixtures", "sample.pptx"));
  const info = await PPTX.read(src);
  assert.equal(info.slides.length, 4);
  assert.equal(info.slides[1].title, "冒泡排序");
  assert.deepStrictEqual(info.slides[1].texts, ["相邻两个数比一比，前面的大就交换", "每一轮把最大的数「冒」到最后", "n 个数最多比 n-1 轮"]);
  assert.ok(info.slides[2].texts.some((t) => t.includes("swap(&a[j], &a[j+1])")));
  assert.equal(info.slides[0].bg, "#ffffff");
  ok("读 PPT：每页的标题、文字（代码里的 & 也对）");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pptx-"));
  const v = await tinyVideo(dir, "a");
  const plan = [
    { no: 2, narration: v, qa: [{ q: "为什么比 n-1 轮？", a: "每一轮排好一个数，\n剩最后一个自然就对了。", ...v }, { q: "哪里容易错？", a: "j 的上界。", ...v }] },
    { no: 3, narration: v, qa: [] },
  ];
  const { buf, report } = await PPTX.write(src, plan, { side: "right" });
  fs.writeFileSync(path.join(dir, "out.pptx"), buf);
  assert.deepStrictEqual(report.map((r) => [r.no, r.narration, r.auto, r.qa]), [[2, true, true, 2], [3, true, true, 0]]);

  const again = await PPTX.read(buf);
  assert.equal(again.slides.length, 6);
  assert.deepStrictEqual(again.slides.map((s) => s.hidden), [false, false, true, true, false, false]);
  assert.ok(again.slides[2].texts.join("").includes("每一轮排好一个数"));
  assert.ok(again.slides[1].laolao && again.slides[2].laolao && !again.slides[0].laolao);
  ok("写 PPT：选中的页加了讲解视频和问题按钮；回答页插在原页后面、是隐藏的");

  const zip = await JSZip.loadAsync(buf);
  const s2 = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.ok(s2.includes('presetClass="entr"'), "原来的动画还在");
  assert.ok(s2.includes('cmd="playFrom(0.0)"') && s2.includes("<p:video>"), "自动播放");
  const ctns = [...s2.matchAll(/<p:cTn\b[^>]*\sid="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ctns).size, ctns.length, "动画编号不能重复");
  const spids = [...s2.matchAll(/<p:cNvPr\b[^>]*\sid="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(spids).size, spids.length, "形状编号不能重复");
  const rels2 = await zip.file("ppt/slides/_rels/slide2.xml.rels").async("string");
  for (const m of s2.matchAll(/r:(?:id|embed|link)="(rId\d+)"/g)) assert.ok(rels2.includes(`Id="${m[1]}"`), "关系 " + m[1] + " 要有");
  assert.ok(/hlinksldjump/.test(s2) && /Target="slide5\.xml"/.test(rels2));
  const ct = await zip.file("[Content_Types].xml").async("string");
  assert.ok(ct.includes('Extension="mp4"') && ct.includes('PartName="/ppt/slides/slide5.xml"') && ct.includes('PartName="/ppt/slides/slide6.xml"'));
  for (const f of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const x = await zip.file(f).async("string");
    const order = ["</p:cSld>", "<p:timing>", "</p:sld>"].map((t) => x.indexOf(t)).filter((i) => i >= 0);
    assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b), f + " 里元素的顺序");
  }
  for (const f of Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f))) wellFormed(await zip.file(f).async("string"), f);
  const app = await zip.file("docProps/app.xml").async("string");
  assert.ok(app.includes("<Slides>6</Slides>"));
  ok("PPT 里面：原来的动画还在、自动播放、编号不重复、关系都在、元素顺序对、页数更新了");
  console.log("PPT 读写：全部通过");
  if (process.env.KEEP) console.log(path.join(dir, "out.pptx"));
})().catch((e) => { console.error(e); process.exit(1); });
