// ===== 云宠农场：完成作业、打卡、番茄钟攒「养料」，喂你的云宠长大 =====
// 原来是队友做的「云养殖」插件（在隔离间里运行，读不到网站的数据，只能自己另记一套任务）。
// 现在并进网站本体：
//  · 养料直接从网站里真实的记录算出来——勾完成的事项、习惯打卡、番茄钟，和「成长值」是同一套规则，
//    所以不用在农场里再勾一遍，也刷不了分（同一件事反复勾只算一次，打卡、番茄有每天上限）；
//  · 宠物（种类、名字、等级、经验、花掉的养料）存在账号里（farm_v1），换浏览器、换手机登录还是那只。
// 这个文件放在 app.js 前面加载：顶层只定义函数，用到 app.js 里的东西都在函数被调用时才去拿。
const LS_FARM = "farm_v1";
const FARM_FEED_COST = 10, FARM_FEED_EXP = 20;
const FARM_STAGE = ["孵化中", "幼崽期", "成长期", "完全体", "传说形态"];
const FARM_EVO = [[1, "孵化"], [2, "幼崽"], [4, "成长期"], [7, "完全体"], [10, "传说"]];
const farmExpNeed = (lv) => 80 + (lv - 1) * 40;
const FARM_HELLO = ["今天也一起加油呀", "完成一件事，我就能吃饱一点", "你专心的样子好帅", "打卡了吗？我在等养料哦", "慢慢来，比较快", "今天的你也很棒"];

let farmCache = null;
function farmState() {
  if (!farmCache) {
    const v = load(LS_FARM, null) || {};
    farmCache = { pet: "cloud", name: "小云朵", level: 1, exp: 0, spent: 0, fed: 0, ...v };
    if (!PETS.some((p) => p.id === farmCache.pet)) farmCache.pet = "cloud";
  }
  return farmCache;
}
function farmSave(patch) { farmCache = { ...farmState(), ...patch, at: Date.now() }; save(LS_FARM, farmCache); }
function farmReload() { farmCache = null; }
const farmOn = () => feat("growth") && funOpts().farm !== false;

// 养料账本：按天算，规则和成长值一样，另外加上原来云养殖的两个奖励
//   完成作业 +10，其它事项 +5；习惯打卡 +3（每天最多 5 次）；番茄钟 +2（每天最多 12 个）
//   一天完成 3 件事以上再 +5；连续 3 天以上有动静，每天再 +3
function farmLedger() {
  const byKey = new Map(allItems().map((r) => [r._key, r]));
  const days = {}, D = (d) => (days[d] ||= { done: 0, hw: 0, habit: 0, pomo: 0, food: 0, bonus: 0 });
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
  for (const [k, d] of Object.entries(doneLog)) {
    if (!isDay(d)) continue;
    const r = byKey.get(k), x = D(d); x.done++;
    if (r && r.msg_type === "作业") x.hw++;
  }
  for (const h of Object.values(habitLog)) for (const d in h || {}) if (h[d] && isDay(d)) D(d).habit++;
  for (const [d, n] of Object.entries(pomoLog)) if (isDay(d) && +n > 0) D(d).pomo += +n;
  const keys = Object.keys(days).sort();
  let run = 0, prev = "", total = 0;
  for (const d of keys) {
    const x = days[d];
    x.food = x.hw * 10 + (x.done - x.hw) * 5 + Math.min(x.habit, 5) * 3 + Math.min(x.pomo, 12) * 2;
    if (x.done >= 3) x.bonus += 5;
    run = prev && shiftDay(prev, 1) === d ? run + 1 : 1; prev = d;
    if (run >= 3) x.bonus += 3;
    x.food += x.bonus; total += x.food;
  }
  // 现在连续了几天（今天还没动静的话，算到昨天为止）
  let streak = 0, k = todayKey();
  if (!days[k]) k = shiftDay(k, -1);
  while (days[k]) { streak++; k = shiftDay(k, -1); }
  return { days, total, today: (days[todayKey()] || { food: 0 }).food, streak };
}
function farmNumbers() {
  const L = farmLedger(), s = farmState();
  return { ...L, left: Math.max(0, L.total - (s.spent || 0)) };
}

// 喂一次（或者一直喂到升级 / 养料用完）
function farmFeed(untilLevel) {
  const s = farmState(), n = farmNumbers();
  let left = n.left, level = s.level, exp = s.exp, spent = s.spent || 0, fed = s.fed || 0, times = 0, ups = 0;
  if (left < FARM_FEED_COST) { showBanner("养料不够啦：去完成一件事、打个卡或者专注一个番茄 🌾"); setTimeout(() => showBanner(""), 3000); return; }
  do {
    left -= FARM_FEED_COST; spent += FARM_FEED_COST; fed++; times++; exp += FARM_FEED_EXP;
    while (exp >= farmExpNeed(level)) { exp -= farmExpNeed(level); level++; ups++; }
  } while (untilLevel && !ups && left >= FARM_FEED_COST && times < 200);
  const before = petStage(s.level);
  farmSave({ level, exp, spent, fed });
  renderFarm(); renderWidgets();
  const fig = $("farmFig"); if (fig) { fig.classList.remove("bounce"); void fig.offsetWidth; fig.classList.add("bounce"); }
  if (petStage(level) > before) { farmToast(`✨ 进化了！${s.name} 变成了「${FARM_STAGE[petStage(level)]}」`); if (funOpts().confetti) confetti(60); }
  else if (ups) farmToast(`🎉 升级啦！现在是 Lv.${level}`);
  else farmToast(times > 1 ? `🥕 喂了 ${times} 次，经验 +${times * FARM_FEED_EXP}` : `🥕 好吃！经验 +${FARM_FEED_EXP}`);
}
let farmToastT = 0;
function farmToast(msg) {
  const t = $("farmToast"); if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(farmToastT); farmToastT = setTimeout(() => t.classList.remove("show"), 2200);
}

