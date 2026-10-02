// 登录 / 注册 / 注册后的新手引导（男生、女生两套）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const form = $("form");
let mode = "login";
const next = new URLSearchParams(location.search).get("next");
const safeNext = next && /^[a-z0-9_-]+\.html([?#].*)?$/i.test(next) ? next : null;
const LS_LAST = "login_last_account_v1";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- 主题：选了男生 / 女生，整个页面跟着变 ----------
const STAGE = {
  "": { t: "群消息太多？<br><em>捞捞</em>帮你理清楚", l: "作业、通知、活动自动整理成日历，换手机、换浏览器登录同一个账号，你的待办都在。", fl: ["📅", "✏️", "✨", "📌"] },
  f: { t: "你好呀～<br>欢迎来到<em>你的小宇宙</em>", l: "把作业、社团、生活小事都收进一本可爱的日历里，再配一套樱花粉，每天打开都开心一点。", fl: ["🌸", "💗", "✨", "🎀", "🌷"] },
  m: { t: "准备好了吗？<br>一起<em>升级</em>这个学期", l: "作业截止、考试安排、训练计划一屏掌握，完成任务攒经验，在捞捞元宇宙里解锁成就。", fl: ["⭐", "🚀", "✨", "🪐", "⚡"] },
};
function setGender(g) {
  document.documentElement.dataset.g = g || "";
  const st = STAGE[g || ""];
  $("stageTitle").innerHTML = st.t; $("stageLead").textContent = st.l;
  document.querySelector('meta[name="theme-color"]').content = g === "f" ? "#ffe1ec" : g === "m" ? "#d6e2ff" : "#cdeeff";
  floaties(st.fl);
}
function floaties(list) {
  const box = $("floaties"); box.innerHTML = "";
  if (reduce) return;
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("span"); s.className = "floaty"; s.textContent = list[i % list.length];
    s.style.cssText = `left:${5 + Math.random() * 85}%;bottom:-40px;animation-delay:${-Math.random() * 9}s;animation-duration:${8 + Math.random() * 6}s;font-size:${16 + Math.random() * 14}px`;
    box.appendChild(s);
  }
}

// ---------- 登录 / 注册切换 ----------
function setMode(m) {
  mode = m;
  form.classList.toggle("signup", m === "signup");
  $("tabs").classList.toggle("signup", m === "signup");
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("goText").textContent = m === "signup" ? "注册并开始" : "登录";
  $("cardTitle").textContent = m === "signup" ? "创建你的账号 ✨" : "欢迎回来 👋";
  $("cardSub").textContent = m === "signup" ? "一分钟搞定，账号不需要邮箱和手机号" : "登录后查看你的班级日历";
  $("password").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("note").textContent = m === "signup" ? "开发者、测试员身份由管理员在后台分配。" : "";
  $("msg").textContent = "";
  const g = document.querySelector("input[name=gender]:checked");
  setGender(m === "signup" && g ? g.value : "");
  checkAccount(); checkPw();
}
$("tabs").onclick = (e) => { const b = e.target.closest("button[data-mode]"); if (b) setMode(b.dataset.mode); };
document.querySelectorAll("input[name=gender]").forEach((r) => r.addEventListener("change", () => { setGender(r.value); $("gHint").className = "hint"; $("gHint").textContent = r.value === "f" ? "已选女生：会用樱花粉主题，准备一套专属欢迎引导 🌸" : "已选男生：会用海军蓝主题，准备一套专属欢迎引导 🚀"; }));

// ---------- 输入时就提示 ----------
function checkAccount() {
  const v = $("account").value.trim().toLowerCase(), ok = CCAuth.ACCOUNT_RE.test(v);
  const hint = $("accHint"), inp = $("account");
  inp.classList.toggle("bad", !!v && !ok && mode === "signup"); inp.classList.toggle("good", ok && mode === "signup");
  $("accOk").classList.toggle("hidden", !(ok && mode === "signup"));
  if (mode !== "signup") { hint.textContent = ""; hint.className = "hint"; return ok; }
  if (!v) { hint.textContent = "3~20 位小写字母、数字或下划线，比如学号"; hint.className = "hint"; }
  else if (!ok) { hint.textContent = v.length < 3 ? "至少 3 位" : v.length > 20 ? "最多 20 位" : "只能用字母、数字和下划线"; hint.className = "hint err"; }
  else if (/[A-Z]/.test($("account").value)) { hint.textContent = "可以用，大写字母会自动变成小写"; hint.className = "hint warn"; }
  else { hint.textContent = "这个账号可以用"; hint.className = "hint"; }
  return ok;
}
function pwScore(p) { let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[a-z]/i.test(p) && /\d/.test(p)) s++; if (/[^a-z0-9]/i.test(p) || /[a-z]/.test(p) && /[A-Z]/.test(p)) s++; return p ? Math.max(1, s) : 0; }
function checkPw() {
  const p = $("password").value, p2 = $("password2").value;
  if (mode === "signup") {
    const sc = pwScore(p); $("meter").className = "meter signup-only" + (sc ? " s" + sc : "");
    $("pwHint").textContent = !p ? "至少 8 位，字母 + 数字更安全" : p.length < 8 ? `还差 ${8 - p.length} 位` : ["", "有点弱", "还行", "不错", "很安全 👍"][sc];
    $("pwHint").className = "hint" + (p && p.length < 8 ? " err" : "");
    $("password2").classList.toggle("bad", !!p2 && p2 !== p); $("password2").classList.toggle("good", !!p2 && p2 === p);
    $("pw2Hint").textContent = p2 && p2 !== p ? "两次输入的不一样" : p2 && p2 === p ? "✓ 一致" : "";
    $("pw2Hint").className = "hint" + (p2 && p2 !== p ? " err" : "");
  } else { $("pwHint").textContent = ""; }
}
$("account").addEventListener("input", checkAccount);
$("password").addEventListener("input", checkPw); $("password2").addEventListener("input", checkPw);
// 大写锁定提醒
["password", "password2"].forEach((id) => $(id).addEventListener("keyup", (e) => {
  if (!e.getModifierState) return;
  const caps = e.getModifierState("CapsLock"), h = id === "password" ? $("pwHint") : $("pw2Hint");
  if (caps) { h.textContent = "⚠ 大写锁定开着"; h.className = "hint warn"; } else checkPw();
}));
document.querySelectorAll("[data-eye]").forEach((b) => b.onclick = () => {
  const inp = $(b.dataset.eye), show = inp.type === "password";
  inp.type = show ? "text" : "password"; b.textContent = show ? "🙈" : "👁"; b.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
});

