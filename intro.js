// App 介绍页：开场的「群消息 → 日历」动画、一天里的天色变化、各个小演示
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const WD = "日一二三四五六";
  const now = new Date();

  // ---------- 把文字拆成一个个字，好做逐字动画 ----------
  function splitChars(el) {
    let i = 0;
    const walk = (node) => {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const ch of n.textContent) { const s = document.createElement("span"); s.className = "c"; s.style.setProperty("--i", i++); s.textContent = ch; frag.append(s); }
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== "BR") walk(n);
      }
    };
    walk(el);
  }

  // ================= 开场 =================
  const hero = $("#hero");
  const lines = $$(".line");
  lines.forEach(splitChars);
  let lineS = 0;
  function setLine(s) {
    lines.forEach((l, i) => { l.classList.toggle("out", i === lineS && i !== s); l.classList.toggle("on", i === s); });
    lineS = s;
  }

  // 群消息
  const fri = new Date(now); fri.setDate(fri.getDate() + 2);
  const MSGS = [
    ["小红", "班长", "#ff8fab", "@全体成员 国庆离校登记今晚 22:00 截止，还没填的抓紧", "a"],
    ["伟", "", "#7aa2d6", "收到"], ["想", "", "#f5a524", "收到"], ["帆", "", "#6cc28a", "stk:🐱"],
    ["涵", "", "#b38cff", "有人一起去食堂吗"], ["多", "", "#7aa2d6", "+1"],
    ["学委", "学委", "#ff8a3d", `高数作业：习题 3.2，周${WD[fri.getDay()]} 23:59 前交到学习通`, "b"],
    ["悦", "", "#6cc28a", "pic"], ["杰", "", "#f5a524", "收到"], ["迪", "", "#7aa2d6", "老师的 PPT 谁有，发一下"],
    ["爽", "", "#b38cff", "收到收到"],
    ["王", "王老师", "#e8590c", "明天下午 3 点 B302 开班会，都要到", "c"],
    ["晨", "", "#7aa2d6", "收到"], ["琳", "", "#ff8fab", "收到"], ["江", "", "#6cc28a", "stk:👍"],
    ["远", "", "#f5a524", "晚上谁去打球"], ["佳", "", "#7aa2d6", "收到"], ["山", "", "#b38cff", "收到"],
    ["雨", "", "#6cc28a", "哈哈哈哈哈哈哈"], ["糖", "", "#ff8fab", "收到"], ["诺", "", "#7aa2d6", "收到"],
    ["梅", "", "#f5a524", "pic"], ["峰", "", "#6cc28a", "收到"], ["琪", "", "#b38cff", "收到"],
  ];
  const NAMES = ["张伟", "李想", "王一帆", "赵子涵", "钱多多", "孙悦", "周杰", "吴迪", "郑爽", "陈晨", "林琳", "何江", "高远", "罗佳", "梁山", "宋雨", "唐糖", "许诺", "韩梅", "冯峰", "白琪"];
  const msgsEl = $("#msgs"), vp = $("#vp");
  let ni = 0;
  const msgEls = MSGS.map(([av, nm, col, text, k]) => {
    const m = document.createElement("div"); m.className = "m" + (k ? " hit" : ""); if (k) m.dataset.k = k;
    const a = document.createElement("span"); a.className = "av"; a.style.setProperty("--a", col); a.textContent = av.slice(-1);
    const box = document.createElement("div");
    const n = document.createElement("div"); n.className = "nm"; n.textContent = nm || NAMES[ni++ % NAMES.length];
    const b = document.createElement("div"); b.className = "bb";
    if (text === "pic") b.classList.add("pic");
    else if (text.startsWith("stk:")) { b.classList.add("stk"); b.textContent = text.slice(4); }
    else b.textContent = text;
    box.append(n, b); m.append(a, box); msgsEl.append(m);
    return m;
  });
  const N = msgEls.length;
  let offK = [], autoK = -1, shownK = -2, chatOff = 0, chatOffT = 0;
  function measureChat() {
    if (msgsEl.classList.contains("sift")) return;
    msgEls.forEach((m) => (m.style.maxHeight = ""));
    const H = vp.clientHeight, pad = 10;
    offK = msgEls.map((m) => Math.max(0, m.offsetTop + m.offsetHeight + pad - H));
    msgEls.forEach((m) => (m.style.maxHeight = m.offsetHeight + 2 + "px"));
  }

  // 日历（当前月份，事件放在今天、明天、后天）
  const calG = $("#calG");
  $("#calM").textContent = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  "一二三四五六日".split("").forEach((w) => { const d = document.createElement("div"); d.className = "wk"; d.textContent = w; calG.append(d); });
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const EV = { a: [0, "离校登记", "k-a"], c: [1, "班会", "k-c"], b: [2, "高数作业", "k-b"] };
  const chips = {};
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const evByDay = {};
  for (const k of Object.keys(EV)) { const d = new Date(now); d.setDate(d.getDate() + EV[k][0]); evByDay[dayKey(d)] = k; }
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const c = document.createElement("div"); c.className = "cd" + (d.getMonth() !== now.getMonth() ? " o" : "") + (dayKey(d) === dayKey(now) ? " t" : "");
    const n = document.createElement("i"); n.textContent = d.getDate(); c.append(n);
    const k = evByDay[dayKey(d)];
    if (k) { const ch = document.createElement("b"); ch.className = "chip " + EV[k][2]; ch.textContent = EV[k][1]; c.append(ch); chips[k] = ch; }
    calG.append(c);
  }
  { const d = new Date(now); d.setDate(d.getDate() + 2); $("#agB").textContent = `周${WD[d.getDay()]} 23:59`; }
  const lockD = $("#lockD"); if (lockD) lockD.textContent = `${now.getMonth() + 1}月${now.getDate()}日 星期${WD[now.getDay()]}`;

  // 飞行的消息
  const scr = $("#scr"), flyBox = $("#flyers");
  const order = ["a", "b", "c"];
  const flyers = order.map((k) => {
    const f = document.createElement("div"); f.className = "fly";
    const fb = document.createElement("div"); fb.className = "fb"; fb.textContent = $(`.m[data-k="${k}"] .bb`).textContent;
    const fc = document.createElement("div"); fc.className = "fc " + EV[k][2]; fc.textContent = EV[k][1];
    f.append(fb, fc); flyBox.append(f);
    return { k, f, fc, src: $(`.m[data-k="${k}"]`), bb: $(`.m[data-k="${k}"] .bb`), chip: chips[k], landed: false };
  });
  const rel = (el, base) => { const r = el.getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; };

  const chat = $("#chat"), cal = $("#cal"), noti = $("#noti"), lao = $("#lao"), arm = $(".lao .arm"), hint = $("#hint");
  const countEl = $("#count"), countN = $("#countN"), ags = $$(".ag");
  let cheered = false, lastUnread = "";

  function renderHero(p) {
    const s = p < 0.3 ? 0 : p < 0.62 ? 1 : 2;
    if (s !== lineS) setLine(s);
    if (hint) hint.style.opacity = 1 - seg(p, 0, 0.05);

    // ① 消息刷屏
    const sift = p >= 0.3;
    const scrollK = Math.round((N - 1) * seg(p, 0.02, 0.27));
    const k = sift ? N - 1 : Math.max(autoK, scrollK);
    if (k !== shownK) {
      shownK = k;
      msgEls.forEach((m, i) => m.classList.toggle("in", i <= k));
      const n = 12 + Math.max(0, k) * 4, txt = n >= 99 ? "99+" : String(n);
      if (txt !== lastUnread) { countN.textContent = txt; lastUnread = txt; countEl.classList.remove("bump"); void countEl.offsetWidth; countEl.classList.add("bump"); }
    }
    if (msgsEl.classList.contains("sift") !== sift) {
      msgsEl.classList.toggle("sift", sift);
      msgEls.forEach((m) => m.classList.toggle("gone", sift && !m.classList.contains("hit")));
    }
    chatOffT = sift ? 0 : offK[Math.max(0, k)] || 0;
    countEl.style.opacity = 1 - seg(p, 0.3, 0.38);
    countEl.style.transform = `scale(${1 - seg(p, 0.3, 0.38) * 0.4})`;

    // ② 捞捞登场，群聊淡出，日历出现
    const li = easeOut(seg(p, 0.27, 0.42));
    lao.style.transform = `translateY(${(1 - li) * 150}%) rotate(${(1 - li) * -16}deg)`;
    arm.style.transform = `rotate(${-Math.sin(seg(p, 0.44, 0.84) * Math.PI) * 30}deg)`;
    const cf = seg(p, 0.5, 0.68);
    chat.style.opacity = 1 - cf;
    chat.style.transform = cf ? `scale(${1 - cf * 0.06})` : "";
    chat.style.filter = cf ? `blur(${cf * 3}px)` : "";
    cal.style.opacity = seg(p, 0.5, 0.66);

    // ③ 三条要紧的消息飞进日历
    const sr = scr.getBoundingClientRect();
    flyers.forEach((F, i) => {
      const t = seg(p, 0.46 + i * 0.07, 0.63 + i * 0.07);
      F.src.style.visibility = t > 0 ? "hidden" : "";
      const landed = t >= 1;
      if (landed !== F.landed) { F.landed = landed; F.chip.classList.toggle("land", landed); F.chip.parentElement.classList.toggle("hot", landed); }
      if (t <= 0 || landed) { F.f.style.display = "none"; return; }
      const a = rel(F.bb, sr), b = rel(F.chip, sr), e = easeIO(t);
      const arc = Math.sin(Math.PI * e) * sr.height * 0.1;
      F.f.style.display = "block";
      F.f.style.left = lerp(a.x, b.x, e) + "px";
      F.f.style.top = lerp(a.y, b.y, e) - arc + "px";
      F.f.style.width = lerp(a.w, b.w, e) + "px";
      F.f.style.height = lerp(a.h, b.h, e) + "px";
      F.f.style.transform = `rotate(${Math.sin(Math.PI * e) * (i % 2 ? 6 : -6)}deg)`;
      F.fc.style.opacity = seg(e, 0.35, 0.8);
    });

    // ④ 今日列表 + 通知
    const agOn = p > 0.8;
    ags.forEach((g) => g.classList.toggle("in", agOn));
    noti.style.transform = `translateY(${(1 - easeOut(seg(p, 0.84, 0.92))) * -140}%)`;
    const ch = p > 0.86;
    if (ch !== cheered) { cheered = ch; if (ch) { lao.classList.remove("cheer"); void lao.getBoundingClientRect(); lao.classList.add("cheer"); } }
  }

  // ================= 一天的天色 =================
  const sky = $("#sky"), top = $("#top"), meta = document.querySelector('meta[name="theme-color"]');
  const sun = document.createElement("div"); sun.className = "orb sun";
  const moon = document.createElement("div"); moon.className = "orb moon";
  sky.append(sun, moon);
  const SKY = [ // [时刻, 上, 下, 文字, 次要文字]
    [7.5, "#bfe6ff", "#f3fbff"], [12, "#a6dcff", "#f0f9ff"], [15.5, "#ffd7ae", "#fff5ea"],
    [18.3, "#ff9f80", "#ffd6b3"], [19.6, "#3b3a8c", "#9a5b8f"], [21.5, "#141f4f", "#2c3474"], [23.5, "#0a1433", "#18234f"],
  ];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => "#" + hex(a).map((v, i) => Math.round(lerp(v, hex(b)[i], t)).toString(16).padStart(2, "0")).join("");
  const rows = $$(".hr"), HOURS = [7.5, 8, 12.17, 15.5, 21.5, 23];
  const day = $("#day"), getSec = $("#get");
  let rowY = [], dayTop = 0, getTop = 0, heroTop = 0, heroH = 1;
  function measurePage() {
    const Y = (el) => el.getBoundingClientRect().top + scrollY;
    rowY = rows.map((r) => Y(r) + r.offsetHeight / 2);
    dayTop = Y(day); getTop = Y(getSec); heroTop = Y(hero); heroH = hero.offsetHeight;
  }
  let lastHour = -1;
  function renderSky(y) {
    const c = y + innerHeight / 2;
    let h;
    if (c <= rowY[0]) h = 7.5;
    else if (c >= getTop) h = 23.5;
    else if (c >= rowY[rowY.length - 1]) h = lerp(23, 23.5, seg(c, rowY[rowY.length - 1], getTop));
    else { let i = 0; while (c > rowY[i + 1]) i++; h = lerp(HOURS[i], HOURS[i + 1], seg(c, rowY[i], rowY[i + 1])); }
    const vis = seg(y + innerHeight, dayTop, dayTop + innerHeight * 0.6);
    const key = h * 10 + vis;
    if (Math.abs(key - lastHour) < 0.003) return;
    lastHour = key;
    let j = 0; while (j < SKY.length - 2 && h > SKY[j + 1][0]) j++;
    const t = seg(h, SKY[j][0], SKY[j + 1][0]);
    const topC = mix(SKY[j][1], SKY[j + 1][1], t), botC = mix(SKY[j][2], SKY[j + 1][2], t);
    const st = document.documentElement.style;
    st.setProperty("--sky-top", topC); st.setProperty("--sky-bot", botC);
    st.setProperty("--stars", seg(h, 19.2, 21.5).toFixed(3));
    if (meta) meta.content = topC;
    document.body.classList.toggle("night", h >= 19);
    // 太阳从左边升起，傍晚落下；月亮接班
    const sp = seg(h, 6.5, 19.4), W = innerWidth, H = innerHeight;
    sun.style.opacity = (vis * 0.8 * (1 - seg(h, 18.8, 19.4))).toFixed(3);
    sun.style.transform = `translate(${lerp(W * 0.04, W * 0.96, sp)}px, ${H * 0.5 - Math.sin(Math.PI * sp) * H * 0.38}px)`;
    const mp = seg(h, 19.2, 23.5);
    moon.style.opacity = (seg(h, 19.2, 20.2)).toFixed(3);
    moon.style.transform = `translate(${lerp(W * 0.1, W * 0.82, mp)}px, ${H * 0.8 - Math.sin(Math.PI * (0.15 + mp * 0.5)) * H * 0.65}px)`;
  }

  // ================= 滚动驱动 =================
  let target = 0, cur = 0, raf = 0;
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  function tick() {
    raf = 0;
    cur += (target - cur) * 0.14;
    if (Math.abs(target - cur) < 0.0004) cur = target; else kick();
    renderHero(cur);
    chatOff += (chatOffT - chatOff) * 0.16;
    if (Math.abs(chatOffT - chatOff) < 0.3) chatOff = chatOffT; else kick();
    msgsEl.style.transform = `translateY(${-chatOff}px)`;
  }
  function onScroll() {
    const y = scrollY;
    top.classList.toggle("solid", y > 8);
    target = reduce ? 1 : clamp((y - heroTop) / Math.max(1, heroH - innerHeight));
    renderSky(y);
    kick();
  }
  function onResize() { measureChat(); measurePage(); lastHour = -1; onScroll(); }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  measureChat(); measurePage(); onScroll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  addEventListener("load", onResize);
  if (reduce) { cur = target = 1; renderHero(1); }
  else {
    // 还没往下滑时，消息自己一条条冒出来
    setTimeout(() => {
      const iv = setInterval(() => { if (autoK >= 7 || target > 0.02) { clearInterval(iv); return; } autoK++; kick(); }, 820);
    }, 500);
  }

  // ================= 07:30 每日鼓励 =================
  const QUOTES = [
    ["今天也是值得被期待的一天。", "Today is another day worth looking forward to.", "🌅", "#fdcbf1", "#a6c1ee"],
    ["别急，花会开的。", "Be patient, the flowers will bloom.", "🌸", "#43e97b", "#38f9d7"],
    ["你已经做得很好了。", "You're already doing great.", "✨", "#fa709a", "#fee140"],
    ["慢慢来，比较快。", "Slow and steady wins the race.", "🐢", "#a18cd1", "#fbc2eb"],
    ["今天的努力，是明天的底气。", "Today's effort is tomorrow's confidence.", "💪", "#667eea", "#764ba2"],
    ["先完成，再完美。", "Done is better than perfect.", "✅", "#43e97b", "#38f9d7"],
    ["一次只做一件事，做完就是胜利。", "One thing at a time — finishing is winning.", "🎯", "#f6d365", "#fda085"],
    ["世界很大，你的可能性更大。", "The world is big, your possibilities are bigger.", "🌍", "#89f7fe", "#66a6ff"],
  ];
  const MOODS = [["great", "😄", "超开心"], ["good", "🙂", "还不错"], ["meh", "😐", "一般般"], ["tired", "😮‍💨", "有点累"], ["down", "😢", "不开心"]];
  const REPLY = {
    great: ["开心的日子要记住！把好心情分一点给同桌吧 🎉", "今天状态满分，冲鸭！"],
    good: ["平平稳稳就是好日子 🙂", "保持住，今天也会顺顺利利。"],
    meh: ["一般般也没关系，做完一件小事就会好一点。", "听首喜欢的歌，再开始下一件事吧 🎧"],
    tired: ["累了就歇一会儿，喝口水、伸个懒腰 ☕", "今天早点睡，明天又是满血的你。"],
    down: ["抱抱你。难过的时候不用硬撑，找信任的朋友或老师聊聊 🤍", "今天不开心也没关系，明天会好一点的。"],
  };
  const enc = $("#enc"), encQ = $("#encQ"), encE = $("#encE"), encEn = $("#encEn");
  let qi = 0;
  function showQuote(i) {
    const [zh, en, em, g1, g2] = QUOTES[i];
    encQ.textContent = zh; splitChars(encQ);
    encEn.textContent = en; encE.textContent = em;
    enc.style.setProperty("--g1", g1); enc.style.setProperty("--g2", g2);
    encE.animate && !reduce && encE.animate([{ transform: "rotate(8deg) scale(.3)", opacity: 0 }, { transform: "rotate(-10deg) scale(1.2)", opacity: 1, offset: 0.6 }, { transform: "rotate(8deg) scale(1)" }], { duration: 600, easing: "cubic-bezier(.3,.7,.4,1.4)" });
  }
  showQuote(0);
  $("#encNext").addEventListener("click", () => { qi = (qi + 1) % QUOTES.length; showQuote(qi); });
  const moodsEl = $("#moods"), moodR = $("#moodR");
  let mc = 0;
  MOODS.forEach(([k, e, t]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chipbtn"; b.setAttribute("aria-pressed", "false"); b.textContent = `${e} ${t}`;
    b.addEventListener("click", () => {
      $$("button", moodsEl).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      moodR.textContent = REPLY[k][mc++ % REPLY[k].length];
      moodR.classList.remove("show"); void moodR.offsetWidth; moodR.classList.add("show");
    });
    moodsEl.append(b);
  });

  // ================= 12:10 班级墙 =================
  const like = $("#like"), likeN = $("#likeN"), burst = $("#burst");
  like.addEventListener("click", () => {
    const on = like.getAttribute("aria-pressed") !== "true";
    like.setAttribute("aria-pressed", String(on));
    likeN.textContent = on ? 24 : 23;
    if (!on || reduce) return;
    burst.innerHTML = "";
    const cols = ["#ff4d7a", "#ffd23f", "#4fc2ff", "#ff8a3d", "#b38cff"];
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("i"), a = (i / 12) * Math.PI * 2, r = 26 + Math.random() * 14;
      p.style.setProperty("--x", Math.cos(a) * r + "px"); p.style.setProperty("--y", Math.sin(a) * r + "px"); p.style.setProperty("--c", cols[i % cols.length]);
      burst.append(p);
    }
  });
  const cmtf = $("#cmtf"), cmtI = $("#cmtI"), cmts = $("#cmts");
  let added = 0;
  cmtf.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = cmtI.value.trim(); if (!v) { cmtI.focus(); return; }
    const d = document.createElement("div"), b = document.createElement("b"); b.textContent = "我："; d.append(b, v);
    cmts.append(d); cmtI.value = "";
    if (++added > 3) cmts.children[2].remove();
  });

  // ================= 15:30 番茄钟（演示里 1 秒 = 1 分钟） =================
  const pomo = $("#pomo"), pomoT = $("#pomoT"), pomoS = $("#pomoS"), pomoB = $("#pomoB"), arc = $("#pomoArc");
  const LEN = 326.7, DUR = 25000;
  let pStart = 0, pDone = 0, pRaf = 0, running = false;
  function pomoDraw() {
    const el = pDone + (running ? performance.now() - pStart : 0), t = clamp(el / DUR);
    const left = Math.round(25 * 60 * (1 - t));
    pomoT.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    arc.style.strokeDashoffset = (LEN * t).toFixed(1);
    if (t >= 1) {
      running = false; pDone = 0; pomo.classList.add("done");
      pomoT.textContent = "🍅"; pomoS.textContent = "完成一个番茄，+5 成长值"; pomoB.textContent = "再来一个";
      return;
    }
    if (running) pRaf = requestAnimationFrame(pomoDraw);
  }
  pomoB.addEventListener("click", () => {
    if (pomo.classList.contains("done")) { pomo.classList.remove("done"); pomoS.textContent = "一个番茄"; arc.style.strokeDashoffset = 0; }
    if (running) { running = false; pDone += performance.now() - pStart; cancelAnimationFrame(pRaf); pomoB.textContent = "继续"; pomoS.textContent = "暂停中"; return; }
    running = true; pStart = performance.now(); pomoB.textContent = "暂停"; pomoS.textContent = "演示：1 秒走 1 分钟"; pomoDraw();
  });

  // ================= 23:00 成长足迹 =================
  const heat = $("#heat"), streak = $("#streak");
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const COLS = 20;
  for (let i = 0; i < COLS * 7; i++) {
    const col = Math.floor(i / 7), r = rnd(), recent = col / COLS;
    const lv = col >= COLS - 3 ? 2 + Math.floor(r * 3) : r < 0.25 - recent * 0.2 ? 0 : 1 + Math.floor(r * (2 + recent * 3));
    const c = document.createElement("i"); if (lv) c.className = "h" + Math.min(4, lv); c.style.setProperty("--i", i); heat.append(c);
  }
  let counted = false;
  function countUp() {
    if (counted) return; counted = true;
    if (reduce) { streak.textContent = 21; return; }
    const t0 = performance.now();
    const step = (t) => { const k = clamp((t - t0) / 1400); streak.textContent = Math.round(21 * easeOut(k)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // 进入视野时播放
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio > 0.3) { e.target.classList.add("seen"); if (e.target.contains(heat)) countUp(); }
    else if (!e.isIntersecting) { e.target.classList.remove("seen"); if (e.target.contains(heat)) counted = false; }
  }), { threshold: [0, 0.3] });
  $$("[data-seen]").forEach((el) => io.observe(el));

  // ================= 换皮肤 =================
  const mini = $("#mini");
  $$(".skins button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k; if (mini.dataset.k === k) return;
    $$(".skins button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const sr = mini.querySelector(".screen").getBoundingClientRect(), br = b.getBoundingClientRect();
    document.documentElement.style.setProperty("--rx", ((br.left + br.width / 2 - sr.left) / sr.width) * 100 + "%");
    document.documentElement.style.setProperty("--ry", ((br.top - sr.top) / sr.height) * 100 + "%");
    if (document.startViewTransition && !reduce) document.startViewTransition(() => { mini.dataset.k = k; });
    else mini.dataset.k = k;
  }));
})();