// 首页、成长页上的小卡片
function farmMini(size) {
  const s = farmState(), n = farmNumbers();
  return `<span class="fm-fig" style="width:${size}px">${petSVG(s.pet, s.level)}</span>
    <span class="fm-txt"><b>${esc(s.name)} <em>Lv.${s.level}</em></b><small>💧 养料 ${n.left}${n.left >= FARM_FEED_COST ? " · 可以喂啦" : ""}</small></span>`;
}
function farmCard(h) {
  return `<button class="surface wb wfarm${h >= 2 ? " big" : ""}" data-tab="farm">${farmMini(h >= 2 ? 120 : 64)}<span class="go2">喂养 ›</span></button>`;
}
function renderFarmEntry() {
  const b = $("farmEntry"); if (!b) return;
  b.classList.toggle("hidden", !farmOn());
  if (farmOn()) b.innerHTML = farmMini(54) + `<span class="re-go">›</span>`;
}

// 这周的数据：和成长页的进度环同一套算法
function farmWeekBar() {
  const w = weekStats(), n = farmNumbers(), pomoToday = +pomoLog[todayKey()] || 0;
  const bits = [["📝", "本周作业", `${w.hwDone}/${w.hwAll}`], ["✅", "本周事项", `${w.allDone}/${w.all}`]];
  if (funOpts().habits) bits.push(["🔥", "今日打卡", `${w.hDone}/${w.hAll}`]);
  bits.push(["🍅", "今日番茄", pomoToday], ["📆", "连续", `${n.streak} 天`]);
  let rank = "";
  if (currentUser && currentClass && !currentClass.is_teacher && feat("rank")) {
    if (rankCache && rankCache.cid === currentClass.id && rankCache.period === "week") {
      const me = rankCache.data.rows.find((r) => r.me);
      rank = me ? `<button class="fw-it fw-rank" data-tab="rank"><span>🏆</span><small>本周成长值</small><b>${me.points} · 第 ${me.rank} 名</b></button>` : "";
    } else loadRankData("week").then(() => renderFarm()).catch(() => {});
  }
  return bits.map(([i, t, v]) => `<div class="fw-it"><span>${i}</span><small>${t}</small><b>${v}</b></div>`).join("") + rank;
}

// 现在就能做的事：没完成的作业 / 事项（一周内到期、或者没定日子），今天还没打的卡
function farmTodo() {
  const t = todayKey(), end = shiftDay(t, 7);
  const items = allItems().filter((r) => !r._plugin && !r._done && !r._hidden && (!r._p || (r._p.day >= shiftDay(t, -3) && r._p.day <= end)))
    .sort((a, b) => (a._p ? a._p.day + (a._p.time || "99") : "9").localeCompare(b._p ? b._p.day + (b._p.time || "99") : "9")).slice(0, 8);
  const hs = funOpts().habits ? habits.filter((h) => !(habitLog[h.id] || {})[t]) : [];
  const rows = items.map((r) => {
    const gain = r.msg_type === "作业" ? 10 : 5, di = dueInfo(r);
    return `<div class="ft-row"><button class="chk" data-act="done" data-k="${esc(r._key)}" title="完成">${""}</button>
      <div class="ft-m"><b>${esc(r.subject || r.summary || "事项")}</b><small><span class="ft-tag">${esc(r.msg_type)}</span>${esc(di.text)}</small></div><span class="ft-gain">+${gain}</span></div>`;
  }).concat(hs.map((h) => `<div class="ft-row"><button class="chk" data-fhabit="${esc(h.id)}" title="打卡"></button>
      <div class="ft-m"><b>${esc(h.icon)} ${esc(h.name)}</b><small><span class="ft-tag">打卡</span>今天还没打</small></div><span class="ft-gain">+3</span></div>`));
  return rows.join("") || `<div class="ft-empty">手头的事都做完了 🎉 可以去<a href="#" data-tab="plan">专注一个番茄</a>，每个 +2 养料</div>`;
}

function farmHistory(L) {
  const days = [...Array(7)].map((_, i) => shiftDay(todayKey(), i - 6)), max = Math.max(10, ...days.map((d) => (L.days[d] || {}).food || 0));
  return `<div class="fh-bars">${days.map((d) => { const x = L.days[d] || { food: 0 }; return `<div class="fh-b${d === todayKey() ? " today" : ""}" title="${d}：${x.food} 养料">
    <i style="height:${Math.round(x.food / max * 100)}%"></i><b>${x.food || ""}</b><small>${d === todayKey() ? "今天" : "周" + WEEK[new Date(d + "T00:00:00").getDay()]}</small></div>`; }).join("")}</div>`;
}

