// 捞小智的「大脑」：本机模型，或者接自己的云端模型（DeepSeek、通义千问、智谱、Kimi、硅基流动、任何 OpenAI 兼容的接口，用自己的 Key）
//   · 配置存在数据文件夹的 cloud.json（Key 只存在这台电脑上）；DeepSeek 的 Key 也可以用环境变量 LAOLAO_DEEPSEEK_KEY 给
//   · 和本机模型是同一个接口（start / chat），xiaozhi.js、agent.js、ground.js 不用改：wrap(本机, 云端) 包一层就行
//   · 现在用哪个：current = "local"（本机）或 "厂商/模型"（比如 deepseek/deepseek-flash）；界面上对话框下面的下拉就是改它
//   · 图片：云端模型现在都按「看不了图」处理 → 这一句带图的交给本机模型（Qwen3-VL）；之前发过的图在云端那边换成一句话
//   · 思考模式（各家参数不一样）：DeepSeek 默认讲题、办事开，照资料回答、逐句核对关；别家「自动」= 用它自己的默认；也能设成总是 / 不思考
//     DeepSeek 带工具的对话里，历史上每一轮的思考内容都要带回去（agent.js 会带）；历史里有不带思考内容的回答 → 这一句先不开思考，免得报 400
//     别家不认 reasoning_content：发出去之前去掉
//   · 用量：每一句记下 token 数；DeepSeek 按刊例价估个钱数（别家看它自己的账单）
//   · 多个助手一起干活（team.js）用「干活模型」：默认是现在这家最便宜的那个，省 token
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const CHAT = require("./chat");

// 价格：元 / 百万 tokens，[空闲, 高峰]；高峰 = 北京时间周一到周五 9:00–12:00、14:00–18:00（2026-11 DeepSeek 开放平台的刊例价，只用来估算）
const PROVIDERS = {
  deepseek: {
    name: "DeepSeek", base: "https://api.deepseek.com", site: "https://platform.deepseek.com", style: "deepseek", cheap: "deepseek-flash",
    models: [
      { id: "deepseek-flash", name: "DeepSeek Flash（快、便宜，推荐）", price: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] } },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro（更强，贵三倍多）", price: { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] } },
    ],
  },
  qwen: { name: "通义千问（阿里云百炼）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", site: "https://bailian.console.aliyun.com", style: "qwen", cheap: "qwen-flash",
    models: [{ id: "qwen-plus", name: "qwen-plus（均衡）" }, { id: "qwen-flash", name: "qwen-flash（快、便宜）" }, { id: "qwen-max", name: "qwen-max（最强）" }] },
  zhipu: { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", site: "https://open.bigmodel.cn", style: "zhipu", cheap: "glm-4.7-flash",
    models: [{ id: "glm-4.7-flash", name: "GLM-4.7-Flash（免费，一次只能问一句）" }] },
  kimi: { name: "Kimi（月之暗面）", base: "https://api.moonshot.cn/v1", site: "https://platform.moonshot.cn", style: "plain", models: [] },
  siliconflow: { name: "硅基流动", base: "https://api.siliconflow.cn/v1", site: "https://cloud.siliconflow.cn", style: "plain", models: [] },
  custom: { name: "自定义（OpenAI 兼容接口）", base: "", site: "", style: "plain", models: [], custom: true },
};
const THINK = ["auto", "on", "off"];
const MODEL_RE = /^[\w.:\-/@+]{1,100}$/;

