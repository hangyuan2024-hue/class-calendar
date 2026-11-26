// 捞小智的「云端大脑」：讲题、做 PPT、办事的对话交给云端大模型（现在接的是 DeepSeek），本机模型只在看图时用
//   · 配置存在数据文件夹的 cloud.json（API Key 只存在这台电脑上）；也可以用环境变量 LAOLAO_DEEPSEEK_KEY 给 Key
//   · 和本机模型是同一个接口（start / chat），xiaozhi.js、agent.js、ground.js 不用改：wrap(本机, 云端) 包一层就行
//   · 图片：DeepSeek 现在看不了图 → 这一句带图的交给本机模型（Qwen3-VL）；之前发过的图在云端那边换成一句「之前发过一张图片」
//   · 思考模式：讲题、做 PPT、办事默认开（答得更准）；照资料回答、逐句核对（ground / check）默认关（格式固定、要快）
//     带工具的对话里，历史上每一轮的思考内容都要带回去（agent.js 会带）；历史里有不带思考内容的回答（比如中途从本机换过来）→ 这一句先不开思考，免得报 400
//   · 用量：每一句记下 token 数，按刊例价估个钱数（价格会变，以开放平台账单为准）
"use strict";
const fs = require("fs");
const path = require("path");
const CHAT = require("./chat");

// 价格：元 / 百万 tokens，[空闲, 高峰]；高峰 = 北京时间周一到周五 9:00–12:00、14:00–18:00（2026-11 DeepSeek 开放平台的刊例价，只用来估算）
const PROVIDERS = {
  deepseek: {
    name: "DeepSeek", base: "https://api.deepseek.com", site: "https://platform.deepseek.com", vision: false,
    models: [
      { id: "deepseek-flash", name: "DeepSeek Flash（快、便宜，推荐）", price: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] } },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro（更强，贵三倍多）", price: { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] } },
    ],
  },
};
const DEFAULTS = { brain: "local", provider: "deepseek", key: "", model: "deepseek-flash", think: "auto", effort: "high" };
const THINK = ["auto", "on", "off"];

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

