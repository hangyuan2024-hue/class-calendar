// 捞小智 · 查实了再回答（云端出主意、本机去查、程序把关、本机照资料写、核对不过再请云端审稿）
//
//   小模型的问题不是不会说话，是不知道的事会编。所以「知道」这件事不押在模型身上，押在这条流水线上：
//   0. 知识卡片：以前查实过的同类问题，直接拿当时核实过的资料（不联网、不花云端）
//   1. 出主意（云端，只看问题、不看资料，几百 token）：这题要不要查、是哪类问题、该搜什么（2~3 个好搜索词）、
//      要核实哪几个「事实空位」（比如：哪一年、总分多少）、回答要覆盖哪几点。云端不许写答案 —— 值只能从资料里来
//      没接云端：按规则出主意（问题本身当搜索词、整个问题当一个空位）
//   2. 按需查（本机）：一轮一轮搜、读网页；每个网页先过 sources.js 的关（分档、登录页 / 验证页、正文太短、对不上、
//      太旧、转载）；读完一轮就看空位填上没有、印证了没有 —— 都查实了就停，没查实换搜索词、去权威网站再查，到上限为止
//   3. 填空位：小模型只做一件小事 ——「这段资料回答了这个空位吗？照抄原话」。抄的必须真是资料里的字（程序比对），编的作废
//      算数的条件：来自权威来源（第 1 档），或者两个不相干的网站说法一致；说法打架 → 只把那两三句原话发给云端判
//   4. 本机照资料写 + 逐句核对（core/ground.js，和训练时同一套说法）；有句子核对不过 → 把这几句和资料发给云端，只让它指出怎么改
//      云端改的句子也要过程序检查（数字必须在资料里、出处要对得上），不全信
//   5. 没查实的空位，程序自己写「没查到」；说法不一致的，把两家说法都摆出来 —— 不让模型补
//   6. 查实了的存成知识卡片；用到的网站按「被印证 / 被挑错」记信誉
"use strict";
const GROUND = require("./ground");
const SRC = require("./sources");

const { rank, chunks, toks } = GROUND;

// ---------- 1. 出主意 ----------
const PLAN_SYS = `你是查资料的策划，只出主意、不回答问题。根据用户的问题输出一个 JSON（不要别的字）：
{"need":"facts|reason|chat","type":"policy|admission|news|course|code|health|law|general","queries":["搜索词1","搜索词2","搜索词3"],"sites":["权威网站域名"],"slots":[{"key":"短名","ask":"要核实的一个具体问题"}],"outline":["回答要覆盖的要点"]}
· need：要查事实才能答对的（数字、日期、人名、规定、政策、分数线、新闻、某个知识点的准确说法）写 facts；靠推理计算就能答的（解题、写代码、写作文、出主意）写 reason；闲聊写 chat。不是 facts 的，后面几项都写空的
· queries：给中文搜索引擎用的 2~3 个搜索词，具体、带关键名词；问到年份或「今年 / 最新」的一定写上年份（现在是 {NOW}）；第一个最直接，后面的换说法或换角度
· sites：这类问题最权威的网站（比如 教育部 moe.gov.cn、研招网 chsi.com.cn、某个学校官网、gov.cn），没把握就写空的
· slots：回答必须核实的 1~4 个事实，每个是一个能在资料里找到原话的小问题（比如「2026 年计算机学硕国家线总分是多少」）；不要写成要推理的问题
· outline：回答要覆盖的 2~4 个要点，每个不超过 15 个字
· 绝对不要在任何地方写出你认为的答案、数字或结论 —— 值只能从查到的资料里来`;
const PLAN_KEYS = ["facts", "reason", "chat"];