function renderFarm() {
  renderFarmEntry();
  const v = document.querySelector('.view[data-view="farm"]');
  if (!v || !v.classList.contains("on")) return;
  const s = farmState(), n = farmNumbers(), p = petCfg(s.pet), st = petStage(s.level), need = farmExpNeed(s.level);
  const pct = Math.min(100, Math.round(s.exp / need * 100));
  const nextEvo = FARM_EVO.find(([lv]) => lv > s.level);
  $("farmPet").innerHTML = `
    <div class="fp-top"><span class="fp-name">${esc(s.name)}</span><button class="small" id="farmRename" title="改名">✏️</button><span class="spacer"></span><span class="fp-lv">Lv.${s.level}</span></div>
    <div class="fp-say">${esc(FARM_HELLO[(new Date().getDate() + s.level) % FARM_HELLO.length])}</div>
    <button class="fp-fig" id="farmFig" title="摸摸头">${petSVG(s.pet, s.level)}</button>
    <div class="fp-stage"><b>${esc(p.name)}</b> · ${FARM_STAGE[st]} ${[0, 1, 2, 3, 4].map((i) => `<i class="${i <= st ? "on" : ""}"></i>`).join("")}</div>
    <div class="fp-exp"><span><i style="width:${pct}%"></i></span><small>经验 ${s.exp}/${need}</small></div>
    ${nextEvo ? `<div class="fp-next">再升到 Lv.${nextEvo[0]} 进化成「${nextEvo[1]}」</div>` : `<div class="fp-next">已经是传说形态啦 ✨</div>`}
    <div class="fp-stats"><div><b>${n.left}</b><small>💧 养料</small></div><div><b>${n.today}</b><small>今天获得</small></div><div><b>${n.total}</b><small>一共获得</small></div><div><b>${s.fed || 0}</b><small>喂过几次</small></div></div>
    <div class="fp-act"><button class="btn ink" id="farmFeed"${n.left < FARM_FEED_COST ? " disabled" : ""}>🥕 喂一次<small>-${FARM_FEED_COST} 养料</small></button>
      <button class="btn" id="farmFeedUp"${n.left < FARM_FEED_COST ? " disabled" : ""}>⚡ 喂到升级</button><button class="btn" id="farmSwitch">🔄 换云宠</button></div>`;
  $("farmWeek").innerHTML = farmWeekBar();
  $("farmTodo").innerHTML = farmTodo();
  $("farmHist").innerHTML = farmHistory(n);
}

// 换云宠：6 种可选，等级和经验跟着走；下面是当前云宠的进化路线
function farmPick() {
  const s = farmState();
  const d = $("farmDlg");
  const draw = () => {
    const cur = farmState().pet;
    $("farmPets").innerHTML = PETS.map((p) => `<button type="button" class="fpk${p.id === cur ? " on" : ""}" data-pet="${p.id}"><span>${petSVG(p.id, Math.max(2, s.level))}</span><b>${esc(p.name)}</b><small>${esc(p.kind)}</small></button>`).join("");
    $("farmEvo").innerHTML = FARM_EVO.map(([lv, nm], i) => `<div class="fev${petStage(s.level) >= i ? " on" : ""}"><span>${petSVG(cur, lv)}</span><b>${nm}</b><small>Lv.${lv}</small></div>`).join('<i class="fev-a">›</i>');
  };
  draw();
  d.showModal();
  $("farmPets").onclick = (e) => { const b = e.target.closest("[data-pet]"); if (!b) return; farmSave({ pet: b.dataset.pet }); draw(); renderFarm(); renderWidgets(); farmToast(`换成「${petCfg(b.dataset.pet).name}」啦 🎈`); };
}
function farmRename() {
  const s = farmState(), v = prompt("给云宠起个名字（最多 12 个字）", s.name);
  if (v == null) return;
  const name = v.trim().slice(0, 12);
  if (name) { farmSave({ name }); renderFarm(); renderWidgets(); farmToast(`新名字「${name}」好可爱 ✨`); }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('.view[data-view="farm"], #farmDlg')) return;
  if (t.closest("#farmFeed")) return farmFeed(false);
  if (t.closest("#farmFeedUp")) return farmFeed(true);
  if (t.closest("#farmSwitch")) return farmPick();
  if (t.closest("#farmRename")) return farmRename();
  if (t.closest("#farmDlgClose")) return $("farmDlg").close();
  if (t.closest("#farmFig")) { const f = $("farmFig"); f.classList.remove("bounce"); void f.offsetWidth; f.classList.add("bounce"); return; }
  const h = t.closest("[data-fhabit]"); if (h) { toggleHabit(h.dataset.fhabit); renderFarm(); }
});
// ===== 云宠形象（队友设计，原「云养殖」插件里的内联 SVG，原样搬过来） =====
// 软糯 3D 潮玩风：6 种云宠 × 5 个进化阶段（蛋 → 幼崽 → 正装 → 手持道具 → 光环云翼星尘），全部用 SVG 画，不需要图片
var petUid = 0;
var PETS = [
  { id: "cloud",  name: "云朵精灵", kind: "人形 · 云朵", prop: "cloud",
    face: ["#FFFFFF", "#EFF5FD", "#C6D8F0"], hair: ["#FDFBFF", "#EBE2FB", "#CBB9F0"],
    accent: "#A9C6EC", deep: "#8FB0DE", blush: "#FFC2D6", eye: "#3B3350", mouth: "#C08498" },
  { id: "berry",  name: "草莓精灵", kind: "人形 · 水果", prop: "berry",
    face: ["#FFF9FA", "#FFE7ED", "#F7C5D3"], hair: ["#FFA3B7", "#FF7C99", "#E85A7C"],
    accent: "#7BC47F", deep: "#E85A7C", blush: "#FF9FB4", eye: "#4A2A38", mouth: "#C06078" },
  { id: "rice",   name: "米粒精灵", kind: "人形 · 谷物", prop: "rice",
    face: ["#FFFDF8", "#FBF2E0", "#E9D7B4"], hair: ["#FFFBF0", "#F7EBD2", "#DFC79C"],
    accent: "#A8C98A", deep: "#D9C08A", blush: "#FFCFA8", eye: "#5A4A32", mouth: "#B08060" },
  { id: "bread",  name: "面包精灵", kind: "人形 · 烘焙", prop: "bread",
    face: ["#FFFCF4", "#FBEDD4", "#E7CDA0"], hair: ["#F7DDAC", "#E8BE7E", "#C99A54"],
    accent: "#D9A066", deep: "#C08A50", blush: "#FFB88C", eye: "#5A4028", mouth: "#A8703C" },
  { id: "cat",    name: "奶油猫咪", kind: "动物 · 猫", prop: "cat",
    face: ["#FFFDF8", "#FBF0DC", "#EED8B8"], hair: ["#FFEAD2", "#FFD6AC", "#E8B87C"],
    accent: "#F0A8C0", deep: "#E8B87C", blush: "#FFB0C0", eye: "#4A3A2A", mouth: "#B0786C" },
  { id: "sprout", name: "树苗精灵", kind: "植物 · 树", prop: "sprout",
    face: ["#FCFFF9", "#ECF8E6", "#C8E4BC"], hair: ["#93D893", "#6FBF74", "#4F9E5C"],
    accent: "#B8895E", deep: "#4F9E5C", blush: "#FFC8C8", eye: "#2E4A2E", mouth: "#8A6A4A" }
];


