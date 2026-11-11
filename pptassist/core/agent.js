// 捞捞PPT助手 · AI 助手「捞捞」：老师说要怎么改，它一边回话一边动手改 PPT，每做一步都汇报进度。
//   send(文字, 图片) → 流式回复（事件：delta 一小段文字、tool 开始 / 做完一步、done、error）
//   ocr(图片) → 照片里的数学公式 → LaTeX（给老师预览，确认了再插）
"use strict";
const M = require("./latex2omml");

const SYSTEM = `你是「捞捞」，捞捞PPT助手里帮老师改 PPT 的 AI 助手。你在老师自己的电脑上运行，不联网。
你能用下面这些工具读和改老师现在打开的这份 PPT（页码从 1 开始）。

做事的规矩：
1. 不清楚 PPT 里有什么，先调用 get_outline 看大纲；要改某一页的某个框，先调用 get_slide 看这一页有哪些框（编号从 1 开始）。
2. 老师说得清楚就直接改，不用反复确认；删掉页面之前要先问老师「确定要删第几页吗」，老师同意了再删。
3. 每改完一步，用一句话告诉老师做了什么（比如「第 3 页的标题改成了……」）。全部做完，最后一句话总结。
4. 数学公式一律写成 LaTeX，用 insert_formula 插入（会变成 PowerPoint 里能双击修改的公式）。老师发来公式照片时：先把照片里的公式写成 LaTeX 给老师看，老师说「插」「可以」再插；老师一开始就说了插到哪一页，就直接插。
5. 不要编造页码和内容；工具报错了，照实告诉老师，换个办法或者问老师。
6. 回答用简体中文，口语化、简短；不要输出 JSON 和代码，除了公式的 LaTeX。
7. 老师问的和 PPT 无关（比如讲题思路、出题），也可以正常回答，但不要乱改 PPT。`;

const TOOLS = [
  { name: "get_outline", desc: "看整份 PPT 的大纲：每一页的页码、标题、主要文字、有几个公式和图片", params: {} },
  { name: "get_slide", desc: "看某一页上有哪些框（编号、类型、文字）。改文字之前先看", params: { slide: { type: "integer", description: "页码" } }, req: ["slide"] },
  { name: "set_text", desc: "把某一页某个框的文字整个换掉（保留原来的字体、字号、颜色）。shape 写框的编号，或者写 \"title\" 表示标题", params: { slide: { type: "integer" }, shape: { type: "string", description: "框的编号（比如 \"2\"），或者 \"title\"" }, lines: { type: "array", items: { type: "string" }, description: "新的文字，每一行一段" } }, req: ["slide", "shape", "lines"] },
  { name: "replace_text", desc: "把 PPT 里的某个词换成另一个词（不写 slide 就是整份都换）", params: { find: { type: "string" }, replace: { type: "string" }, slide: { type: "integer", description: "只换这一页（可以不写）" } }, req: ["find", "replace"] },
  { name: "add_slide", desc: "在第 after 页后面加一页（after 写 0 就是放在最前面），有标题和几条要点", params: { after: { type: "integer" }, title: { type: "string" }, lines: { type: "array", items: { type: "string" } } }, req: ["after", "title"] },
  { name: "delete_slide", desc: "删掉某一页（老师确认过才能删）", params: { slide: { type: "integer" } }, req: ["slide"] },
  { name: "move_slide", desc: "把第 slide 页挪到第 to 页的位置", params: { slide: { type: "integer" }, to: { type: "integer" } }, req: ["slide", "to"] },
  { name: "insert_formula", desc: "在某一页插入数学公式（PowerPoint 公式，能双击修改）。latex 写 LaTeX，不要带 $", params: { slide: { type: "integer" }, latex: { type: "string" }, where: { type: "string", enum: ["top", "middle", "bottom"], description: "大概放在哪：上面 / 中间 / 下面" }, size: { type: "integer", description: "字号（磅），默认 28" } }, req: ["slide", "latex"] },
  { name: "undo", desc: "撤销上一步改动", params: {} },
];
const toolSchema = () => TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.desc, parameters: { type: "object", properties: t.params, required: t.req || [] } } }));

// 每一步给老师看的进度
function say(name, a = {}) {
  switch (name) {
    case "get_outline": return "看一下整份 PPT 的大纲";
    case "get_slide": return `看第 ${a.slide} 页上有哪些框`;
    case "set_text": return `改第 ${a.slide} 页${a.shape === "title" ? "的标题" : `第 ${a.shape} 个框的文字`}`;
    case "replace_text": return `把「${a.find}」换成「${a.replace}」${a.slide ? `（第 ${a.slide} 页）` : ""}`;
    case "add_slide": return `在第 ${a.after} 页后面加一页「${a.title || ""}」`;
    case "delete_slide": return `删掉第 ${a.slide} 页`;
    case "move_slide": return `把第 ${a.slide} 页挪到第 ${a.to} 页`;
    case "insert_formula": return `在第 ${a.slide} 页插公式 ${M.linear(a.latex || "")}`;
    case "undo": return "撤销上一步";
    default: return name;
  }
}
const CHANGES = new Set(["set_text", "replace_text", "add_slide", "delete_slide", "move_slide", "insert_formula", "undo"]);

