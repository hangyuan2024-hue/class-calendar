// 设置：账号、提醒、外观、启动、快捷键、专注、AI、数据导出
"use strict";
App.views.settings = {
  title: "设置", icon: "settings",
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>设置</h1><div class="sub">改完马上生效</div></div></div><div class="vbody"><div class="st-wrap" id="stWrap"></div></div>`;
    el.addEventListener("change", (e) => { const t = e.target.closest("[data-set]"); if (!t) return; const v = t.type === "number" ? Math.max(+t.min || 0, Math.min(+t.max || 999, +t.value || 0)) : t.dataset.num ? +t.value : t.value; this.set({ [t.dataset.set]: v }); });
    el.addEventListener("click", async (e) => {
      const sw = e.target.closest(".switch[data-set]"); if (sw) { this.set({ [sw.dataset.set]: !sw.classList.contains("on") }); return; }
      const th = e.target.closest("[data-theme]"); if (th) { this.set({ theme: th.dataset.theme }); return; }
      const a = e.target.closest("[data-a]"); if (!a) return;
      const act = a.dataset.a;
      if (act === "logout") { if (await confirmBox("退出登录？", "这台电脑上的数据会清掉，下次登录会重新同步。还没上传的改动会先上传。", "退出登录", true)) await call("logout"); }
      if (act === "sync") call("refresh").then(() => toast("已同步"));
      if (act === "ics") this.exportIcs();
      if (act === "ai") { call("ai:prepare"); App.go("ai"); }
      if (act === "mini") call("mini:toggle");
      if (act === "hkReset") this.set({ hotkey: "CommandOrControl+Alt+Space" });
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
    el.innerHTML = `
      <section class="card st-card"><h3>账号</h3>
        <div class="st-me"><span class="av lg">${esc((me.display_name || me.account || "我").slice(-1))}</span><div><b>${esc(me.display_name || "")}</b><small>账号 ${esc(me.account || "")}${me.role === "teacher" ? " · 老师" : ""}</small></div><span class="grow"></span><button class="btn danger" data-a="logout">退出登录</button></div>
        ${row("当前班级", cls.length > 1 ? "有多个班级时可以在这里切换" : "", cls.length ? `<select class="input st-sel" id="stClass">${cls.map((c) => `<option value="${esc(c.id)}"${c.id === S.cid ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : `<a data-ext="https://www.laolaokechengbiao.cn/app.html">去网站加入班级</a>`)}
      </section>
      <section class="card st-card"><h3>提醒 <small>在屏幕右下角弹出，窗口关了也会提醒</small></h3>
        ${row("事项开始 / 截止前", "有具体时间的事项", sel("remindBefore", [0, 5, 10, 15, 30, 60, 120], "分钟"))}
        ${row("上课前", "按课程表提醒下一节课", sel("courseRemind", [0, 5, 10, 15, 20, 30], "分钟"))}
        ${row("每晚 8 点提醒明天的安排", "明天的课、要做的事、快到期的作业", sw("eveningDigest"))}
      </section>
      <section class="card st-card"><h3>外观</h3>
        ${row("主题", "", `<div class="seg">${[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].map(([k, n]) => `<button data-theme="${k}" class="${st.theme === k ? "on" : ""}">${n}</button>`).join("")}</div>`)}
      </section>
      <section class="card st-card"><h3>窗口和启动</h3>
        ${row("关闭窗口时缩到右下角托盘", "继续提醒、继续专注计时；右键托盘图标可以退出", sw("closeToTray"))}
        ${row("开机自动启动", "开机后安静地待在托盘里，不弹窗口", sw("autoStart"))}
        ${row("快速记事快捷键", "在任何软件里按下，弹出一个小框记事", `<input class="input hk" id="stHk" readonly value="${esc(hk)}" title="点一下，然后按下新的组合键"><button class="btn ghost sm" data-a="hkReset">恢复默认</button>`)}
        ${row("桌面小窗", "今天的课和待办，一直浮在桌面最上面", `<button class="btn" data-a="mini">${icon("mini")}打开 / 关闭</button>`)}
      </section>
      <section class="card st-card"><h3>专注</h3>
        ${row("每次专注", "", `<input class="input num" type="number" min="5" max="120" data-set="pomoFocus" value="${st.pomoFocus}"> 分钟`)}
        ${row("休息", "", `<input class="input num" type="number" min="1" max="30" data-set="pomoBreak" value="${st.pomoBreak}"> 分钟`)}
      </section>
      <section class="card st-card"><h3>AI 助手</h3>
        ${row(esc(a.model || "本地模型"), a.ready ? "已就绪，在这台电脑上运行" : a.status === "downloading" ? "正在下载…" : a.status === "error" ? "出错了：" + esc(a.error) : "还没下载（约 1 GB）", `<button class="btn" data-a="ai">${a.ready ? "去聊天" : "下载并启动"}</button>`)}
      </section>
      <section class="card st-card"><h3>数据</h3>
        ${row("同步", `${S.lastRefresh ? "上次同步 " + new Date(S.lastRefresh).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "还没同步过"}${S.pending ? ` · ${S.pending} 条改动等着上传` : ""} · 每 5 分钟自动同步`, `<button class="btn" data-a="sync">${icon("sync")}立即同步</button>`)}
        ${row("导出到日历", "生成 .ics 文件，可以导入 Outlook、Windows 日历、手机日历", `<button class="btn" data-a="ics">${icon("export")}导出</button>`)}
      </section>
      <section class="card st-card"><h3>快捷键</h3>
        <div class="st-keys">${[["Ctrl K", "搜索 / 命令面板"], ["Ctrl N", "记一件事"], ["Ctrl 1 – 7", "切换页面"], ["Ctrl ,", "设置"], ["F5", "同步"], [hk, "快速记事（全局）"], ["↑ ↓ 空格 Enter Del", "在事项表里操作"], ["← → T", "课程表 / 月历翻页、回到今天"]].map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${d}</span></div>`).join("")}</div>
      </section>
      <p class="st-ver muted">捞捞课程表 电脑版 ${esc(S.version || "")} · <a data-ext="https://www.laolaokechengbiao.cn/">网站</a></p>`;
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
