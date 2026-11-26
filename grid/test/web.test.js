// 捞小智联网搜索（pptassist/core/websearch.js）：解析搜索结果（必应的跳转链接解出真网址）、读网页正文（GBK 也行）、不读本机和内网
"use strict";
const assert = require("assert");
const W = require("../app/ppt/websearch");
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
  assert.deepEqual(t.map((x) => x.name), ["web_search", "read_page", "crawl_site", "news_today", "news_video", "video_search", "image_search"]);
  const T = (n) => t.find((x) => x.name === n);
  W._cache.clear();
  const rr = (await T("web_search").run({ query: "比赛" })).results;
  assert.deepEqual(rr.map((x) => x.url), ["https://news.example.cn/2026/a.html"], "只留国内网站的结果");
  await assert.rejects(() => T("read_page").run({ url: "https://b.example.com/x" }), /只读国内网站/);
  assert.ok(!T("news_today").when("鸡兔同笼怎么算") && T("news_today").when("今天有什么新闻") && T("image_search").when("找几张熊猫的图片") && T("video_search").when("有没有讲递归的视频") && T("crawl_site").when("去教务处官网看看") && !T("crawl_site").when("鸡兔同笼"));
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

  // ---------- 通用抓取引擎 ----------
  {
    W._cache.clear(); W._recent.length = 0;
    const bing = `<ol><li class="b_algo"><h2><a href="https://www.runoob.com/cprogramming/c-tutorial.html">C 语言教程 | 菜鸟教程</a></h2><p>C 语言是一种通用的编程语言</p></li><li class="b_algo"><h2><a href="https://en.example.com/c">English C</a></h2><p>x</p></li></ol>`;
    const baidu = `<div class="result c-container xpath-log new-pmd" mu="https://www.runoob.com/cprogramming/c-tutorial.html"><h3 class="t"><a href="http://www.baidu.com/link?url=AAA">C 语言教程 菜鸟</a></h3><span class="content-right_8Zs40">菜鸟教程的 C 语言入门</span></div>
      <div class="result c-container new-pmd"><h3 class="t"><a href="http://www.baidu.com/link?url=BBB">C语言程序设计 - 中国大学MOOC</a></h3><div class="c-abstract">浙江大学 翁恺</div></div>`;
    const so = `<h3 class="res-title"><a href="https://www.so.com/link?m=CCC" data-mdurl="https://blog.csdn.net/x/article/details/1">C语言指针详解_CSDN</a></h3><p class="res-desc">指针是 C 语言的灵魂</p>`;
    const pages = {
      "http://www.baidu.com/link?url=BBB": { status: 302, loc: "https://www.icourse163.org/course/ZJU-9001" },
      "https://www.icourse163.org/course/ZJU-9001": { body: `<html><head><title>C语言程序设计</title><meta name="description" content="浙江大学翁恺老师的 C 语言课"></head><body><div id="app"></div><script>render()</script></body></html>` },
      "https://www.runoob.com/cprogramming/c-tutorial.html": { body: `<html><title>C 语言教程</title><body><article><h1>C 语言教程</h1><p>C 语言是一种通用的、面向过程式的计算机程序设计语言。1972 年，为了移植与开发 UNIX 操作系统，丹尼斯·里奇在贝尔电话实验室设计开发了 C 语言。</p><p>指针是 C 语言里最重要的概念之一：指针变量存的是地址。</p><p>数组名在大多数表达式里会变成指向第一个元素的指针。</p><p>学习 C 语言之前，最好先装好编译器，比如 GCC。这里有很多例子可以直接运行，边看边练最快。</p></article>
        <a href="/cprogramming/c-pointers.html">C 指针</a><a href="/cprogramming/c-arrays.html">C 数组</a><a href="/cprogramming/c-functions.html">C 函数</a><a href="https://www.runoob.com/python/python-tutorial.html">Python 教程</a><a href="javascript:void(0)">无</a>
        <img src="/images/c-logo-big.png" alt="C 语言" width="400"><img src="/icon.png" width="16"><iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>
        <table><tr><th>类型</th><th>字节</th></tr><tr><td>int</td><td>4</td></tr><tr><td>char</td><td>1</td></tr></table></body></html>` },
      "https://www.runoob.com/cprogramming/c-pointers.html": { body: `<html><title>C 指针</title><article><p>每一个变量都有一个内存位置，每一个内存位置都定义了可使用 &amp; 运算符访问的地址。指针是一个变量，其值为另一个变量的地址。这一页讲指针的声明和使用，还有空指针。</p></article></html>` },
      "https://www.runoob.com/cprogramming/c-arrays.html": { body: `<html><title>C 数组</title><article><p>数组可以存储一个固定大小的相同类型元素的顺序集合。数组名和指针关系很密切，这一页讲数组的声明、初始化和访问元素，也讲到多维数组。</p></article></html>` },
      "https://example.cn/doc.docx": { ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", raw: null },
      "https://search.bilibili.com/all?keyword=C%E8%AF%AD%E8%A8%80%E6%95%99%E7%A8%8B": { body: `<div><a href="//www.bilibili.com/video/BV1q54y1q79w/" title="C语言教程 从入门到精通（翁恺）">x</a><a href="//www.bilibili.com/video/BV1q54y1q79w/">重复的</a></div>` },
      "https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ie=utf-8&oe=utf-8&pn=0&rn=30&word=C%E8%AF%AD%E8%A8%80": { body: JSON.stringify({ data: [{ thumbURL: "https://img1.baidu.com/it/u=1.jpg", fromPageTitleEnc: "C语言入门", replaceUrl: [{ ObjURL: "https://pic.example.cn/c.png", FromURL: "https://www.runoob.com/c.html" }] }, {}] }) },
    };
    pages["https://example.cn/doc.docx"].raw = await require("../app/ppt/files").docx("# 作业\n\n- 指针练习三道");
    const f4 = async (u, opt = {}) => {
      if (/cn\.bing\.com\/search/.test(u)) return { ok: true, status: 200, url: u, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from(bing) };
      if (/www\.baidu\.com\/s\?/.test(u)) return { ok: true, status: 200, url: u, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from(baidu) };
      if (/www\.so\.com\/s\?/.test(u)) return { ok: true, status: 200, url: u, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from(so) };
      const p = pages[u]; if (!p) return { ok: false, status: 404, url: u, headers: { get: () => "" }, arrayBuffer: async () => Buffer.from("") };
      if (p.status === 302) return { ok: false, status: 302, url: u, headers: { get: (k) => (k === "location" ? p.loc : "") }, arrayBuffer: async () => Buffer.from("") };
      return { ok: true, status: 200, url: u, headers: { get: () => p.ct || "text/html; charset=utf-8" }, arrayBuffer: async () => p.raw || Buffer.from(p.body) };
    };
    const rendered = [];
    const render = async (u) => { rendered.push(u); if (/icourse163/.test(u)) return { url: u, html: `<html><title>C语言程序设计_中国大学MOOC</title><main><p>本课程是浙江大学翁恺老师主讲的 C 语言入门课，一共 12 周，从变量、判断、循环讲到指针和链表，配有大量练习和在线测验，适合零基础的同学。</p></main></html>` }; throw new Error("x"); };
    const r = await W.search("C语言教程", { fetch: f4, cnOnly: true, render });
    const urls = r.map((x) => x.url);
    assert.equal(urls[0], "https://www.runoob.com/cprogramming/c-tutorial.html", "两家都搜到的排第一：" + urls.join(","));
    assert.ok(r[0].engine.includes("必应") && r[0].engine.includes("百度"));
    assert.ok(urls.includes("https://www.icourse163.org/course/ZJU-9001"), "百度的跳转链接解开了");
    assert.ok(urls.includes("https://blog.csdn.net/x/article/details/1"), "360 的真网址从 data-mdurl 拿");
    assert.ok(!urls.some((u) => /example\.com|baidu\.com\/link|so\.com\/link/.test(u)), "外国网站、没解开的跳转都不要");
    ok("搜索：必应、百度、360 一起搜，合并去重（几家都搜到的排前面）；解开百度的跳转链接、用 360 的 data-mdurl；只留国内网站");

    const pg = await W.read("https://www.icourse163.org/course/ZJU-9001", { fetch: f4, render });
    assert.ok(pg.rendered && /翁恺老师主讲/.test(pg.text), "网页是空壳：用看不见的浏览器打开再读");
    const rp = await W.read("https://www.runoob.com/cprogramming/c-tutorial.html", { fetch: f4, want: "all", focus: "指针" });
    assert.ok(/指针变量存的是地址/.test(rp.text) && !/^C 语言教程/.test(rp.text), "focus：只要和「指针」有关的段落（带上前后各一段）：" + rp.text);
    assert.ok(rp.links.some((l) => l.text === "C 指针" && l.url === "https://www.runoob.com/cprogramming/c-pointers.html") && !rp.links.some((l) => /javascript/.test(l.url)));
    assert.deepEqual(rp.images.map((x) => x.src), ["https://www.runoob.com/images/c-logo-big.png"], "小图标不要");
    assert.ok(rp.videos.some((v) => /player\.bilibili\.com/.test(v.url)));
    assert.match(rp.tables[0], /\| int \| 4 \|/);
    const dc = await W.read("https://example.cn/doc.docx", { fetch: f4 });
    assert.match(dc.text, /指针练习三道/); assert.equal(dc.file, "docx");
    ok("读网页：空壳网页用浏览器打开再读；只要相关段落；顺带链接、图片、视频、表格；Word / PDF 链接也能读");

    const cs = await W.crawlSite("https://www.runoob.com/cprogramming/c-tutorial.html", "指针 数组", { fetch: f4, max: 3 });
    const got = cs.pages.map((x) => x.url);
    assert.equal(cs.site, "runoob.com");
    assert.ok(got.includes("https://www.runoob.com/cprogramming/c-pointers.html") && got.includes("https://www.runoob.com/cprogramming/c-arrays.html"), got.join(","));
    assert.ok(!got.some((u) => /python/.test(u)), "和要找的对不上的不读");
    ok("顺着网站找：读首页、挑链接文字对得上的几页一起读（不相干的不读）");

    W._cache.clear(); W._recent.length = 0;
    const vs = await W.videoSearch("C语言教程", { fetch: f4, render });
    assert.ok(vs.some((v) => v.url === "https://www.bilibili.com/video/BV1q54y1q79w" && /翁恺/.test(v.title)), JSON.stringify(vs));
    assert.equal(vs.filter((v) => /BV1q54y1q79w/.test(v.url)).length, 1, "去重");
    const im = await W.imageSearch("C语言", { fetch: f4 });
    assert.ok(im.some((x) => x.thumb === "https://img1.baidu.com/it/u=1.jpg" && x.page === "https://www.runoob.com/c.html"));
    ok("找视频：B 站自己的搜索页 + 搜索网站一起找；找图片：必应 + 百度图片");

    // 搜索网站都只给了验证页：用浏览器打开搜索页再找
    W._cache.clear(); W._recent.length = 0;
    const cap = async (u) => ({ ok: true, status: 200, url: u, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from("<html>请输入验证码 安全验证</html>") });
    const r2 = await W.search("C语言", { fetch: cap, cnOnly: true, render: async (u) => ({ url: u, html: /bing/.test(u) ? bing : "<html></html>" }) });
    assert.equal(r2[0].url, "https://www.runoob.com/cprogramming/c-tutorial.html");
    await assert.rejects(() => W.search("C语言", { fetch: cap, cnOnly: true }), /要人机验证/);
    ok("搜索网站给了验证页：用看不见的浏览器真打开一遍再找；还不行就说清楚是被要求验证了");
  }
  console.log("联网搜索：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
