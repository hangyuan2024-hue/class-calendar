// 捞捞PPT助手 · AI 助手「捞捞」：老师说要怎么改，它一边回话一边动手改 PPT，每做一步都汇报进度。
//   send(文字, 图片) → 流式回复（事件：delta 一小段文字、tool 开始 / 做完一步、done、error）
//   ocr(图片) → 照片里的数学公式 → LaTeX（给老师预览，确认了再插）
"use strict";
const M = require("./latex2omml");

const D = require("./deck");

// 改 PPT 的规矩（「AI 改 PPT」和成品展示里的捞小智用同一份）
const PPT_RULES = `改 PPT 的规矩：
1. 先看再改：不清楚 PPT 里有什么，先 get_outline；要改某一页，先 get_slide 看这一页有哪些框（编号从 1 开始、每个框是哪一块）。
2. 老师说得清楚就直接改，不用反复确认；只有删掉页面要先问一句「确定要删第几页吗」。
3. 选对工具：
   · 改几个字、全文统一换一个词 → replace_text；改一个框里的字 → set_text。
   · 这一页要重写、加一条 / 减一条、换个排法（要点 ↔ 卡片 ↔ 步骤 ↔ 两栏对比 ↔ 表格 ↔ 代码 ↔ 公式）→ edit_slide：把这一页新的内容写全，layout 写要的版式。
   · 加一页 → add_slide（写 layout 和内容；内容多会自动拆成两页）。复制 → copy_slide，挪位置 → move_slide。
   · 换颜色风格 → set_theme；字大一点 / 小一点 → set_font_size；标红、加粗、标重点、高亮 → format_text。
   · 数学公式一律写 LaTeX：单独一条公式用 insert_formula（会变成 PowerPoint 里能双击修改的公式），整页讲一个公式用 layout=formula。
   · 表格 → insert_table，或者 layout=table 单独一页；老师发来的图片 → insert_image；讲稿 → set_notes；多余的框 → delete_shape。
   · 老师说「不对」「改回去」→ undo。
4. 版面：每页只讲一件事，标题一句话说清这一页的结论；要点 3～5 条、每条不超过 25 个字；能用步骤、对比、表格说清楚的，不要堆成一串要点。
5. 内容要准：概念、公式、代码、数据只写有把握的；拿不准的直接告诉老师「这里请您核对」，不要编。代码要能运行、缩进对齐。
6. 改动多的时候（新做了一份，或者一次改了 3 页以上）调用 check_ppt 自己查一遍，查出问题先改掉，再告诉老师。
7. 每改完一步用一句话说做了什么（比如「第 3 页改成了两栏对比」），全部做完最后一句话总结；工具报错了照实说，换个办法或者问老师。`;

const SYSTEM = `你是「捞捞」，捞捞PPT助手里帮老师改 PPT 的 AI 助手。你在老师自己的电脑上运行，不联网。
你能用下面这些工具读和改老师现在打开的这份 PPT（页码从 1 开始）。

${PPT_RULES}
8. 老师发来公式照片时：先把照片里的公式写成 LaTeX 给老师看，老师说「插」「可以」再插；老师一开始就说了插到哪一页，就直接插。
9. 回答用简体中文，口语化、简短；不要输出 JSON 和代码，除了公式的 LaTeX。
10. 老师问的和 PPT 无关（比如讲题思路、出题），也可以正常回答，但不要乱改 PPT。`;

