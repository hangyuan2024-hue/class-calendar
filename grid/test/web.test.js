// 捞小智联网搜索（pptassist/core/websearch.js）：解析搜索结果（必应的跳转链接解出真网址）、读网页正文（GBK 也行）、不读本机和内网
"use strict";
const assert = require("assert");
const W = require("../../pptassist/core/websearch");
const ok = (m) => console.log("✓", m);
(async () => {
  const b64 = Buffer.from("https://news.example.cn/2026/a.html").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const serp = `<html><ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1${b64}&amp;ntb=1">2026 年 <strong>比赛</strong>结果</a></h2><div class="b_caption"><p>2026年11月21日 · 第一名是 &quot;捞捞队&quot;</p></div></li>
    <li class="b_algo"><h2><a href="http://192.168.1.5/admin">内网</a></h2><p>不该出现</p></li><li class="b_algo"><h2><a href="https://b.example.com/x">第二条</a></h2><p>摘要二</p></li></ol></html>`;
  const gbk = Buffer.from([0x3c,0x74,0x69,0x74,0x6c,0x65,0x3e,0xd6,0xd0,0xce,0xc4,0x3c,0x2f,0x74,0x69,0x74,0x6c,0x65,0x3e]);   // <title>中文</title>（GBK）
  const pages = {
    "https://news.example.cn/2026/a.html": { ct: "text/html; charset=utf-8", body: Buffer.from("<html><head><title>比赛新闻</title><script>var x=1</script></head><body><nav>导航</nav><article><p>捞捞队拿了第一名。</p><p>评委说作品很完整，联网搜索、讲题、做 PPT 都能用。</p>" + "<p>补充内容。</p>".repeat(40) + "</article><footer>版权</footer></body></html>") },
    "https://gbk.example.cn/": { ct: "text/html; charset=gb2312", body: Buffer.concat([gbk, Buffer.from("<p>")]) },
  };
  const fetch = async (u) => {
    if (/bing\.com\/search/.test(u)) return { ok: true, status: 200, url: u, headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => Buffer.from(serp) };
    const p = pages[u]; if (!p) return { ok: false, status: 404, headers: { get: () => "" } };
    return { ok: true, status: 200, url: u, headers: { get: () => p.ct }, arrayBuffer: async () => p.body };
  };
  const r = await W.search("2026 比赛结果", { fetch });
  assert.deepEqual(r.map((x) => x.url), ["https://news.example.cn/2026/a.html", "https://b.example.com/x"]);
  assert.equal(r[0].title, "2026 年 比赛结果"); assert.equal(r[0].snippet, "第一名是 \"捞捞队\"");
  ok("搜索：必应的跳转链接解出真网址，日期前缀去掉，内网地址的结果丢掉");
  const pg = await W.read("https://news.example.cn/2026/a.html", { fetch });
  assert.equal(pg.title, "比赛新闻"); assert.match(pg.text, /^捞捞队拿了第一名。/); assert.ok(!/导航|版权|var x/.test(pg.text)); assert.ok(pg.text.length <= 5000);
  assert.equal((await W.read("https://gbk.example.cn/", { fetch })).title, "中文");
  ok("读网页：只要正文（去掉脚本、导航、页脚），GBK 编码的中文网页也认得，最多 5000 字");
  for (const u of ["http://127.0.0.1:8787/api", "http://localhost/", "file:///C:/x", "http://10.0.0.2/"]) await assert.rejects(() => W.read(u, { fetch }), /公开的网页/);
  ok("不读本机、内网、本地文件");
  const t = W.tools({ fetch });
  assert.deepEqual(t.map((x) => x.name), ["web_search", "read_page"]);
  assert.ok((await t[0].run({ query: "比赛" })).results.length === 2);
  ok("给捞小智的两个工具：web_search、read_page");
  console.log("联网搜索：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