function petCfg(id) {
  for (var i = 0; i < PETS.length; i++) if (PETS[i].id === id) return PETS[i];
  return PETS[0];
}
function petStage(level) {
  if (level >= 10) return 4;
  if (level >= 7)  return 3;
  if (level >= 4)  return 2;
  if (level >= 2)  return 1;
  return 0;
}

function svgGrad(id, cols) {
  return '<radialGradient id="' + id + '" cx="34%" cy="26%" r="80%">' +
    '<stop offset="0%" stop-color="' + cols[0] + '"/>' +
    '<stop offset="56%" stop-color="' + cols[1] + '"/>' +
    '<stop offset="100%" stop-color="' + cols[2] + '"/></radialGradient>';
}
function svgGloss(cx, cy, rx, ry, op) {
  return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="#fff" opacity="' + op + '"/>';
}
function svgStar(x, y, r, fill, op) {
  var d = "M" + x + " " + (y - r) + " L" + (x + r * .3) + " " + (y - r * .3) + " L" + (x + r) + " " + y +
          " L" + (x + r * .3) + " " + (y + r * .3) + " L" + x + " " + (y + r) + " L" + (x - r * .3) + " " + (y + r * .3) +
          " L" + (x - r) + " " + y + " L" + (x - r * .3) + " " + (y - r * .3) + " Z";
  return '<path d="' + d + '" fill="' + fill + '" opacity="' + op + '"/>';
}

/* --- 阶段 0：蛋 / 种子 --- */
function petEgg(p, u) {
  var o = [];
  o.push('<ellipse cx="100" cy="176" rx="52" ry="13" fill="' + p.face[2] + '" opacity=".5"/>');
  o.push('<path d="M100 48 C 138 48 158 92 158 128 C 158 160 132 178 100 178 C 68 178 42 160 42 128 C 42 92 62 48 100 48 Z" fill="url(#fb' + u + ')"/>');
  o.push('<path d="M62 112 Q 100 128 138 112" stroke="' + p.face[2] + '" stroke-width="3.5" fill="none" opacity=".6" stroke-linecap="round"/>');
  o.push('<path d="M56 138 Q 100 154 144 138" stroke="' + p.face[2] + '" stroke-width="3.5" fill="none" opacity=".42" stroke-linecap="round"/>');
  o.push(svgStar(100, 92, 11, p.accent, .85));
  o.push(svgGloss(74, 84, 15, 26, .55));
  o.push('<circle cx="132" cy="150" r="7" fill="#fff" opacity=".3"/>');
  return o.join('');
}

/* --- 各阶段几何参数（头身比例：大头 + 完整小身体，参考潮玩比例） --- */
var GEO = {
  1: { hcy: 96, hrx: 50, hry: 46, by: 156, brx: 25, bry: 22, leg: 0,   arm: 154, armr: 7.5 },
  2: { hcy: 84, hrx: 44, hry: 42, by: 148, brx: 30, bry: 28, leg: 178, arm: 148, armr: 9 },
  3: { hcy: 82, hrx: 43, hry: 41, by: 146, brx: 31, bry: 29, leg: 177, arm: 146, armr: 9 },
  4: { hcy: 80, hrx: 42, hry: 40, by: 144, brx: 31, bry: 29, leg: 176, arm: 144, armr: 9 }
};
var HAIR_TOP = { 1: 48, 2: 40, 3: 38, 4: 37 };

/* --- 阶段 4：背后光环（柔和，不抢角色；半径收在画布内） --- */
function petAura(p, u) {
  return '<circle cx="100" cy="106" r="88" fill="url(#au' + u + ')"/>';
}

/* --- 阶段 4：云翼（坐标全部落在 viewBox 0..200 内，用 accent 色保证可见） --- */
function petWings(p, u) {
  var o = [];
  // 外层大翼
  o.push('<path d="M72 114 C 36 88 10 114 16 146 C 22 172 54 172 70 150 Z" fill="' + p.accent + '" opacity=".62"/>');
  o.push('<path d="M128 114 C 164 88 190 114 184 146 C 178 172 146 172 130 150 Z" fill="' + p.accent + '" opacity=".62"/>');
  // 内层亮翼（层次）
  o.push('<path d="M74 120 C 48 102 30 120 36 140 C 42 158 62 158 71 145 Z" fill="#ffffff" opacity=".8"/>');
  o.push('<path d="M126 120 C 152 102 170 120 164 140 C 158 158 138 158 129 145 Z" fill="#ffffff" opacity=".8"/>');
  // 翼尖点缀
  o.push('<circle cx="42" cy="136" r="4.5" fill="' + p.hair[1] + '" opacity=".85"/>');
  o.push('<circle cx="158" cy="136" r="4.5" fill="' + p.hair[1] + '" opacity=".85"/>');
  return o.join('');
}