async function afterLogin(isNew) {
  const me = await CCAuth.me();
  let dest = "index.html";
  if (me && me.role === "teacher") dest = "class.html";
  else if (me && ["admin", "developer", "tester"].includes(me.role)) dest = "dev.html";
  if (isNew) return onboard(me);
  location.href = safeNext || dest;
}

form.onsubmit = async (e) => {
  e.preventDefault();
  $("msg").textContent = "";
  const account = $("account").value, password = $("password").value;
  const gender = (document.querySelector("input[name=gender]:checked") || {}).value || "";
  if (mode === "signup") {
    if (!checkAccount()) { $("msg").textContent = "账号格式不对"; $("account").focus(); return; }
    if (!gender) { $("msg").textContent = "请选择男生还是女生"; $("gHint").className = "hint err"; return; }
    if (!$("name").value.trim()) { $("msg").textContent = "请填写姓名"; $("name").focus(); return; }
    if (password.length < 8) { $("msg").textContent = "密码至少 8 位"; $("password").focus(); return; }
    if (password !== $("password2").value) { $("msg").textContent = "两次输入的密码不一样"; $("password2").focus(); return; }
  }
  $("go").disabled = true;
  try {
    if (mode === "signup") await CCAuth.signUp(account, password, $("name").value, (document.querySelector("input[name=role]:checked") || {}).value, gender);
    else await CCAuth.signIn(account, password);
    try { localStorage.setItem(LS_LAST, account.trim().toLowerCase()); } catch (e2) {}
    await afterLogin(mode === "signup");
  } catch (err) {
    $("msg").textContent = err.message;
    if (mode === "login" && /账号或密码/.test(err.message)) { $("password").select(); }
  } finally {
    $("go").disabled = false;
  }
};

