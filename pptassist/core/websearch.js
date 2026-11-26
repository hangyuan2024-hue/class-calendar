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
  for (const m of String(html).matchAll(/<h3[^>]*>\s*<a([^>]*)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/h3>([\s\S]{0,1500})/g)) {
    // 360、搜狗的结果链接是跳转地址；真网址常常写在 data-mdurl / data-url 里（没有的话留着跳转地址，后面统一解开）
    const real = (/data-(?:mdurl|url|landurl)="(https?:[^"]+)"/.exec(m[1] + " " + m[3]) || /data-(?:mdurl|url|landurl)="(https?:[^"]+)"/.exec(m[5].slice(0, 600)) || [])[1];
    const url = unent(real || m[2]);
    m[2] = m[4]; m[3] = m[5];
    if (!publicUrl(url)) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>|<div[^>]+class="[^"]*(?:abstract|summary|res-desc|txt-info|str_info)[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(m[3]);
    out.push({ title: text(m[2]).slice(0, 120), url, snippet: text(p ? p[1] || p[2] : "").slice(0, 300) });
  }
  return out;
}
// 百度：每条结果的 div 上有 mu="真网址"（大部分有）；没有的就是 baidu.com/link?url= 跳转，后面统一解开
function parseBaidu(html) {
  const out = [], parts = String(html).split(/<div[^>]+class="[^"]*\b(?:result|result-op)\b[^"]*c-container/).slice(1);
  for (const blk of parts) {
    const b = blk.slice(0, 6000);
    const mu = (/^[^>]*\bmu="([^"]+)"/.exec(b) || [])[1];
    const a = /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    const url = unent(mu && /^https?:/.test(unent(mu)) ? mu : a[1]);
    if (!publicUrl(url)) continue;
    const sn = /<span[^>]+class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(b) || /<div[^>]+class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b) || /<div[^>]+class="[^"]*(?:c-span-last|c-gap-top)[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b);
    out.push({ title: text(a[2]).slice(0, 120), url, snippet: text(sn ? sn[1] : "").replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*/, "").slice(0, 300) });
  }
  return out;
}
const ENGINES = [
  { name: "必应", base: "https://cn.bing.com/search?setmkt=zh-CN&ensearch=0&q=", parse: parseBing, recent: { day: "&filters=ex1%3a%22ez1%22", week: "&filters=ex1%3a%22ez2%22", month: "&filters=ex1%3a%22ez3%22" } },
  { name: "百度", base: "https://www.baidu.com/s?ie=utf-8&rn=20&wd=", parse: parseBaidu, recent: { day: "&gpc=stf%3D{t}|stftype%3D1", week: "&gpc=stf%3D{t}|stftype%3D1", month: "&gpc=stf%3D{t}|stftype%3D1" } },
  { name: "360 搜索", base: "https://www.so.com/s?q=", parse: parseH3 },
  { name: "搜狗", base: "https://www.sogou.com/web?query=", parse: parseH3 },
  { name: "必应国际", base: "https://www.bing.com/search?setlang=zh-Hans&q=", parse: parseBing, foreign: true },
];
// 搜索网站的跳转链接（百度 link?url=、360 link?m=、搜狗 link?url=）→ 真网址：先看 302 的 Location，没有就从页面里的 location.replace / URL= 找
const isJump = (u) => { const h = hostOf(u); return (/(^|\.)(baidu\.com|so\.com|sogou\.com)$/.test(h) && /\/link\b/.test(u)) || (/(^|\.)bing\.com$/.test(h) && /\/ck\/a/.test(u)); };
async function unjump(u, o = {}) {
  if (!isJump(u)) return u;
  try {
    const r = await (o.fetch || fetch)(u, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" }, redirect: "manual", signal: AbortSignal.timeout(o.jumpMs || 6000) });
    const loc = r.headers.get("location");
    if (loc && /^https?:/.test(loc)) return loc;
    const h = r.arrayBuffer ? Buffer.from(await r.arrayBuffer()).toString("utf8").slice(0, 20000) : "";
    const m = /location\.replace\(\s*["']([^"']+)["']/.exec(h) || /URL='?([^'">\s]+)/i.exec(h) || /window\.location\.href\s*=\s*["']([^"']+)["']/.exec(h);
    if (m && /^https?:/.test(unent(m[1]))) return unent(m[1]);
  } catch (e) {}
  return u;
}
// 搜网页 → [{ title, url, snippet, engine }]：几家搜索网站一起搜（必应、百度、360 先上，不够再加搜狗），解开跳转链接，
//   合并去重：几家都搜到的、政府 / 学校 / 大媒体的排前面。o.site 只搜某个网站；o.recent = day / week / month 只要最近的。
//   几家都只给了验证页 / 空页：有 o.render（软件里一个看不见的浏览器窗口）就用它真的打开搜索页再找一遍
const recent = [];
const AUTH = /(\.gov\.cn|\.edu\.cn|people\.com\.cn|news\.cn|xinhuanet\.com|cctv\.com|chinanews\.com|gmw\.cn|bilibili\.com|runoob\.com|csdn\.net|icourse163\.org|zhihu\.com)$/;
const normUrl = (u) => { try { const x = new URL(u); x.hash = ""; for (const k of [...x.searchParams.keys()]) if (/^(utm_|spm|from|share|ref)/i.test(k)) x.searchParams.delete(k); return x.href.replace(/\/$/, ""); } catch (e) { return u; } };
function recentParam(e, r, now) {
  if (!r || !e.recent || !e.recent[r]) return "";
  const t = Math.floor((now || Date.now()) / 1000), from = t - { day: 86400, week: 7 * 86400, month: 31 * 86400 }[r];
  return e.recent[r].replace("{t}", `${from},${t}`);
}
async function search(q, o = {}) {
  q = scrub(String(q || "").trim().slice(0, 200));
  if (!q) throw new Error("要搜什么（query）");
  const now = Date.now();
  while (recent.length && now - recent[0] > 60e3) recent.shift();
  if (!(o.snapshot && o.snapshot.mode === "replay") && recent.length >= (o.perMin || 20)) throw new Error("搜得太频繁了，等一会儿再搜");
  recent.push(now);
  const qq = o.site ? `${q} site:${String(o.site).replace(/^https?:\/\//, "").replace(/\/.*$/, "")}` : q;
  const all = (o.engines || (o.bases ? o.bases.map((b) => ({ name: "", base: b, parse: parseBing })) : ENGINES)).filter((e) => !(o.cnOnly && e.foreign));
  const legacy = !!(o.engines || o.bases || o.snapshot);   // 测试 / 联网考试（快照）：照旧一家一家来，第一家有结果就用它
  const errs = [];
  const runOne = async (e, viaRender) => {
    const u = e.base + encodeURIComponent(qq) + recentParam(e, o.recent, o.now ? +o.now() : 0);
    const { html } = viaRender ? await o.render(u) : await get(u, { ...o, cacheMs: o.cacheMs != null ? o.cacheMs : 10 * 60e3 });
    const r = e.parse(html);
    if (!r.length) { errs.push(`${e.name || "搜索"}${/验证|captcha|异常访问|unusual traffic/i.test(html) ? "要人机验证" : "没解析到结果"}`); return []; }
    return r.map((x, i) => ({ ...x, engine: e.name, rank: i }));
  };
  if (legacy) {
    let last = null;
    for (const e of all) {
      try {
        const r = (await runOne(e)).filter((x) => !o.cnOnly || isCn(x.url));
        if (r.length) return r.slice(0, o.n || 6).map(({ rank, engine, ...x }) => ({ ...x, ...(e.name ? { engine: e.name } : {}) }));
        last = new Error(o.cnOnly ? "没搜到国内网站的结果" : "没搜到结果");
      } catch (x) { last = x; }
    }
    throw new Error("联网搜索没成：" + (last ? last.message : "") + "（这台电脑能上网吗？）");
  }
  const settle = (ps) => Promise.all(ps.map((p) => p.catch((e) => { errs.push(e.message); return []; })));
  let lists = await settle(all.slice(0, 3).map((e) => runOne(e)));
  if (lists.flat().length < 4) lists = lists.concat(await settle(all.slice(3).map((e) => runOne(e))));
  if (!lists.flat().length && o.render) lists = await settle(all.slice(0, 2).map((e) => runOne(e, true)));
  const raw = lists.flat();
  // 跳转链接解开（最多 12 个，一起解）
  await Promise.all(raw.filter((x) => isJump(x.url)).slice(0, 12).map(async (x) => { x.url = await unjump(x.url, o); }));
  const merged = new Map();
  for (const x of raw) {
    if (isJump(x.url) || !publicUrl(x.url)) continue;
    const k = normUrl(x.url), m = merged.get(k);
    const sc = Math.max(1, 10 - x.rank) + (AUTH.test(hostOf(x.url)) ? 3 : 0);
    if (m) { m.score += sc; if (!m.engines.includes(x.engine)) m.engines.push(x.engine); if (!m.snippet && x.snippet) m.snippet = x.snippet; }
    else merged.set(k, { title: x.title, url: x.url, snippet: x.snippet, engines: [x.engine], score: sc });
  }
  const out = [...merged.values()];
  if (!out.length) throw new Error("联网搜索没成：" + (errs.slice(0, 3).join("；") || "搜索网站都打不开") + "（这台电脑能上网吗？）");
  const cnOut = o.cnOnly ? out.filter((x) => isCn(x.url)) : out;
  if (!cnOut.length) throw new Error(`搜到了 ${out.length} 条，但都不是国内网站的：换个说法再搜试试`);
  return cnOut.sort((a, b) => b.score - a.score).slice(0, o.n || 8).map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, engine: x.engines.join("、") }));
}
// 读网页 → { title, url, text, date?, links?, images?, videos?, tables? }
//   · 普通网页：取正文（去掉导航、页脚、脚本）
//   · 正文太少（很多网站是打开以后才用 JS 把内容画出来的，比如 B 站、知乎）：有 o.render 就用软件里看不见的浏览器真打开一遍再取
//   · PDF、Word、PPT、Excel：下载下来按文件读（core/files.js）；JSON 直接给
//   o.want：要额外带上的 links（页面上的链接）/ images（图片）/ videos（视频）/ tables（表格）/ all；o.focus：只要和这几个词有关的段落
async function read(url, o = {}) {
  url = String(url || "").trim();
  if (!publicUrl(url)) throw new Error("只能读公开的网页（http / https 开头）");
  let g;
  try { g = await get(url, o); }
  catch (e) { if (!o.render) throw e; const r = await o.render(url); g = { html: r.html, ct: "text/html", url: r.url || url }; }   // 打不开（403、要验证）：用看不见的浏览器再试一次
  let { html, ct, url: final } = g;
  const kind = /pdf/i.test(ct) || /\.pdf(\?|$)/i.test(final) ? "pdf" : /wordprocessingml|msword/i.test(ct) || /\.docx(\?|$)/i.test(final) ? "docx" : /presentationml/i.test(ct) || /\.pptx(\?|$)/i.test(final) ? "pptx" : /spreadsheetml/i.test(ct) || /\.xlsx(\?|$)/i.test(final) ? "xlsx" : /json/i.test(ct) ? "json" : "";
  if (["pdf", "docx", "pptx", "xlsx"].includes(kind)) return readDoc(final, kind, o);
  if (kind === "json") return { title: final, url: final, text: html.slice(0, o.maxChars || 5000) };
  if (!/html|text\/plain|xml|^$/i.test(ct)) throw new Error("这不是网页（" + ct.split(";")[0] + "），读不了");
  let x = extractHtml(html), rendered = false;
  if (o.render && x.text.length < (o.minText || 300) && !/text\/plain/i.test(ct)) {
    try { const r = await o.render(final); const y = extractHtml(r.html); if (y.text.length > x.text.length) { x = y; html = r.html; final = r.url || final; rendered = true; } } catch (e) {}
  }
  let t = x.text;
  if (o.focus) t = focusText(t, o.focus, o.maxChars || 5000);
  const want = String(o.want || "");
  const all = want === "all";
  return {
    title: x.title, url: final, text: t.slice(0, o.maxChars || 5000), ...(x.date ? { date: x.date } : {}), ...(x.desc ? { desc: x.desc } : {}), ...(rendered ? { rendered: true } : {}),
    ...(all || /links/.test(want) ? { links: extractLinks(html, final).slice(0, o.maxLinks || 40) } : {}),
    ...(all || /images/.test(want) ? { images: extractImages(html, final).slice(0, 20) } : {}),
    ...(all || /videos/.test(want) ? { videos: extractVideos(html, final).slice(0, 10) } : {}),
    ...(all || /tables/.test(want) ? { tables: extractTables(html).slice(0, 5) } : {}),
  };
}
// 只留和关键词有关的段落（前后各带一段），省得把整页塞给模型
function focusText(t, focus, max) {
  const ws = String(focus).split(/[\s,，、]+/).filter(Boolean).map((w) => w.toLowerCase());
  if (!ws.length) return t;
  const ps = t.split("\n"), keep = new Set();
  ps.forEach((p, i) => { if (ws.some((w) => p.toLowerCase().includes(w))) { keep.add(i - 1); keep.add(i); keep.add(i + 1); } });
  if (!keep.size) return t;
  return [...keep].filter((i) => i >= 0 && i < ps.length).sort((a, b) => a - b).map((i) => ps[i]).join("\n").slice(0, max);
}
async function readDoc(url, kind, o) {
  const r = await (o.fetch || fetch)(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(o.docMs || 30000) });
  if (!r.ok) throw new Error("打不开（" + r.status + "）");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 30 * 1048576) throw new Error("文件太大了（超过 30M）");
  const f = require("path").join(require("os").tmpdir(), `lg-web-${process.pid}-${Date.now()}.${kind}`);
  require("fs").writeFileSync(f, buf);
  try { const x = await require("./files").read(f); return { title: decodeURIComponent((url.split("/").pop() || "").split("?")[0]) || url, url, text: String(x.text || "").slice(0, o.maxChars || 5000), file: kind }; }
  finally { try { require("fs").rmSync(f, { force: true }); } catch (e) {} }
}
const absUrl = (u, base) => { try { return new URL(unent(u), base).href; } catch (e) { return ""; } };
// 页面上的链接：去掉导航那种很短的、脚本链接；同一个网址只留一次
function extractLinks(html, base) {
  const out = [], seen = new Set();
  const body = String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = absUrl(m[1], base); if (!u || !publicUrl(u) || seen.has(u)) continue;
    const t = text(m[2]) || (/title=["']([^"']+)["']/.exec(m[0]) || [])[1] || "";
    if (t.length < 2 || /^(javascript|mailto)/i.test(m[1])) continue;
    seen.add(u); out.push({ text: t.slice(0, 80), url: u });
  }
  return out;
}
function extractImages(html, base) {
  const out = [], seen = new Set();
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) { const u = absUrl(og[1], base); if (u) { seen.add(u); out.push({ src: u, alt: "封面" }); } }
  for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0], src = (/\b(?:data-src|data-original|src)=["']([^"']+)["']/i.exec(tag) || [])[1];
    const u = src && absUrl(src, base); if (!u || !/^https?:/.test(u) || seen.has(u) || /\.(svg|gif|ico)(\?|$)|[\/_.-](logo|icon|favicon|avatar|blank|pixel|spacer)\.(png|jpe?g|webp)/i.test(u)) continue;
    const w = +(/\bwidth=["']?(\d+)/i.exec(tag) || [])[1] || 0; if (w && w < 120) continue;
    seen.add(u); out.push({ src: u, alt: text((/\balt=["']([^"']*)["']/i.exec(tag) || [])[1] || "").slice(0, 60) });
  }
  return out;
}
function extractVideos(html, base) {
  const out = [], seen = new Set();
  const add = (u, t) => { u = absUrl(u, base); if (u && /^https?:/.test(u) && !seen.has(u)) { seen.add(u); out.push({ url: u, title: t || "" }); } };
  for (const m of String(html).matchAll(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/gi)) add(m[1], "页面视频");
  for (const m of String(html).matchAll(/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1], "视频");
  for (const m of String(html).matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)) if (/player|video|bilibili|v\.qq|youku|iqiyi|ixigua|cctv/i.test(m[1])) add(m[1], "嵌入的视频");
  return out;
}
// 表格 → 一行一行（格子用 | 隔开），给模型看
function extractTables(html) {
  const out = [];
  for (const m of String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...m[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1]).replace(/\|/g, "/"))).filter((r) => r.some(Boolean));
    if (rows.length >= 2) out.push(rows.slice(0, 60).map((r) => "| " + r.join(" | ") + " |").join("\n"));
  }
  return out;
}
// 顺着一个网站往下读：先读给的这一页，再按链接文字和要找的东西对不对得上，挑同一个网站里最像的几页读（一起读，最多 o.max 页）
async function crawlSite(start, query, o = {}) {
  const first = await read(start, { ...o, want: "links", maxLinks: 300 });
  const host = hostOf(first.url).replace(/^www\./, "");
  const ws = String(query || "").split(/[\s,，、]+/).filter(Boolean).map((w) => w.toLowerCase());
  const cand = (first.links || []).filter((l) => hostOf(l.url).replace(/^www\./, "").endsWith(host) && l.url !== first.url && !/\.(jpg|png|gif|zip|rar|exe)(\?|$)/i.test(l.url))
    .map((l) => ({ ...l, score: ws.reduce((a, w) => a + (l.text.toLowerCase().includes(w) ? 3 : 0) + (l.url.toLowerCase().includes(w) ? 1 : 0), 0) + Math.min(2, l.text.length / 20) }))
    .sort((a, b) => b.score - a.score);
  const pick = (ws.length ? cand.filter((c) => c.score >= 3) : cand).slice(0, Math.max(1, Math.min(10, o.max || 5)));
  const pages = [{ title: first.title, url: first.url, text: (ws.length ? focusText(first.text, query, 800) : first.text).slice(0, 800) }];
  const queue = pick.slice(); const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) { const l = queue.shift(); try { const r = await read(l.url, { ...o, focus: query || "", maxChars: 1200 }); pages.push({ title: r.title || l.text, url: r.url, text: r.text.slice(0, 800) }); } catch (e) {} }
  });
  await Promise.all(workers);
  return { site: host, pages, more: cand.length > pick.length ? cand.slice(pick.length, pick.length + 15).map((l) => ({ text: l.text, url: l.url })) : [] };
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
  const desc = text((/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i.exec(html) || [])[1] || "").slice(0, 200);
  return { title, text: t || desc, ...(desc ? { desc } : {}), ...(dm ? { date: `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}` } : {}) };
}
// ---------- 只看国内媒体 ----------
//   .cn 结尾的（人民网、央视、光明网、各级政府和学校……）+ 下面这些国内网站；搜到的、要读的、新闻、图片、视频都只认这些
const CN_SITES = ["xinhuanet.com", "news.cn", "cctv.com", "cctv.cn", "cntv.cn", "chinanews.com", "thepaper.cn", "ifeng.com", "sina.com.cn", "sina.cn", "qq.com", "163.com", "sohu.com",
  "huanqiu.com", "chinadaily.com.cn", "caixin.com", "yicai.com", "jiemian.com", "guancha.cn", "cls.cn", "36kr.com", "ithome.com", "bjnews.com.cn", "zhihu.com", "bilibili.com", "b23.tv",
  "ixigua.com", "toutiao.com", "baidu.com", "kankanews.com", "eastmoney.com", "stcn.com", "21jingji.com", "jfdaily.com", "xinmin.cn", "ynet.com", "dzwww.com", "youku.com", "iqiyi.com",
  "douyin.com", "kuaishou.com", "weibo.com", "csdn.net", "cnblogs.com", "juejin.cn", "oschina.net", "gitee.com", "runoob.com", "jianshu.com", "douban.com", "zol.com.cn", "pconline.com.cn",
  "people.com.cn", "gmw.cn", "ce.cn", "cri.cn", "cnr.cn", "youth.cn", "workercn.cn", "china.com.cn", "china.com", "hupu.com", "autohome.com.cn", "dxy.cn", "guokr.com", "smzdm.com", "mydrivers.com",
  "icourse163.org", "xuetangx.com", "zhihuishu.com", "chaoxing.com", "imooc.com", "biancheng.net", "51cto.com", "acwing.com", "nowcoder.com", "cnki.net", "xiaohongshu.com", "haokan.baidu.com", "sogou.com", "so.com", "360.cn", "aliyun.com", "tencent.com", "huawei.com", "mi.com", "jd.com", "taobao.com", "tmall.com", "ctrip.com", "12306.cn", "baike.com", "mooc.cn"];
