// 捞小智的「眼力」：看图反推（训练出来的看图本事，训练和使用用同一套说法）
//   · 拍一张 PPT 页面（截图、手机拍的屏幕或投影）→ 还原成能编辑的一页（版式 + 标题 + 要点……，就是 add_slide 要的那些）
//   · 一张人物图片（照片或卡通形象）→ 做 Q版公仔要的几样特征（发型、刘海、发色、眼镜、上衣颜色……）
// 提示词、特征的取值和训练数据工厂（grid/recipes/vis_gen.py）一字不差（测试里核对）。
// 隐私：公仔特征只有这几样粗的类别（颜色也只是十几种颜色名），从它认不出是谁；照片只在本机用，不存、不上传。
"use strict";

// 颜色名 → 颜色（公仔用）。只有这十几种：特征粗，认不出人
const PALETTE = { 黑: "1F1A17", 深棕: "3B2418", 棕: "6B4226", 栗: "8B4A2B", 金: "C9A15B", 灰: "8A8A8A", 白: "F2F2F2", 米: "E8DCC4", 红: "C0392B", 橙: "E67E22", 黄: "F1C40F", 绿: "27AE60", 青: "16A085", 蓝: "2E6FD8", 藏青: "1F2F5A", 紫: "8E44AD", 粉: "F28CB1" };
const DOLL = {
  hairStyle: ["short", "bob", "long", "flare", "ponytail", "bun", "curly"],
  bangs: ["full", "side", "middle", "none"],
  faceShape: ["round", "oval", "long", "square"],
  eyeStyle: ["open", "smile"],
  bottom: ["pants", "skirt"],
};
const SLIDE_LAYOUTS = ["bullets", "cards", "steps", "compare", "table", "summary", "section", "statement", "code", "formula"];

const SLIDE_SYS = `你看一张 PPT 页面的图片（可能是截图，也可能是手机拍的屏幕或投影，会有点歪、反光、模糊），把这一页还原成能编辑的一页。
只输出一个 JSON，不要别的字。字段：
· layout：版式，${SLIDE_LAYOUTS.join(" / ")} 之一（一条一条的要点 bullets；几个并列的小块 cards；从左到右的几步 steps；左右两栏 compare；表格 table；深色底的几条结论 summary；一部分的开头 section；一句话放大 statement；代码 code；大公式 formula）
· title：标题，照着图上的字抄
· 按版式写内容：bullets、summary 写 lines（每条要点一个字符串）；cards、steps 写 items（每项 {"head":小标题,"body":说明}）；compare 写 left、right（{"head":栏标题,"lines":[...]}）；table 写 table（每行一个数组，第一行是表头）；section、statement 写 sub；code 写 code 和 lang；formula 写 formula（LaTeX）
图上的字一个不改地抄下来；看不清的字按最可能的写。`;
const SLIDE_ASK = "把这一页还原成 JSON。";
const DOLL_SYS = `你看一张人物图片（照片或卡通形象），说出把这个人做成 Q版公仔要的几样特征。只看外表，不猜这个人是谁。
只输出一个 JSON，不要别的字。字段和能填的值：
· hairStyle：发型，short 短发 / bob 齐耳短发 / long 长发 / flare 外翻 / ponytail 马尾 / bun 丸子头 / curly 卷发
· bangs：刘海，full 齐刘海 / side 斜刘海 / middle 中分 / none 没有刘海
· hair：发色，${Object.keys(PALETTE).join(" / ")} 之一
· glasses：戴不戴眼镜，true / false
· top：上衣颜色，同上面的颜色名
· bottom：pants 裤子 / skirt 裙子（看不到下半身就写 pants）
· faceShape：脸型，round 圆脸 / oval 鹅蛋脸 / long 长脸 / square 方脸
· eyeStyle：open 睁着眼 / smile 笑眯眯
· earrings：戴不戴耳环，true / false`;
const DOLL_ASK = "这个人做成公仔是什么样？输出 JSON。";

// 模型说的话里找出第一个完整的 JSON（前后有别的字、包在 ```json 里都行）
function parseJson(s) {
  s = String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const a = s.indexOf("{");
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch (e) { return null; } }
  }
  return null;
}

// 公仔特征 → 形象数据（avatar3d 的 sanitize 认的写法）；不认得的值不写（用形象原来的）
function dollToPerson(j) {
  if (!j || typeof j !== "object") return null;
  const out = {};
  for (const k of Object.keys(DOLL)) if (DOLL[k].includes(j[k])) out[k] = j[k];
  for (const k of ["hair", "top"]) if (PALETTE[j[k]]) out[k] = "#" + PALETTE[j[k]];
  for (const k of ["glasses", "earrings"]) if (typeof j[k] === "boolean") out[k] = j[k];
  return Object.keys(out).length ? out : null;
}

// 一页的数据：只留 add_slide 认的字段
const PAGE_KEYS = ["layout", "title", "sub", "lines", "items", "left", "right", "code", "lang", "table", "formula", "takeaway"];
function cleanSlide(j) {
  if (!j || typeof j !== "object" || !String(j.title || "").trim()) return null;
  const out = {};
  for (const k of PAGE_KEYS) if (j[k] != null && j[k] !== "") out[k] = j[k];
  if (out.layout && !SLIDE_LAYOUTS.includes(out.layout)) delete out.layout;
  return out;
}

// llm：有 chat(messages, opt) 的（core/llm.js、成品展示里的 llm）；image：data:image/...;base64,...
async function look(llm, image, sys, ask) {
  if (llm.start) await llm.start({ eyes: true });
  const r = await llm.chat([{ role: "system", content: sys }, { role: "user", content: [{ type: "image_url", image_url: { url: image } }, { type: "text", text: ask }] }], { temperature: 0, maxTokens: 1200, mode: "eyes" });
  return parseJson(r && r.content);
}
async function slideFromImage(llm, image) {
  const s = cleanSlide(await look(llm, image, SLIDE_SYS, SLIDE_ASK));
  if (!s) throw new Error("没认出这一页：照片拍正一点、整页都拍进去再试");
  return s;
}
async function dollFromImage(llm, image) {
  const p = dollToPerson(await look(llm, image, DOLL_SYS, DOLL_ASK));
  if (!p) throw new Error("没认出来：换一张正面、光线好一点的照片再试");
  return p;
}

module.exports = { PALETTE, DOLL, SLIDE_LAYOUTS, SLIDE_SYS, SLIDE_ASK, DOLL_SYS, DOLL_ASK, parseJson, dollToPerson, cleanSlide, slideFromImage, dollFromImage };