// ---------- 注册后的新手引导 ----------
const PALS = {
  sakura: ["樱花粉", "#ff5f8f", "#ffb03b"], peach: ["蜜桃", "#ff7a6b", "#ffc24b"], lavender: ["薰衣草", "#8c6bff", "#ff7bc0"], rose: ["玫瑰", "#e0457b", "#8c6bff"],
  sky: ["天空蓝", "#1ea0ff", "#ff7b2e"], mint: ["薄荷绿", "#17b890", "#ff8a3d"], lemon: ["柠檬", "#e0b000", "#3c8dff"], galaxy: ["星空", "#5b5bd6", "#ff5fa2"],
  navy: ["海军蓝", "#2457d6", "#ffb020"], ocean: ["深海", "#0f8bb5", "#ff6a5c"], graphite: ["石墨", "#3d4b5c", "#ff7b2e"], orange: ["活力橙", "#ff8a1f", "#1ea0ff"], matcha: ["抹茶", "#5f9e45", "#e0a526"],
};
const OB = {
  f: {
    hi: (n) => `嗨，${n}～`, lead: "欢迎来到你的班级小宇宙 🌸<br>接下来花 30 秒，把这里布置成你喜欢的样子。",
    orbs: ["🌸", "💗", "🎀", "✨"], pals: ["sakura", "peach", "lavender", "rose", "sky", "mint", "galaxy", "lemon"], pal: "sakura", skin: "vivid", rec: "vivid",
    habits: [["📖", "阅读 20 分钟"], ["🔤", "背 30 个单词"], ["🌙", "11 点前睡觉"], ["💧", "喝 8 杯水"], ["🧘", "拉伸 10 分钟"], ["📝", "写日记"]],
    done: "布置好啦！", doneLead: "你的小宇宙已经准备好了，去看看吧 💫",
  },
  m: {
    hi: (n) => `${n}，欢迎加入！`, lead: "新学期任务已载入 🚀<br>先花 30 秒完成初始设置，解锁你的主控台。",
    orbs: ["⭐", "🚀", "🪐", "⚡"], pals: ["navy", "ocean", "sky", "galaxy", "graphite", "orange", "mint", "matcha"], pal: "navy", skin: "vivid", rec: "cyber",
    habits: [["🏃", "运动 30 分钟"], ["🔤", "背 30 个单词"], ["🧮", "刷 5 道题"], ["📖", "阅读 20 分钟"], ["🌙", "11 点前睡觉"], ["💧", "喝 8 杯水"]],
    done: "初始化完成！", doneLead: "装备已就绪，开始这个学期的第一个任务吧 ⚡",
  },
};
const SKINS = [["vivid", "元气", "linear-gradient(135deg,#cdeeff,#ffffff)"], ["clean", "简约", "linear-gradient(135deg,#ffffff,#eef1f5)"], ["dark", "夜间", "linear-gradient(135deg,#111,#2a2a2e)"], ["cyber", "元宇宙", "linear-gradient(135deg,#7a1cff,#00e5ff)"]];
let ob = null;
async function onboard(me) {
  const s = await CCAuth.session();
  const g = (document.querySelector("input[name=gender]:checked") || {}).value || "m";
  const cfg = OB[g];
  ob = { step: 0, g, cfg, me, dest: safeNext || (me && me.role === "teacher" ? "class.html" : me && ["admin", "developer", "tester"].includes(me.role) ? "dev.html" : "index.html"), uid: s && s.user_id, name: (me && me.display_name) || $("name").value.trim() || "同学",
    teacher: !!(me && me.role === "teacher"), skin: cfg.skin, pal: cfg.pal, habits: new Set([cfg.habits[0][1], cfg.habits[1][1]]), sync: "cloud" };
  setGender(g);
  $("ob").classList.remove("hidden");
  renderOb();
}
const OB_STEPS = 5;
function renderOb() {
  const { step, cfg, g } = ob;
  $("obDots").innerHTML = Array.from({ length: OB_STEPS }, (_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("");
  const mascot = `<svg class="m" viewBox="0 0 ${g ? 80 : 120} ${g ? 80 : 120}" aria-hidden="true"><use href="#${g === "f" ? "avF" : "avM"}"/></svg>`;
  let h = "";
  if (step === 0) h = `<div class="ob-art">${mascot}${cfg.orbs.map((o, i) => `<span class="orb" style="animation-delay:${-i * 1.75}s">${o}</span>`).join("")}</div>
      <h3>${esc(cfg.hi(ob.name))}</h3><p class="lead">${cfg.lead}</p>
      <div class="ob-nav"><button class="go" data-ob="next">开始布置 →</button></div>`;
  if (step === 1) {
    const p = PALS[ob.pal];
    h = `<h3>${g === "f" ? "挑一套喜欢的颜色" : "选择你的主题"}</h3><p class="lead">已经帮你选好了默认的，换一个也行，以后在「我的 → 外观」里随时改。</p>
      <div class="skinrow">${SKINS.map(([id, n, bg]) => `<button data-skin="${id}" class="${ob.skin === id ? "on" : ""}"><div class="pv" style="background:${bg}"></div>${n}${cfg.rec === id && id !== cfg.skin ? '<span class="rec">试试</span>' : ""}</button>`).join("")}</div>
      <div class="pals${ob.skin === "cyber" ? " hidden" : ""}">${cfg.pals.map((id) => `<button data-pal="${id}" class="${ob.pal === id ? "on" : ""}"><span class="dot" style="background:linear-gradient(135deg,${PALS[id][1]},${PALS[id][2]})"></span>${PALS[id][0]}</button>`).join("")}</div>
      <div class="preview" style="background:${ob.skin === "cyber" ? "#0c0a20" : ob.skin === "dark" ? "#1a1a1e" : "#fff"}">
        <div class="pvh" style="background:${ob.skin === "cyber" ? "linear-gradient(135deg,#7a1cff,#00e5ff)" : `linear-gradient(135deg,${p[1]},${p[2]})`}">${ob.skin === "cyber" ? "▶ 捞捞元宇宙" : "今天有 3 件事"}</div>
        <div class="pvb" style="background:${ob.skin === "cyber" ? "#ff2bd6" : p[1]}">＋</div></div>
      <div class="ob-nav"><button class="ghost" data-ob="back">上一步</button><button class="go" data-ob="next">就这个 →</button></div>`;
  }
  if (step === 2) h = `<h3>${g === "f" ? "想养成什么小习惯？" : "选几个每日任务"}</h3><p class="lead">选 1~3 个，每天在「成长」页打个卡，${g === "f" ? "看着小火苗一天天变旺 🔥" : "连续打卡解锁成就 🏆"}。不选也可以。</p>
      <div class="chips">${cfg.habits.map(([e, n]) => `<button data-habit="${esc(n)}" class="${ob.habits.has(n) ? "on" : ""}">${e} ${esc(n)}</button>`).join("")}</div>
      <div class="ob-nav"><button class="ghost" data-ob="back">上一步</button><button class="go" data-ob="next">${ob.habits.size ? `选好了（${ob.habits.size} 个）→` : "先跳过 →"}</button></div>`;
  if (step === 3) h = `<h3>数据存在哪里？</h3><p class="lead">「我的事项」、打卡、规划这些数据，可以跟着账号走。</p>
      <div class="opts">
        <button class="opt ${ob.sync === "cloud" ? "on" : ""}" data-sync="cloud"><span class="em">☁️</span><span><b>云端同步（推荐）</b><small>换浏览器、换手机登录同一个账号都能看到</small></span></button>
        <button class="opt ${ob.sync === "local" ? "on" : ""}" data-sync="local"><span class="em">📱</span><span><b>只存在这台设备</b><small>不上传，换浏览器就看不到了</small></span></button>
      </div>
      <div class="ob-nav"><button class="ghost" data-ob="back">上一步</button><button class="go" data-ob="next">下一步 →</button></div>`;
  if (step === 4) h = `<div class="ob-art">${mascot}</div><h3>${cfg.done}</h3><p class="lead">${cfg.doneLead}<br>${ob.teacher ? "第一步：创建你的班级，把班级码发给学生。" : "第一步：找老师要班级码，加入你的班级。"}</p>
      <div class="ob-nav"><button class="ghost" data-ob="home">先去首页看看</button><button class="go" data-ob="class">${ob.teacher ? "去创建班级 →" : "输入班级码 →"}</button></div>`;
  $("obBody").innerHTML = `<div class="ob-step${ob.shown === step ? "" : " anim"}">${h}</div>${step < OB_STEPS - 1 ? `<button class="ob-skip" data-ob="skip">跳过，直接用默认设置</button>` : ""}`;
  ob.shown = step;
}
$("obBody").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.skin) { ob.skin = b.dataset.skin; renderOb(); return; }
  if (b.dataset.pal) { ob.pal = b.dataset.pal; renderOb(); return; }
  if (b.dataset.habit) { const n = b.dataset.habit; ob.habits.has(n) ? ob.habits.delete(n) : ob.habits.size < 3 && ob.habits.add(n); renderOb(); return; }
  if (b.dataset.sync) { ob.sync = b.dataset.sync; renderOb(); return; }
  const a = b.dataset.ob;
  if (a === "next") { ob.step = Math.min(OB_STEPS - 1, ob.step + 1); if (ob.step === OB_STEPS - 1) { applyOb(); burst(); } renderOb(); }
  if (a === "back") { ob.step = Math.max(0, ob.step - 1); renderOb(); }
  if (a === "skip") { applyOb(); location.href = ob.dest; }
  if (a === "home") location.href = "index.html?welcome=1";
  if (a === "class") location.href = "class.html";
});
// 选择先记下来，主页面打开、确认是这个账号后再应用并同步到云端
function applyOb() {
  const p = PALS[ob.pal];
  const pending = { uid: ob.uid, gender: ob.g, skin: ob.skin, palette: { id: ob.pal, name: p[0], p: p[1], s: p[2] }, sync: ob.sync,
    habits: [...ob.habits].map((n) => { const x = ob.cfg.habits.find((h) => h[1] === n); return { name: n, icon: x ? x[0] : "⭐" }; }) };
  try { localStorage.setItem("onboard_apply_v1", JSON.stringify(pending)); } catch (e) {}
}
function burst() {
  if (reduce) return;
  const cols = ob.g === "f" ? ["#ff5f8f", "#ffb03b", "#ffd1e0", "#8c6bff", "#fff"] : ["#2457d6", "#ffb020", "#00c8ff", "#17b890", "#fff"];
  const cx = innerWidth / 2, cy = innerHeight / 2, R = Math.min(innerWidth, innerHeight);
  for (let i = 0; i < 70; i++) {
    const c = document.createElement("i"); c.className = "confetti"; const a = Math.random() * Math.PI * 2, v = R * (0.2 + Math.random() * 0.35);
    c.style.cssText = `left:${cx}px;top:${cy}px;background:${cols[i % cols.length]};--dx:${Math.cos(a) * v}px;--dy:${Math.sin(a) * v + R * .2}px;--r:${Math.random() * 720 - 360}deg`;
    document.body.appendChild(c); setTimeout(() => c.remove(), 1800);
  }
}