const VIDEO_SITES = ["cctv.com", "cctv.cn", "cntv.cn", "bilibili.com", "b23.tv", "ixigua.com", "v.qq.com", "youku.com", "iqiyi.com", "douyin.com", "kuaishou.com", "haokan.baidu.com", "v.163.com", "video.sina.com.cn", "kankanews.com", "thepaper.cn"];
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ""; } };
const under = (h, d) => h === d || h.endsWith("." + d);
function isCn(u) { const h = hostOf(u); return !!h && publicUrl(u) && (/\.cn$/.test(h) || CN_SITES.some((d) => under(h, d))); }
const isVideo = (u) => { const h = hostOf(u); return VIDEO_SITES.some((d) => under(h, d.split("/")[0])) && (/video|VIDE|\/v\/|\/play|bilibili\.com\/video|ixigua\.com\/\d|v\.qq\.com\/x|\.html?$|\.shtml$/i.test(u)); };
const SITE_NAME = [["news.cn", "新华网"], ["xinhuanet.com", "新华网"], ["people.com.cn", "人民网"], ["cctv.com", "央视网"], ["cctv.cn", "央视网"], ["chinanews.com", "中国新闻网"], ["gmw.cn", "光明网"],
  ["thepaper.cn", "澎湃新闻"], ["sina.com.cn", "新浪"], ["163.com", "网易"], ["qq.com", "腾讯"], ["ifeng.com", "凤凰网"], ["chinadaily.com.cn", "中国日报"], ["huanqiu.com", "环球网"], ["bilibili.com", "哔哩哔哩"], ["ce.cn", "中国经济网"], ["cnr.cn", "央广网"]];
