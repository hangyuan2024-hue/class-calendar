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
  assert.deepEqual(t.map((x) => x.name), ["web_search", "read_page", "news_today", "news_video", "video_search", "image_search"]);
  W._cache.clear();
  const rr = (await t[0].run({ query: "比赛" })).results;
  assert.deepEqual(rr.map((x) => x.url), ["https://news.example.cn/2026/a.html"], "只留国内网站的结果");
  await assert.rejects(() => t[1].run({ url: "https://b.example.com/x" }), /只读国内网站/);
  assert.ok(!t[2].when("鸡兔同笼怎么算") && t[2].when("今天有什么新闻") && t[5].when("找几张熊猫的图片") && t[4].when("有没有讲递归的视频"));
  ok("给捞小智的工具：搜网页、读网页只认国内网站；新闻、视频、图片的工具只在说到时才带上");

  // 今天的新闻：各家首页上网址带今天 / 昨天日期的文章；同标题只留一条；轮着挑；前几条读正文
  W._cache.clear();
  const NOW = new Date(2026, 10, 27, 9, 0);
  const homes = {
    "https://www.news.cn/": `<a href="/politics/20261127/abc/c.html">国务院常务会议研究部署冬季安全生产工作</a><a href="/tech/20261126/x/c.html">我国成功发射新一代通信卫星一颗</a><a href="/2025/old.html">去年的旧闻旧闻旧闻旧闻</a><a href="https://evil.example.com/20261127/a.html">外国网站的今日新闻标题</a><a href="/edu/20261127/e/c.html">教育部发布高校毕业生就业新举措</a>`,
    "http://www.people.com.cn/": `<a href="http://edu.people.com.cn/n1/2026/1127/c1006-1.html">教育部发布高校毕业生就业新举措</a><a href="http://tech.people.com.cn/n1/2026/1127/c1007-2.html">人工智能赋能千行百业的新进展</a><a href="/more/">更多新闻更多新闻更多</a>`,
    "https://news.cctv.com/": `<a href="https://news.cctv.com/2026/11/27/ARTIabc.shtml">寒潮来袭多地气温骤降需注意保暖</a>`,
  };
  const art = "<html><title>t</title><article><p>" + "这是一篇新闻的正文内容。".repeat(30) + "</p></article></html>";
  const f2 = async (u) => {
    const b = homes[u] || (/news\.cn|people\.com\.cn|cctv\.com/.test(u) ? art : null);
    if (b == null) return { ok: false, status: 404, headers: { get: () => "" } };
    return { ok: true, status: 200, url: u, headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => Buffer.from(b) };
  };
  const news = await W.newsToday({ n: 10, read: 2 }, { fetch: f2, now: () => NOW, newsHomes: [{ name: "新华网", url: "https://www.news.cn/" }, { name: "人民网", url: "http://www.people.com.cn/" }, { name: "央视网", url: "https://news.cctv.com/" }, { name: "打不开的", url: "https://down.example.cn/" }] });
  const titles = news.map((x) => x.title);
  assert.ok(titles.includes("国务院常务会议研究部署冬季安全生产工作") && titles.includes("寒潮来袭多地气温骤降需注意保暖") && titles.includes("我国成功发射新一代通信卫星一颗"));
  assert.ok(!titles.some((x) => /旧闻|外国网站|更多/.test(x)), titles.join("|"));
  assert.equal(titles.filter((x) => x === "教育部发布高校毕业生就业新举措").length, 1, "同标题只留一条");
  assert.equal(news[news.length - 1].when, "昨天", "今天的排前面");
  assert.deepEqual(news.slice(0, 3).map((x) => x.source), ["新华网", "人民网", "央视网"], "各家轮着挑");
  assert.ok(news[0].text && news[0].text.length <= 700 && !news[3].text);
  const edu = await W.newsToday({ topic: "教育", read: 0 }, { fetch: f2, now: () => NOW, newsHomes: [{ name: "新华网", url: "https://www.news.cn/" }] });
  assert.deepEqual(edu.map((x) => x.title), ["教育部发布高校毕业生就业新举措"]);
  ok("今天的新闻：几家国内媒体首页上今天 / 昨天的文章，同标题去重、各家轮着挑、前几条带正文；能按方面筛；外国网站、旧闻不要");

  // 新闻联播、图片、视频
  W._cache.clear();
  const tv = `<a href="https://tv.cctv.com/2026/11/26/VIDEabc.shtml">《新闻联播》 20261126 19:00</a><a href="https://tv.cctv.com/2026/11/20/VIDEold.shtml">《新闻联播》 20261120 19:00</a>`;
  const imgs = `<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.cn/panda.jpg&quot;,&quot;turl&quot;:&quot;https://tse1.mm.bing.net/th?id=1&quot;,&quot;purl&quot;:&quot;https://www.news.cn/panda.html&quot;,&quot;t&quot;:&quot;大熊猫&quot;}"></a><a class="iusc" m="{&quot;murl&quot;:&quot;https://x.example.com/a.jpg&quot;,&quot;turl&quot;:&quot;https://tse1.mm.bing.net/th?id=2&quot;,&quot;purl&quot;:&quot;https://x.example.com/a&quot;}"></a>`;
  const serp2 = `<ol><li class="b_algo"><h2><a href="https://www.bilibili.com/video/BV1xx">递归讲解 视频</a></h2><p>B 站</p></li><li class="b_algo"><h2><a href="https://www.runoob.com/recursion.html">递归教程</a></h2><p>文字</p></li><li class="b_algo"><h2><a href="https://www.youtube.com/watch?v=1">外网视频</a></h2><p>x</p></li></ol>`;
  const f3 = async (u) => {
    const b = u === "https://tv.cctv.com/lm/xwlb/" ? tv : /images\/search/.test(u) ? imgs : /bing\.com\/search/.test(u) ? serp2 : null;
    if (b == null) return { ok: false, status: 404, headers: { get: () => "" } };
    return { ok: true, status: 200, url: u, headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => Buffer.from(b) };
  };
  const xw = await W.xwlb({ fetch: f3, now: () => NOW });
  assert.deepEqual(xw.map((x) => x.url), ["https://tv.cctv.com/2026/11/26/VIDEabc.shtml"]); assert.equal(xw[0].when, "昨天");
  const im = await W.imageSearch("大熊猫", { fetch: f3 });
  assert.deepEqual(im.map((x) => x.page), ["https://www.news.cn/panda.html"]); assert.equal(im[0].thumb, "https://tse1.mm.bing.net/th?id=1"); assert.equal(im[0].source, "新华网");
  W._recent.length = 0;
  const vs = await W.videoSearch("递归", { fetch: f3 });
  assert.deepEqual(vs.map((x) => x.url), ["https://www.bilibili.com/video/BV1xx"]); assert.equal(vs[0].source, "哔哩哔哩");
  ok("新闻联播（央视网今天 / 昨天那期）、找图片（只要国内网页上的）、找视频（只要国内视频网站的）");
  console.log("联网搜索：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
