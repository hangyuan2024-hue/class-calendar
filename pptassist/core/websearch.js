// 捞小智 · 联网搜索：搜网页（必应国内版的网页结果，不要 Key）、读网页正文。回答还是本机的大模型写，只是先去网上查资料。
//   只读公开网页：只认 http / https，不访问本机和内网地址；每页最多读 1.5MB、15 秒；正文最多给模型 5000 字。
"use strict";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", ensp: " ", emsp: " ", middot: "·", hellip: "…", mdash: "—", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’" };
const unent = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, k) => (k[0] === "#" ? String.fromCodePoint(k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : +k.slice(1)) : ENT[k.toLowerCase()] != null ? ENT[k.toLowerCase()] : m));
const text = (html) => unent(String(html || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
// 必应的结果链接是跳转地址（bing.com/ck/a?…&u=a1<base64>）：解出真正的网址
function realUrl(u) {
  u = unent(u);
  try {
    const x = new URL(u);
    if (/bing\.com$/.test(x.hostname) && x.pathname.startsWith("/ck/")) { const p = x.searchParams.get("u"); if (p && p.startsWith("a1")) return Buffer.from(p.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
  } catch (e) {}
  return u;
}
// 不读本机、内网（防止被网页里的链接骗去读这台电脑上的服务）
function publicUrl(u) {
  let x; try { x = new URL(u); } catch (e) { return false; }
  if (!/^https?:$/.test(x.protocol)) return false;
  const h = x.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]" || /^\[(fc|fd|fe80)/i.test(h)) return false;
  return true;
}
function parseBing(html) {
  const out = [];
  for (const m of String(html).matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)) {
    const li = m[0];
    const a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(li);
    if (!a) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(li) || /<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/.exec(li);
    const url = realUrl(a[1]);
    if (!publicUrl(url)) continue;
    out.push({ title: text(a[2]).slice(0, 120), url, snippet: text(p ? p[1] : "").replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*·\s*/, "").slice(0, 300) });
  }
  return out;
}
// 取网页：缓存（搜索 10 分钟、网页 30 分钟）；快照（o.snapshot = { dir, mode: "record" | "replay" }）——
//   record：真的上网，顺便把每个网址拿到的内容存下来；replay：只从存下来的读、不上网（联网考试用：网上的内容会变，考同一份快照分数才能比）
const CACHE = new Map();
const snapKey = (url) => require("crypto").createHash("sha1").update(url).digest("hex");
async function get(url, o = {}) {
  const ttl = o.cacheMs != null ? o.cacheMs : 30 * 60e3, hit = CACHE.get(url);
  if (ttl && hit && Date.now() - hit.at < ttl) return hit.v;
  const sn = o.snapshot, sf = sn && require("path").join(sn.dir, snapKey(url) + ".json");
  if (sn && sn.mode === "replay") {
    let v; try { v = JSON.parse(require("fs").readFileSync(sf, "utf8")); } catch (e) { throw new Error("快照里没有这个网页"); }
    return v;
  }
  const r = await (o.fetch || fetch)(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs || 15000) });
  if (!r.ok) throw new Error("打不开（" + r.status + "）");
  const buf = Buffer.from(await r.arrayBuffer()).subarray(0, o.maxBytes || 1.5e6);
  const ct = r.headers.get("content-type") || "";
  let cs = (/charset=([\w-]+)/i.exec(ct) || [])[1] || (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString("latin1").slice(0, 3000)) || [])[1] || "utf-8";
  cs = /gb/i.test(cs) ? "gbk" : cs.toLowerCase();
  let v;
  try { v = { html: new TextDecoder(cs).decode(buf), ct, url: r.url || url }; } catch (e) { v = { html: buf.toString("utf8"), ct, url: r.url || url }; }
  if (ttl) { CACHE.set(url, { at: Date.now(), v }); if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value); }
  if (sn && sn.mode === "record") { try { require("fs").mkdirSync(sn.dir, { recursive: true }); require("fs").writeFileSync(sf, JSON.stringify(v)); } catch (e) {} }
  return v;
}
// 搜索词发出去之前抹掉个人信息：手机号、身份证号、学号（长串数字）、邮箱
function scrub(q) {
  return String(q || "").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ").replace(/\b\d{17}[\dXx]\b/g, " ").replace(/\b1[3-9]\d{9}\b/g, " ").replace(/\b\d{8,}\b/g, " ").replace(/\s+/g, " ").trim();
}
// 别的搜索网站（必应不行时换着用）：标题在 <h3><a href> 里的通用写法
function parseH3(html) {
  const out = [];
  for (const m of String(html).matchAll(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>([\s\S]{0,1500})/g)) {
    const url = unent(m[1]);
    if (!publicUrl(url)) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>|<div[^>]+class="[^"]*(?:abstract|summary|res-desc|txt-info|str_info)[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(m[3]);
    out.push({ title: text(m[2]).slice(0, 120), url, snippet: text(p ? p[1] || p[2] : "").slice(0, 300) });
  }
  return out;
}
const ENGINES = [
  { name: "必应", base: "https://cn.bing.com/search?setmkt=zh-CN&ensearch=0&q=", parse: parseBing },
  { name: "必应国际", base: "https://www.bing.com/search?setlang=zh-Hans&q=", parse: parseBing },
  { name: "360 搜索", base: "https://www.so.com/s?q=", parse: parseH3 },
  { name: "搜狗", base: "https://www.sogou.com/web?query=", parse: parseH3 },
];
// 搜网页 → [{ title, url, snippet }]：一家不行换下一家；同一台电脑每分钟最多 o.perMin 次（默认 12，别给人家网站添麻烦）
const recent = [];
async function search(q, o = {}) {
  q = scrub(String(q || "").trim().slice(0, 200));
  if (!q) throw new Error("要搜什么（query）");
  const now = Date.now();
  while (recent.length && now - recent[0] > 60e3) recent.shift();
  if (!(o.snapshot && o.snapshot.mode === "replay") && recent.length >= (o.perMin || 12)) throw new Error("搜得太频繁了，等一会儿再搜");
  recent.push(now);
  let last = null;
  const engines = o.engines || (o.bases ? o.bases.map((b) => ({ name: "", base: b, parse: parseBing })) : ENGINES);
  for (const e of engines) {
    try {
      const { html } = await get(e.base + encodeURIComponent(q), { ...o, cacheMs: o.cacheMs != null ? o.cacheMs : 10 * 60e3 });
      const r = e.parse(html);
      if (r.length) return r.slice(0, o.n || 6).map((x) => ({ ...x, ...(e.name ? { engine: e.name } : {}) }));
      last = new Error("没搜到结果");
    } catch (x) { last = x; }
  }
  throw new Error("联网搜索没成：" + (last ? last.message : "") + "（这台电脑能上网吗？）");
}
// 读网页正文 → { title, url, text }
async function read(url, o = {}) {
  url = String(url || "").trim();
  if (!publicUrl(url)) throw new Error("只能读公开的网页（http / https 开头）");
  const { html, ct, url: final } = await get(url, o);
  if (!/html|text\/plain|^$/i.test(ct)) throw new Error("这不是网页（" + ct.split(";")[0] + "），读不了");
  const x = extractHtml(html);
  return { title: x.title, url: final, text: x.text.slice(0, o.maxChars || 5000), ...(x.date ? { date: x.date } : {}) };
}
// 网页 → { title, text, date }：去掉导航、页脚、脚本；挑正文那一块（article / main / 类名像正文的 div，挑字最多、链接最少的）
function extractHtml(html) {
  const title = text((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "").slice(0, 120);
  let body = String(html).replace(/<head[\s\S]*?<\/head>/i, " ").replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|title)[\s\S]*?<\/\1>/gi, " ");
  const cands = [];
  for (const m of body.matchAll(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/gi)) cands.push(m[2]);
  for (const m of body.matchAll(/<div[^>]+(?:class|id)="[^"]*(?:content|article|detail|text|v_news|news_con|wp_articlecontent|zw|正文)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<\/div>|<div|$)/gi)) cands.push(m[1]);
  const score = (h) => { const t = text(h); const links = text((h.match(/<a[\s\S]*?<\/a>/gi) || []).join(" ")); return t.length - 2 * links.length; };
  const best = cands.filter((c) => text(c).length > 100).sort((a, b) => score(b) - score(a))[0];
  if (best) body = best;
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|br)>|<br\s*\/?>/gi, "\n");
  const t = unent(body.replace(/<[^>]+>/g, " ")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 2).join("\n");
  const dm = /(20\d\d)[-年/.](\d{1,2})[-月/.](\d{1,2})/.exec(text(String(html).slice(0, 200000)));
  return { title, text: t, ...(dm ? { date: `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}` } : {}) };
}
// 给捞小智的两个工具
function tools(o = {}) {
  return [
    { name: "web_search", desc: "联网搜索：问到新闻、最近发生的事、现在的价格 / 排名 / 政策、你不确定的事实时，先搜一下再回答。返回几条结果（标题、网址、摘要）", params: { query: { type: "string", description: "搜索词：简短的几个关键词" } }, req: ["query"],
      say: (a) => `联网搜索「${String(a.query || "").slice(0, 30)}」`, run: async (a) => { const r = await search(a.query, o); return { results: r, tip: "摘要不够就用 read_page 读其中一两个网页的正文；回答最后写「来源：网站名」" }; } },
    { name: "read_page", desc: "读一个网页的正文（web_search 搜到的网址）", params: { url: { type: "string" } }, req: ["url"],
      say: (a) => { let h = ""; try { h = new URL(a.url).hostname; } catch (e) {} return `读网页 ${h}`; }, run: async (a) => read(a.url, o) },
  ];
}
module.exports = { search, read, tools, parseBing, parseH3, publicUrl, realUrl, extractHtml, scrub, ENGINES, _cache: CACHE, _recent: recent };