// 没有云端时：按规则出主意
const FACTY = /是谁|谁是|哪一年|哪年|什么时候|何时|多少|几个|几月|几号|几岁|多大|多高|多长|是什么|什么是|指的是|定义|规定|政策|通知|分数线|国家线|录取|在哪|哪里|哪个|有哪些|最新|今年|去年|新闻|发生了什么|几点|日期|时间|名单|排名|首都|作者|发明|成立|面积|人口/;
// 不用查事实的：闲聊、写东西、算题、改东西、做 PPT、查自己的课表成绩（那些有专门的工具）
const NOT_FACTS = /^(你好|您好|在吗|谢谢|再见|哈哈|嗯|好的|ok)|写一篇|写一段|写个|作文|帮我写|编一个|讲个笑话|陪我|聊聊|怎么哄|计算一下|帮我算|算一下|求解|解方程|证明|推导|化简|写代码|写一个.*(程序|函数|代码)|改一下|润色|翻译|总结一下这|做一份|做个|PPT|ppt|我的(课表|成绩|绩点|考勤)|帮我请假|借教室/i;
function rulePlan(q) {
  const need = !NOT_FACTS.test(q) && FACTY.test(q) ? "facts" : "chat";
  const type = SRC.typeOf(q);
  const core = q.replace(/[？?。！!，,]/g, " ").replace(/请问|帮我查一下|帮我查查|查一下|告诉我|我想知道|你知道|吗|呢|吧/g, " ").replace(/\s+/g, " ").trim();
  return { need, type, queries: [...new Set([core || q, q])].slice(0, 2), sites: [], slots: need === "facts" ? [{ key: "答案", ask: q }] : [], outline: [], by: "规则" };
}
function parsePlan(raw, q) {
  const m = /\{[\s\S]*\}/.exec(String(raw || ""));
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch (e) { return null; }
  const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
  const need = PLAN_KEYS.includes(j.need) ? j.need : "facts";
  const type = ["policy", "admission", "news", "course", "code", "health", "law", "general"].includes(j.type) ? j.type : SRC.typeOf(q);
  const queries = (Array.isArray(j.queries) ? j.queries : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 3);
  const sites = (Array.isArray(j.sites) ? j.sites : []).map((x) => str(x, 60).replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x)).slice(0, 3);
  const slots = (Array.isArray(j.slots) ? j.slots : []).map((x) => ({ key: str(x && x.key, 20), ask: str(x && x.ask, 80) })).filter((x) => x.key && x.ask).slice(0, 4);
  const outline = (Array.isArray(j.outline) ? j.outline : []).map((x) => str(x, 30)).filter(Boolean).slice(0, 4);
  if (need === "facts" && !queries.length) queries.push(q);
  if (need === "facts" && !slots.length) slots.push({ key: "答案", ask: q });
  return { need, type, queries, sites, slots, outline, by: "云端" };
}