function create(opt) {
  const llm = opt.llm;          // core/llm.js 的实例
  const deck = opt.deck;        // () => 当前打开的 PPT（core/pptedit.js），没打开时是 null
  const emit = (e) => { try { opt.onEvent && opt.onEvent(e); } catch (x) {} };
  let messages = [];
  let busy = null;

  async function run(name, a) {
    const d = deck();
    if (!d) throw new Error("老师还没打开 PPT（在「选页和内容」里打开一个）");
    switch (name) {
      case "get_outline": return (await d.outline()).map((s) => ({ no: s.no, title: s.title, text: s.texts.join(" / ").slice(0, 120), ...(s.formulas ? { formulas: s.formulas } : {}), ...(s.pictures ? { pictures: s.pictures } : {}), ...(s.hidden ? { hidden: true } : {}) }));
      case "get_slide": return d.slide(a.slide);
      case "set_text": return d.setText(a.slide, a.shape, a.lines || []);
      case "replace_text": return d.replace(a.find, a.replace, a.slide);
      case "add_slide": return d.addSlide(a.after, a.title, a.lines || []);
      case "delete_slide": return d.deleteSlide(a.slide);
      case "move_slide": return d.moveSlide(a.slide, a.to);
      case "insert_formula": return d.insertFormula(a.slide, a.latex, { where: a.where, size: a.size });
      case "undo": { const l = await d.undo(); return l ? { undone: l } : { undone: null, note: "没有可以撤销的了" }; }
      default: throw new Error("没有这个工具：" + name);
    }
  }

  // text：老师说的话；images：[data:image/jpeg;base64,…]（照片、截图）
  async function send(text, images = []) {
    if (busy) throw new Error("上一句还没说完");
    text = String(text || "").trim();
    if (!text && !images.length) throw new Error("说点什么吧");
    const user = images.length ? { role: "user", content: [...images.map((u) => ({ type: "image_url", image_url: { url: u } })), { type: "text", text: text || "这是什么？" }] } : { role: "user", content: text };
    messages.push(user);
    const ac = { aborted: false };
    busy = ac;
    let changed = 0;
    try {
      await llm.start();
      for (let round = 0; round < (opt.maxRounds || 10); round++) {
        const sys = { role: "system", content: SYSTEM + (deck() ? `\n\n现在打开的 PPT：${opt.fileName ? opt.fileName() : ""}，一共 ${(await deck().outline()).length} 页。` : "\n\n老师现在还没有打开 PPT。") };
        const p = llm.chat([sys, ...trim(messages)], { tools: toolSchema(), onDelta: (t) => emit({ type: "delta", text: t }) });
        ac.abort = p.abort;
        const r = await p;
        if (ac.aborted) { messages.push({ role: "assistant", content: (r.content || "") + "（老师让我停下了）" }); emit({ type: "done", stopped: true, changed }); return; }
        messages.push({ role: "assistant", content: r.content || "", ...(r.tool_calls.length ? { tool_calls: r.tool_calls } : {}) });
        if (!r.tool_calls.length) { emit({ type: "done", changed }); return; }
        for (const c of r.tool_calls) {
          let a = {}; try { a = JSON.parse(c.function.arguments || "{}"); } catch (e) {}
          const name = c.function.name;
          emit({ type: "tool", stage: "start", name, args: a, say: say(name, a) });
          let res, ok = true;
          try { res = await run(name, a); if (CHANGES.has(name)) changed++; }
          catch (e) { ok = false; res = { error: e.message }; }
          emit({ type: "tool", stage: "done", name, args: a, say: say(name, a), ok, result: res, changed: ok && CHANGES.has(name) });
          messages.push({ role: "tool", tool_call_id: c.id, name, content: JSON.stringify(res).slice(0, 6000) });
          if (ac.aborted) break;
        }
        if (ac.aborted) { emit({ type: "done", stopped: true, changed }); return; }
      }
      emit({ type: "done", changed, note: "做的步骤太多了，先停在这里：看看改得对不对，再告诉我接下来做什么" });
    } catch (e) {
      emit({ type: "error", message: e.message });
      throw e;
    } finally { busy = null; }
  }
  // 对话太长时只留最近的（图片只留最近一张，省内存、省时间）
  function trim(ms) {
    let out = ms.slice(-30);
    while (out.length && out[0].role === "tool") out = out.slice(1);
    let seenImg = false;
    return out.slice().reverse().map((m) => {
      if (!Array.isArray(m.content)) return m;
      const has = m.content.some((c) => c.type === "image_url");
      if (has && seenImg) return { ...m, content: m.content.filter((c) => c.type !== "image_url").concat([{ type: "text", text: "（之前发过一张图片）" }]) };
      if (has) seenImg = true;
      return m;
    }).reverse();
  }
  function stop() { if (busy) { busy.aborted = true; if (busy.abort) busy.abort(); return true; } return false; }
  function reset() { stop(); messages = []; }

  // 照片 → 公式的 LaTeX（不改 PPT，只认）
  async function ocr(image) {
    await llm.start();
    const r = await llm.chat([
      { role: "system", content: "你把图片里的数学公式转成 LaTeX。只输出 LaTeX 本身，不要 $ 符号，不要解释。有好几行就用 \\\\ 分行。看不清的地方按最可能的写。" },
      { role: "user", content: [{ type: "image_url", image_url: { url: image } }, { type: "text", text: "把图片里的公式写成 LaTeX。" }] },
    ], { temperature: 0.1, maxTokens: 800 });
    const latex = M.clean(r.content || "");
    if (!latex) throw new Error("没认出公式：照片拍清楚一点、只拍公式那一块再试");
    return { latex, text: M.linear(latex) };
  }
  return { send, stop, reset, ocr, history: () => messages.slice(), busy: () => !!busy };
}

module.exports = { create, SYSTEM, TOOLS, toolSchema, say };