// 北京时间是不是高峰（不管法定节假日：节假日按高峰估，宁可估多）
function peak(t = new Date()) {
  const bj = new Date(t.getTime() + 8 * 3600e3), d = bj.getUTCDay(), h = bj.getUTCHours();
  return d >= 1 && d <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
}
const dayOf = (t = new Date()) => new Date(t.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const hasImg = (m) => Array.isArray(m && m.content) && m.content.some((c) => c && c.type === "image_url");

function cost(model, u, isPeak) {
  const pr = model && model.price; if (!pr || !u) return 0;
  const k = isPeak ? 1 : 0;
  const hit = u.prompt_cache_hit_tokens || 0, miss = u.prompt_cache_miss_tokens != null ? u.prompt_cache_miss_tokens : Math.max(0, (u.prompt_tokens || 0) - hit);
  return (hit * pr.hit[k] + miss * pr.miss[k] + (u.completion_tokens || 0) * pr.out[k]) / 1e6;
}
// "deepseek/deepseek-flash" → ["deepseek", "deepseek-flash"]（模型名里也可能有 /，比如硅基流动的 deepseek-ai/DeepSeek-V3）
const split = (v) => { const s = String(v || ""), i = s.indexOf("/"); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };

function create(o = {}) {
  const fileOf = () => (typeof o.file === "function" ? o.file() : o.file);
  const usageFile = () => { const f = fileOf(); return f ? path.join(path.dirname(f), "cloud-usage.json") : null; };
  const env = o.env || process.env;
  const now = o.now || (() => new Date());
  const read = (f, d) => { try { return f ? JSON.parse(fs.readFileSync(f, "utf8")) : d; } catch (e) { return d; } };
  const write = (f, v) => { if (!f) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };

  // 读配置（旧版只有 DeepSeek：{ brain, key, model, think } → 换成新的样子）
  function raw() {
    const r = read(fileOf(), {}) || {};
    if (!r.providers) {
      const p = {}; if (r.key) p.deepseek = { key: r.key };
      const m = PROVIDERS.deepseek.models.some((x) => x.id === r.model) ? r.model : "deepseek-flash";
      return { current: r.brain === "cloud" ? "deepseek/" + m : "local", think: THINK.includes(r.think) ? r.think : "auto", worker: "", providers: p, lastDeepseek: m };
    }
    return { current: "local", think: "auto", worker: "", ...r, providers: { ...r.providers } };
  }
  const keyOf = (c, id) => { const k = ((c.providers[id] || {}).key || "").trim(); return k || (id === "deepseek" && env.LAOLAO_DEEPSEEK_KEY ? String(env.LAOLAO_DEEPSEEK_KEY).trim() : ""); };
  const baseOf = (c, id) => (PROVIDERS[id].custom ? ((c.providers[id] || {}).base || "") : PROVIDERS[id].base);
  const modelsOf = (c, id) => {
    const P = PROVIDERS[id], extra = ((c.providers[id] || {}).models || []).filter((m) => MODEL_RE.test(m) && !P.models.some((x) => x.id === m));
    return [...P.models.map((m) => ({ id: m.id, name: m.name })), ...extra.map((m) => ({ id: m, name: m }))];
  };
  const usable = (c, id) => !!(PROVIDERS[id] && keyOf(c, id) && baseOf(c, id));
  // 现在用哪个：{ pid, mid } 或者 null（本机）
  function target(c, v) {
    const [pid, mid] = split(v == null ? c.current : v);
    if (pid === "local" || !PROVIDERS[pid] || !mid || !usable(c, pid)) return null;
    return { pid, mid, P: PROVIDERS[pid], model: PROVIDERS[pid].models.find((m) => m.id === mid) || { id: mid, name: mid } };
  }
  const active = () => !!target(raw());
  const hybrid = () => { const c = raw(); return !!(c.hybrid && target(c)); };

  function setConfig(patch = {}) {
    const c = raw(), prov = { ...c.providers };
    const need = (cond, m) => { if (!cond) throw new Error(m); };
    const checkKey = (k) => { k = String(k).trim(); need(!k || /^[\x21-\x7e]{8,300}$/.test(k), "API Key 看着不对：应该是一串英文字母和数字（比如 sk- 开头），不要带空格和中文"); return k; };
    // 旧的写法（只管 DeepSeek）：{ brain, key, model }
    if (patch.key != null) prov.deepseek = { ...(prov.deepseek || {}), key: checkKey(patch.key) };
    if (patch.model != null) { need(PROVIDERS.deepseek.models.some((m) => m.id === patch.model), "没有这个模型：" + patch.model); c.lastDeepseek = patch.model; if (split(c.current)[0] === "deepseek") c.current = "deepseek/" + patch.model; }
    if (patch.brain != null) {
      need(["local", "cloud"].includes(patch.brain), "大脑只能选本机或云端"); c.hybrid = false;
      c.current = patch.brain === "local" ? "local" : "deepseek/" + (patch.model || (split(c.current)[0] === "deepseek" ? split(c.current)[1] : c.lastDeepseek) || "deepseek-flash");
    }
    // 新的写法：填某一家的 Key / 地址 / 自己加的模型名
    if (patch.provider) {
      const id = patch.provider.id || patch.provider; need(PROVIDERS[id], "还不支持这家：" + id);
      const q = typeof patch.provider === "object" ? patch.provider : {}, cur = { ...(prov[id] || {}) };
      if (q.key != null) cur.key = checkKey(q.key);
      if (q.base != null) { const b = String(q.base).trim().replace(/\/+$/, ""); need(!b || /^https?:\/\/[^\s]+$/.test(b), "接口地址要以 http:// 或 https:// 开头"); cur.base = b; }
      if (q.name != null) cur.name = String(q.name).slice(0, 30);
      if (q.models != null) { const ms = (Array.isArray(q.models) ? q.models : String(q.models).split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean); need(ms.every((m) => MODEL_RE.test(m)), "模型名看着不对：只能是英文字母、数字和 . - / _ :"); cur.models = [...new Set(ms)].slice(0, 30); }
      if (q.remove) { delete prov[id]; if (split(c.current)[0] === id) c.current = "local"; } else prov[id] = cur;
    }
    if (patch.current != null) {
      const v = String(patch.current);
      if (v === "local") { c.current = "local"; c.hybrid = false; }
      // 混合：本机优先，难题自动交给云端（云端用的是之前选的那个模型；还没选过就用第一家能用的）
      else if (v === "auto") {
        let tv = target({ ...c, providers: prov }) ? c.current : null;
        if (!tv) { const pid = Object.keys(PROVIDERS).find((id) => usable({ providers: prov }, id)); if (pid) tv = `${pid}/${pid === "deepseek" ? c.lastDeepseek || "deepseek-flash" : (modelsOf({ providers: prov }, pid)[0] || {}).id}`; }
        need(tv && target({ ...c, providers: prov }, tv), "混合模式要先接一家云端模型：在「插件 → 模型」里填好 Key");
        c.current = tv; c.hybrid = true;
      }
      else {
        c.hybrid = false;
        const [pid, mid] = split(v); need(PROVIDERS[pid], "还不支持这家：" + pid); need(mid && MODEL_RE.test(mid), "模型名看着不对");
        need(usable({ providers: prov }, pid) || (pid === "deepseek" && env.LAOLAO_DEEPSEEK_KEY), PROVIDERS[pid].custom && !(prov[pid] || {}).base ? "要先填接口地址和 Key" : `要先填 ${PROVIDERS[pid].name} 的 API Key（在 ${PROVIDERS[pid].site || "它的开放平台"} 申请）`);
        c.current = v;
      }
    }
    if (patch.think != null) { need(THINK.includes(patch.think), "思考只能选 自动 / 总是 / 不思考"); c.think = patch.think; }
    if (patch.worker != null) { const w = String(patch.worker); need(!w || w === "local" || (PROVIDERS[split(w)[0]] && split(w)[1]), "干活模型看着不对"); c.worker = w; }
    // 选了云端却没 Key
    if (split(c.current)[0] !== "local") { const pid = split(c.current)[0]; need(usable({ providers: prov }, pid), `要先填 ${PROVIDERS[pid].name} 的 API Key（在 ${PROVIDERS[pid].site || "它的开放平台"} 申请）`); }
    write(fileOf(), { current: c.current, hybrid: !!c.hybrid, think: c.think, worker: c.worker || "", lastDeepseek: c.lastDeepseek, providers: prov });
    return info();
  }

  // ---------- 用量 ----------
  function record(model, u) {
    if (!u) return;
    const f = usageFile(), all = read(f, { days: {} }) || { days: {} }, d = dayOf(now()), x = all.days[d] || { calls: 0, hit: 0, miss: 0, out: 0, think: 0, cost: 0 };
    const hit = u.prompt_cache_hit_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    x.calls++; x.hit += hit; x.miss += u.prompt_cache_miss_tokens != null ? u.prompt_cache_miss_tokens : Math.max(0, (u.prompt_tokens || 0) - hit);
    x.out += u.completion_tokens || 0; x.think += (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
    x.cost = +(x.cost + cost(model, u, peak(now()))).toFixed(6);
    all.days[d] = x;
    for (const k of Object.keys(all.days).sort().slice(0, -62)) delete all.days[k];   // 留两个月
    try { write(f, all); } catch (e) {}
  }
  function usage() {
    const days = (read(usageFile(), { days: {} }) || { days: {} }).days, today = dayOf(now()), month = today.slice(0, 7);
    const sum = (ks) => ks.reduce((a, k) => { const x = days[k]; a.calls += x.calls; a.tokens += x.hit + x.miss + x.out; a.cached += x.hit; a.cost += x.cost; return a; }, { calls: 0, tokens: 0, cached: 0, cost: 0 });
    const r = (s) => ({ ...s, cost: +s.cost.toFixed(2) });
    return { today: r(sum(days[today] ? [today] : [])), month: r(sum(Object.keys(days).filter((k) => k.startsWith(month)))) };
  }

  const nameOf = (c, v) => { if (!v || v === "local") return "本机模型"; const t = target(c, v); return t ? `${t.P.custom && (c.providers.custom || {}).name ? c.providers.custom.name : t.P.name} · ${t.model.name}` : String(v); };
  // 多个助手一起干活时用哪个：设了就用设的；没设 = 现在这家最便宜的那个（DeepSeek Flash、qwen-flash、GLM-4.7-Flash）；本机就是本机
  function workerModel() {
    const c = raw();
    if (c.worker && (c.worker === "local" || target(c, c.worker))) return c.worker;
    const t = target(c); if (!t) return "local";
    return t.P.cheap && modelsOf(c, t.pid).some((m) => m.id === t.P.cheap) ? `${t.pid}/${t.P.cheap}` : c.current;
  }
  function info() {
    const c = raw(), t = target(c), pid = t ? t.pid : "deepseek", P = PROVIDERS[pid], key = keyOf(c, pid);
    const providers = Object.entries(PROVIDERS).map(([id, Q]) => { const k = keyOf(c, id); return { id, name: Q.custom && (c.providers[id] || {}).name ? c.providers[id].name : Q.name, site: Q.site, custom: !!Q.custom, base: Q.custom ? baseOf(c, id) : "", keySet: !!k, keyTail: k ? k.slice(-4) : "", keyFromEnv: id === "deepseek" && !((c.providers.deepseek || {}).key) && !!k, models: modelsOf(c, id) }; });
    const choices = [{ value: "local", name: "本机模型（免费、不联网，慢一些）" }];
    if (t || providers.some((p) => usable(c, p.id))) choices.push({ value: "auto", name: "混合：本机优先，难题用云端" });
    for (const p of providers) if (usable(c, p.id)) for (const m of p.models) choices.push({ value: `${p.id}/${m.id}`, name: `${p.name} · ${m.name}` });
    if (c.current !== "local" && !choices.some((x) => x.value === c.current) && t) choices.push({ value: c.current, name: nameOf(c, c.current) });
    const wm = workerModel();
    const hy = !!(t && c.hybrid);
    return { on: !!t, hybrid: hy, current: hy ? "auto" : t ? c.current : "local", cloudModel: t ? c.current : "", currentName: hy ? `混合（难题用 ${nameOf(c, c.current)}）` : nameOf(c, t ? c.current : "local"), brain: t ? "cloud" : "local",
      provider: pid, providerName: P.name, site: P.site, keySet: !!key, keyTail: key ? key.slice(-4) : "", keyFromEnv: pid === "deepseek" && !((c.providers.deepseek || {}).key) && !!key,
      model: t ? t.mid : c.lastDeepseek || "deepseek-flash", models: modelsOf(c, "deepseek"), think: c.think, vision: false, peak: peak(now()), usage: usage(),
      providers, choices, worker: c.worker || "", workerNow: wm, workerName: nameOf(c, wm) };
  }

  // 这一句开不开思考：true / false / null（不传，用那家的默认）
  function thinkFor(c, style, opt, msgs) {
    let on = opt.think != null ? !!opt.think : c.think === "on" ? true : c.think === "off" ? false : style === "deepseek" ? !["ground", "check"].includes(opt.mode) : null;
    // DeepSeek：历史里有不带思考内容的回答（中途从本机换过来、或者上一句没开思考）：带工具时会报 400 → 这一句先不开
    if (style === "deepseek" && on && opt.tools && opt.tools.length && msgs.some((m) => m.role === "assistant" && !("reasoning_content" in m))) on = false;
    if (style === "plain") on = null;   // 不知道它认哪个参数：不传
    return on;
  }

  // 和本机模型一样的接口：返回带 abort() 的 Promise → { content, tool_calls, reasoning_content?, usage? }
  //   opt.model：这一句临时换一个模型（"厂商/模型"，多个助手一起干活时用）
  function chat(messages, opt = {}) {
    const c = raw(), t = target(c, opt.model);
    if (!t) { const p = Promise.reject(new Error(opt.model ? "这个模型用不了：先在插件页「模型」里填好它的 Key" : "还没选云端模型，或者还没填 API Key")); p.abort = () => {}; return p; }
    const style = t.P.style;
    // 云端看不了图：之前发过的图换成一句话（这一句本身带图的，wrap 会交给本机）；别家不认 reasoning_content：去掉
    const msgs = messages.map((m) => {
      let x = hasImg(m) ? { ...m, content: m.content.filter((y) => y.type !== "image_url").concat([{ type: "text", text: "（之前发过一张图片）" }]) } : m;
      if (style !== "deepseek" && "reasoning_content" in x) { x = { ...x }; delete x.reasoning_content; }
      return x;
    });
    const think = thinkFor(c, style, opt, msgs);
    const extra = { ...(opt.extra || {}) };
    if (style === "deepseek") { extra.thinking = { type: think ? "enabled" : "disabled" }; if (think) extra.reasoning_effort = c.effort || "high"; }
    else if (style === "zhipu" && think != null) extra.thinking = { type: think ? "enabled" : "disabled" };
    else if (style === "qwen" && think != null) extra.enable_thinking = !!think;
    let told = false;
    const onThink = (x) => { if (!told) { told = true; o.onThinking && o.onThinking(); } opt.onThink && opt.onThink(x); };
    const cap = style === "deepseek" ? 32768 : 8192;
    const { model: _m, think: _t, ...rest } = opt;
    // 连接中途断了、而且一个字都还没收到：悄悄再试一次（收到过字了就不重试，免得说两遍）
    let got = false, inner = null, stopped = false;
    const onDelta = opt.onDelta ? (x) => { got = true; opt.onDelta(x); } : null;
    const onThink2 = (x) => { got = true; onThink(x); };
    const go = () => (inner = CHAT.chatAt(o.base || baseOf(c, t.pid), msgs, {
      ...rest, ...(onDelta ? { onDelta } : {}), model: t.mid, apiKey: keyOf(c, t.pid), onThink: onThink2, timeoutMs: o.timeoutMs || 180000,
      temperature: think ? null : opt.temperature,                      // 思考模式不认 temperature
      maxTokens: think ? Math.max(opt.maxTokens || 0, cap) : Math.max(opt.maxTokens || 0, 4096),   // 思考也算在输出里，给够，免得答到一半被截断
      extra,
    }));
    const first = go();
    const p = first.catch((e) => { if (!e.cut || got || stopped) throw e; return go(); }).then((r) => { record(t.model, r.usage); if (style === "deepseek" && think && r.reasoning_content == null) r.reasoning_content = ""; if (style !== "deepseek") delete r.reasoning_content; r.model = `${t.pid}/${t.mid}`; return r; });
    p.abort = () => { stopped = true; if (inner && inner.abort) inner.abort(); };
    return p;
  }

  // 试一下：Key 对不对、连不连得上、多快（v：哪个模型，不写就是现在用的）
  async function test(v) {
    const c = raw(), t = target(c, v) || (!v ? target(c, "deepseek/" + (c.lastDeepseek || "deepseek-flash")) : null);   // 还在用本机：试一下 DeepSeek 的 Key
    if (!t) throw new Error(v ? "这个模型用不了：先填好它的 Key" : `还没填 ${PROVIDERS.deepseek.name} 的 API Key`);
    const t0 = Date.now();
    const r = await chat([{ role: "user", content: "只回复两个字：好的" }], { model: `${t.pid}/${t.mid}`, think: false, maxTokens: 16, temperature: 0 });
    return { ok: true, ms: Date.now() - t0, model: t.mid, reply: (r.content || "").slice(0, 20) };
  }
  // 这家有哪些模型：问它的 /models（大多数 OpenAI 兼容的接口都有）；问不到就用我们写好的那几个
  function listModels(id) {
    const c = raw(); if (!PROVIDERS[id]) return Promise.reject(new Error("还不支持这家：" + id));
    const key = keyOf(c, id), base = o.base || baseOf(c, id), fallback = modelsOf(c, id).map((m) => m.id);
    if (!key || !base) return Promise.resolve({ models: fallback, from: "preset" });
    const url = new URL(base.replace(/\/+$/, "") + (/\/v\d+$/.test(base.replace(/\/+$/, "")) ? "/models" : "/v1/models")), lib = url.protocol === "https:" ? https : http;
    return new Promise((resolve) => {
      const req = lib.get(url, { headers: { Authorization: "Bearer " + key }, timeout: 15000 }, (res) => {
        let s = ""; res.setEncoding("utf8"); res.on("data", (x) => (s += x));
        res.on("end", () => { try { const ids = (JSON.parse(s).data || []).map((m) => m.id).filter((m) => typeof m === "string" && MODEL_RE.test(m)); resolve(ids.length ? { models: ids.sort(), from: "api" } : { models: fallback, from: "preset" }); } catch (e) { resolve({ models: fallback, from: "preset" }); } });
      });
      req.on("timeout", () => req.destroy()); req.on("error", () => resolve({ models: fallback, from: "preset" }));
    });
  }

  return { info, setConfig, active, hybrid, chat, test, usage, listModels, workerModel, start: async () => ({ status: "ready", msg: nameOf(raw(), raw().current) }) };
}

// 包一层：云端开着就走云端；看图（start({ eyes: true })、这一句带图）走本机；其它方法照旧用本机的
//   opt.model = "local"：这一句指定用本机（多个助手一起干活、干活模型选了本机时）
// ---------- 混合模式：这一句交给本机还是云端 ----------
//   本机优先（免费、不联网、快）；难的才交给云端：证明推导、写代码查报错、论文报告、长文翻译润色、带了长文件、做 PPT、
//   说的话很长、一次要几个助手一起做。电脑好（显卡 8G 以上，本机跑的是 8B）就多留一些给本机；本机模型还没准备好就都走云端。
//   查课表、请假、闲聊这些办事和日常一律本机。
const HARD = /证明|推导|求证|论文|综述|文献|代码|编程|程序|函数|报错|调试|bug|debug|算法|复杂度|数据结构|高数|高等数学|微积分|积分|导数|极限|微分方程|矩阵|线性代数|行列式|概率论|统计学|物理|化学|有机|电路|经济学|金融|法律|翻译|润色|改写|写一篇|作文|报告|方案|计划书|策划|总结一下|详细分析|深入|对比.*(区别|优缺点)|优缺点|原理|为什么会|推荐.*(方案|路线)|面试|简历/i;
const EASY = /课表|有什么课|请假|销假|借教室|空教室|成绩|绩点|学分|考试安排|校历|几点|在哪|食堂|宿舍|你好|您好|谢谢|再见|哈哈|在吗|你是谁|你叫什么|天气/;
const ATT = "【附件：";
function route(messages, opt = {}, env = {}) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const t = !lastUser ? "" : typeof lastUser.content === "string" ? lastUser.content : (lastUser.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (env.localOk && !env.localOk()) return { where: "cloud", why: "本机模型还没准备好" };
  const ask = t.split("\n\n" + ATT)[0].replace(/\n\n（附：我现在电脑屏幕的截图[\s\S]*$/, "");
  const big = env.tier && env.tier() === "big";
  let score = 0; const why = [];
  if (t.includes(ATT) && t.length > 3000) { score += 3; why.push("带了长文件"); }
  if (ask.length > 300) { score += 2; why.push("问题很长"); }
  if (HARD.test(ask)) { score += 3; why.push("问题比较难"); }
  // 手上开着 PPT 时每句都带着改 PPT 的工具（mode = ppt），但只有真在说 PPT 的事才算「做 PPT」
  if (opt.mode === "ppt" && /PPT|ppt|幻灯片|课件|第\s*\d+\s*页|这一页|配色|版式|讲稿/.test(ask)) { score += 3; why.push("做 PPT"); }
  if ((opt.tools || []).some((x) => (x.function || x).name === "team_work") && /team|对比|整理|汇总/.test(ask)) { score += 1; }
  if (EASY.test(ask) && ask.length < 80) score -= 3;
  const need = big ? 5 : 3;
  return score >= need ? { where: "cloud", why: why.join("、") || "问题比较难" } : { where: "local", why: big ? "日常问题，本机（8B）就能答好" : "日常问题，本机就能答" };
}

function wrap(local, cloud, env = {}) {
  const w = Object.create(local);
  w.start = async (opt) => (cloud.active() && !(opt && opt.eyes) ? cloud.start() : local.start(opt));
  const viaLocal = (messages, opt, eyes) => {
    let inner = null, stopped = false;
    const { model: _m, ...rest } = opt;
    const p = (async () => {
      await local.start(eyes ? { eyes: true } : undefined);
      if (stopped) return { content: "", tool_calls: [] };
      inner = local.chat(messages, rest);
      return inner;
    })();
    p.abort = () => { stopped = true; if (inner && inner.abort) inner.abort(); };
    return p;
  };
  let lastTold = "";
  const tell = (r, lastUser) => { const k = r.where + "|" + (lastUser ? JSON.stringify(lastUser.content).slice(0, 200) : ""); if (k === lastTold) return; lastTold = k; if (env.onRoute) try { env.onRoute(r); } catch (e) {} };
  w.chat = (messages, opt = {}) => {
    if (opt.model === "local") return viaLocal(messages, opt, false);
    if (!cloud.active() && !opt.model) return local.chat(messages, opt);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!hasImg(lastUser) && !opt.model && cloud.hybrid && cloud.hybrid()) {
      const r = route(messages, opt, env); tell(r, lastUser);
      return r.where === "local" ? viaLocal(messages, opt, false) : cloud.chat(messages, opt);
    }
    if (hasImg(lastUser) && cloud.hybrid && cloud.hybrid()) tell({ where: "local", why: "带了图片，本机看图" }, lastUser);
    if (!hasImg(lastUser)) return cloud.chat(messages, opt);
    // 这一句带图：本机模型（带视觉组件）来看；它的回答没有思考内容，下一句云端会先不开思考（见 thinkFor）
    return viaLocal(messages, opt, true);
  };
  w.cloud = cloud;
  w.isCloud = () => cloud.active();
  return w;
}

module.exports = { create, wrap, route, PROVIDERS, peak, cost, dayOf };