// ---------- 3. 填空位：小模型照抄原话，程序比对 ----------
const QUOTE_SYS = `你是摘录员。下面有一段资料和一个问题。如果这段资料里有直接回答这个问题的话，把那句话原样抄出来（一个字都不改，不超过 80 个字）；资料里没有直接回答的，只写「没有」。不要解释，不要写别的。`;
const norm = (s) => String(s || "").replace(/[\s　"“”'‘’「」『』]/g, "");
// 抄的是不是资料里真有的话：原样在 → 用它；改了几个字 → 找资料里最像的那一句（重合七成以上）；对不上 → 作废
function verifyQuote(quote, passage) {
  const q = norm(quote), p = String(passage || "");
  if (!q || /^没有/.test(q) || q.length < 2) return null;
  if (norm(p).includes(q)) return String(quote).trim().replace(/^["“「]|["”」]$/g, "");
  const sents = p.split(/(?<=[。！？!?；;\n])/).map((x) => x.trim()).filter(Boolean);
  let best = null, bs = 0;
  for (const s of sents) {
    const ns = norm(s); if (!ns) continue;
    const A = new Set(q), common = [...new Set(ns)].filter((c) => A.has(c)).length, sc = common / Math.max(A.size, 1);
    if (sc > bs) { bs = sc; best = s; }
  }
  return bs >= 0.7 && best && norm(best).length <= q.length * 3 ? best : null;
}
const numsOf = (s) => (String(s || "").match(/\d+(?:\.\d+)?/g) || []).filter((x) => !/^20\d\d$/.test(x));   // 年份不算（几家都写着「2026 年」）
// 两句话说的是不是一回事：有数字的看数字（数字一样才算一致、不一样就是打架）；没数字的看用词重合
function agree(a, b) {
  const na = numsOf(a), nb = numsOf(b);
  if (na.length && nb.length) {
    // 一边的数字全在另一边里 → 一致（一句多说了单科线不算打架）；两边各有对方没有的数字 → 打架（「8000 元，10 月」和「6000 元，10 月」）
    const A = new Set(na), B = new Set(nb), onlyA = [...A].filter((x) => !B.has(x)).length, onlyB = [...B].filter((x) => !A.has(x)).length;
    return onlyA && onlyB ? "conflict" : "same";
  }
  const ta = new Set(toks(a).filter((t) => t.length > 1)), tb = toks(b).filter((t) => t.length > 1);
  if (!ta.size || !tb.length) return "unknown";
  const ov = tb.filter((t) => ta.has(t)).length / Math.min(ta.size, new Set(tb).size);
  return ov >= 0.5 ? "same" : "unknown";
}
// 一个空位现在怎么样：ok 查实了 / conflict 说法打架 / single 只有一家（不够权威）/ none 没查到
function slotState(cands) {
  if (!cands.length) return { state: "none" };
  const best = [...cands].sort((a, b) => a.tier - b.tier || b.rep - a.rep);
  // 权威（第 1 档）的说法之间、权威和可靠（第 2 档）之间打架：先按打架算
  for (let i = 0; i < best.length; i++) for (let j = i + 1; j < best.length; j++) {
    const x = best[i], y = best[j];
    if (x.site !== y.site && x.tier <= 2 && y.tier <= 2 && agree(x.quote, y.quote) === "conflict") return { state: "conflict", cands: [x, y] };
  }
  const t1 = best.find((c) => c.tier === 1);
  if (t1) return { state: "ok", pick: t1, why: "权威来源" };
  for (let i = 0; i < best.length; i++) for (let j = i + 1; j < best.length; j++) {
    const x = best[i], y = best[j];
    if (x.site !== y.site && x.tier <= 3 && y.tier <= 3 && agree(x.quote, y.quote) === "same") return { state: "ok", pick: x, also: y, why: "两个网站说法一致" };
  }
  return { state: "single", pick: best[0] };
}

const BUDGET = { admission: { pages: 10, ms: 40000 }, policy: { pages: 10, ms: 40000 }, news: { pages: 8, ms: 35000 }, law: { pages: 8, ms: 35000 }, health: { pages: 8, ms: 35000 }, default: { pages: 6, ms: 30000 } };
const DEFAULT_SITE = { policy: "gov.cn", admission: "chsi.com.cn", law: "gov.cn", health: "gov.cn", news: "news.cn", code: "runoob.com" };

function create(o = {}) {
  const say = (m) => { try { o.onStep && o.onStep(m); } catch (e) {} };
  const now = () => (o.now ? new Date(o.now()) : new Date());
  const rep = o.reputation || SRC.reputation(null);
  const ground = o.ground || GROUND.create({ llm: o.llm, onStep: o.onStep });
  let used = { in: 0, out: 0, calls: 0 };
  const cloudOk = () => !!(o.cloud && (!o.cloud.ok || o.cloud.ok()));
  const cloudAsk = async (sys, user, maxTokens) => {
    const r = await o.cloud.chat([{ role: "system", content: sys }, { role: "user", content: user }], { think: false, temperature: 0, maxTokens });
    used.calls++; if (r && r.usage) { used.in += r.usage.prompt_tokens || 0; used.out += r.usage.completion_tokens || 0; }
    return String((r && r.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  };
  const localAsk = async (sys, user, maxTokens) => {
    if (o.llm.start) await o.llm.start();
    const r = await o.llm.chat([{ role: "system", content: sys }, { role: "user", content: user }], { mode: "check", model: o.localModel || undefined, temperature: 0, maxTokens });
    return String((r && r.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  };

  // 1. 出主意（考试时存成快照：o.planCache = { get(q), set(q, plan) }）
  async function plan(q) {
    const c = o.planCache && o.planCache.get(q);
    if (c) return c;
    let p = null;
    if (cloudOk()) {
      try { p = parsePlan(await cloudAsk(PLAN_SYS.replace("{NOW}", `${now().getFullYear()} 年 ${now().getMonth() + 1} 月`), q, 260), q); }
      catch (e) { say("云端出主意没成，按规则查：" + e.message); }
    }
    p = p || rulePlan(q);
    if (o.planCache) o.planCache.set(q, p);
    return p;
  }

  // 2+3. 按需查
  async function investigate(q, P) {
    const t0 = Date.now(), rec = SRC.recencyOf(q, now(), P.type), budget = BUDGET[P.type] || BUDGET.default;
    const qTerms = [...new Set(toks(q).filter((t) => t.length > 1))].filter((t) => !/^(什么|怎么|多少|哪些|哪个|是不|请问|一下|可以|知道|告诉)$/.test(t)).slice(0, 12);
    const seen = new Set(), pages = [], rejected = [], passages = [];
    const slots = P.slots.map((s) => ({ ...s, cands: [], judged: new Set(), state: "none" }));
    const lim = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("太慢")), ms))]);
    // 本机资料（知识库、思维导图……）当第 1 档：学校自己放进来的
    for (const m of o.localMats ? await o.localMats(q) : []) passages.push({ ...m, tier: 1, site: "本机资料", url: "", rep: 1 });
    const addPage = (r, p) => {
      const why = SRC.pageProblem(p, qTerms) || SRC.staleProblem({ ...p, url: p.url || r.url }, rec, now());
      if (why) { rejected.push({ url: r.url, title: p.title || r.title, why }); return; }
      const tier = SRC.tierOf(p.url || r.url, P.type);
      const sh = SRC.shingles(p.text);
      const dup = pages.find((x) => SRC.similar(x.sh, sh) > 0.8);
      if (dup) {
        // 转载：留更权威的（档位小）、一样就留先读到的
        if (tier < dup.tier) {
          // 先读到的是转载、现在读到了原发的权威网站：这份资料（已经切好的段、已经摘到的原话）都改记在权威网站名下
          const old = dup.url, nu = { url: p.url || r.url, title: p.title || r.title, tier, site: SRC.siteOf(p.url || r.url), rep: rep.score(p.url || r.url), date: SRC.dateOf({ ...p, url: p.url || r.url }) };
          rejected.push({ url: old, title: dup.title, why: "和 " + SRC.hostOf(nu.url) + " 是同一篇（转载）" });
          Object.assign(dup, nu, { sh });
          for (const ps of passages) if (ps.url === old) Object.assign(ps, { title: nu.title, src: nu.url, url: nu.url, tier, site: nu.site, rep: nu.rep, date: nu.date });
          for (const sl of slots) {
            let ch = false;
            for (const c of sl.cands) if (c.url === old) { Object.assign(c, { url: nu.url, site: nu.site, tier, rep: nu.rep, title: nu.title, date: nu.date }); ch = true; }
            if (ch) { const st = slotState(sl.cands); sl.state = st.state; sl.st = st; }
          }
        }
        else rejected.push({ url: r.url, title: p.title || r.title, why: "和 " + SRC.hostOf(dup.url) + " 是同一篇（转载）" });
        return;
      }
      const date = SRC.dateOf({ ...p, url: p.url || r.url });
      const pg = { url: p.url || r.url, title: p.title || r.title, tier, date, site: SRC.siteOf(p.url || r.url), sh, rep: rep.score(p.url || r.url) };
      pages.push(pg);
      for (const text of chunks(p.text)) passages.push({ title: pg.title, src: pg.url, url: pg.url, text, tier, date, site: pg.site, rep: pg.rep });
    };
    const fill = async () => {
      for (const s of slots) {
        if (s.state === "ok") continue;
        const order = rank(s.ask + " " + q, passages).filter((r) => r.score > 0 && !s.judged.has(r.i)).slice(0, 3);
        for (const r of order) {
          s.judged.add(r.i);
          const ps = passages[r.i];
          let quote = null;
          try { quote = verifyQuote(await localAsk(QUOTE_SYS, `资料：${ps.text}\n\n问题：${s.ask}`, 120), ps.text); } catch (e) { say("摘录没成：" + e.message); }
          if (!quote) continue;
          if (s.cands.some((c) => c.site === ps.site && norm(c.quote) === norm(quote))) continue;
          s.cands.push({ quote, url: ps.url, site: ps.site, tier: ps.tier, date: ps.date, title: ps.title, rep: ps.rep, i: r.i });
          const st = slotState(s.cands); s.state = st.state; s.st = st;
          if (st.state === "ok") break;
        }
      }
    };
    const done = () => slots.every((s) => s.state === "ok");
    // 一轮一轮来：搜索词 1 → 搜索词 2 → 权威网站里搜 → 搜索词 3
    const site = (P.sites && P.sites[0]) || DEFAULT_SITE[P.type] || "";
    const rounds = [{ q: P.queries[0] || q }, { q: P.queries[1] || q }, ...(site ? [{ q: P.queries[0] || q, site }] : []), ...(P.queries[2] ? [{ q: P.queries[2] }] : [])];
    if (passages.length) { say("先看本机资料"); await fill(); }
    let round = 0;
    for (const rd of rounds) {
      if (done() || pages.length >= budget.pages || Date.now() - t0 > budget.ms) break;
      round++;
      say(`联网查（第 ${round} 轮）：${rd.q}${rd.site ? "（只在 " + rd.site + " 里）" : ""}`);
      let rs = [];
      try { rs = await o.web.search(rd.q, rd.site ? { site: rd.site } : {}); } catch (e) { say("搜索没成：" + e.message); continue; }
      // 先读靠谱的：档位、网站信誉、搜索排名
      const cand = rs.map((r, k) => ({ ...r, k, tier: SRC.tierOf(r.url, P.type), rep: rep.score(r.url) })).filter((r) => r.tier > 0 && !seen.has(r.url))
        .sort((a, b) => a.tier - b.tier || b.rep - a.rep || a.k - b.k);
      for (const r of rs) if (SRC.tierOf(r.url, P.type) === 0 && !seen.has(r.url)) { seen.add(r.url); rejected.push({ url: r.url, title: r.title, why: "内容农场 / 抄袭站，不采用" }); }
      const take = cand.slice(0, Math.min(3, budget.pages - pages.length));
      take.forEach((r) => seen.add(r.url));
      const got = await Promise.allSettled(take.map((r) => lim(o.web.read(r.url), o.readMs || 9000).then((p) => ({ r, p }))));
      got.forEach((g, i) => { if (g.status === "fulfilled") addPage(g.value.r, g.value.p); else rejected.push({ url: take[i].url, title: take[i].title, why: "打不开：" + g.reason.message }); });
      await fill();
    }
    // 4. 说法打架：只把那几句原话发给云端判
    for (const s of slots) {
      if (s.state !== "conflict") continue;
      const [x, y] = s.st.cands;
      if (cloudOk()) {
        try {
          const raw = await cloudAsk(`你是核实员。两个网站对同一个问题说法不一样。只根据来源的权威程度、发布日期和说法本身判断哪个对，输出 JSON：{"pick":1 或 2 或 0,"why":"一句话"}（0 = 判断不了）。`,
            `问题：${s.ask}\n1.【${x.site}，${SRC.TIER_NAME[x.tier]}${x.date ? "，" + x.date : ""}】${x.quote}\n2.【${y.site}，${SRC.TIER_NAME[y.tier]}${y.date ? "，" + y.date : ""}】${y.quote}`, 80);
          const j = JSON.parse((/\{[\s\S]*\}/.exec(raw) || ["{}"])[0]);
          if (j.pick === 1 || j.pick === 2) {
            const w = j.pick === 1 ? x : y, l = j.pick === 1 ? y : x;
            s.state = "ok"; s.st = { state: "ok", pick: w, why: "两家打架，云端判定：" + String(j.why || "").slice(0, 40) };
            rep.mark(w.url, true); rep.mark(l.url, false);
          }
        } catch (e) { say("云端判断没成：" + e.message); }
      }
    }
    for (const s of slots) if (s.state === "ok") { rep.mark(s.st.pick.url, true); if (s.st.also) rep.mark(s.st.also.url, true); }
    return { slots, pages, rejected, passages, rounds: round, ms: Date.now() - t0, rec };
  }

  // 写回答用的资料：每个查实 / 只有一家的空位放它那一段，再按问题补最相关的，最多 5 段、2600 字
  function materials(q, inv) {
    const out = [], idx = new Set();
    // 说法打架的那几段不给模型（免得它挑一家当结论写）；两家说法由程序摆出来
    for (const s of inv.slots) if (s.state === "conflict" && s.st) for (const c of s.st.cands) idx.add(c.i);
    const push = (i) => { if (i == null || idx.has(i) || out.length >= 5) return; const p = inv.passages[i]; if (out.reduce((a, m) => a + m.text.length, 0) + p.text.length > 2600 && out.length) return; idx.add(i); out.push(p); };
    for (const s of inv.slots) if (s.st && s.st.pick && s.state !== "conflict") { push(s.st.pick.i); if (s.st.also) push(s.st.also.i); }
    for (const r of rank(q, inv.passages).filter((r) => r.score > 0)) { if (out.length >= 5) break; if (inv.passages[r.i].tier > 0) push(r.i); }
    return out.map((p) => ({ title: (p.title || "") + (p.site ? "｜" + p.site + "·" + SRC.TIER_NAME[p.tier] : ""), src: p.src || p.url || "", text: p.text, ...(p.date ? { date: p.date } : {}), tier: p.tier }));
  }

  // 5. 核对没过的句子：发给云端，只让它照资料改；改完的句子还要过程序检查
  async function review(q, mats, dropped, kept) {
    if (!cloudOk() || !dropped.length) return [];
    try {
      const raw = await cloudAsk(`你是审稿人。下面是资料（编了号）、问题、已经核对通过的回答，以及几句核对没通过的句子。只根据资料，把没通过的句子改对：每句改成资料里有依据的说法，句末用 [编号] 标出处；资料里确实没有依据的那句写「删」。输出 JSON 数组：[{"i":序号,"fix":"改好的句子或删"}]，不要别的。`,
        `资料：\n${GROUND.matText(mats)}\n\n问题：${q}\n\n已通过：${kept || "（无）"}\n\n没通过：\n${dropped.map((d, i) => `${i + 1}. ${d.s}（${d.why}）`).join("\n")}`, 60 + dropped.length * 90);
      const arr = JSON.parse((/\[[\s\S]*\]/.exec(raw) || ["[]"])[0]);
      return arr.map((x) => String((x && x.fix) || "").trim()).filter((f) => f && f !== "删" && /\[\d+\]/.test(f) && !GROUND.ruleCheck(f, mats));
    } catch (e) { say("云端审稿没成：" + e.message); return []; }
  }

  // 整条流水线 → { text, abstained, sources, slots, rejected, usage, plan, card, ms }
  async function answer(q, opt = {}) {
    q = String(q || "").trim();
    if (!q) throw new Error("要问什么");
    used = { in: 0, out: 0, calls: 0 };
    const t0 = Date.now();
    // 0. 知识卡片
    const hit = !opt.fresh && o.cards ? o.cards.find(q) : null;
    let P, inv, mats;
    if (hit) {
      say("用之前查实过的资料（知识卡片）");
      P = hit.plan || rulePlan(q); mats = hit.mats; inv = { slots: (hit.slots || []).map((s) => ({ ...s, state: s.state || "ok" })), pages: [], rejected: [], rounds: 0 };
    } else {
      say(cloudOk() ? "云端出主意：该搜什么、要核实哪几点" : "想想该搜什么");
      P = opt.plan || await plan(q);
      if (P.need !== "facts" && !opt.force) return { skip: true, plan: P, usage: used };
      inv = await investigate(q, P);
      mats = materials(q, inv);
    }
    const slotsOut = inv.slots.map((s) => ({ key: s.key, ask: s.ask, state: s.state, ...(s.st && s.st.pick ? { quote: s.st.pick.quote, url: s.st.pick.url, site: s.st.pick.site, tier: s.st.pick.tier, date: s.st.pick.date, why: s.st.why || "" } : {}), ...(s.state === "conflict" && s.st ? { both: s.st.cands.map((c) => ({ quote: c.quote, site: c.site, url: c.url, tier: c.tier, date: c.date })) } : {}) }));
    // 程序自己补的话：没查到的、说法不一致的、只有一家的
    const notes = [];
    for (const s of slotsOut) {
      const what = s.key === "答案" ? "这个说法" : `「${s.key}」`;
      if (s.state === "none") { if (s.key !== "答案") notes.push(`没查到可靠的资料说明「${s.key}」。`); }
      else if (s.state === "conflict" && s.both) notes.push(`关于「${s.key}」，${s.both.map((b) => `${b.site}（${SRC.TIER_NAME[b.tier]}${b.date ? "，" + b.date : ""}）说「${b.quote.slice(0, 60)}」`).join("；")}，说法不一致，请以官方发布为准。`);
      else if (s.state === "single" && s.tier >= 2) notes.push(`${what}只在 ${s.site} 查到，没找到第二个来源印证。`);
    }
    if (!mats.length && notes.some((x) => !/^没查到/.test(x))) return { text: notes.join(""), abstained: false, sources: [], slots: slotsOut, rejected: inv.rejected, usage: { ...used }, plan: P, ms: Date.now() - t0 };
    if (!mats.length) {
      const why = inv.rejected.length ? `看了 ${inv.rejected.length} 个网页，都不能用（${[...new Set(inv.rejected.map((r) => r.why.replace(/：.*/, "")))].slice(0, 3).join("、")}）` : "没搜到相关的网页";
      return { text: `${GROUND.ABSTAIN}能回答这个问题的可靠资料：${why}。建议去官方网站或问老师确认。`, abstained: true, sources: [], slots: slotsOut, rejected: inv.rejected, usage: used, plan: P, ms: Date.now() - t0 };
    }
    say("照查到的资料写回答，再逐句核对");
    const r = await ground.answer(q, { mats, hint: (P.outline || []).join("；") });
    let text = r.text, extra = [];
    if (r.dropped.length && cloudOk()) {
      say(`有 ${r.dropped.length} 句核对没过，请云端照资料改`);
      extra = await review(q, mats, r.dropped, r.abstained ? "" : text);
      if (extra.length) text = (r.abstained ? "" : text) + extra.join("");
    }
    const abst = r.abstained && !extra.length;
    if (abst && notes.length) text = notes.join("");
    else if (notes.length) text += "\n\n" + notes.join("");
    const cited = [...new Set([...GROUND.citesOf(text)])].sort((a, b) => a - b).filter((n) => n >= 1 && n <= mats.length);
    const sources = cited.map((n) => ({ n, title: mats[n - 1].title, src: mats[n - 1].src, tier: mats[n - 1].tier, date: mats[n - 1].date || "" }));
    const out = { text, abstained: abst && !notes.length, sources, slots: slotsOut, rejected: inv.rejected, usage: { ...used }, plan: P, fromCard: !!hit, rounds: inv.rounds, pages: inv.pages.length, ms: Date.now() - t0, mats };
    // 6. 查实了的存成卡片（全部空位都查实、回答没被删光）
    if (!hit && o.cards && !out.abstained && slotsOut.length && slotsOut.every((s) => s.state === "ok")) {
      try { o.cards.add({ q, type: P.type, plan: P, mats, slots: slotsOut, text }); } catch (e) {}
    }
    return out;
  }
  return { answer, plan, investigate, materials, review, usage: () => ({ ...used }) };
}

// ---------- 知识卡片：查实过的问题和当时核实过的资料，存在本机；问到相近的直接用 ----------
//   过期：新闻 2 天、招生考试 120 天、政策 180 天、其他 1 年；最多 2000 张（旧的先删）
const TTL = { news: 2, admission: 120, policy: 180 };
function cards(file, opt = {}) {
  const fs = require("fs"), path = require("path");
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, "utf8")) || []; } catch (e) {}
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(list)); fs.renameSync(file + ".tmp", file); };
  const now = () => (opt.now ? opt.now() : Date.now());
  const alive = (c) => now() - c.at < (TTL[c.type] || 365) * 864e5;
  // 问题要对得上：重要的词（两个字以上的）至少七成在卡片的问题里；数字、年份必须一样
  function find(q) {
    const live = list.filter(alive); if (!live.length) return null;
    const terms = [...new Set(toks(q).filter((t) => t.length > 1))];
    const nq = (String(q).match(/\d+/g) || []).join(",");
    let best = null, bs = 0;
    for (const c of live) {
      if ((String(c.q).match(/\d+/g) || []).join(",") !== nq) continue;
      const ct = new Set(toks(c.q).filter((t) => t.length > 1));
      const cover = terms.length ? terms.filter((t) => ct.has(t)).length / terms.length : 0;
      const back = ct.size ? [...ct].filter((t) => terms.includes(t)).length / ct.size : 0;
      const sc = Math.min(cover, back);
      if (sc > bs) { bs = sc; best = c; }
    }
    return bs >= (opt.min || 0.7) ? best : null;
  }
  function add(c) {
    const k = String(c.q).replace(/\s/g, "");
    list = list.filter((x) => String(x.q).replace(/\s/g, "") !== k);
    list.push({ ...c, at: now() });
    if (list.length > (opt.max || 2000)) list = list.filter(alive).slice(-(opt.max || 2000));
    save();
  }
  return { find, add, list: () => list.filter(alive), remove: (q) => { list = list.filter((x) => x.q !== q); save(); }, clear: () => { list = []; save(); } };
}

module.exports = { create, cards, rulePlan, parsePlan, verifyQuote, agree, slotState, PLAN_SYS, QUOTE_SYS, numsOf };
