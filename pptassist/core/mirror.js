// 国内存储里的 AI 组件清单（官网的 download/ai-mirror.json，由 .github/workflows/ai-mirror.yml 写）：
// 整合包、模型、插件在国内的下载地址、大小、sha256。读不到清单就照旧走 hf-mirror.com / GitHub 加速镜像。
"use strict";
const SOURCES = [
  "https://www.laolaokechengbiao.cn/download/ai-mirror.json",
  "https://cdn.jsdelivr.net/gh/hangyuan2024-hue/class-calendar@main/download/ai-mirror.json",
  "https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main/download/ai-mirror.json",
];

// 没告诉在哪：看电脑的时区（中国时区算国内）
const tzRegion = () => { try { return new Date().getTimezoneOffset() === -480 || /^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Hong_Kong|Macau|Taipei)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone) ? "cn" : "global"; } catch (e) { return "cn"; } };
// 一个文件的下载地址：国内存储（url）和自己 GitHub 的 Release（gh：一个地址，或者切成几块）按地区排
function sourcesOf(x, region) {
  const gh = Array.isArray(x.gh) && x.gh.length ? (x.gh.length === 1 ? x.gh[0] : { parts: x.gh }) : null;
  return (region === "global" ? [gh, x.url] : [x.url, gh]).filter(Boolean);
}

function create(opt = {}) {
  const region = () => (typeof opt.region === "function" ? opt.region() : opt.region) || tzRegion();
  const doFetch = opt.fetch || fetch;
  const sources = opt.sources || SOURCES;
  let cache = null, at = 0, failAt = 0;
  async function load(force) {
    if (cache && !force && Date.now() - at < 10 * 60 * 1000) return cache;
    if (!force && Date.now() - failAt < 60 * 1000) return cache || { files: {} };   // 刚刚都没读到：一分钟内不再试
    for (const u of sources) {
      try {
        const r = await doFetch(u + "?t=" + Date.now(), { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const m = await r.json();
        if (m && m.files && typeof m.files === "object") { cache = m; at = Date.now(); return m; }
      } catch (e) {}
    }
    failAt = Date.now();
    return cache || { files: {} };
  }
  const list = async () => Object.entries((await load()).files).map(([key, v]) => ({ key, ...v })).filter((x) => /^(https:\/\/|http:\/\/127\.0\.0\.1:)/.test(x.url || ""));   // 只认 https（测试时的本机地址除外）
  // 某个模型在国内存储里有哪些文件（同一个模型可能有好几种量化）
  async function model(key) { return (await list()).filter((x) => x.model === key); }
  async function node(dir, commit) { return (await list()).find((x) => x.node === dir && x.commit === commit) || null; }
  // 整合包：kind = comfyui / gsv / gsv50 / hy3d；分卷的（.7z.001、.002…）按顺序给出；有好几种（比如 cu126、cu128）挑 CUDA 版本最高的
  async function pkg(kind) {
    const all = (await list()).filter((x) => x.pkg === kind);
    if (!all.length) return null;
    const ver = all.map((x) => x.ver || "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    const same = all.filter((x) => (x.ver || "") === ver);
    const baseOf = (n) => n.replace(/\.\d{3}$/, "");
    const groups = {};
    for (const x of same) (groups[baseOf(x.name)] = groups[baseOf(x.name)] || []).push(x);
    const cu = (n) => +((/cu(\d{3})/i.exec(n) || [0, 0])[1]);
    const best = Object.keys(groups).sort((a, b) => cu(b) - cu(a) || a.localeCompare(b))[0];
    const parts = groups[best].sort((a, b) => a.name.localeCompare(b.name));
    return { ver, name: best, parts, size: parts.reduce((s, x) => s + (x.size || 0), 0) };
  }
  return { load, list, model, node, pkg, region, sources: (x) => sourcesOf(x, region()) };
}

module.exports = { create, SOURCES, sourcesOf, tzRegion };