/* --- 身体（腿 / 手脚 / 衣服 / 领结） --- */
function petBody(p, u, s) {
  var G = GEO[s];
  var o = [];
  // 落地投影
  o.push('<ellipse cx="100" cy="186" rx="42" ry="11" fill="' + p.face[2] + '" opacity=".4"/>');
  // 腿
  if (G.leg) {
    o.push('<ellipse cx="87" cy="' + G.leg + '" rx="10" ry="8" fill="url(#fb' + u + ')"/>');
    o.push('<ellipse cx="113" cy="' + G.leg + '" rx="10" ry="8" fill="url(#fb' + u + ')"/>');
  }
  // 身体
  o.push('<ellipse cx="100" cy="' + G.by + '" rx="' + G.brx + '" ry="' + G.bry + '" fill="url(#fb' + u + ')"/>');
  // 手（贴在身体两侧）
  o.push('<circle cx="' + (100 - G.brx - 2) + '" cy="' + G.arm + '" r="' + G.armr + '" fill="url(#fb' + u + ')"/>');
  o.push('<circle cx="' + (100 + G.brx + 2) + '" cy="' + G.arm + '" r="' + G.armr + '" fill="url(#fb' + u + ')"/>');
  // 围裙 / 小衣服（阶段 2+，贴合身体下缘）
  if (s >= 2) {
    var ty = G.by - 9, byy = G.by + 17;
    o.push('<path d="M' + (100 - 19) + ' ' + ty + ' Q100 ' + (ty - 9) + ' ' + (100 + 19) + ' ' + ty +
      ' L' + (100 + 22) + ' ' + byy + ' Q100 ' + (byy + 12) + ' ' + (100 - 22) + ' ' + byy + ' Z" fill="' +
      p.accent + '" opacity=".72"/>');
    o.push('<path d="M' + (100 - 19) + ' ' + ty + ' Q100 ' + (ty - 9) + ' ' + (100 + 19) + ' ' + ty +
      '" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/>');
  }
  // 领结（阶段 3+）
  if (s >= 3) {
    var ny = G.by - 15;
    o.push('<path d="M100 ' + ny + ' l -11 -6 l 0 12 z" fill="' + p.deep + '"/>');
    o.push('<path d="M100 ' + ny + ' l 11 -6 l 0 12 z" fill="' + p.deep + '"/>');
    o.push('<circle cx="100" cy="' + ny + '" r="4.6" fill="' + p.deep + '"/>');
  }
  // 身体高光
  o.push(svgGloss(100 - G.brx * .42, G.by - G.bry * .5, G.brx * .3, G.bry * .28, .42));
  return o.join('');
}

/* --- 头部（含脸） --- */
function petHead(p, u, s) {
  var G = GEO[s];
  return '<ellipse cx="100" cy="' + G.hcy + '" rx="' + G.hrx + '" ry="' + G.hry + '" fill="url(#fb' + u + ')"/>' +
    svgGloss(100 - G.hrx * .36, G.hcy - G.hry * .34, G.hrx * .28, G.hry * .32, .55) +
    svgFace(p, s, G.hcy, G.hrx);
}