const STR = { type: "string" }, INT = { type: "integer" }, LIST = { type: "array", items: STR };
// 一页的内容（make_ppt、add_slide、edit_slide 都是这几样；用不到的不写）
const PAGE = {
  layout: { type: "string", enum: Object.keys(D.LAYOUTS), description: "版式：cover 封面 / section 章节页 / bullets 要点 / cards 卡片 / steps 步骤 / compare 两栏对比 / statement 金句 / code 代码 / table 表格 / formula 公式 / summary 小结 / end 结束页。不写就按内容自动挑" },
  title: { type: "string", description: "这一页的标题" },
  sub: { type: "string", description: "副标题（cover、section、statement、end 用）" },
  lines: { ...LIST, description: "要点（bullets、summary）；code、formula 页里是旁边的讲解" },
  items: { type: "array", items: { type: "object", properties: { head: STR, body: STR } }, description: "cards / steps 的每一项：head 小标题，body 一句说明" },
  left: { type: "object", properties: { head: STR, lines: LIST }, description: "compare 的左栏" },
  right: { type: "object", properties: { head: STR, lines: LIST }, description: "compare 的右栏" },
  code: { type: "string", description: "code 页的代码（原样，带换行和缩进）" },
  lang: { type: "string", description: "代码是什么语言，比如 C" },
  table: { type: "array", items: LIST, description: "table 页：每一行一个数组，第一行是表头" },
  formula: { type: "string", description: "formula 页的公式：LaTeX，不带 $" },
  takeaway: { type: "string", description: "这一页最下面的一句结论（可以不写）" },
  notes: { type: "string", description: "备注：老师讲这一页时说的话（只有老师看得见，可以不写）" },
};
const PAGE_KEYS = Object.keys(PAGE);
const PAGE0 = Object.fromEntries(Object.entries(PAGE).map(([k, v]) => { const { description, ...r } = v; void description; return [k, r]; }));   // 不带说明的（说明在 add_slide 里写过一遍了，省上下文）
const pageOf = (a) => Object.fromEntries(PAGE_KEYS.filter((k) => a[k] != null && a[k] !== "").map((k) => [k, a[k]]));
const WHERE = { type: "string", enum: ["top", "middle", "bottom"], description: "大概放在哪：上面 / 中间 / 下面" };