function create(o = {}) {
  const fileOf = () => (typeof o.file === "function" ? o.file() : o.file);
  const usageFile = () => { const f = fileOf(); return f ? path.join(path.dirname(f), "cloud-usage.json") : null; };
  const env = o.env || process.env;
  const now = o.now || (() => new Date());
  const read = (f, d) => { try { return f ? JSON.parse(fs.readFileSync(f, "utf8")) : d; } catch (e) { return d; } };
  const write = (f, v) => { if (!f) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };

  function cfg() {
    const c = { ...DEFAULTS, ...read(fileOf(), {}) };
    if (!c.key && env.LAOLAO_DEEPSEEK_KEY) { c.key = String(env.LAOLAO_DEEPSEEK_KEY).trim(); c.keyFromEnv = true; }
    if (!PROVIDERS[c.provider]) c.provider = DEFAULTS.provider;
    const P = PROVIDERS[c.provider];
    if (!P.models.some((m) => m.id === c.model)) c.model = P.models[0].id;
    if (!THINK.includes(c.think)) c.think = "auto";
    return c;
  }
  const active = () => { const c = cfg(); return c.brain === "cloud" && !!c.key; };

  function setConfig(patch = {}) {
    const cur = { ...DEFAULTS, ...read(fileOf(), {}) }, next = { ...cur };
    if (patch.brain != null) { if (!["local", "cloud"].includes(patch.brain)) throw new Error("大脑只能选本机或云端"); next.brain = patch.brain; }
    if (patch.provider != null) { if (!PROVIDERS[patch.provider]) throw new Error("还不支持这家：" + patch.provider); next.provider = patch.provider; }
    if (patch.model != null) { if (!PROVIDERS[next.provider].models.some((m) => m.id === patch.model)) throw new Error("没有这个模型：" + patch.model); next.model = patch.model; }
    if (patch.think != null) { if (!THINK.includes(patch.think)) throw new Error("思考只能选 自动 / 总是 / 不思考"); next.think = patch.think; }
    if (patch.key != null) {
      const k = String(patch.key).trim();
      if (k && !/^[\x21-\x7e]{8,200}$/.test(k)) throw new Error("API Key 看着不对：应该是一串英文字母和数字（比如 sk- 开头），不要带空格和中文");
      next.key = k;
    }
    if (next.brain === "cloud" && !next.key && !env.LAOLAO_DEEPSEEK_KEY) throw new Error(`要先填 ${PROVIDERS[next.provider].name} 的 API Key（在 ${PROVIDERS[next.provider].site} 申请）`);
    write(fileOf(), next);
    return info();
  }

  // ---------- 用量 ----------
  function record(model, u) {
    if (!u) return;
    const f = usageFile(), all = read(f, { days: {} }), d = dayOf(now()), x = all.days[d] || { calls: 0, hit: 0, miss: 0, out: 0, think: 0, cost: 0 };
    const hit = u.prompt_cache_hit_tokens || 0;
    x.calls++; x.hit += hit; x.miss += u.prompt_cache_miss_tokens != null ? u.prompt_cache_miss_tokens : Math.max(0, (u.prompt_tokens || 0) - hit);
    x.out += u.completion_tokens || 0; x.think += (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
    x.cost = +(x.cost + cost(model, u, peak(now()))).toFixed(6);
    all.days[d] = x;
    for (const k of Object.keys(all.days).sort().slice(0, -62)) delete all.days[k];   // 留两个月
    try { write(f, all); } catch (e) {}
  }
  function usage() {
    const days = read(usageFile(), { days: {} }).days, today = dayOf(now()), month = today.slice(0, 7);
    const sum = (ks) => ks.reduce((a, k) => { const x = days[k]; a.calls += x.calls; a.tokens += x.hit + x.miss + x.out; a.cost += x.cost; return a; }, { calls: 0, tokens: 0, cost: 0 });
    const r = (s) => ({ ...s, cost: +s.cost.toFixed(2) });
    return { today: r(sum(days[today] ? [today] : [])), month: r(sum(Object.keys(days).filter((k) => k.startsWith(month)))) };
  }

  function info() {
    const c = cfg(), P = PROVIDERS[c.provider];
    return { brain: c.brain, on: active(), provider: c.provider, providerName: P.name, site: P.site, keySet: !!c.key, keyTail: c.key ? c.key.slice(-4) : "", keyFromEnv: !!c.keyFromEnv,
      model: c.model, models: P.models.map((m) => ({ id: m.id, name: m.name })), think: c.think, vision: P.vision, peak: peak(now()), usage: usage() };
  }

  // 这一句开不开思考
  function thinkFor(c, opt, msgs) {
    let on = opt.think != null ? !!opt.think : c.think === "on" ? true : c.think === "off" ? false : !["ground", "check"].includes(opt.mode);
    // 历史里有不带思考内容的回答（中途从本机换过来、或者上一句没开思考）：带工具时会报 400 → 这一句先不开
    if (on && opt.tools && opt.tools.length && msgs.some((m) => m.role === "assistant" && !("reasoning_content" in m))) on = false;
    return on;
  }

  // 和本机模型一样的接口：返回带 abort() 的 Promise → { content, tool_calls, reasoning_content?, usage? }
  function chat(messages, opt = {}) {
    const c = cfg(), P = PROVIDERS[c.provider], model = P.models.find((m) => m.id === (opt.model || c.model)) || P.models[0];
    if (!c.key) { const p = Promise.reject(new Error(`还没填 ${P.name} 的 API Key`)); p.abort = () => {}; return p; }
    // 云端看不了图：之前发过的图换成一句话（这一句本身带图的，wrap 会交给本机）
    const msgs = messages.map((m) => (hasImg(m) ? { ...m, content: m.content.filter((x) => x.type !== "image_url").concat([{ type: "text", text: "（之前发过一张图片）" }]) } : m));
    const think = thinkFor(c, opt, msgs);
    let told = false;
    const onThink = (t) => { if (!told) { told = true; o.onThinking && o.onThinking(); } opt.onThink && opt.onThink(t); };
    const inner = CHAT.chatAt(o.base || P.base, msgs, {
      ...opt, model: model.id, apiKey: c.key, onThink, timeoutMs: o.timeoutMs || 180000,
      temperature: think ? null : opt.temperature,                      // 思考模式不认 temperature
      maxTokens: think ? Math.max(opt.maxTokens || 0, 32768) : Math.max(opt.maxTokens || 0, 4096),   // 思考也算在输出里，给够，免得答到一半被截断
      extra: { ...(opt.extra || {}), thinking: { type: think ? "enabled" : "disabled" }, ...(think ? { reasoning_effort: c.effort || "high" } : {}) },
    });
    const p = inner.then((r) => { record(model, r.usage); if (think && r.reasoning_content == null) r.reasoning_content = ""; return r; });
    p.abort = inner.abort;
    return p;
  }

  // 试一下：Key 对不对、连不连得上、多快
  async function test() {
    const c = cfg(), t0 = Date.now();
    if (!c.key) throw new Error(`还没填 ${PROVIDERS[c.provider].name} 的 API Key`);
    const r = await chat([{ role: "user", content: "只回复两个字：好的" }], { think: false, maxTokens: 16, temperature: 0 });
    return { ok: true, ms: Date.now() - t0, model: c.model, reply: (r.content || "").slice(0, 20) };
  }

  return { info, setConfig, active, chat, test, usage, start: async () => ({ status: "ready", msg: PROVIDERS[cfg().provider].name }) };
}

// 包一层：云端开着就走云端；看图（start({ eyes: true })、这一句带图）走本机；其它方法照旧用本机的
function wrap(local, cloud) {
  const w = Object.create(local);
  w.start = async (opt) => (cloud.active() && !(opt && opt.eyes) ? cloud.start() : local.start(opt));
  w.chat = (messages, opt = {}) => {
    if (!cloud.active()) return local.chat(messages, opt);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!hasImg(lastUser)) return cloud.chat(messages, opt);
    // 这一句带图：本机模型（带视觉组件）来看；它的回答没有思考内容，下一句云端会先不开思考（见 thinkFor）
    let inner = null, stopped = false;
    const p = (async () => {
      await local.start({ eyes: true });
      if (stopped) return { content: "", tool_calls: [] };
      inner = local.chat(messages, opt);
      return inner;
    })();
    p.abort = () => { stopped = true; if (inner && inner.abort) inner.abort(); };
    return p;
  };
  w.cloud = cloud;
  w.isCloud = () => cloud.active();
  return w;
}

module.exports = { create, wrap, PROVIDERS, peak, cost, dayOf };
