// 设置：账号、提醒、外观、启动、快捷键、专注、AI、数据导出
"use strict";
App.views.settings = {
  title: "设置", icon: "settings",
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>设置</h1><div class="sub">改完马上生效</div></div></div><div class="vbody st-body"><nav class="st-idx" id="stIdx"></nav><div class="st-wrap" id="stWrap"></div></div>`;
    el.addEventListener("change", (e) => { const t = e.target.closest("[data-set]"); if (!t) return; const v = t.type === "number" ? Math.max(+t.min || 0, Math.min(+t.max || 999, +t.value || 0)) : t.dataset.num ? +t.value : t.value; this.set({ [t.dataset.set]: v }); });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("#stIsland")) { DIsland.save({ on: DIsland.opts().on === false }); return; }
      const sw = e.target.closest(".switch[data-set]"); if (sw) { this.set({ [sw.dataset.set]: !sw.classList.contains("on") }); return; }
      const th = e.target.closest("button[data-theme]"); if (th) { this.set({ theme: th.dataset.theme }); return; }
      const ac = e.target.closest("[data-acc]"); if (ac) { this.set({ accent: ac.dataset.acc }); return; }
      const ui = e.target.closest("[data-ui-pick]"); if (ui) { setUi(ui.dataset.uiPick); this.set({ uiStyle: ui.dataset.uiPick }); return; }
      const a = e.target.closest("[data-a]"); if (!a) return;
      const act = a.dataset.a;
      if (act === "logout") { if (await confirmBox("退出登录？", "这台电脑上的数据会清掉，下次登录会重新同步。还没上传的改动会先上传。", "退出登录", true)) await call("logout"); }
      if (act === "sync") call("refresh").then(() => toast("已同步"));
      if (act === "ics") this.exportIcs();
      if (act === "csvItems") exportCsv("items");
      if (act === "csvCourses") exportCsv("courses");
      if (act === "ai") { call("ai:prepare"); App.go("ai"); }
      if (act === "mini") call("mini:toggle");
      if (act === "hkReset") this.set({ hotkey: "CommandOrControl+Alt+Space" });
      if (act === "brief") call("brief:open");
      if (act === "report") App.go("report");
      if (act === "bkopen") call("backup:open");
      if (act === "wp") App.views.week.wallpaper();
      if (act === "wpoff") call("wallpaper:restore").then(() => toast("已换回原来的壁纸"));
    });
    el.addEventListener("change", (e) => { if (e.target.id === "stClass" && e.target.value !== App.S.cid) call("class:switch", e.target.value).then(() => toast("已切换班级")); });
  },
  async set(patch) { await call("settings", patch); },
  async exportIcs() { const n = await call("export:ics"); if (n !== false) toast(`已导出 ${n} 件事，可以导入 Outlook、Windows 日历或手机日历`); },
  update() {
    const S = App.S, st = S.settings, me = S.me || {}, a = S.ai || {}, el = $("#stWrap", this.el);
    if (el.contains(document.activeElement) && document.activeElement.matches("input[type=number]")) return;   // 正在输入数字：不打断
    const sw = (k) => `<button class="switch${st[k] ? " on" : ""}" data-set="${k}"></button>`;
    const sel = (k, opts, unit) => `<select class="input st-sel" data-set="${k}" data-num="1">${opts.map((o) => `<option value="${o}"${+st[k] === o ? " selected" : ""}>${o ? o + " " + unit : "不提醒"}</option>`).join("")}</select>`;
    const row = (t, d, ctl) => `<div class="st-row"><div><b>${t}</b>${d ? `<small>${d}</small>` : ""}</div><div class="st-ctl">${ctl}</div></div>`;
    const cls = (S.classes || []).filter((c) => c.status !== "pending");
    const hk = (st.hotkey || "").replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");
    const top = el.parentElement.scrollTop;
    el.innerHTML = `
      <section class="card st-card" id="st-look" data-st="外观"><h3>外观</h3>
        ${row("界面风格", "随时可以换回来，数据和功能都一样", `<div class="st-ui">${[["desktop", "电脑版风格", "课表纸 + 课铃线，紧凑，一屏看到更多"], ["web", "网页风格", "和网站一样的白卡片、大侧栏，熟悉好认"]].map(([k, n, d]) => `<button data-ui-pick="${k}" class="${(st.uiStyle || "desktop") === k ? "on" : ""}"><i class="st-ui-pv ${k}"><em></em><span></span><span></span><span></span></i><b>${n}</b><small>${d}</small></button>`).join("")}</div>`)}
        ${row("主题", "", `<div class="seg">${[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"], ["meta", "元宇宙"]].map(([k, n]) => `<button data-theme="${k}" class="${st.theme === k ? "on" : ""}">${n}</button>`).join("")}</div>`)}
        ${row("主色", "按钮、选中的颜色", `<div class="st-acc">${ACCENTS.map(([k, n, c]) => `<button data-acc="${k}" class="${(st.accent || "jade") === k ? "on" : ""}" style="--a:${c}" title="${n}"></button>`).join("")}</div>`)}
      </section>
      <section class="card st-card" id="st-remind" data-st="提醒"><h3>提醒 <small>在屏幕右下角弹出，窗口关了也会提醒</small></h3>
        ${row("事项开始 / 截止前", "有具体时间的事项", sel("remindBefore", [0, 5, 10, 15, 30, 60, 120], "分钟"))}
        ${row("上课前", "按课程表提醒下一节课", sel("courseRemind", [0, 5, 10, 15, 20, 30], "分钟"))}
        ${row("每晚 8 点提醒明天的安排", "明天的课、要做的事、快到期的作业", sw("eveningDigest"))}
        ${row("倒数日提醒", "提前 7 天、3 天、1 天和当天各提醒一次", sw("countdownRemind"))}
        ${row("专注时勿扰", "番茄钟专注时不弹事项提醒，结束后一起告诉你", sw("focusQuiet"))}
        ${row("上课时勿扰", "正在上课时只弹上课提醒，别的下课后一起说", sw("classQuiet"))}
      </section>
      <section class="card st-card" id="st-data" data-st="同步和数据"><h3>同步和数据</h3>
        ${row("同步", `${S.lastRefresh ? "上次完整同步 " + new Date(S.lastRefresh).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "还没同步过"}${S.pending ? ` · ${S.pending} 条改动等着上传` : ""}`, `<button class="btn" data-a="sync">${icon("sync")}立即同步</button>`)}
        ${row("实时同步", S.live ? "开着：网页、手机上改了，几秒内就同步过来；老师发布了事项也马上能看到" : st.liveSync ? "服务器还没开通实时同步，现在每分钟同步一次" : "关着：每分钟同步一次", sw("liveSync"))}
        ${row(`<i class="lan-dot ${window.Lan ? Lan.status().tone : ""}" id="lanDot"></i>局域网互传`, `<span id="lanSt">${esc(window.Lan ? Lan.status().text : "")}</span><br>记事时勾「只存在这台设备」，这件事就不上传云端；同一账号的电脑、手机在同一个 Wi-Fi 里时直接点对点传（加密，不经过服务器）${window.Lan && Lan.status().local ? ` · 这台电脑上有 ${Lan.status().local} 件只存本机的事` : ""}`, sw("lanSync"))}
        ${row("时间校准", Math.abs(S.clockOff || 0) >= 60000 ? `这台电脑的时间比标准时间${S.clockOff > 0 ? "慢" : "快"}了约 ${Math.round(Math.abs(S.clockOff) / 60000)} 分钟，提醒和倒计时已经按标准时间算了。建议在 Windows 设置里打开「自动设置时间」` : "按北京时间、用服务器时间校准过，电脑时间不准也不影响提醒", "")}
        ${row("过期自动删除我记的事", "日期过去 2 周后自动删掉（和网页版一样）；最后 3 天会在事项里提醒，可以推迟", sw("autodelMine"))}
        ${row("导出到日历", "生成 .ics 文件，可以导入 Outlook、Windows 日历、手机日历", `<button class="btn" data-a="ics">${icon("export")}导出</button>`)}
        ${row("导出成表格", "Excel、WPS 能直接打开：所有事项，或者课程表（带调课记录）", `<button class="btn" data-a="csvItems">▦ 事项</button><button class="btn" data-a="csvCourses">▦ 课程表</button>`)}
      </section>
      <section class="card st-card" id="st-helper" data-st="电脑版小助手"><h3>电脑版小助手</h3>
        ${row("复制群消息时识别作业通知", "在微信、QQ 里复制了作业、考试通知，右下角提示一键整理进日历（只在这台电脑上识别，不上传）", sw("clipWatch"))}
        ${row("每天早上的今日简报", "每天第一次打开电脑时，右下角弹出今天的课、要交的作业和倒数日", sw("morningBrief") + `<button class="btn ghost sm" data-a="brief">现在看看</button>`)}
        ${row("任务栏图标显示数字", "图标右下角显示今天还剩几件事没做", sw("taskbarBadge"))}
        ${row("每周学习报告", "周日晚上 7 点提醒你看这周的报告", sw("weeklyReport") + `<button class="btn ghost sm" data-a="report">打开</button>`)}
        ${row("每天自动备份", "备份到「文档 / 捞捞课程表备份」，留最近 14 份", sw("autoBackup") + `<button class="btn ghost sm" data-a="bkopen">打开文件夹</button>`)}
        ${row("课程表壁纸", "把这周的课表和作业设成桌面壁纸，每周一自动换新", `<button class="btn" data-a="wp">${icon("image")}设成壁纸</button><button class="btn ghost sm" data-a="wpoff">换回原来的</button>`)}
      </section>
      <section class="card st-card" id="st-lao" data-st="捞捞助手"><h3>捞捞助手 <small>窗口角落里的捞捞：举着小屏幕显示最急的事，到点冒泡泡提醒，点它能问问题（Ctrl+J）</small></h3>
        ${row("显示捞捞", "按时间轻重把待办智能排序；规则答不上来的问题交给内置 AI", `<button class="switch${DIsland.opts().on !== false ? " on" : ""}" id="stIsland"></button>`)}
      </section>
      <section class="card st-card" id="st-win" data-st="窗口和启动"><h3>窗口和启动</h3>
        ${row("关闭窗口时缩到右下角托盘", "继续提醒、继续专注计时；右键托盘图标可以退出", sw("closeToTray"))}
        ${row("开机自动启动", "开机后安静地待在托盘里，不弹窗口", sw("autoStart"))}
        ${row("快速记事快捷键", "在任何软件里按下，弹出一个小框记事", `<input class="input hk" id="stHk" readonly value="${esc(hk)}" title="点一下，然后按下新的组合键"><button class="btn ghost sm" data-a="hkReset">恢复默认</button>`)}
        ${row("桌面小窗", "今天的课和待办，一直浮在桌面最上面", `<button class="btn" data-a="mini">${icon("mini")}打开 / 关闭</button>`)}
      </section>
      <section class="card st-card" id="st-focus" data-st="专注"><h3>专注</h3>
        ${row("每次专注", "", `<input class="input num" type="number" min="5" max="120" data-set="pomoFocus" value="${st.pomoFocus}"> 分钟`)}
        ${row("休息", "", `<input class="input num" type="number" min="1" max="30" data-set="pomoBreak" value="${st.pomoBreak}"> 分钟`)}
      </section>
      <section class="card st-card" id="st-ai" data-st="AI 助手"><h3>AI 助手</h3>
        ${row(esc(a.model || "本地模型"), a.ready ? "已就绪，在这台电脑上运行" : a.status === "downloading" ? "正在下载…" : a.status === "error" ? "出错了：" + esc(a.error) : "还没下载（约 1 GB）", `<button class="btn" data-a="ai">${a.ready ? "去聊天" : "下载并启动"}</button>`)}
      </section>
      <section class="card st-card" id="st-keys" data-st="快捷键"><h3>快捷键</h3>
        <div class="st-keys">${[["Ctrl K", "搜索 / 命令面板"], ["Ctrl N", "记一件事"], ["Ctrl 1 – 9", "切换页面"], ["Ctrl V", "在课程表页粘贴课表截图"], ["Ctrl ,", "设置"], ["F5", "同步"], [hk, "快速记事（全局）"], ["Ctrl J", "捞捞助手"], ["Esc", "关掉详情栏、弹窗"], ["↑ ↓ 空格 Enter Del", "在事项表里操作"], ["← → T", "课程表 / 月历翻页、回到今天"]].map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${d}</span></div>`).join("")}</div>
      </section>
      <section class="card st-card" id="st-acct" data-st="账号"><h3>账号</h3>
        <div class="st-me"><span class="av lg">${esc((me.display_name || me.account || "我").slice(-1))}</span><div><b>${esc(me.display_name || "")}</b><small>账号 ${esc(me.account || "")}${me.role === "teacher" ? " · 老师" : ""}</small></div><span class="grow"></span><button class="btn danger" data-a="logout">退出登录</button></div>
        ${row("当前班级", cls.length > 1 ? "有多个班级时可以在这里切换" : "", cls.length ? `<select class="input st-sel" id="stClass">${cls.map((c) => `<option value="${esc(c.id)}"${c.id === S.cid ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : `<button class="btn" data-go-cl>加入班级</button>`)}
      </section>
      <p class="st-ver muted">捞捞课程表 电脑版 ${esc(S.version || "")} · <a data-ext="https://www.laolaokechengbiao.cn/">网站</a></p>`;
    // 左边的目录：点一下跳到那一组，滚动时高亮当前这一组
    const idx = $("#stIdx", this.el), body = el.parentElement;
    idx.innerHTML = $$("[data-st]", el).map((x) => `<button data-st-go="${x.id}">${esc(x.dataset.st)}</button>`).join("");
    idx.onclick = (e) => { const b = e.target.closest("[data-st-go]"); if (b) $("#" + b.dataset.stGo, el).scrollIntoView({ behavior: "smooth", block: "start" }); };
    const mark = () => { const y = body.getBoundingClientRect().top + 90; let cur = null; for (const x of $$("[data-st]", el)) if (x.getBoundingClientRect().top <= y) cur = x.id; $$("[data-st-go]", idx).forEach((b, i) => b.classList.toggle("on", cur ? b.dataset.stGo === cur : i === 0)); };
    body.onscroll = mark; body.scrollTop = top; mark();
    // 录快捷键：点一下输入框，然后按组合键
    const hkIn = $("#stHk", el);
    hkIn.onfocus = () => { hkIn.value = "请按下组合键…"; };
    hkIn.onblur = () => { hkIn.value = hk; };
    hkIn.onkeydown = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return hkIn.blur();
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const mods = [e.ctrlKey && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
      if (!mods.length || (mods.length === 1 && mods[0] === "Shift")) { hkIn.value = "要带 Ctrl 或 Alt"; return; }
      let k = e.key.length === 1 ? e.key.toUpperCase() : e.key; if (k === " ") k = "Space"; if (e.code === "Space") k = "Space";
      this.set({ hotkey: mods.concat(k).join("+") }).then(() => toast("快捷键已改成 " + mods.concat(k).join(" + ").replace("CommandOrControl", "Ctrl")));
      hkIn.blur();
    };
  },
};

const ACCENTS = [["jade", "青绿（和网站一样）", "#0f7a68"], ["blue", "海军蓝", "#2f62d8"], ["teal", "湖水青", "#0e8ea3"], ["green", "薄荷绿", "#2c9a5c"], ["purple", "星空紫", "#7a4fd6"], ["sakura", "樱花粉", "#e0457b"], ["orange", "活力橙", "#d9640f"], ["red", "中国红", "#c8333a"], ["ink", "墨色", "#2b3b52"]];
document.addEventListener("click", (e) => { if (e.target.closest("[data-go-cl]")) App.go("classes"); });