const TOOLS = [
  { name: "get_outline", desc: "看整份 PPT 的大纲：每一页的页码、标题、版式、主要文字、有几个公式 / 图片 / 表格", params: {} },
  { name: "get_slide", desc: "看某一页上有哪些框（编号、是哪一块、文字）和备注。改之前先看", params: { slide: { ...INT, description: "页码" } }, req: ["slide"] },
  { name: "set_text", desc: "把某一页某个框的文字整个换掉（保留原来的样子）。shape 写框的编号，或者写 \"title\" 表示标题", params: { slide: INT, shape: { type: "string", description: "框的编号（比如 \"2\"），或者 \"title\"" }, lines: { ...LIST, description: "新的文字，每一行一段" } }, req: ["slide", "shape", "lines"] },
  { name: "replace_text", desc: "把 PPT 里的某个词换成另一个词（不写 slide 就是整份都换）", params: { find: STR, replace: STR, slide: { ...INT, description: "只换这一页（可以不写）" } }, req: ["find", "replace"] },
  { name: "add_slide", desc: "在第 after 页后面加一页（after 写 0 就是放在最前面）。写 layout 和这种版式要的内容；内容多会自动拆成两页", params: { after: INT, ...PAGE }, req: ["after", "title"] },
  { name: "edit_slide", desc: "重写一页 / 换版式：把这一页新的内容写全（没写的块留着原来的），layout 写要换成的版式（内容的写法和 add_slide 一样）。加一条、减一条要点也用它", params: { slide: INT, ...PAGE0 }, req: ["slide"] },
  { name: "delete_slide", desc: "删掉某一页（老师确认过才能删）", params: { slide: INT }, req: ["slide"] },
  { name: "move_slide", desc: "把第 slide 页挪到第 to 页的位置", params: { slide: INT, to: INT }, req: ["slide", "to"] },
  { name: "copy_slide", desc: "把某一页复制一份，放在它后面", params: { slide: INT }, req: ["slide"] },
  { name: "set_theme", desc: "整份换配色。theme：" + Object.entries(D.THEMES).map(([k, v]) => `${k} ${v.name}`).join(" / ") + "；或者 color 给一个颜色（#RRGGBB，比如校徽的颜色），主色用它", params: { theme: { type: "string", enum: Object.keys(D.THEMES) }, color: { type: "string", description: "#RRGGBB" } } },
  { name: "set_font_size", desc: "调字号。scale：放大 / 缩小的倍数（大一点 1.15，小一点 0.87）；不写 shape 就是整页；要定成具体的磅数就写 shape 和 size", params: { slide: INT, scale: { type: "number" }, shape: { type: "string", description: "只调这个框（编号或 \"title\"）" }, size: { ...INT, description: "字号（磅）" } }, req: ["slide"] },
  { name: "format_text", desc: "给某几个字加粗 / 上色 / 标底色 / 下划线（标重点、标红、高亮）。find 写要标的字；slide 写 0 就是整份都标", params: { slide: INT, find: { type: "string", description: "要标的那几个字" }, bold: { type: "boolean" }, color: { type: "string", description: "字的颜色：红 / 蓝 / 绿 / 橙 / 紫 / 灰，或者 #RRGGBB，或者 accent1（主题色）" }, highlight: { type: "string", description: "底色（荧光笔）：黄 / 绿 / 蓝 / 粉" }, underline: { type: "boolean" }, italic: { type: "boolean" }, shape: { type: "string", description: "不写 find、写 shape：把这个框整个标上" } }, req: ["slide"] },
  { name: "insert_formula", desc: "在某一页插入数学公式（PowerPoint 公式，能双击修改）。latex 写 LaTeX，不要带 $", params: { slide: INT, latex: STR, where: WHERE, size: { ...INT, description: "字号（磅），默认 28" } }, req: ["slide", "latex"] },
  { name: "insert_table", desc: "在某一页放一张表格。rows：每一行一个数组，第一行是表头", params: { slide: INT, rows: { type: "array", items: LIST }, where: WHERE }, req: ["slide", "rows"] },
  { name: "insert_image", desc: "把老师发来的图片放到某一页。image：老师这次发的第几张（默认 1）；where：right 右边 / left 左边 / center 中间 / full 铺满当背景，不写就自动找地方", params: { slide: INT, image: INT, where: { type: "string", enum: ["right", "left", "center", "full", "top", "bottom"] } }, req: ["slide"] },
  { name: "delete_shape", desc: "删掉某一页上的一个框（公式、图片、表格、一条要点…）。shape 写 get_slide 里的编号", params: { slide: INT, shape: STR }, req: ["slide", "shape"] },
  { name: "set_notes", desc: "给某一页写备注（讲稿，上课时只有老师看得见）", params: { slide: INT, text: STR }, req: ["slide", "text"] },
  { name: "check_ppt", desc: "自己检查一遍整份 PPT：哪一页字放不下、没标题、标题重复、是空的。每个问题带页码和改法", params: {} },
  { name: "undo", desc: "撤销上一步改动", params: {} },
];
const toolSchema = (list = TOOLS) => list.map((t) => ({ type: "function", function: { name: t.name, description: t.desc, parameters: { type: "object", properties: t.params, required: t.req || [] } } }));

// 每一步给老师看的进度
const LNAME = (k) => (D.LAYOUTS[D.layoutKey(k)] || "").replace(/（.*$/, "");
function say(name, a = {}) {
  switch (name) {
    case "get_outline": return "看一下整份 PPT 的大纲";
    case "get_slide": return `看第 ${a.slide} 页上有哪些框`;
    case "set_text": return `改第 ${a.slide} 页${a.shape === "title" ? "的标题" : `第 ${a.shape} 个框的文字`}`;
    case "replace_text": return `把「${a.find}」换成「${a.replace}」${a.slide ? `（第 ${a.slide} 页）` : ""}`;
    case "add_slide": return `在第 ${a.after} 页后面加一页「${a.title || ""}」${LNAME(a.layout) ? `（${LNAME(a.layout)}）` : ""}`;
    case "edit_slide": return `重排第 ${a.slide} 页${LNAME(a.layout) ? `，换成「${LNAME(a.layout)}」` : ""}`;
    case "delete_slide": return `删掉第 ${a.slide} 页`;
    case "move_slide": return `把第 ${a.slide} 页挪到第 ${a.to} 页`;
    case "copy_slide": return `复制第 ${a.slide} 页`;
    case "set_theme": return `换配色${a.theme && D.THEMES[a.theme] ? `「${D.THEMES[a.theme].name}」` : a.color ? `（主色 ${a.color}）` : ""}`;
    case "set_font_size": return `把第 ${a.slide} 页${a.shape ? `第 ${a.shape} 个框` : ""}的字调${a.size ? `成 ${a.size} 磅` : +a.scale < 1 ? "小" : "大"}`;
    case "format_text": return a.find ? `把${+a.slide ? `第 ${a.slide} 页的` : ""}「${a.find}」标出来` : `改第 ${a.slide} 页第 ${a.shape} 个框的样子`;
    case "insert_formula": return `在第 ${a.slide} 页插公式 ${M.linear(a.latex || "")}`;
    case "insert_table": return `在第 ${a.slide} 页放一张表格`;
    case "insert_image": return `把图片放到第 ${a.slide} 页`;
    case "delete_shape": return `删掉第 ${a.slide} 页第 ${a.shape} 个框`;
    case "set_notes": return `写第 ${a.slide} 页的备注`;
    case "check_ppt": return "自己检查一遍";
    case "undo": return "撤销上一步";
    default: return name;
  }
}
const READS = new Set(["get_outline", "get_slide", "check_ppt"]);
const CHANGES = new Set(TOOLS.map((t) => t.name).filter((n) => !READS.has(n)));

