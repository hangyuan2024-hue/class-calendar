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
async function get(url, o = {}) {
  const r = await (o.fetch || fetch)(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs || 15000) });
  if (!r.ok) throw new Error("打不开（" + r.status + "）");
  const buf = Buffer.from(await r.arrayBuffer()).subarray(0, o.maxBytes || 1.5e6);
  const ct = r.headers.get("content-type") || "";
  let cs = (/charset=([\w-]+)/i.exec(ct) || [])[1] || (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString("latin1").slice(0, 3000)) || [])[1] || "utf-8";
  cs = /gb/i.test(cs) ? "gbk" : cs.toLowerCase();
  try { return { html: new TextDecoder(cs).decode(buf), ct, url: r.url || url }; } catch (e) { return { html: buf.toString("utf8"), ct, url: r.url || url }; }
}
// 搜网页 → [{ title, url, snippet }]
async function search(q, o = {}) {
  q = String(q || "").trim().slice(0, 200);
  if (!q) throw new Error("要搜什么（query）");
  let last = null;
  for (const base of o.bases || ["https://cn.bing.com/search?setmkt=zh-CN&ensearch=0&q=", "https://www.bing.com/search?setlang=zh-Hans&q="]) {
    try {
      const { html } = await get(base + encodeURIComponent(q), o);
      const r = parseBing(html);
      if (r.length) return r.slice(0, o.n || 6);
      last = new Error("没搜到结果");
    } catch (e) { last = e; }
  }
  throw new Error("联网搜索没成：" + (last ? last.message : "") + "（这台电脑能上网吗？）");
}
// 读网页正文 → { title, url, text }
async function read(url, o = {}) {
  url = String(url || "").trim();
  if (!publicUrl(url)) throw new Error("只能读公开的网页（http / https 开头）");
  const { html, ct, url: final } = await get(url, o);
  if (!/html|text\/plain|^$/i.test(ct)) throw new Error("这不是网页（" + ct.split(";")[0] + "），读不了");
  const title = text((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "").slice(0, 120);
  let body = String(html).replace(/<head[\s\S]*?<\/head>/i, " ").replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|title)[\s\S]*?<\/\1>/gi, " ");
  const main = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (main && text(main[2]).length > 100) body = main[2];
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|br)>|<br\s*\/?>/gi, "\n");
  const t = unent(body.replace(/<[^>]+>/g, " ")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 2).join("\n");
  return { title, url: final, text: t.slice(0, o.maxChars || 5000) };
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
module.exports = { search, read, tools, parseBing, publicUrl, realUrl };
