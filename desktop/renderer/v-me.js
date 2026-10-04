// 我的：资料和个人主页、账号安全（改密码）、邮箱通知、手机日历订阅、数据和备份、趣味设置、功能介绍、感谢名单
"use strict";
const INTRO_DEFAULT = [
  { id: "desktop", icon: "💻", title: "电脑版", tag: "Windows 软件", body: "电脑版是独立的 Windows 软件，和网页、手机用同一个账号。\n- **托盘常驻**：关掉窗口缩到右下角，上课前、截止前准时提醒\n- **Ctrl+Alt+空格**：在任何软件里一句话记一件事\n- **复制群消息自动识别**：在微信、QQ 里复制了作业通知，右下角会提示一键整理\n- **任务栏**：图标上显示今天还剩几件事，右键能直接记事、专注\n- 课程表壁纸、导出 PDF、作业附件、倒数日、每周报告、自动备份、内置离线 AI" },
  { id: "start", icon: "👋", title: "这是什么网站", tag: "一分钟了解", body: "班级群消息太多、太乱？**捞捞课程表**把群里的作业、通知、活动整理成一本日历，谁都能一眼看清「什么时候、要做什么」。\n- 班委把群消息粘贴进来，AI 自动整理成事项\n- 同学打开就能看到本周作业、今天的安排\n- 换手机、换浏览器，登录同一个账号数据都在" },
  { id: "home", icon: "🏠", title: "首页", tag: "今天要做什么", body: "首页按「今天、明天、这周」列出接下来两周的安排，过期没交的作业会单独提醒。\n- 点左边的圆圈就是完成，会有鼓励动画\n- 「隐藏已完成」可以让列表更清爽，「清理」能一键删掉自己已完成的事\n- 「自定义首页」可以拖动卡片、调大小，放上课程表、番茄钟、排行榜" },
  { id: "hw", icon: "📝", title: "作业", tag: "按截止时间排好", body: "一周的作业按截止时间排序，显示「还剩几天」，没交的过期作业也会列出来。可以切换上一周、下一周。" },
  { id: "cal", icon: "📅", title: "日历与「记一件事」", tag: "班级事项 + 自己的事", body: "日历里能看到整个月的安排，点某一天在右边看详情，**双击日期**可以直接在那天加事项。\n- 「记一件事」用来记自己的事，只有你看得到\n- 可以不填日期，当作待办\n- 能一键加到手机日历，班委新发的事项会自动同步过去" },
  { id: "wall", icon: "💬", title: "班级墙", tag: "全班的留言板", body: "全班同学和老师都能发言、评论、回复。老师和班委可以发通知、置顶。\n- 点名字或头像能进入对方的个人主页\n- 遇到不友善的内容可以举报，只有老师能看到是谁举报的" },
  { id: "plan", icon: "🎯", title: "规划 · 时间管理", tag: "四象限、PDCA、SMART…", body: "规划页里有五种时间管理方法，每种都有简介，不会用就展开看看：\n1. 四象限法：按重要和紧急分成四类\n2. PDCA 循环：计划、执行、检查、改进\n3. SMART 目标：把目标定清楚\n4. 六件事法：每天只排最重要的 6 件\n5. 番茄工作法：专注 25 分钟、休息 5 分钟" },
  { id: "growth", icon: "🔥", title: "成长与排行榜", tag: "坚持看得见", body: "完成作业、习惯打卡、专注番茄钟都会攒成长值，班级排行榜按周、月、总榜排名。不想上榜可以设为匿名或不参加。" },
  { id: "course", icon: "📚", title: "课程表", tag: "拍照导入", body: "在「工具」里打开课程表，拍一张课表照片就能自动识别，还会越用越准。每天晚上可以发邮件提醒明天的课。" },
  { id: "meta", icon: "🌐", title: "捞捞元宇宙", tag: "另一种风格", body: "首页右上角「进入捞捞元宇宙」可以换成霓虹科幻风格。元宇宙空间里有你的等级、每日任务、成就徽章，还有元宇宙小百科。" },
  { id: "me", icon: "👤", title: "我的 · 个人主页", tag: "资料、外观、数据", body: "- 编辑资料：性别、个性签名、主页封面\n- 外观：元气、简约、夜间、元宇宙四种风格，十几种配色，还能换背景图\n- 数据：选择云端同步还是只存在这台设备\n- 账号安全：修改密码；绑定邮箱后忘记密码可以自己找回" },
  { id: "faq", icon: "❓", title: "常见问题", tag: "", body: "**忘记密码怎么办？** 绑定过邮箱的，在登录页点「忘记密码」；没绑的请找班主任，在你的个人主页重置。\n**换了手机数据还在吗？** 登录同一个账号就在（「我的 → 保存位置」选云端同步）。\n**事项和群里说的不一样？** 以群里为准，可以在事项上加备注，或者告诉班委修改。" },
];