// 电脑版：点右边的页面名，换左边的截图
(() => {
  const win = document.getElementById("pcWin"), img = document.getElementById("pcShot");
  if (!win || !img) return;
  const tabs = Array.from(document.querySelectorAll(".pctabs [data-shot]"));
  const show = (b) => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    const src = "download/pc/" + b.dataset.shot + ".webp";
    if (img.getAttribute("src") === src) return;
    img.classList.add("fade");
    const pre = new Image();
    pre.onload = pre.onerror = () => { img.src = src; img.alt = "捞捞课程表电脑版：" + b.dataset.alt; win.classList.toggle("dark", b.dataset.shot === "ai"); img.classList.remove("fade"); };
    pre.src = src;
  };
  tabs.forEach((b) => b.addEventListener("click", () => show(b)));
  // 自动轮播，鼠标放上去或点过就停
  let auto = setInterval(() => { const i = tabs.findIndex((x) => x.getAttribute("aria-selected") === "true"); show(tabs[(i + 1) % tabs.length]); }, 4500);
  const stop = () => { clearInterval(auto); auto = 0; };
  win.addEventListener("mouseenter", stop); tabs.forEach((b) => b.addEventListener("click", stop));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => { if (!es[0].isIntersecting && auto) { clearInterval(auto); auto = -1; } else if (es[0].isIntersecting && auto === -1) auto = setInterval(() => { const i = tabs.findIndex((x) => x.getAttribute("aria-selected") === "true"); show(tabs[(i + 1) % tabs.length]); }, 4500); });
    io.observe(win);
  }
})();