// ---------- 忘记密码 ----------
function showForgot(on) {
  $("loginBox").classList.toggle("hidden", on); $("forgotBox").classList.toggle("hidden", !on);
  if (on) { $("fgAcct").value = $("account").value.trim().toLowerCase(); $("fg1").classList.remove("hidden"); $("fg2").classList.add("hidden"); $("fgHelp").textContent = ""; $("fgMsg").textContent = ""; setTimeout(() => $("fgAcct").focus(), 50); }
}
$("forgotLink").onclick = (e) => { e.preventDefault(); showForgot(true); };
$("fgBack").onclick = () => showForgot(false);
async function fgSend() {
  const acct = $("fgAcct").value.trim().toLowerCase();
  $("fgMsg").textContent = ""; $("fgHelp").textContent = "";
  if (!CCAuth.ACCOUNT_RE.test(acct)) { $("fgMsg").textContent = "请输入正确的账号"; return; }
  $("fgSend").disabled = true;
  try {
    const r = await CCAuth.rpc("pw_reset_start", { acct });
    if (r.ok) {
      $("fg1").classList.add("hidden"); $("fg2").classList.remove("hidden");
      $("fgHelp").innerHTML = `验证码已发到你绑定的邮箱 <b>${esc(r.email)}</b>，15 分钟内有效。`;
      setTimeout(() => $("fgCode").focus(), 50);
    } else {
      $("fgHelp").innerHTML = r.why === "no_email"
        ? "这个账号<b>没有绑定邮箱</b>，没法自己找回。<br>请联系班主任：老师在你的个人主页可以给你重置一个临时密码。"
        : "网站还没开通邮件发送，暂时没法用邮箱找回。<br>请联系班主任给你重置临时密码。";
    }
  } catch (err) { $("fgMsg").textContent = err.message; }
  finally { $("fgSend").disabled = false; }
}
$("fgSend").onclick = fgSend;
$("fgAcct").addEventListener("keydown", (e) => { if (e.key === "Enter") fgSend(); });
$("fgResend").onclick = (e) => { e.preventDefault(); $("fg2").classList.add("hidden"); $("fg1").classList.remove("hidden"); fgSend(); };
$("fgDone").onclick = async () => {
  const acct = $("fgAcct").value.trim().toLowerCase(), code = $("fgCode").value.trim(), pw = $("fgPw").value;
  $("fgMsg").textContent = "";
  if (!/^\d{6}$/.test(code)) { $("fgMsg").textContent = "验证码是 6 位数字"; return; }
  if (pw.length < 8) { $("fgMsg").textContent = "新密码至少 8 位"; return; }
  if (pw !== $("fgPw2").value) { $("fgMsg").textContent = "两次输入的新密码不一样"; return; }
  $("fgDone").disabled = true;
  try {
    await CCAuth.rpc("pw_reset_finish", { acct, code, newpw: pw });
    $("fgHelp").textContent = "✓ 新密码设置好了，正在登录…";
    await CCAuth.signIn(acct, pw);
    try { localStorage.setItem(LS_LAST, acct); } catch (e2) {}
    await afterLogin(false);
  } catch (err) { $("fgMsg").textContent = err.message; }
  finally { $("fgDone").disabled = false; }
};