const MAIL_KINDS = [["new_items", "📣 班级发布新事项", "班委、老师发布作业和通知时"], ["due", "⏰ 作业截止前一晚提醒", "每天晚上 7 点后，明天要交还没勾完成的作业"], ["wall", "📌 班级墙通知", "老师、班委在班级墙发的通知"], ["report", "🚩 有人举报", "班级墙有新举报时（老师）"], ["course", "📚 明天的课", "每天晚上 7 点后，把明天的课发给你"]];
App.views.me = {
  title: "我的", icon: "me", tab: "home", sec: null, mail: null, feed: null, intro: null, introEdit: null, credits: null, creditEdit: null, cool: 0,
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>我的</h1><div class="sub">资料、账号、通知和数据</div></div><span class="grow"></span>
        <div class="seg" id="meTabs"><button data-t="home" class="on">我的</button><button data-t="intro">功能介绍</button><button data-t="credits">感谢名单</button></div></div>
      <div class="vbody"><div class="me-wrap" id="meBox"></div></div>`;
    $("#meTabs", el).onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; this.tab = b.dataset.t; $$("#meTabs button", el).forEach((x) => x.classList.toggle("on", x === b)); this.load(); };
    el.addEventListener("click", (e) => this.click(e));
    el.addEventListener("change", (e) => this.change(e));
    el.addEventListener("input", (e) => this.input(e));
  },
  show(arg) { if (arg && arg.tab) { this.tab = arg.tab; $$("#meTabs button", this.el).forEach((x) => x.classList.toggle("on", x.dataset.t === this.tab)); } this.load(); },
  update() { if (this.tab === "home" && !this.el.contains(document.activeElement)) this.draw(); },
  async load() {
    if (this.tab === "home") {
      this.draw();
      const [sec, mail] = await Promise.all([api("account_security", {}, true).catch(() => null), api("mail_my", {}, true).catch(() => null)]);
      this.sec = sec; this.mail = mail; this.draw();
    } else if (this.tab === "intro") {
      try { this.intro = await api("intro_get", {}, true); } catch (e) { this.intro = { sections: [], can_edit: false }; }
      this.draw();
      if (this.intro.is_admin) this.loadEditors();
    } else {
      try { this.credits = (await api("credit_list", {}, true)) || []; } catch (e) { this.credits = null; }
      this.draw();
    }
  },
  draw() {
    const box = $("#meBox", this.el); if (!box) return;
    if (this.tab === "intro") return this.introEdit ? this.drawIntroEdit() : this.drawIntro();
    if (this.tab === "credits") return this.drawCredits();
    const S = App.S, me = S.me || {}, st = S.settings, f = App.fun(), g = me.gender || (KV("profile_v1") || {}).gender, s = this.sec, m = this.mail;
    const sw = (on, attr) => `<button class="switch${on ? " on" : ""}" ${attr}></button>`;
    box.innerHTML = `
      <div class="card me-top"><div class="me-cv" style="background:${coverOf(me.cover, g)}"></div>
        <div class="me-row">${avHtml(me.display_name || me.account, "xl")}<div><b class="me-n">${esc(me.display_name || "")}${gIco(g)}</b><div class="muted">${esc(({ admin: "管理员", developer: "开发者", tester: "测试员", teacher: "老师", student: "学生" })[me.role] || me.role || "")} · @${esc(me.account || "")}</div>
          <div class="me-bio${me.bio ? "" : " muted"}">${me.bio ? esc(me.bio) : "还没有个性签名，写一句介绍自己吧"}</div></div><span class="grow"></span>
          <button class="btn" data-a="prof">✏️ 编辑资料</button><button class="btn primary" data-a="page">我的主页 ›</button></div></div>
      <div class="me-cols">
        <div>
          <section class="card st-card"><h3>账号安全</h3>
            <div class="st-row"><div><b>修改密码</b><small>改完以后，其他设备上的登录会失效</small></div><div class="st-ctl"><button class="btn" data-a="pw">🔑 修改密码</button></div></div>
            <div class="st-row"><div><b>找回密码用的邮箱</b><small>${s && s.email ? `已绑定 ${esc(s.email)}，忘记密码可以在登录页自己找回` : s && !s.smtp ? "管理员还没开通邮件发送；忘记密码时请找老师重置" : "还没绑定。绑定后忘记密码可以自己用邮箱找回"}</small></div><div class="st-ctl">${s && s.email ? `<span class="tag" style="--c:var(--ok)">✓ 已绑定</span>` : ""}</div></div>
            <div class="st-row"><div><b>没绑邮箱也别担心</b><small>班主任可以在你的个人主页给你重置一个临时密码</small></div></div>
          </section>
          <section class="card st-card" id="meMail"><h3>邮箱通知 <small>重要的事发到邮箱，电脑关着也不会漏</small></h3>${this.mailHtml()}</section>
          <section class="card st-card"><h3>加到手机日历 <small>订阅后班级事项自动出现在手机、Outlook 日历里</small></h3>
            <div id="meFeed">${this.feed ? this.feedHtml() : `<div class="st-row"><div><b>专属订阅链接</b><small>只包含班级事项，日历 App 会定时自动刷新</small></div><div class="st-ctl"><button class="btn" data-a="feed">获取链接</button></div></div>`}</div>
            <div class="st-row"><div><b>一次性导出</b><small>生成 .ics 文件，可以导入 Outlook、Windows 日历、手机日历</small></div><div class="st-ctl"><button class="btn" data-a="ics">${icon("export")}导出 .ics</button></div></div></section>
        </div>
        <div>
          <section class="card st-card"><h3>数据和备份</h3>
            <div class="st-row"><div><b>云端同步</b><small>${S.lastRefresh ? "上次同步 " + whenStr(S.lastRefresh) : "还没同步过"}${S.pending ? ` · ${S.pending} 条改动等着上传` : ""} · 我的事项、打卡、规划、心情、倒数日都会同步</small></div><div class="st-ctl"><button class="btn" data-a="sync">${icon("sync")}立即同步</button></div></div>
            <div class="st-row"><div><b>每天自动备份到「文档」</b><small>文档 / 捞捞课程表备份，留最近 14 份，可以随时恢复</small></div><div class="st-ctl">${sw(st.autoBackup, 'data-set="autoBackup"')}</div></div>
            <div class="st-row"><div><b>备份</b><small id="meBk">点「查看备份」看看有哪些</small></div><div class="st-ctl"><button class="btn" data-a="bk-now">💾 现在备份</button><button class="btn" data-a="bk-list">查看备份</button><button class="btn ghost" data-a="bk-open">打开文件夹</button></div></div>
            <div class="st-row"><div><b>和网页版互导</b><small>网页版「我的 → 备份」导出的 .json 文件也能在这里恢复</small></div><div class="st-ctl"><button class="btn" data-a="bk-file">从文件恢复…</button></div></div>
          </section>
          <section class="card st-card"><h3>趣味</h3>
            <div class="st-row"><div><b>完成鼓励</b><small>完成事项、打卡时弹一句鼓励</small></div><div class="st-ctl"><select class="input st-sel" data-fun="cheer">${[["mascot", "表情 + 文字"], ["text", "只有文字"], ["off", "关闭"]].map(([k, t]) => `<option value="${k}"${f.cheer === k ? " selected" : ""}>${t}</option>`).join("")}</select></div></div>
            <div class="st-row"><div><b>彩纸动画</b></div><div class="st-ctl">${sw(f.confetti, 'data-fun-sw="confetti"')}</div></div>
            <div class="st-row"><div><b>习惯打卡</b><small>关掉后侧边栏不再显示「打卡」的数字</small></div><div class="st-ctl">${sw(f.habits, 'data-fun-sw="habits"')}</div></div>
            <div class="st-row"><div><b>规划 · 时间管理</b></div><div class="st-ctl">${sw(f.plan, 'data-fun-sw="plan"')}</div></div>
            <div class="st-row"><div><b>元宇宙模式</b><small>霓虹科幻风格</small></div><div class="st-ctl">${sw(st.theme === "meta", 'data-a="meta"')}</div></div>
          </section>
          <section class="card st-card"><h3>关于</h3>
            <div class="st-row"><div><b>捞捞课程表 电脑版 ${esc(S.version || "")}</b><small>和网站、手机用同一个账号</small></div><div class="st-ctl"><button class="btn ghost" data-ext="https://www.laolaokechengbiao.cn/">打开网站</button><button class="btn danger" data-a="logout">退出登录</button></div></div>
          </section>
        </div>
      </div>`;
  },
  mailHtml() {
    const m = this.mail;
    if (!m) return `<div class="muted st-row">邮箱通知还没装好，或者暂时连不上</div>`;
    if (!m.configured) return `<div class="muted st-row">管理员还没有开通邮件发送，开通后这里就能绑定邮箱。</div>`;
    if (!m.email) return `<div class="st-row"><div><b>绑定邮箱</b><small>QQ 邮箱、163 都行，我们会发验证码确认是你的</small></div><div class="st-ctl me-mail"><input class="input" id="mlAddr" type="email" placeholder="123456@qq.com" value="${esc(m.pending || "")}"><button class="btn" data-a="ml-send"${this.cool > Date.now() ? " disabled" : ""}>${this.cool > Date.now() ? "已发送" : "发验证码"}</button></div></div>
      ${m.pending ? `<div class="st-row"><div><b>验证码</b><small>已发到 ${esc(m.pending)}，15 分钟内有效，没收到看看垃圾箱</small></div><div class="st-ctl me-mail"><input class="input" id="mlCode" maxlength="6" placeholder="6 位验证码"><button class="btn primary" data-a="ml-ok">确认绑定</button></div></div>` : ""}`;
    const p = m.prefs || {};
    return `<div class="st-row"><div><b>📧 ${esc(m.email)}</b><small>已绑定</small></div><div class="st-ctl"><button class="btn sm" data-a="ml-test">发一封测试邮件</button><button class="btn sm" data-a="ml-unbind">换邮箱</button></div></div>
      ${MAIL_KINDS.filter(([k]) => k !== "report" || m.is_teacher).map(([k, t, d]) => `<div class="st-row"><div><b>${t}</b><small>${d}</small></div><div class="st-ctl"><button class="switch${p[k] !== false && (k !== "course" || p[k]) ? " on" : ""}" data-mailk="${k}"></button></div></div>`).join("")}
      ${m.recent && m.recent.length ? `<div class="me-recent muted">${m.recent.map((r) => `${esc(whenStr(r.at))} · ${esc(r.subject)} · ${r.status === "sent" ? "✓ 已发出" : r.status === "failed" ? "✗ 没发出去" : "发送中…"}`).join("<br>")}</div>` : ""}`;
  },
  feedHtml() {
    const f = this.feed;
    const https = f.url, webcal = https.replace(/^https?:\/\//, "webcal://"), outlook = "https://outlook.live.com/calendar/0/addfromweb?url=" + encodeURIComponent(https) + "&name=" + encodeURIComponent("捞捞课程表");
    return `${f.classes ? "" : `<div class="muted">⚠ 你还没有加入班级，订阅后暂时是空的，入班后会自动出现。</div>`}
      <div class="st-row"><div style="flex:1;min-width:0"><b>专属订阅链接</b><input class="input selectable" readonly value="${esc(https)}" style="margin-top:6px"><small>这个链接相当于你的身份，别发到群里；发出去了可以重置</small></div>
        <div class="st-ctl"><button class="btn" data-a="feed-copy">复制</button><button class="btn" data-ext="${esc(outlook)}">添加到 Outlook</button><button class="btn ghost danger" data-a="feed-reset">重置链接</button></div></div>
      <div class="muted me-feedhelp">iPhone：设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历 → 粘贴链接。安卓：装 ICSx⁵，添加订阅 → 粘贴链接。Google 日历：其他日历 ＋ → 通过网址添加。</div>`;
  },
  // ---------- 编辑资料：性别、签名、主页封面 ----------
  async editProfile() {
    const me = App.S.me || {}, g0 = me.gender || "x";
    let cover = me.cover || "";
    const d = h(`<form class="dialog" role="dialog"><h3>编辑资料</h3><div class="dbody">
      <div class="field">性别<div class="seg" id="pfG">${[["m", "男生"], ["f", "女生"], ["x", "保密"]].map(([k, t]) => `<button type="button" data-g="${k}" class="${g0 === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
      <label class="field">个性签名 <small class="muted" id="pfN"></small><input name="bio" maxlength="60" value="${esc(me.bio || "")}" placeholder="写一句介绍自己"></label>
      <div class="field">主页封面<div class="pf-covers">${Object.entries(COVERS).map(([k, [n, bg]]) => `<button type="button" data-cover="${k}" style="background:${bg}" class="${cover === k ? "on" : ""}"><span>${n}</span></button>`).join("")}</div></div>
      <div class="fb-err"></div></div><div class="dfoot"><span class="grow"></span><button type="button" class="btn" data-a="no">取消</button><button class="btn primary">保存</button></div></form>`);
    let gender = g0;
    d.querySelector("#pfG").onclick = (e) => { const b = e.target.closest("[data-g]"); if (!b) return; gender = b.dataset.g; $$("#pfG button", d).forEach((x) => x.classList.toggle("on", x === b)); };
    d.querySelector(".pf-covers").onclick = (e) => { const b = e.target.closest("[data-cover]"); if (!b) return; cover = b.dataset.cover; $$(".pf-covers button", d).forEach((x) => x.classList.toggle("on", x === b)); };
    const n = d.querySelector("#pfN"), bio = d.elements.bio; const cnt = () => (n.textContent = `${bio.value.length}/60`); bio.oninput = cnt; cnt();
    return new Promise((res) => {
      d.querySelector('[data-a="no"]').onclick = () => closeOverlay();
      d.onsubmit = async (e) => {
        e.preventDefault();
        try { await api("profile_update", { p_gender: gender, p_bio: bio.value.trim(), ...(cover ? { p_cover: cover } : {}) }); closeOverlay(); toast("资料已保存"); await call("refresh"); res(true); }
        catch (err) { d.querySelector(".fb-err").textContent = cleanErr(err); }
      };
      openOverlay(d, () => res(false));
    });
  },
  // ---------- 改密码（用老师给的临时密码登录后会强制改） ----------
  async changePw(forced) {
    const v = await formBox(forced ? "请设置一个新密码" : "修改密码", (forced ? [] : [{ name: "old", label: "现在的密码", type: "password", max: 72 }]).concat([{ name: "n1", label: "新密码（至少 8 位）", type: "password", max: 72 }, { name: "n2", label: "再输一次新密码", type: "password", max: 72 }]), "保存",
      { desc: forced ? "你刚才用的是老师给的临时密码，为了账号安全，请马上改成只有你知道的新密码。" : "改完以后，这台电脑不用重新登录。", check: (o) => (o.n1.length < 8 ? "新密码至少 8 位" : o.n1 !== o.n2 ? "两次输入的新密码不一样" : "") });
    if (!v) { if (forced) setTimeout(() => this.changePw(true), 300); return; }
    try { await api("pw_change", { oldpw: v.old || "", newpw: v.n1 }); toast("密码已修改 ✓"); call("refresh"); }
    catch (e) { setTimeout(() => this.changePw(forced), 300); }
  },
  async click(e) {
    const b = e.target.closest("[data-a]"), mk = e.target.closest("[data-mailk]"), fs = e.target.closest("[data-fun-sw]"), ss = e.target.closest(".switch[data-set]");
    if (ss) { call("settings", { [ss.dataset.set]: !ss.classList.contains("on") }); return; }
    if (fs) { const k = fs.dataset.funSw; kvSet("fun_opts_v1", "_", { ...(KV("fun_opts_v1") || {}), [k]: !fs.classList.contains("on") }); return; }
    if (mk) { const on = !mk.classList.contains("on"); try { this.mail = await api("mail_set_prefs", { p: { [mk.dataset.mailk]: on } }); this.draw(); toast("已保存"); } catch (err) {} return; }
    if (this.tab === "intro") return this.introClick(e);
    if (this.tab === "credits") return this.creditClick(e);
    if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === "prof") this.editProfile();
      if (a === "page") App.go("people", { uid: App.S.me.id });
      if (a === "pw") this.changePw(false);
      if (a === "sync") { await call("refresh"); toast("已同步"); }
      if (a === "ics") { const n = await call("export:ics"); if (n !== false) toast(`已导出 ${n} 件事`); }
      if (a === "feed" || a === "feed-reset") {
        if (a === "feed-reset" && !(await confirmBox("重置订阅链接？", "旧链接马上失效，已经订阅的设备需要重新订阅。", "重置", true))) return;
        const r = await api("ics_my_feed", { reset: a === "feed-reset" });
        const cfg = App.S.siteUrl || "https://br-brave-deer-5873ae6f.supabase2.aidap-global.cn-beijing.volces.com";
        this.feed = { ...r, url: r.url || `${cfg}/rest/v1/rpc/ics_feed?t=${encodeURIComponent(r.token)}&apikey=${encodeURIComponent(App.S.anonKey || "")}` };
        $("#meFeed", this.el).innerHTML = this.feedHtml();
      }
      if (a === "feed-copy") { await navigator.clipboard.writeText(this.feed.url); toast("已复制订阅链接"); }
      if (a === "bk-now") { const f = await call("backup:now"); toast("已备份：" + f.split(/[\\/]/).pop()); }
      if (a === "bk-open") call("backup:open");
      if (a === "bk-list") {
        const r = await call("backup:list");
        const d = infoBox("本机备份", r.list.length ? `<div class="muted" style="margin-bottom:8px">${esc(r.dir)}</div>${r.list.map((x) => `<div class="bk-row"><b>${esc(x.name)}</b><small class="muted">${(x.size / 1024).toFixed(0)} KB · ${whenStr(x.at)}</small><span class="grow"></span><button class="btn sm" data-bk="${esc(x.name)}">恢复这一份</button></div>`).join("")}` : "还没有备份。", true);
        d.addEventListener("click", async (ev) => { const x = ev.target.closest("[data-bk]"); if (!x) return; if (!(await confirmBox("从这份备份恢复？", "备份里的事项、打卡、规划等会写回来并同步到云端；之后新加的东西不会被删掉。", "恢复"))) return; const n = await call("backup:restore", x.dataset.bk); toast(`已恢复 ${n} 条记录`); });
      }
      if (a === "bk-file") { const n = await call("backup:restore", null); if (n !== false) toast(`已恢复 ${n} 条记录`); }
      if (a === "meta") App.views.meta.el ? $("#mtWarp", App.views.meta.el).click() : call("settings", { theme: App.S.settings.theme === "meta" ? "system" : "meta", themeBefore: App.S.settings.theme });
      if (a === "logout") { if (await confirmBox("退出登录？", "这台电脑上的数据会清掉，下次登录会重新同步。还没上传的改动会先上传。", "退出登录", true)) await call("logout"); }
      if (a === "ml-send") { await api("mail_bind_start", { addr: $("#mlAddr", this.el).value }); this.cool = Date.now() + 60000; this.mail = await api("mail_my", {}, true); this.draw(); toast("验证码已发送，去邮箱看看"); setTimeout(() => this.draw(), 60500); }
      if (a === "ml-ok") { const r = await api("mail_bind_confirm", { c: $("#mlCode", this.el).value }); if (r && r.ok === false) throw new Error(r.why || "验证码不对"); this.mail = r; this.draw(); toast("绑定成功 🎉"); }
      if (a === "ml-test") { this.mail = await api("mail_test", {}); this.draw(); toast("测试邮件已交给发信服务，一两分钟内到"); }
      if (a === "ml-unbind") { if (!(await confirmBox("解绑邮箱？", "解绑后不会再收到邮件，可以重新绑定别的邮箱。", "解绑", true))) return; this.mail = await api("mail_unbind", {}); this.draw(); }
    } catch (err) { if (err && err.message && !/^Error invoking/.test(err.message) && a === "ml-ok") toast(cleanErr(err), { bad: true }); }
  },
  change(e) { const f = e.target.closest("[data-fun]"); if (f) kvSet("fun_opts_v1", "_", { ...(KV("fun_opts_v1") || {}), [f.dataset.fun]: f.value }); },
  input(e) {
    if (this.tab !== "intro" || !this.introEdit) return;
    const ed = e.target.closest(".in-ed"); if (!ed) return;
    const i = +ed.dataset.i, f = e.target.dataset.f; if (!f) return;
    this.introEdit[i][f] = e.target.value;
    if (f === "body") ed.querySelector(".in-prev").innerHTML = mdLite(e.target.value);
  },
  // ---------- 功能介绍 ----------
  sections() { return this.intro && this.intro.sections && this.intro.sections.length ? this.intro.sections : INTRO_DEFAULT; },
  drawIntro() {
    const box = $("#meBox", this.el);
    if (!this.intro) { box.innerHTML = `<div class="empty">加载中…</div>`; return; }
    const secs = this.sections();
    box.innerHTML = `<div class="card in-hero"><span>📖</span><div><h3>捞捞课程表 · 功能介绍</h3><p class="muted">把班级群里的消息变成一本清清楚楚的日历。点目录可以直接跳过去。${this.intro.updated_at ? `<br><small>最后由 ${esc(this.intro.updated_name || "管理员")} 更新于 ${new Date(this.intro.updated_at).toLocaleDateString("zh-CN")}</small>` : ""}</p></div><span class="grow"></span>${this.intro.can_edit ? `<button class="btn" data-in="edit">✏️ 编辑</button>` : ""}</div>
      <div class="in-toc">${secs.map((x) => `<a data-in-go="${esc(x.id)}">${esc(x.icon || "•")} ${esc(x.title)}</a>`).join("")}</div>
      ${secs.map((x) => `<section class="card in-sec" id="in_${esc(x.id)}"><div class="in-h"><span>${esc(x.icon || "📌")}</span><div><h4>${esc(x.title)}</h4>${x.tag ? `<small class="muted">${esc(x.tag)}</small>` : ""}</div></div><div class="in-b md selectable">${mdLite(x.body)}</div></section>`).join("")}
      ${this.intro.is_admin ? `<div class="sec-h"><b>谁可以编写这一页</b><span>管理员可以指定任何人</span></div><div class="card in-eds" id="inEds">加载中…</div>` : ""}`;
  },
  async loadEditors() {
    try {
      const list = await api("intro_editors_list", {}, true), el = $("#inEds", this.el); if (!el) return;
      el.innerHTML = `<div class="row"><input class="input" id="edAcct" placeholder="输入对方的账号" maxlength="40"><button class="btn primary" data-in="ed-add">允许编写</button></div>
        ${list.length ? list.map((x) => `<div class="bk-row">${avHtml(x.name, "sm")}<b>${esc(x.name)}</b><small class="muted">@${esc(x.account)}</small><span class="grow"></span><button class="btn sm" data-in="ed-rm" data-acct="${esc(x.account)}">取消权限</button></div>`).join("") : `<div class="muted">现在只有管理员能编写。</div>`}`;
    } catch (e) {}
  },
  drawIntroEdit() {
    const box = $("#meBox", this.el), E = this.introEdit;
    box.innerHTML = `<div class="card in-bar"><b>✏️ 正在编辑功能介绍</b><span class="muted">支持 **加粗**、「- 」列表、「1. 」编号</span><span class="grow"></span><button class="btn sm" data-in="hist">历史版本</button><button class="btn sm" data-in="cancel">取消</button><button class="btn primary sm" data-in="save">保存发布</button></div><div id="inHist"></div>
      ${E.map((x, i) => `<div class="card in-ed" data-i="${i}"><div class="row"><input class="input in-ic" data-f="icon" value="${esc(x.icon || "")}" maxlength="4"><input class="input" data-f="title" value="${esc(x.title)}" maxlength="40" placeholder="小节标题" style="flex:1"><input class="input" data-f="tag" value="${esc(x.tag || "")}" maxlength="30" placeholder="一句话说明（可不填）" style="flex:1">
        <button class="btn ghost sm" data-mv="-1"${i ? "" : " disabled"}>↑</button><button class="btn ghost sm" data-mv="1"${i < E.length - 1 ? "" : " disabled"}>↓</button><button class="btn ghost sm danger" data-rm>✕</button></div>
        <div class="in-ed2"><textarea class="input" data-f="body" rows="6" maxlength="4000" placeholder="内容">${esc(x.body || "")}</textarea><div class="in-prev md">${mdLite(x.body)}</div></div></div>`).join("")}
      <button class="btn" data-in="add" style="width:100%">${icon("plus")}添加一个小节</button>`;
  },
  async introClick(e) {
    const go = e.target.closest("[data-in-go]"); if (go) { const n = document.getElementById("in_" + go.dataset.inGo); if (n) n.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const ed = e.target.closest(".in-ed"), b = e.target.closest("button"); if (!b) return;
    const E = this.introEdit;
    if (E && ed && b.dataset.mv) { const i = +ed.dataset.i, j = i + +b.dataset.mv; [E[i], E[j]] = [E[j], E[i]]; this.draw(); return; }
    if (E && ed && b.hasAttribute("data-rm")) { if (await confirmBox(`删除小节「${E[+ed.dataset.i].title || ""}」？`, "", "删除", true)) { E.splice(+ed.dataset.i, 1); this.draw(); } return; }
    const a = b.dataset.in; if (!a) return;
    try {
      if (a === "edit") { this.introEdit = JSON.parse(JSON.stringify(this.sections())); this.introBase = this.intro.updated_at || null; this.draw(); }
      if (a === "add") { E.push({ id: "s" + Date.now().toString(36), icon: "✨", title: "", tag: "", body: "" }); this.draw(); }
      if (a === "cancel") { if (await confirmBox("放弃这次的修改？", "", "放弃", true)) { this.introEdit = null; this.draw(); } }
      if (a === "save") { b.disabled = true; await api("intro_save", { p_sections: E, base: this.introBase }); this.introEdit = null; toast("功能介绍已更新 ✓"); this.load(); }
      if (a === "hist") { const hs = await api("intro_history_list", {}); $("#inHist", this.el).innerHTML = `<div class="card" style="padding:10px 14px;margin-bottom:12px">${hs.length ? hs.map((x) => `<div class="bk-row"><span>${esc(new Date(x.saved_at).toLocaleString("zh-CN", { hour12: false }))}</span><small class="muted">${esc(x.saved_name || "")} · ${x.n} 个小节</small><span class="grow"></span><button class="btn sm" data-in="hload" data-id="${x.id}">载入这个版本</button></div>`).join("") : `<div class="muted">还没有历史版本。</div>`}</div>`; }
      if (a === "hload") { const s = await api("intro_history_get", { hid: +b.dataset.id }); if (s && await confirmBox("载入这个历史版本？", "还需要点「保存发布」才会生效。", "载入")) { this.introEdit = s; this.draw(); } }
      if (a === "ed-add") { const acct = $("#edAcct", this.el).value.trim(); if (!acct) return; const r = await api("intro_editor_set", { acct, on_: true }); toast(`已允许 ${r.name} 编写功能介绍`); this.loadEditors(); }
      if (a === "ed-rm") { if (await confirmBox(`取消 @${b.dataset.acct} 的编写权限？`, "", "取消权限", true)) { await api("intro_editor_set", { acct: b.dataset.acct, on_: false }); this.loadEditors(); } }
    } catch (err) { b.disabled = false; }
  },
  // ---------- 感谢名单 ----------
  drawCredits() {
    const box = $("#meBox", this.el), c = this.credits, admin = App.isAdmin();
    if (c === null) { box.innerHTML = `<div class="empty">感谢名单暂时打不开</div>`; return; }
    box.innerHTML = `<div class="card in-hero"><span>💛</span><div><h3>感谢名单</h3><p class="muted">谢谢每一位为捞捞课程表出过力的同学和老师。</p></div></div>
      ${(c || []).length ? `<div class="cr-grid">${c.map((x, i) => this.creditEdit === x.id ? `<div class="card cr" data-cid="${x.id}"><input class="input" data-cf="name" maxlength="30" value="${esc(x.name)}"><textarea class="input" data-cf="contribution" rows="3" maxlength="200">${esc(x.contribution || "")}</textarea>
          <div class="row"><button class="btn ghost sm" data-cr="up"${i ? "" : " disabled"}>↑</button><button class="btn ghost sm" data-cr="down"${i < c.length - 1 ? "" : " disabled"}>↓</button><span class="grow"></span><button class="btn sm danger" data-cr="del">删除</button><button class="btn sm" data-cr="cancel">取消</button><button class="btn primary sm" data-cr="save">保存</button></div></div>`
        : `<div class="card cr" data-cid="${x.id}"><b>${esc(x.name)}</b>${x.contribution ? `<p class="muted selectable">${esc(x.contribution)}</p>` : ""}${admin ? `<button class="btn ghost sm" data-cr="edit">编辑</button>` : ""}</div>`).join("")}</div>`
        : `<div class="card empty">名单还是空的${admin ? "，在下面添加第一位吧" : ""}</div>`}
      ${admin ? `<form class="card cr-add" data-cr-add><b>添加</b><input class="input" name="n" maxlength="30" placeholder="名字"><input class="input" name="w" maxlength="200" placeholder="做了什么贡献" style="flex:1"><button class="btn primary">添加</button></form>` : ""}`;
    const f = $("[data-cr-add]", box);
    if (f) f.onsubmit = async (e) => { e.preventDefault(); if (!f.n.value.trim()) return f.n.focus(); try { await api("credit_save", { cid: null, cname: f.n.value, contrib: f.w.value, csort: null }); toast("已添加 ✓"); this.load(); } catch (err) {} };
  },
  async creditClick(e) {
    const b = e.target.closest("[data-cr]"); if (!b) return;
    const card = b.closest("[data-cid]"), id = +card.dataset.cid, c = this.credits.find((x) => x.id === id), a = b.dataset.cr;
    if (a === "edit") { this.creditEdit = id; this.draw(); return; }
    if (a === "cancel") { this.creditEdit = null; this.draw(); return; }
    try {
      if (a === "save") await api("credit_save", { cid: id, cname: card.querySelector('[data-cf="name"]').value, contrib: card.querySelector('[data-cf="contribution"]').value, csort: c.sort });
      if (a === "del") { if (!(await confirmBox(`从感谢名单里删掉「${c.name}」？`, "", "删除", true))) return; await api("credit_delete", { cid: id }); }
      if (a === "up" || a === "down") {
        const i = this.credits.indexOf(c), j = a === "up" ? i - 1 : i + 1, order = this.credits.slice(); [order[i], order[j]] = [order[j], order[i]];
        for (let k = 0; k < order.length; k++) if (order[k].sort !== (k + 1) * 10) await api("credit_save", { cid: order[k].id, cname: order[k].name, contrib: order[k].contribution, csort: (k + 1) * 10 });
      }
      this.creditEdit = null; this.load();
    } catch (err) {}
  },
};