function create(opt) {
  const llm = opt.llm;          // core/llm.js 的实例
  const deck = opt.deck;        // () => 当前打开的 PPT（core/pptedit.js），没打开时是 null
  const emit = (e) => { try { opt.onEvent && opt.onEvent(e); } catch (x) {} };
  let messages = [];
  let busy = null;
  // 另外带的工具（成品展示里的「捞小智」：教务办事、做 PPT……）：{ name, desc, params, req, say(a), run(a), changes }
  //   opt.ppt === false：不带改 PPT 的那一套；opt.system：换一套系统提示（字符串，或者每一轮现算的函数）
  const EXTRA = new Map((opt.tools || []).map((t) => [t.name, t]));
  const ALL = [...(opt.ppt === false ? [] : TOOLS), ...EXTRA.values()];
  let images = [];              // 老师最近一次发来的图片（insert_image 用）
  const sayOf = (name, a) => { const x = EXTRA.get(name); try { return x ? (x.say ? x.say(a) : x.name) : say(name, a); } catch (e) { return name; } };
  const changes = (name) => (EXTRA.has(name) ? !!EXTRA.get(name).changes : CHANGES.has(name));
  const sysOf = async (names) => {
    if (opt.system) return typeof opt.system === "function" ? await opt.system(names) : opt.system;
    return SYSTEM + (deck() ? `\n\n现在打开的 PPT：${opt.fileName ? opt.fileName() : ""}，一共 ${(await deck().outline()).length} 页。` : "\n\n老师现在还没有打开 PPT。");
  };

  async function run(name, a) {
    if (EXTRA.has(name)) return EXTRA.get(name).run(a);
    if (opt.ppt === false) throw new Error("没有这个工具：" + name);
    const d = deck();
    if (!d) throw new Error("老师还没打开 PPT（在「选页和内容」里打开一个）");
    switch (name) {
      case "get_outline": { const ol = await d.outline(), cut = ol.length > 24 ? 50 : 120;
        return ol.map((s) => ({ no: s.no, title: s.title, ...(s.layout ? { layout: s.layout } : {}), text: s.texts.join(" / ").slice(0, cut), ...(s.formulas ? { formulas: s.formulas } : {}), ...(s.pictures ? { pictures: s.pictures } : {}), ...(s.tables ? { tables: s.tables } : {}), ...(s.hidden ? { hidden: true } : {}) })); }
      case "get_slide": return d.slide(a.slide);
      case "set_text": return d.setText(a.slide, a.shape, a.lines || []);
      case "replace_text": return d.replace(a.find, a.replace, a.slide);
      case "add_slide": { const { title, lines, ...ex } = pageOf(a); return d.addSlide(a.after, title, lines || [], ex); }
      case "edit_slide": return d.editSlide(a.slide, { ...pageOf(a), ...(a.font_scale ? { font_scale: a.font_scale } : {}) });
      case "copy_slide": return d.duplicateSlide(a.slide);
      case "set_theme": return d.setTheme({ theme: a.theme, color: a.color });
      case "set_font_size": return d.scaleFont(a.slide, { scale: a.scale, shape: a.shape, size: a.size });
      case "format_text": return d.formatText(a.slide, a.find, { bold: a.bold, italic: a.italic, underline: a.underline, color: a.color, highlight: a.highlight, size: a.size, shape: a.shape });
      case "insert_table": return d.insertTable(a.slide, a.rows, { where: a.where });
      case "insert_image": { const u = images[(+a.image || 1) - 1]; if (!u) throw new Error(images.length ? `老师只发了 ${images.length} 张图片` : "老师还没发图片：请老师把图片发过来（拖进来或者点「加图片」）"); return d.insertImage(a.slide, u, { where: a.where }); }
      case "delete_shape": return d.deleteShape(a.slide, a.shape);
      case "set_notes": return d.setNotes(a.slide, a.text);
      case "check_ppt": return d.check();
      case "delete_slide": return d.deleteSlide(a.slide);
      case "move_slide": return d.moveSlide(a.slide, a.to);
      case "insert_formula": return d.insertFormula(a.slide, a.latex, { where: a.where, size: a.size });
      case "undo": { const l = await d.undo(); return l ? { undone: l } : { undone: null, note: "没有可以撤销的了" }; }
      default: throw new Error("没有这个工具：" + name);
    }
  }

  // text：老师说的话；images：[data:image/jpeg;base64,…]（照片、截图）
  async function send(text, imgs = []) {
    if (busy) throw new Error("上一句还没说完");
    text = String(text || "").trim();
    if (!text && !imgs.length) throw new Error("说点什么吧");
    if (imgs.length) images = imgs.slice();
    // 这一句带哪些工具：opt.pick(这句话) 返回工具名的集合（工具多的时候按这句话在说什么挑，省模型的上下文）；不给就全带
    const names = opt.pick ? opt.pick(text, imgs) : null, use = names ? ALL.filter((t) => names.has(t.name)) : ALL;
    const user = imgs.length ? { role: "user", content: [...imgs.map((u) => ({ type: "image_url", image_url: { url: u } })), { type: "text", text: text || "这是什么？" }] } : { role: "user", content: text };
    messages.push(user);
    const ac = { aborted: false };
    busy = ac;
    let changed = 0;
    try {
      await llm.start();
      for (let round = 0; round < (opt.maxRounds || 10); round++) {
        const sys = { role: "system", content: await sysOf(names) };
        const p = llm.chat([sys, ...trim(messages)], { tools: toolSchema(use), onDelta: (t) => emit({ type: "delta", text: t }) });
        ac.abort = p.abort;
        const r = await p;
        if (ac.aborted) { messages.push({ role: "assistant", content: (r.content || "") + "（老师让我停下了）" }); emit({ type: "done", stopped: true, changed }); return; }
        messages.push({ role: "assistant", content: r.content || "", ...(r.tool_calls.length ? { tool_calls: r.tool_calls } : {}) });
        if (!r.tool_calls.length) { emit({ type: "done", changed }); return; }
        for (const c of r.tool_calls) {
          let a = {}; try { a = JSON.parse(c.function.arguments || "{}"); } catch (e) {}
          const name = c.function.name;
          emit({ type: "tool", stage: "start", name, args: a, say: sayOf(name, a) });
          let res, ok = true;
          try { res = await run(name, a); if (changes(name)) { changed++; if (opt.onChanged) { const x = await opt.onChanged(name, res, a); if (x && res && typeof res === "object") res = { ...res, ...x }; } } }
          catch (e) { ok = false; res = { error: e.message }; }
          emit({ type: "tool", stage: "done", name, args: a, say: sayOf(name, a), ok, result: res, changed: ok && changes(name) });
          messages.push({ role: "tool", tool_call_id: c.id, name, content: JSON.stringify(res).slice(0, opt.maxResult || 6000) });
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
  function reset() { stop(); messages = []; images = []; }

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

module.exports = { create, SYSTEM, PPT_RULES, TOOLS, PAGE, PAGE0, pageOf, toolSchema, say };