// ---------- 安卓 App ----------
window.ccAppBack = () => { if (!$("forgotBox").classList.contains("hidden")) { showForgot(false); return true; } return false; };
if (!window.AndroidBridge && !/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
  fetch("download/app-version.json?t=" + Date.now(), { cache: "no-store", signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)).then((v) => {
    if (!v) return;
    const a = document.createElement("a"); a.href = "app.html"; a.textContent = "📱 下载安卓 App";
    const foot = document.querySelector(".card > .foot:last-child"); if (foot) { foot.append("　·　", a); }
  }).catch(() => {});
}

// ---------- 打开页面 ----------
try { const last = localStorage.getItem(LS_LAST); if (last) { $("account").value = last; } } catch (e) {}
setMode(new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "login");
setTimeout(() => ($("account").value ? $("password") : $("account")).focus(), 60);
(async () => {
  const s = await CCAuth.session();
  if (!s) return;
  const me = await CCAuth.me();
  if (!me) return;
  $("alreadyAv").textContent = [...(me.display_name || "?")][0];
  $("alreadyHi").textContent = `欢迎回来，${me.display_name}`;
  $("alreadyName").textContent = `${CCAuth.ROLE_NAMES[me.role] || me.role} · @${me.account || ""}`;
  $("already").classList.remove("hidden"); $("loginBox").classList.add("hidden");
})();
$("continueBtn").onclick = () => afterLogin(false);
$("switchBtn").onclick = async () => {
  await CCAuth.signOut();
  $("already").classList.add("hidden"); $("loginBox").classList.remove("hidden");
};