const siteName = (u) => { const h = hostOf(u); const x = SITE_NAME.find(([d]) => under(h, d)); return x ? x[1] : h.replace(/^www\./, ""); };

// ---------- 今天的新闻：从几家国内主要媒体的首页把「今天 / 昨天发的」那些文章链接收上来 ----------
//   不靠接口：各家文章网址里都带日期（新华网 20261127、人民网 2026/1127、中新网 2026/11-27、央视 2026/11/27、新浪 2026-11-27……），
//   按网址里的日期认「今天的」，链接文字当标题。某一家打不开就跳过
const NEWS_HOMES = [
  { name: "新华网", url: "https://www.news.cn/" },
  { name: "人民网", url: "http://www.people.com.cn/" },
  { name: "央视网", url: "https://news.cctv.com/" },
  { name: "中国新闻网", url: "https://www.chinanews.com.cn/" },
  { name: "光明网", url: "https://www.gmw.cn/" },
  { name: "新浪新闻", url: "https://news.sina.com.cn/" },
];
const XWLB = "https://tv.cctv.com/lm/xwlb/";   // 新闻联播（每天的视频页）
function dayPats(d) {
  const Y = String(d.getFullYear()), M = String(d.getMonth() + 1).padStart(2, "0"), D = String(d.getDate()).padStart(2, "0");
  return [`${Y}${M}${D}`, `${Y}/${M}${D}`, `${Y}/${M}-${D}`, `${Y}/${M}/${D}`, `${Y}-${M}/${D}`, `${Y}-${M}-${D}`, `/${Y.slice(2)}/${M}${D}/`];
}
function harvest(html, base, days) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(unent(m[1]), base).href; } catch (e) { continue; }
    if (!isCn(u) || seen.has(u)) continue;
    const day = days.findIndex((ps) => ps.some((p) => u.includes(p)));
    if (day < 0) continue;
    const t = text(m[2]).replace(/^\s*[·•]\s*/, "");
    if (t.length < 8 || t.length > 60 || /^(更多|详细|查看|点击)/.test(t)) continue;
    seen.add(u); out.push({ title: t, url: u, day });
  }
  return out;
}
async function newsToday(a = {}, o = {}) {
  const now = o.now ? o.now() : new Date(), y = new Date(now.getTime() - 864e5);
  const days = [dayPats(now), dayPats(y)];
  const homes = o.newsHomes || NEWS_HOMES;
  const all = [];
  await Promise.all(homes.map(async (h) => {
    try { const { html, url } = await get(h.url, { ...o, cacheMs: o.cacheMs != null ? o.cacheMs : 10 * 60e3 }); for (const x of harvest(html, url, days)) all.push({ ...x, source: h.name }); } catch (e) {}
  }));
  if (!all.length) throw new Error("几家新闻网站都没打开（这台电脑能上网吗？）");
  // 同一个标题只留一条；今天的排前面；有关键词就只要标题里带关键词的
  const kw = String(a.topic || "").trim().split(/[\s,，、]+/).filter(Boolean);
  const seenT = new Set();
  let list = all.filter((x) => { const k = x.title.replace(/\s/g, ""); if (seenT.has(k)) return false; seenT.add(k); return true; });
  if (kw.length) list = list.filter((x) => kw.some((k) => x.title.includes(k)));
  list.sort((p, q) => p.day - q.day);
  // 各家轮着挑，不让一家占满
  const by = new Map(); for (const x of list) { if (!by.has(x.source)) by.set(x.source, []); by.get(x.source).push(x); }
  const n = Math.max(3, Math.min(30, +a.n || 15)), pickd = [];
  for (let i = 0; pickd.length < n && [...by.values()].some((v) => v.length > i); i++) for (const v of by.values()) if (v[i] && pickd.length < n) pickd.push(v[i]);
  // 读前几条的正文（给模型写汇总用）：每条 700 字
  const k = Math.max(0, Math.min(8, a.read == null ? 5 : +a.read));
  await Promise.all(pickd.slice(0, k).map(async (x) => { try { const r = await read(x.url, { ...o, maxChars: 700 }); x.text = r.text; } catch (e) {} }));
  return pickd.map((x) => ({ title: x.title, url: x.url, source: x.source, when: x.day ? "昨天" : "今天", ...(x.text ? { text: x.text } : {}) }));
}
// 新闻联播：今天（还没播就昨天）的视频页
async function xwlb(o = {}) {
  const now = o.now ? o.now() : new Date(), y = new Date(now.getTime() - 864e5);
  const { html, url } = await get(o.xwlbUrl || XWLB, { ...o, cacheMs: o.cacheMs != null ? o.cacheMs : 10 * 60e3 });
  const list = harvest(html, url, [dayPats(now), dayPats(y)]).filter((x) => /VIDE|video/i.test(x.url));
  return list.sort((p, q) => p.day - q.day).slice(0, 20).map((x) => ({ title: x.title, url: x.url, source: "央视网 · 新闻联播", when: x.day ? "昨天" : "今天" }));
}
// 视频：① 搜「××视频」、② 只在 B 站里搜（大部分教程视频在 B 站）、③ B 站自己的搜索页（静态取不到就用看不见的浏览器打开）——三路一起，合并去重，只留国内视频网站的
function parseBiliSearch(html) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']((?:https?:)?\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const bv = m[2]; if (seen.has(bv)) continue;
    const t = (/title=["']([^"']+)["']/.exec(m[0]) || [])[1] || text(m[3]);
    if (!t || t.length < 4) continue;
    seen.add(bv); out.push({ title: unent(t).slice(0, 80), url: `https://www.bilibili.com/video/${bv}`, snippet: "", source: "哔哩哔哩" });
  }
  // 页面里内嵌的数据（"bvid":"BV…","title":"…"）
  for (const m of String(html).matchAll(/"bvid":"(BV[0-9A-Za-z]{10})"[^{}]{0,400}?"title":"([^"]{4,120})"/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    out.push({ title: text(m[2].replace(/\\u003c[^>]*?\\u003e|<[^>]+>/g, "")).slice(0, 80), url: `https://www.bilibili.com/video/${m[1]}`, snippet: "", source: "哔哩哔哩" });
  }
  return out;
}
async function videoSearch(q, o = {}) {
  q = String(q || "").trim(); if (!q) throw new Error("要找什么视频");
  const errs = [];
  const safe = (p) => p.catch((e) => { errs.push(e.message); return []; });
  const bili = async () => {
    const u = "https://search.bilibili.com/all?keyword=" + encodeURIComponent(q);
    let r = [];
    try { r = parseBiliSearch((await get(u, { ...o, cacheMs: 10 * 60e3 })).html); } catch (e) {}
    if (!r.length && o.render) { try { r = parseBiliSearch((await o.render(u)).html); } catch (e) { errs.push("B 站：" + e.message); } }
    return r;
  };
  const lists = await Promise.all([
    safe(search(q + " 视频", { ...o, cnOnly: true, n: 12 })),
    safe(search(q, { ...o, cnOnly: true, n: 10, site: "bilibili.com" })),
    safe(bili()),
  ]);
  const seen = new Set(), out = [];
  for (const x of lists.flat()) { if (!isVideo(x.url)) continue; const k = normUrl(x.url); if (seen.has(k)) continue; seen.add(k); out.push({ title: x.title, url: x.url, snippet: x.snippet || "", source: x.source || siteName(x.url) }); }
  if (!out.length) throw new Error("没找到国内视频网站上的视频" + (errs.length ? "（" + errs.slice(0, 2).join("；") + "）" : "") + "：换个说法试试，比如少写几个词");
  return out.slice(0, o.n || 8);
}
// 图片：必应图片 + 百度图片两家一起，只要图片所在网页是国内网站的；显示用缩略图（国内能打开）
function parseImages(html) {
  const out = [];
  for (const m of String(html).matchAll(/\bm="(\{[^"]+\})"/g)) {
    let j; try { j = JSON.parse(unent(m[1])); } catch (e) { continue; }
    if (!j.murl || !j.purl) continue;
    out.push({ title: text(j.t || "").slice(0, 80), img: j.murl, thumb: j.turl || j.murl, page: j.purl });
  }
  return out;
}
function parseBaiduImages(json) {
  let j; try { j = typeof json === "string" ? JSON.parse(json.replace(/\\'/g, "'")) : json; } catch (e) { return []; }
  return (j.data || []).filter((x) => x && x.thumbURL).map((x) => {
    const r = (x.replaceUrl || [])[0] || {};
    return { title: text(x.fromPageTitleEnc || x.fromPageTitle || "").slice(0, 80), img: r.ObjURL || x.middleURL || x.thumbURL, thumb: x.thumbURL, page: r.FromURL || r.FromUrl || "" };
  }).filter((x) => x.page);
}
async function imageSearch(q, o = {}) {
  q = scrub(String(q || "").trim().slice(0, 100));
  if (!q) throw new Error("要找什么图片");
  const bingU = (o.imageBase || "https://cn.bing.com/images/search?form=HDRSC2&first=1&q=") + encodeURIComponent(q);
  const bing = async () => { let r = []; try { r = parseImages((await get(bingU, { ...o, cacheMs: 10 * 60e3 })).html); } catch (e) {} if (!r.length && o.render) { try { r = parseImages((await o.render(bingU)).html); } catch (e) {} } return r; };
  const baidu = async () => { if (o.imageBase) return []; try { return parseBaiduImages((await get("https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ie=utf-8&oe=utf-8&pn=0&rn=30&word=" + encodeURIComponent(q), { ...o, cacheMs: 10 * 60e3 })).html); } catch (e) { return []; } };
  const [a, b] = await Promise.all([bing(), baidu()]);
  const seen = new Set(), r = [];
  for (const x of [...a, ...b]) { if (!isCn(x.page) || !publicUrl(x.thumb) || seen.has(x.thumb)) continue; seen.add(x.thumb); r.push(x); }
  if (!r.length) throw new Error("没找到国内网站上的图片");
  return r.slice(0, Math.max(1, Math.min(16, +o.n || 8))).map((x) => ({ ...x, source: siteName(x.page) }));
}
// 给捞小智的工具：搜网页、读网页（只认国内网站），今天的新闻、新闻联播、找图片、找视频
function tools(o = {}) {
  o = { cnOnly: true, ...o };
  const cnRead = (u, x = {}) => { if (o.cnOnly && !isCn(u)) throw new Error("只读国内网站（.cn 和国内的新闻、视频、技术、学习网站）"); return read(u, { ...o, ...x }); };
  return [
    { name: "web_search", desc: "联网搜索（必应、百度、360、搜狗几家一起搜，合并去重，只留国内网站）：问到最近的事、现在的价格 / 排名 / 政策 / 通知、教程资料、你不确定的事实时，先搜再答。site：只在某个网站里搜（比如 runoob.com、gov.cn、某个学校官网）；recent：只要最近的（day 一天内 / week 一周 / month 一个月）",
      params: { query: { type: "string" }, site: { type: "string" }, recent: { type: "string", enum: ["day", "week", "month"] } }, req: ["query"],
      say: (a) => `联网搜索「${String(a.query || "").slice(0, 30)}」${a.site ? "（" + String(a.site).slice(0, 20) + "）" : ""}`,
      run: async (a) => { const r = await search(a.query, { ...o, site: a.site || "", recent: a.recent || "" }); return { results: r, forModel: "（搜到的网页界面上已经列出来了）\n" + r.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet || ""}`).join("\n") + "\n摘要不够就用 read_page 读其中一两个；要顺着一个网站往下找用 crawl_site。回答最后写「来源：」列出用到的网站名" }; } },
    { name: "read_page", desc: "读一个网页（web_search / crawl_site 给的网址，或者对方发来的链接）。打开以后才出内容的网页会用软件里的浏览器真的打开再读；PDF、Word、PPT、Excel 链接也能读。focus：只要和这几个词有关的段落；want：还要页面上的 links（链接）/ images（图片）/ videos（视频）/ tables（表格）/ all",
      params: { url: { type: "string" }, focus: { type: "string" }, want: { type: "string", enum: ["links", "images", "videos", "tables", "all"] } }, req: ["url"],
      say: (a) => { let h = ""; try { h = new URL(a.url).hostname; } catch (e) {} return `读网页 ${h}`; },
      run: async (a) => {
        const r = await cnRead(a.url, { focus: a.focus || "", want: a.want || "" });
        const ui = {};
        if (r.images && r.images.length) ui.images = r.images.slice(0, 12).map((x) => ({ thumb: x.src, img: x.src, page: r.url, title: x.alt, source: siteName(r.url) }));
        if (r.videos && r.videos.length) ui.videos = r.videos.map((x) => ({ url: isCn(x.url) ? x.url : r.url, title: x.title || r.title, source: siteName(r.url) }));
        return { ...r, ...ui };
      } },
    { name: "crawl_site", when: (t) => RE_SITE.test(t), desc: "顺着一个网站往下找：先打开给的网址（比如学校官网、教务处、某个教程网站的首页 / 栏目页），再挑页面上和要找的东西最对得上的几个链接接着读，一次读好几页。对方说「去××官网看看有没有××」「把这个网站上关于××的都找出来」时用。query：要找什么；max：最多读几页（默认 5）",
      params: { url: { type: "string" }, query: { type: "string" }, max: { type: "integer" } }, req: ["url"],
      say: (a) => { let h = ""; try { h = new URL(a.url).hostname; } catch (e) {} return `顺着网站找 ${h}${a.query ? "「" + String(a.query).slice(0, 12) + "」" : ""}`; },
      run: async (a) => { if (o.cnOnly && !isCn(a.url)) throw new Error("只读国内网站"); const r = await crawlSite(a.url, a.query || "", { ...o, max: a.max }); return { ...r, forModel: `（在 ${r.site} 上读了 ${r.pages.length} 页）\n` + r.pages.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.text.replace(/\s+/g, " ")}`).join("\n") + (r.more.length ? "\n还有这些链接没读：\n" + r.more.map((l) => `- ${l.text} ${l.url}`).join("\n") : "") }; } },
    { name: "news_today", when: (t) => RE_NEWS.test(t), desc: "今天的新闻：从新华网、人民网、央视网、中国新闻网、光明网、新浪新闻收今天（和昨天）发的新闻，前几条带正文。对方问「今天有什么新闻 / 热点 / 头条」「汇总一下今天的新闻」「××方面的新闻」时用。topic：只要某方面的（比如「教育」「科技 人工智能」），不写就是全部；n 要几条（默认 15）。拿到以后按类别分几块汇总，每条一两句，标上来源；不要编没收到的新闻",
      params: { topic: { type: "string" }, n: { type: "integer" } }, say: (a) => `收今天的新闻${a.topic ? "（" + String(a.topic).slice(0, 12) + "）" : ""}`, run: async (a) => { const news = await newsToday({ read: 4, ...a }, o); return { news, forModel: "（界面上已经列出了这些新闻，点标题能打开原文。按类别汇总，每条一两句，标上来源；不要编没有的）\n" + news.map((x, i) => `${i + 1}. 【${x.source}·${x.when}】${x.title}${x.text ? "\n   " + x.text.replace(/\s+/g, " ").slice(0, 600) : ""}`).join("\n") }; } },
    { name: "news_video", when: (t) => RE_NEWS.test(t) || RE_VIDEO.test(t), desc: "新闻联播的视频（央视网）：对方说「播放今天的新闻 / 看新闻联播」时用。返回今天（还没播就昨天）的新闻联播各条视频，界面上会出现能直接播放的卡片",
      params: {}, say: () => "找新闻联播的视频", run: async () => { const videos = await xwlb(o); return { videos, forModel: "（界面上已经有播放按钮，点一下就能看）\n" + videos.map((x, i) => `${i + 1}. ${x.title}（${x.when}）`).join("\n") }; } },
    { name: "video_search", when: (t) => RE_VIDEO.test(t), desc: "找视频：在国内视频网站（央视、B 站、西瓜、腾讯视频、优酷、爱奇艺……）上找视频，对方说「找个××的视频 / 有没有讲××的视频」时用",
      params: { query: { type: "string" } }, req: ["query"], say: (a) => `找视频「${String(a.query || "").slice(0, 20)}」`, run: async (a) => { const videos = await videoSearch(a.query, o); return { videos, forModel: "（界面上已经有播放按钮）\n" + videos.map((x, i) => `${i + 1}. 【${x.source}】${x.title}：${x.snippet || ""}`).join("\n") }; } },
    { name: "image_search", when: (t) => RE_IMAGE.test(t), desc: "找图片：在国内网站上找图片，对方说「找几张××的图片 / 给我看看××长什么样」时用",
      params: { query: { type: "string" } }, req: ["query"], say: (a) => `找图片「${String(a.query || "").slice(0, 20)}」`, run: async (a) => { const images = await imageSearch(a.query, o); return { images, forModel: `（找到 ${images.length} 张，已经显示在界面上了，来自：${[...new Set(images.map((x) => x.source))].join("、")}。简单说一两句就行，不要念网址）` }; } },
  ];
}
const RE_SITE = /网站|官网|网页|链接|https?:\/\/|www\.|爬|抓取|栏目|通知公告|教务处|主页/i;
const RE_NEWS = /新闻|热点|头条|时事|要闻|快讯|今天发生|今天.*(大事|消息)|联播|资讯/;
const RE_VIDEO = /视频|播放|看.*(片|录像|直播)|联播|B ?站|哔哩/i;
const RE_IMAGE = /图片|照片|图像|长什么样|配图|找.*图|壁纸/;
module.exports = { search, read, tools, crawlSite, parseBaidu, unjump, isJump, extractLinks, extractImages, extractVideos, extractTables, focusText, parseBiliSearch, parseBaiduImages, normUrl, isCn, isVideo, harvest, newsToday, xwlb, videoSearch, imageSearch, parseImages, dayPats, siteName, CN_SITES, parseBing, parseH3, publicUrl, realUrl, extractHtml, scrub, ENGINES, _cache: CACHE, _recent: recent };
