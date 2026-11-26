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
      const r = e.parse(html).filter((x) => !o.cnOnly || isCn(x.url));
      if (r.length) return r.slice(0, o.n || 6).map((x) => ({ ...x, ...(e.name ? { engine: e.name } : {}) }));
      if (o.cnOnly) { last = new Error("没搜到国内网站的结果"); continue; }
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
// ---------- 只看国内媒体 ----------
//   .cn 结尾的（人民网、央视、光明网、各级政府和学校……）+ 下面这些国内网站；搜到的、要读的、新闻、图片、视频都只认这些
const CN_SITES = ["xinhuanet.com", "news.cn", "cctv.com", "cctv.cn", "cntv.cn", "chinanews.com", "thepaper.cn", "ifeng.com", "sina.com.cn", "sina.cn", "qq.com", "163.com", "sohu.com",
  "huanqiu.com", "chinadaily.com.cn", "caixin.com", "yicai.com", "jiemian.com", "guancha.cn", "cls.cn", "36kr.com", "ithome.com", "bjnews.com.cn", "zhihu.com", "bilibili.com", "b23.tv",
  "ixigua.com", "toutiao.com", "baidu.com", "kankanews.com", "eastmoney.com", "stcn.com", "21jingji.com", "jfdaily.com", "xinmin.cn", "ynet.com", "dzwww.com", "youku.com", "iqiyi.com",
  "douyin.com", "kuaishou.com", "weibo.com", "csdn.net", "cnblogs.com", "juejin.cn", "oschina.net", "gitee.com", "runoob.com", "jianshu.com", "douban.com", "zol.com.cn", "pconline.com.cn",
  "people.com.cn", "gmw.cn", "ce.cn", "cri.cn", "cnr.cn", "youth.cn", "workercn.cn", "china.com.cn", "china.com", "hupu.com", "autohome.com.cn", "dxy.cn", "guokr.com", "smzdm.com", "mydrivers.com"];
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
// 视频：搜国内视频网站的结果（加「视频」两个字去搜，只留视频网站的）
async function videoSearch(q, o = {}) {
  const r = await search(String(q || "").trim() + " 视频", { ...o, cnOnly: true, n: 12 });
  const v = r.filter((x) => isVideo(x.url));
  if (!v.length) throw new Error("没搜到国内视频网站上的视频");
  return v.slice(0, o.n || 6).map((x) => ({ ...x, source: siteName(x.url) }));
}
// 图片：必应图片（国内版）的结果，只要图片所在网页是国内网站的；显示用必应的缩略图（国内能打开）
function parseImages(html) {
  const out = [];
  for (const m of String(html).matchAll(/\bm="(\{[^"]+\})"/g)) {
    let j; try { j = JSON.parse(unent(m[1])); } catch (e) { continue; }
    if (!j.murl || !j.purl) continue;
    out.push({ title: text(j.t || "").slice(0, 80), img: j.murl, thumb: j.turl || j.murl, page: j.purl });
  }
  return out;
}
async function imageSearch(q, o = {}) {
  q = scrub(String(q || "").trim().slice(0, 100));
  if (!q) throw new Error("要找什么图片");
  const { html } = await get((o.imageBase || "https://cn.bing.com/images/search?form=HDRSC2&first=1&q=") + encodeURIComponent(q), { ...o, cacheMs: o.cacheMs != null ? o.cacheMs : 10 * 60e3 });
  const r = parseImages(html).filter((x) => isCn(x.page) && publicUrl(x.img) && publicUrl(x.thumb));
  if (!r.length) throw new Error("没找到国内网站上的图片");
  return r.slice(0, Math.max(1, Math.min(12, +o.n || 8))).map((x) => ({ ...x, source: siteName(x.page) }));
}

// 给捞小智的工具：搜网页、读网页（只认国内网站），今天的新闻、新闻联播、找图片、找视频
function tools(o = {}) {
  o = { cnOnly: true, ...o };
  const cnRead = (u) => { if (o.cnOnly && !isCn(u)) throw new Error("只读国内网站（.cn 和国内的新闻、视频、技术网站）"); return read(u, o); };
  return [
    { name: "web_search", desc: "联网搜索：问到新闻、最近发生的事、现在的价格 / 排名 / 政策、你不确定的事实时，先搜一下再回答。返回几条结果（标题、网址、摘要）", params: { query: { type: "string", description: "搜索词：简短的几个关键词" } }, req: ["query"],
      say: (a) => `联网搜索「${String(a.query || "").slice(0, 30)}」`, run: async (a) => { const r = await search(a.query, o); return { results: r, tip: "摘要不够就用 read_page 读其中一两个网页的正文；回答最后写「来源：网站名」" }; } },
    { name: "read_page", desc: "读一个网页的正文（web_search 搜到的网址）", params: { url: { type: "string" } }, req: ["url"],
      say: (a) => { let h = ""; try { h = new URL(a.url).hostname; } catch (e) {} return `读网页 ${h}`; }, run: async (a) => cnRead(a.url) },
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
const RE_NEWS = /新闻|热点|头条|时事|要闻|快讯|今天发生|今天.*(大事|消息)|联播|资讯/;
const RE_VIDEO = /视频|播放|看.*(片|录像|直播)|联播|B ?站|哔哩/i;
const RE_IMAGE = /图片|照片|图像|长什么样|配图|找.*图|壁纸/;
module.exports = { search, read, tools, isCn, isVideo, harvest, newsToday, xwlb, videoSearch, imageSearch, parseImages, dayPats, siteName, CN_SITES, parseBing, parseH3, publicUrl, realUrl, extractHtml, scrub, ENGINES, _cache: CACHE, _recent: recent };