function svgFace(p, s, cy, rx) {
  var ex = rx * .34;
  var ey = cy + rx * .06;
  var erx = [0, rx * .15, rx * .155, rx * .16, rx * .165][s];
  var ery = [0, rx * .2, rx * .21, rx * .22, rx * .23][s];
  var o = [];
  // 眼白
  o.push('<ellipse cx="' + (100 - ex) + '" cy="' + ey + '" rx="' + (erx * 1.5) + '" ry="' + (ery * 1.18) + '" fill="#fff" opacity=".92"/>');
  o.push('<ellipse cx="' + (100 + ex) + '" cy="' + ey + '" rx="' + (erx * 1.5) + '" ry="' + (ery * 1.18) + '" fill="#fff" opacity=".92"/>');
  // 瞳孔
  o.push('<ellipse cx="' + (100 - ex) + '" cy="' + (ey + 1) + '" rx="' + erx + '" ry="' + ery + '" fill="' + p.eye + '"/>');
  o.push('<ellipse cx="' + (100 + ex) + '" cy="' + (ey + 1) + '" rx="' + erx + '" ry="' + ery + '" fill="' + p.eye + '"/>');
  // 高光
  o.push('<circle cx="' + (100 - ex + erx * .35) + '" cy="' + (ey - ery * .4) + '" r="' + (erx * .44) + '" fill="#fff"/>');
  o.push('<circle cx="' + (100 + ex + erx * .35) + '" cy="' + (ey - ery * .4) + '" r="' + (erx * .44) + '" fill="#fff"/>');
  o.push('<circle cx="' + (100 - ex - erx * .3) + '" cy="' + (ey + ery * .38) + '" r="' + (erx * .22) + '" fill="#fff" opacity=".6"/>');
  o.push('<circle cx="' + (100 + ex - erx * .3) + '" cy="' + (ey + ery * .38) + '" r="' + (erx * .22) + '" fill="#fff" opacity=".6"/>');
  // 阶段 4：星光眼
  if (s >= 4) {
    o.push(svgStar(100 - ex + erx * .3, ey - ery * .5, erx * .55, "#FFE6A8", .95));
    o.push(svgStar(100 + ex + erx * .3, ey - ery * .5, erx * .55, "#FFE6A8", .95));
  }
  // 腮红
  o.push('<ellipse cx="' + (100 - ex - rx * .3) + '" cy="' + (ey + rx * .22) + '" rx="' + (rx * .21) + '" ry="' + (rx * .13) + '" fill="' + p.blush + '" opacity=".62"/>');
  o.push('<ellipse cx="' + (100 + ex + rx * .3) + '" cy="' + (ey + rx * .22) + '" rx="' + (rx * .21) + '" ry="' + (rx * .13) + '" fill="' + p.blush + '" opacity=".62"/>');
  // 微笑
  o.push('<path d="M' + (100 - rx * .17) + ' ' + (ey + rx * .3) + ' Q100 ' + (ey + rx * .44) + ' ' + (100 + rx * .17) + ' ' + (ey + rx * .3) + '" stroke="' + p.mouth + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>');
  return o.join('');
}

/* --- 主题头饰（云朵 / 草莓 / 米粒 / 面包 / 猫耳 / 叶片） --- */
function petHair(p, u, s) {
  var top = HAIR_TOP[s];
  var k = [0, .82, 1, 1, 1][s];
  var o = [];
  var t = p.prop;
  if (t === "cloud") {
    // 蓬松云朵绒发：一大两小，边缘再补两个小球更蓬
    o.push('<circle cx="100" cy="' + (top - 3 * k) + '" r="' + (26 * k) + '" fill="url(#hb' + u + ')"/>');
    o.push('<circle cx="' + (100 - 26 * k) + '" cy="' + (top + 9 * k) + '" r="' + (18 * k) + '" fill="url(#hb' + u + ')"/>');
    o.push('<circle cx="' + (100 + 26 * k) + '" cy="' + (top + 9 * k) + '" r="' + (18 * k) + '" fill="url(#hb' + u + ')"/>');
    o.push('<circle cx="' + (100 - 15 * k) + '" cy="' + (top - 15 * k) + '" r="' + (14 * k) + '" fill="url(#hb' + u + ')"/>');
    o.push('<circle cx="' + (100 + 15 * k) + '" cy="' + (top - 15 * k) + '" r="' + (14 * k) + '" fill="url(#hb' + u + ')"/>');
    o.push(svgGloss(100 - 12 * k, top - 12 * k, 9 * k, 7 * k, .5));
  } else if (t === "berry") {
    // 草莓帽：果实 + 蒂叶 + 籽
    o.push('<ellipse cx="100" cy="' + (top + 4 * k) + '" rx="' + (31 * k) + '" ry="' + (27 * k) + '" fill="url(#hb' + u + ')"/>');
    o.push('<path d="M100 ' + (top - 20 * k) + ' l ' + (-15 * k) + ' ' + (-12 * k) + ' l ' + (15 * k) + ' ' + (7 * k) +
      ' l ' + (15 * k) + ' ' + (-7 * k) + ' z" fill="' + p.accent + '"/>');
    o.push('<path d="M100 ' + (top - 20 * k) + ' l 0 ' + (-8 * k) + '" stroke="' + p.accent + '" stroke-width="' + (3 * k) + '" stroke-linecap="round"/>');
    o.push('<circle cx="' + (100 - 13 * k) + '" cy="' + (top + 2 * k) + '" r="' + (2.3 * k) + '" fill="#fff" opacity=".8"/>');
    o.push('<circle cx="' + (100 + 6 * k) + '" cy="' + (top + 14 * k) + '" r="' + (2.3 * k) + '" fill="#fff" opacity=".8"/>');
    o.push('<circle cx="' + (100 + 18 * k) + '" cy="' + (top - 4 * k) + '" r="' + (2.3 * k) + '" fill="#fff" opacity=".8"/>');
    o.push(svgGloss(100 - 16 * k, top - 6 * k, 8 * k, 6 * k, .5));
  } else if (t === "rice") {
    // 米粒尖帽：饱满的水滴 + 稻穗
    o.push('<path d="M100 ' + (top - 24 * k) + ' C ' + (100 + 23 * k) + ' ' + (top - 6 * k) + ' ' + (100 + 27 * k) + ' ' + (top + 13 * k) +
      ' 100 ' + (top + 25 * k) + ' C ' + (100 - 27 * k) + ' ' + (top + 13 * k) + ' ' + (100 - 23 * k) + ' ' + (top - 6 * k) +
      ' 100 ' + (top - 24 * k) + ' Z" fill="url(#hb' + u + ')"/>');
    o.push('<path d="M100 ' + (top - 22 * k) + ' l 0 ' + (-13 * k) + '" stroke="' + p.accent + '" stroke-width="' + (3.4 * k) + '" stroke-linecap="round"/>');
    o.push('<ellipse cx="' + (100 + 6 * k) + '" cy="' + (top - 31 * k) + '" rx="' + (7.5 * k) + '" ry="' + (3.6 * k) + '" fill="' + p.accent + '" transform="rotate(-32 ' + (100 + 6 * k) + ' ' + (top - 31 * k) + ')"/>');
    o.push('<ellipse cx="' + (100 - 6 * k) + '" cy="' + (top - 31 * k) + '" rx="' + (7.5 * k) + '" ry="' + (3.6 * k) + '" fill="' + p.accent + '" transform="rotate(32 ' + (100 - 6 * k) + ' ' + (top - 31 * k) + ')"/>');
    o.push(svgGloss(100 - 10 * k, top - 4 * k, 7 * k, 9 * k, .5));
  } else if (t === "bread") {
    // 面包片造型：方形吐司轮廓（与云朵明显区分）+ 顶部微隆 + 面包皮边
    o.push('<path d="M' + (100 - 30 * k) + ' ' + (top + 14 * k) + ' L' + (100 - 30 * k) + ' ' + (top - 6 * k) +
      ' Q' + (100 - 30 * k) + ' ' + (top - 24 * k) + ' 100 ' + (top - 24 * k) +
      ' Q' + (100 + 30 * k) + ' ' + (top - 24 * k) + ' ' + (100 + 30 * k) + ' ' + (top - 6 * k) +
      ' L' + (100 + 30 * k) + ' ' + (top + 14 * k) + ' Z" fill="url(#hb' + u + ')"/>');
    // 面包皮
    o.push('<path d="M' + (100 - 30 * k) + ' ' + (top - 6 * k) + ' Q' + (100 - 30 * k) + ' ' + (top - 24 * k) + ' 100 ' + (top - 24 * k) +
      ' Q' + (100 + 30 * k) + ' ' + (top - 24 * k) + ' ' + (100 + 30 * k) + ' ' + (top - 6 * k) +
      '" stroke="' + p.deep + '" stroke-width="' + (4 * k) + '" fill="none" opacity=".55" stroke-linecap="round"/>');
    // 气孔
    o.push('<circle cx="' + (100 - 12 * k) + '" cy="' + (top - 2 * k) + '" r="' + (3.4 * k) + '" fill="' + p.deep + '" opacity=".28"/>');
    o.push('<circle cx="' + (100 + 9 * k) + '" cy="' + (top + 5 * k) + '" r="' + (2.8 * k) + '" fill="' + p.deep + '" opacity=".24"/>');
    o.push('<circle cx="' + (100 + 15 * k) + '" cy="' + (top - 9 * k) + '" r="' + (2.4 * k) + '" fill="' + p.deep + '" opacity=".22"/>');
    o.push(svgGloss(100 - 16 * k, top + 4 * k, 8 * k, 5 * k, .4));
  } else if (t === "cat") {
    // 圆润猫耳（外耳 + 内耳）
    o.push('<path d="M' + (100 - 32 * k) + ' ' + (top + 20 * k) + ' Q' + (100 - 40 * k) + ' ' + (top - 14 * k) + ' ' + (100 - 12 * k) + ' ' + (top + 2 * k) + ' Z" fill="url(#hb' + u + ')"/>');
    o.push('<path d="M' + (100 + 32 * k) + ' ' + (top + 20 * k) + ' Q' + (100 + 40 * k) + ' ' + (top - 14 * k) + ' ' + (100 + 12 * k) + ' ' + (top + 2 * k) + ' Z" fill="url(#hb' + u + ')"/>');
    o.push('<path d="M' + (100 - 28 * k) + ' ' + (top + 14 * k) + ' Q' + (100 - 33 * k) + ' ' + (top - 4 * k) + ' ' + (100 - 16 * k) + ' ' + (top + 3 * k) + ' Z" fill="' + p.blush + '" opacity=".8"/>');
    o.push('<path d="M' + (100 + 28 * k) + ' ' + (top + 14 * k) + ' Q' + (100 + 33 * k) + ' ' + (top - 4 * k) + ' ' + (100 + 16 * k) + ' ' + (top + 3 * k) + ' Z" fill="' + p.blush + '" opacity=".8"/>');
  } else if (t === "sprout") {
    // 双叶 + 嫩茎
    o.push('<ellipse cx="' + (100 - 23 * k) + '" cy="' + (top - 4 * k) + '" rx="' + (21 * k) + '" ry="' + (12 * k) + '" fill="url(#hb' + u + ')" transform="rotate(-24 ' + (100 - 23 * k) + ' ' + (top - 4 * k) + ')"/>');
    o.push('<ellipse cx="' + (100 + 23 * k) + '" cy="' + (top - 4 * k) + '" rx="' + (21 * k) + '" ry="' + (12 * k) + '" fill="url(#hb' + u + ')" transform="rotate(24 ' + (100 + 23 * k) + ' ' + (top - 4 * k) + ')"/>');
    o.push('<path d="M100 ' + (top + 10 * k) + ' l 0 ' + (-12 * k) + '" stroke="' + p.deep + '" stroke-width="' + (3 * k) + '" stroke-linecap="round"/>');
    o.push('<path d="M' + (100 - 21 * k) + ' ' + (top - 8 * k) + ' Q' + (100 - 12 * k) + ' ' + (top - 14 * k) + ' ' + (100 - 4 * k) + ' ' + (top - 10 * k) + '" stroke="#fff" stroke-width="' + (1.8 * k) + '" fill="none" opacity=".55" stroke-linecap="round"/>');
    o.push('<path d="M' + (100 + 21 * k) + ' ' + (top - 8 * k) + ' Q' + (100 + 12 * k) + ' ' + (top - 14 * k) + ' ' + (100 + 4 * k) + ' ' + (top - 10 * k) + '" stroke="#fff" stroke-width="' + (1.8 * k) + '" fill="none" opacity=".55" stroke-linecap="round"/>');
    if (s >= 4) o.push('<circle cx="100" cy="' + (top + 14 * k) + '" r="' + (5 * k) + '" fill="' + p.blush + '"/>');
  }
  return o.join('');
}

/* --- 手持道具（阶段 3+）：握在右手（约 x=134, y=148）向上举 --- */
function petProp(p, u, s) {
  var x = 134, y = 150;
  var o = [];
  var t = p.prop;
  if (t === "rice" || t === "bread") {          // 稻穗 / 麦穗
    o.push('<path d="M' + x + ' ' + (y + 2) + ' L' + (x + 8) + ' ' + (y - 46) + '" stroke="' + p.deep + '" stroke-width="3.4" stroke-linecap="round"/>');
    for (var i = 0; i < 5; i++) {
      var yy = y - 12 - i * 8;
      o.push('<ellipse cx="' + (x + 12) + '" cy="' + yy + '" rx="6" ry="3.6" fill="' + p.accent + '" transform="rotate(-32 ' + (x + 12) + ' ' + yy + ')"/>');
      o.push('<ellipse cx="' + (x + 6) + '" cy="' + (yy - 4) + '" rx="6" ry="3.6" fill="' + p.accent + '" transform="rotate(32 ' + (x + 6) + ' ' + (yy - 4) + ')"/>');
    }
  } else if (t === "cloud") {                    // 云朵气球
    o.push('<path d="M' + x + ' ' + (y + 2) + ' L' + (x + 5) + ' ' + (y - 34) + '" stroke="' + p.deep + '" stroke-width="2.4" stroke-linecap="round" opacity=".75"/>');
    o.push('<circle cx="' + (x + 6) + '" cy="' + (y - 50) + '" r="13" fill="url(#hb' + u + ')"/>');
    o.push('<circle cx="' + (x - 5) + '" cy="' + (y - 42) + '" r="9.5" fill="url(#hb' + u + ')"/>');
    o.push('<circle cx="' + (x + 17) + '" cy="' + (y - 42) + '" r="9.5" fill="url(#hb' + u + ')"/>');
    o.push(svgGloss(x + 2, y - 54, 5, 4, .55));
  } else if (t === "berry") {                    // 草莓
    o.push('<path d="M' + (x + 6) + ' ' + (y + 4) + ' C ' + (x + 21) + ' ' + (y + 4) + ' ' + (x + 25) + ' ' + (y - 18) + ' ' + (x + 6) + ' ' + (y - 30) + ' C ' + (x - 13) + ' ' + (y - 18) + ' ' + (x - 9) + ' ' + (y + 4) + ' ' + (x + 6) + ' ' + (y + 4) + ' Z" fill="' + p.hair[1] + '"/>');
    o.push('<path d="M' + (x + 6) + ' ' + (y - 30) + ' l -9 -9 l 9 4 l 9 -4 z" fill="' + p.accent + '"/>');
    o.push('<circle cx="' + (x + 2) + '" cy="' + (y - 14) + '" r="1.8" fill="#fff" opacity=".85"/>');
    o.push('<circle cx="' + (x + 12) + '" cy="' + (y - 6) + '" r="1.8" fill="#fff" opacity=".85"/>');
  } else if (t === "cat") {                      // 小鱼干
    o.push('<ellipse cx="' + (x + 4) + '" cy="' + (y - 22) + '" rx="15" ry="9.5" fill="' + p.accent + '"/>');
    o.push('<path d="M' + (x + 19) + ' ' + (y - 22) + ' l 12 -8 l 0 16 z" fill="' + p.accent + '"/>');
    o.push('<circle cx="' + (x - 4) + '" cy="' + (y - 24) + '" r="1.9" fill="#3A2A22"/>');
    o.push('<path d="M' + (x - 1) + ' ' + (y - 16) + ' Q' + (x + 4) + ' ' + (y - 13) + ' ' + (x + 9) + ' ' + (y - 16) + '" stroke="#3A2A22" stroke-width="1.4" fill="none" opacity=".5"/>');
  } else if (t === "sprout") {                   // 小花枝
    o.push('<path d="M' + x + ' ' + (y + 2) + ' L' + (x + 6) + ' ' + (y - 40) + '" stroke="' + p.deep + '" stroke-width="3.4" stroke-linecap="round"/>');
    o.push('<circle cx="' + (x + 6) + '" cy="' + (y - 48) + '" r="10" fill="' + p.blush + '"/>');
    o.push('<circle cx="' + (x + 6) + '" cy="' + (y - 48) + '" r="4.5" fill="#FFE9A8"/>');
    o.push('<ellipse cx="' + (x - 4) + '" cy="' + (y - 26) + '" rx="7" ry="4" fill="' + p.hair[1] + '" transform="rotate(-28 ' + (x - 4) + ' ' + (y - 26) + ')"/>');
  }
  return o.join('');
}

/* --- 阶段 4：星尘 --- */
function petSparkles(p) {
  var pos = [[30, 60, 6.5], [170, 74, 6], [22, 118, 5], [178, 126, 5.5], [50, 22, 5], [150, 24, 5.5], [18, 164, 5], [182, 168, 5]];
  var o = [];
  for (var i = 0; i < pos.length; i++) {
    o.push(svgStar(pos[i][0], pos[i][1], pos[i][2], i % 2 ? "#FFF3C8" : p.accent, .92));
  }
  return o.join('');
}

/* --- 组装：某个宠物在某个等级的形象 --- */
function petSVG(petId, level) {
  var p = petCfg(petId), s = petStage(level), u = p.id + s + "_" + (++petUid);   // 每次画都用新的编号：同一页上画好几只也不会互相串色
  var o = [];
  o.push('<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">');
  o.push('<defs>' + svgGrad("fb" + u, p.face) + svgGrad("hb" + u, p.hair));
  o.push('<radialGradient id="au' + u + '" cx="50%" cy="52%" r="50%">' +
    '<stop offset="55%" stop-color="' + p.accent + '" stop-opacity="0"/>' +
    '<stop offset="100%" stop-color="' + p.accent + '" stop-opacity=".38"/></radialGradient>');
  o.push('<linearGradient id="wg' + u + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + p.face[0] + '" stop-opacity=".95"/>' +
    '<stop offset="100%" stop-color="' + p.accent + '" stop-opacity=".55"/></linearGradient>');
  o.push('</defs>');
  if (s === 0) {
    o.push(petEgg(p, u));
  } else {
    if (s >= 4) { o.push(petAura(p, u)); o.push(petWings(p, u)); }
    o.push(petBody(p, u, s));
    o.push(petHead(p, u, s));
    o.push(petHair(p, u, s));
    if (s >= 3) o.push(petProp(p, u, s));
    if (s >= 4) o.push(petSparkles(p));
  }
  o.push('</svg>');
  return o.join('');
}
