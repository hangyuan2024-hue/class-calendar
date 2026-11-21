// 捞捞 · 检测报告（通用接口）：把「检测仪 / 合作方 / 我们自己」给出的检测结果统一成一种报告，存历史、能对比、能看趋势，给捞小智当工具用。
//
//   为什么这样分层：数据从哪来（插头）和怎么用（历史、对比、雷达图、捞小智）分开。
//     · 合作方给接口 → 「合作方接口」插头（地址、口令、字段对应都在设置里填，不改代码）
//     · 合作方只给导出文件 → 「导入文件」（JSON / CSV，表头写项目名就行）
//     · 合作方不合作了 → 「捞捞自己的分析」插头：本机看图模型给能看出来的几项打等级，看不出来的用问卷补。全是我们自己的代码和提示词，
//       不依赖合作方的模型、代码、数据。换插头不影响历史记录、对比和捞小智。
//   报告的样子（统一格式）：
//     { id, at: 毫秒, source: "partner" | "import" | "local" | "quiz" | "demo", sourceName, profile: "scalp",
//       dims: [{ key, name, level: 1～4（4 正常、3 轻度、2 中度、1 重度；越大越好）或 null（信息不足）, label, regions: [], note }],
//       photos: [本机文件名], fallback?: "合作方接口连不上，这次用的是…", demo?: true }
//   项目不写死：合作方多给一项、改个名字，认得出的归到已知项目，认不出的原样留下（雷达图上照样画）。
//
//   隐私：头皮 / 面部照片是敏感个人信息。
//     · 做检测前必须同意（consent.local）；照片和报告只存在这台电脑上，随时能全部删除。
//     · 把照片发给合作方，要另外同意一次（consent.partner）；没同意就不发，自动用我们自己的分析。
//     · 合作方的口令只存在本机配置里，不给界面、不写日志。
//   不是医学诊断：给的是日常护理参考；持续重度、疼痛、成片掉发，建议去看皮肤科医生。
"use strict";
const fs = require("fs");
const path = require("path");

const DISCLAIMER = "护理参考，不是医学诊断。持续严重、疼痛或成片掉发，请去看皮肤科医生。";
const GRADES = { 4: "正常", 3: "轻度", 2: "中度", 1: "重度" };

// 头皮八项（通用的头皮护理分类）。alias：合作方 / 导入文件里可能的叫法（中英文都认）
const PROFILES = {
  scalp: {
    name: "头皮检测",
    dims: [
      { key: "oil", name: "出油量", alias: ["出油", "油脂", "控油", "oil", "sebum", "oiliness", "grease"], photo: "头皮和发根反光、发亮、油腻、发丝结成一缕缕" },
      { key: "dandruff", name: "头屑程度", alias: ["头屑", "头皮屑", "鳞屑", "dandruff", "flake", "flakes", "scale"], photo: "头皮上白色或黄色的小片、屑" },
      { key: "redness", name: "敏感泛红", alias: ["泛红", "敏感", "红血丝", "炎症", "redness", "sensitivity", "sensitive", "erythema", "inflammation"], photo: "头皮发红、红点、红血丝" },
      { key: "density", name: "发量密度", alias: ["发量", "密度", "头发密度", "density", "hair_density", "hairdensity"], photo: "单位面积里头发的根数，能不能看到大片头皮" },
      { key: "thickness", name: "发丝粗细", alias: ["粗细", "发径", "直径", "发丝直径", "thickness", "diameter", "hair_diameter"], photo: "每根头发是粗是细、粗细是否均匀" },
      { key: "strength", name: "发丝强韧", alias: ["强韧", "韧性", "断裂", "发质", "strength", "toughness", "breakage"], photo: "发丝分叉、断裂、毛躁" },
      { key: "follicle", name: "毛囊堵塞", alias: ["毛囊", "堵塞", "毛孔", "follicle", "follicles", "pore", "pores", "clog"], photo: "毛孔周围的油脂栓、角质堆积、一个毛孔里长出的头发根数" },
      { key: "moisture", name: "水润度", alias: ["水润", "水分", "保湿", "干燥", "含水量", "moisture", "hydration", "water"], photo: "头皮干燥、紧绷、起皮" },
    ],
  },
};

// ---------- 分区实拍：专业头皮检测仪，每个部位白光、偏振光、紫外光各拍一张（合作方要的就是这一套：5 个部位 × 3 种光 = 15 张）----------
//   白光：看出油、头屑、发量、发丝；偏振光：去掉反光，看泛红、红血丝、毛囊；紫外光：看卟啉（橙红色小点，细菌和油脂堆积）、残留
const ZONES = [
  { key: "front", name: "前额", alias: ["前额", "额头", "发际线", "前部", "front", "frontal", "forehead", "hairline"] },
  { key: "top", name: "头顶", alias: ["头顶", "顶部", "中间", "top", "vertex", "crown"] },
  { key: "left", name: "左侧", alias: ["左侧", "左边", "左颞", "left", "left_temporal"] },
  { key: "right", name: "右侧", alias: ["右侧", "右边", "右颞", "right", "right_temporal"] },
  { key: "back", name: "后枕", alias: ["后枕", "后脑", "枕部", "后部", "back", "occipital", "nape"] },
];
const LIGHTS = [
  { key: "white", name: "白光", alias: ["白光", "white", "rgb", "normal"], see: "出油、头屑、发量、发丝粗细" },
  { key: "polarized", name: "偏振光", alias: ["偏振光", "偏振", "polarized", "polar", "pol"], see: "泛红、红血丝、毛囊（去掉了反光）" },
  { key: "uv", name: "紫外光", alias: ["紫外光", "紫外", "uv", "ultraviolet", "wood"], see: "卟啉（橙红色小点）、残留" },
];
const findIn = (list, v) => { const s = String(v == null ? "" : v).trim(), low = s.toLowerCase(); if (!s) return null; return list.find((x) => x.key === low || x.name === s || x.alias.some((a) => a.toLowerCase() === low)) || list.find((x) => x.alias.some((a) => /[一-龥]/.test(a) && s.includes(a))) || null; };
const zoneOf = (v) => findIn(ZONES, v), lightOf = (v) => findIn(LIGHTS, v);
// 按拍摄顺序自动标：检测仪一般是一个部位换三种光拍完再换下一个部位（前额 白 偏 紫、头顶 白 偏 紫……）
function autoLabel(n, zones = ZONES.map((z) => z.key)) {
  return Array.from({ length: n }, (_, i) => ({ zone: zones[Math.floor(i / LIGHTS.length)] || null, light: LIGHTS[i % LIGHTS.length].key }));
}

// 等级的各种写法 → 1～4（越大越好）；认不出 → null（信息不足）
const LEVEL_WORDS = [
  [4, /^(正常|良好|健康|无|没有|好|优|优秀|理想|normal|good|healthy|none|ok|excellent|a)$/i],
  [3, /^(轻度|轻微|轻|略|偏|一般|较好|mild|slight|light|fair|b)$/i],
  [2, /^(中度|中等|中|明显|较差|moderate|medium|c)$/i],
  [1, /^(重度|严重|重|很差|差|severe|heavy|serious|bad|poor|d)$/i],
  [null, /^(信息不足|看不清|未知|不确定|无法判断|暂无|未检测|-|—|n\/?a|unknown|null)$/i],
];
function toLevel(v, opt = {}) {
  if (v == null || v === "") return null;
  if (opt.levels && Object.prototype.hasOwnProperty.call(opt.levels, String(v))) { const x = opt.levels[String(v)]; return x == null ? null : clamp(+x); }
  if (typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v).trim())) {
    let n = +v;
    // 0～100 的分数：默认越高越好；合作方的分数是越高越严重，设置里写 scoreHigherWorse
    if (opt.scale === 100 || n > 4) { if (opt.scoreHigherWorse) n = 100 - n; return n >= 85 ? 4 : n >= 65 ? 3 : n >= 40 ? 2 : 1; }
    // 1～4 的等级：默认 4 最好；合作方是 1 最好，设置里写 gradeOneIsBest
    if (n < 1) return null;
    return clamp(opt.gradeOneIsBest ? 5 - Math.round(n) : Math.round(n));
  }
  const s = String(v).trim().replace(/[（(].*$/, "").trim();
  for (const [lv, re] of LEVEL_WORDS) if (re.test(s)) return lv;
  // 「轻度油」「中度敏感」这种：看开头
  if (/^轻/.test(s)) return 3; if (/^中/.test(s)) return 2; if (/^(重|严)/.test(s)) return 1; if (/^正常/.test(s)) return 4;
  return null;
}
const clamp = (n) => (Number.isFinite(n) ? Math.max(1, Math.min(4, Math.round(n))) : null);
const labelOf = (lv) => (lv == null ? "信息不足" : GRADES[lv]);

// 项目叫法 → 已知项目
function dimOf(profile, k) {
  const s = String(k || "").trim(), low = s.toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  for (const d of profile.dims) if (d.key === low || d.name === s || d.alias.some((a) => a.toLowerCase() === low)) return d;
  for (const d of profile.dims) if (s.includes(d.name) || d.alias.some((a) => /[一-龥]/.test(a) && a.length >= 2 && s.includes(a))) return d;
  return null;
}
// 取 a.b.c
const pick = (o, p) => (!p ? o : String(p).split(".").reduce((x, k) => (x == null ? x : x[k]), o));
const first = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return undefined; };
const asList = (v) => (Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : String(v).split(/[、,，/·;；\s]+/)).map((x) => x.trim()).filter(Boolean).slice(0, 12);

// 合作方的一份结果（各种样子）→ 统一的 dims。map：字段对应（设置里填，不填就自动认）
//   map = { items: "data.result", key: "code", name: "name", level: "grade", regions: "areas", note: "desc", at: "data.time",
//           levels: { "A": 4, "B": 3 }, scoreHigherWorse: false, gradeOneIsBest: false }
function normalize(raw, profile, map = {}) {
  const m = map || {};
  let body = raw;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { throw new Error("结果不是 JSON"); } }
  const root = m.items ? pick(body, m.items) : body;
  let items = null;
  if (Array.isArray(root)) items = root;
  else if (root && typeof root === "object") {
    // 自动找：常见的外层（data / result / items / indicators…）里第一个对象数组
    const seen = new Set();
    const find = (o, depth) => { if (!o || typeof o !== "object" || depth > 3 || seen.has(o)) return null; seen.add(o); if (Array.isArray(o)) return o.length && typeof o[0] === "object" ? o : null; for (const k of Object.keys(o)) { const r = find(o[k], depth + 1); if (r) return r; } return null; };
    items = m.items ? null : find(root, 0);
    if (!items) {
      // 平铺的 { 出油量: "轻度", oil: 2, … }
      items = Object.entries(root).filter(([k, v]) => dimOf(profile, k) && (typeof v !== "object" || v == null || !Array.isArray(v))).map(([k, v]) => (v && typeof v === "object" ? { key: k, ...v } : { key: k, level: v }));
    }
  }
  if (!items || !items.length) throw new Error("结果里找不到检测项目（设置里可以填「字段对应」告诉它在哪）");
  // 按部位分组的 [{ zone: "头顶", items: [...] }, …]：摊平成一项一项，每项带上部位
  const ZK = ["zone", "region", "area", "part", "position", "部位", "分区", "区域"];
  const zoneField = (it) => (m.zone ? pick(it, m.zone) : first(it, ZK));
  if (items.every((g) => g && typeof g === "object" && zoneField(g) != null && Object.values(g).some((v) => Array.isArray(v) && v.length && typeof v[0] === "object"))) {
    items = items.flatMap((g) => { const z = zoneField(g); const arr = Object.values(g).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object"); return arr.map((x) => ({ ...x, __zone: z })); });
  }
  const out = new Map(), perZone = new Map();
  for (const it of items) {
    const zRaw = it.__zone != null ? it.__zone : zoneField(it);
    if (zRaw != null && zRaw !== "" && !Array.isArray(zRaw)) {
      // 某一项在某个部位的结果：先按部位记下，后面合成这一项的总等级（取最差的那个部位）、关注部位
      const k = m.key ? pick(it, m.key) : first(it, ["key", "code", "id", "item", "type", "dimension", "dim", "indicator"]);
      const nm = m.name ? pick(it, m.name) : first(it, ["name", "title", "label_name", "item_name", "名称", "项目"]);
      const d = dimOf(profile, k) || dimOf(profile, nm);
      const key = d ? d.key : String(k || nm || "").trim().slice(0, 30);
      if (!key) continue;
      const lvRaw = m.level ? pick(it, m.level) : first(it, ["level", "grade", "result", "status", "label", "等级", "结果", "score", "value"]);
      const level = toLevel(lvRaw, { levels: m.levels, scoreHigherWorse: m.scoreHigherWorse, gradeOneIsBest: m.gradeOneIsBest, scale: m.scale });
      const z = zoneOf(zRaw), zn = z ? z.name : String(zRaw).slice(0, 10);
      const e = perZone.get(key) || { key, name: d ? d.name : String(nm || k).slice(0, 20), zones: {}, notes: [] };
      e.zones[zn] = level;
      const note = String((m.note ? pick(it, m.note) : first(it, ["note", "desc", "description", "detail", "说明", "描述"])) || "").slice(0, 120);
      if (note) e.notes.push(`${zn}：${note}`);
      perZone.set(key, e);
      continue;
    }
    if (!it || typeof it !== "object") continue;
    const k = m.key ? pick(it, m.key) : first(it, ["key", "code", "id", "item", "type", "dimension", "dim", "indicator"]);
    const nm = m.name ? pick(it, m.name) : first(it, ["name", "title", "label_name", "item_name", "名称", "项目"]);
    const lvRaw = m.level ? pick(it, m.level) : first(it, ["level", "grade", "result", "status", "label", "等级", "结果", "score", "value"]);
    const d = dimOf(profile, k) || dimOf(profile, nm);
    const key = d ? d.key : String(k || nm || "").trim().slice(0, 30);
    if (!key) continue;
    const level = toLevel(lvRaw, { levels: m.levels, scoreHigherWorse: m.scoreHigherWorse, gradeOneIsBest: m.gradeOneIsBest, scale: m.scale });
    const regions = asList(m.regions ? pick(it, m.regions) : first(it, ["regions", "areas", "parts", "positions", "部位", "关注部位"]));
    const note = String((m.note ? pick(it, m.note) : first(it, ["note", "desc", "description", "detail", "说明", "描述"])) || "").slice(0, 200);
    out.set(key, { key, name: d ? d.name : String(nm || k).slice(0, 20), level, label: labelOf(level), regions, note });
  }
  for (const e of perZone.values()) {
    const lvs = Object.values(e.zones).filter((x) => x != null);
    const worst = lvs.length ? Math.min(...lvs) : null;
    const hit = Object.entries(e.zones).filter(([, v]) => v != null && v < 4).sort((a, b) => a[1] - b[1]).map(([z]) => z);
    const had = out.get(e.key);
    // 合作方另外给了这一项的总等级：用他们的；没给：取最差的那个部位
    const level = had && had.level != null ? had.level : worst;
    out.set(e.key, { key: e.key, name: e.name, level, label: labelOf(level), regions: [...new Set([...(had ? had.regions : []), ...hit])].slice(0, 12), note: (had && had.note) || e.notes.slice(0, 3).join("；").slice(0, 200), zones: e.zones });
  }
  // 检测时间：外层或者 data 这一层里找（{ data: { time, result: [...] } } 这种）
  const TK = ["at", "time", "date", "created_at", "test_time", "日期", "检测时间"];
  const findAt = (o, depth) => { if (!o || typeof o !== "object" || Array.isArray(o) || depth > 2) return undefined; const v = first(o, TK); if (v != null && typeof v !== "object") return v; for (const k of Object.keys(o)) { const r = findAt(o[k], depth + 1); if (r != null) return r; } return undefined; };
  const at = m.at ? pick(body, m.at) : findAt(body, 0);
  return { dims: fillDims(profile, [...out.values()]), at: parseTime(at) };
}
// 已知的八项按固定顺序放前面，缺的补成「信息不足」；认不出的项目跟在后面
function fillDims(profile, dims) {
  const by = new Map(dims.map((d) => [d.key, d]));
  const known = profile.dims.map((d) => by.get(d.key) || { key: d.key, name: d.name, level: null, label: labelOf(null), regions: [], note: "" });
  const extra = dims.filter((d) => !profile.dims.some((x) => x.key === d.key)).slice(0, 8);
  return [...known, ...extra];
}
function parseTime(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim().replace(/[年月]/g, "-").replace(/日/g, "").replace(/\//g, "-");
  const t = Date.parse(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s) ? s.replace(/-(\d)(?=-|$)/g, "-0$1") + "T12:00:00" : s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

// CSV（Excel 另存）：一行一次检测。表头：日期 + 各项目（出油量、头屑程度…），格子里写 正常 / 轻度 / 中度 / 重度 或 1～4
function parseCsv(text) {
  const rows = [], s = String(text).replace(/^﻿/, "");
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === "," || c === "\t") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

// ---------- 日常护理参考（通用的头皮护理常识；不是诊断，不推荐药品） ----------
const TIPS = {
  oil: ["洗头频率按出油来：油得快可以一两天一洗，水温别太烫", "少熬夜，少吃油炸、甜食", "护发素只抹发尾，别抹到头皮"],
  dandruff: ["洗头时先把头发打湿透，洗发水在手心起泡再上头", "冲洗干净，别留洗发水残留", "头屑多又痒、反复不好，可以问问医生或药师"],
  redness: ["换温和、无香精的洗护产品，新产品先在小块皮肤试", "别用指甲抓，水温别太烫", "发红刺痛持续几天不退，请去看皮肤科"],
  density: ["规律作息，保证蛋白质和铁的摄入", "别总扎很紧的马尾", "短时间掉发明显变多或成片掉，请去看皮肤科"],
  thickness: ["少烫染、少高温吹烫", "吃够蛋白质", "吹头用中低温，离远一点"],
  strength: ["湿发时别用力梳、别拉扯", "减少烫染和高温造型", "发尾干就定期修剪"],
  follicle: ["洗头时用指腹按摩、彻底冲净", "定型产品、发油当天洗掉", "油多的话洗头别间隔太久"],
  moisture: ["水温别太烫，洗完及时吹干", "秋冬可以用温和的保湿型洗护", "多喝水，空调房里注意加湿"],
};

// 自己的问卷：看图看不出来的（水润度、发丝强韧），以及帮看图核对的
const QUIZ = [
  { key: "oil", q: "洗完头以后，多久头发就会变油、贴头皮？", options: [["三天以上", 4], ["两天左右", 3], ["一天", 2], ["半天就油", 1]] },
  { key: "dandruff", q: "平时肩膀上、头发里能看到头屑吗？", options: [["基本没有", 4], ["偶尔有一点", 3], ["经常有", 2], ["很多、还痒", 1]] },
  { key: "redness", q: "头皮会发红、刺痛，或者换洗发水就不舒服吗？", options: [["不会", 4], ["偶尔", 3], ["经常", 2], ["几乎一直", 1]] },
  { key: "moisture", q: "洗头后头皮会发紧、发干、起白皮吗？", options: [["不会", 4], ["偶尔", 3], ["经常", 2], ["几乎每次", 1]] },
  { key: "strength", q: "梳头、洗头时，断掉的短头发（不带发根的）多吗？", options: [["很少", 4], ["有一些", 3], ["挺多", 2], ["非常多", 1]] },
  { key: "density", q: "最近一个月掉头发和以前比怎么样？", options: [["差不多", 4], ["多了一点", 3], ["明显变多", 2], ["一抓一把", 1]] },
];

function create(o = {}) {
  const profile = PROFILES[o.profile || "scalp"];
  const now = o.now || (() => new Date());
  const dir = path.join(o.dir, "checkup");
  const DB = path.join(dir, "reports.json"), CFG = path.join(dir, "config.json"), PH = path.join(dir, "photos");
  const look = o.look || null;          // 本机看图：async (图片 data URL 数组, 提示词) => 模型回的文字
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const log = o.log || (() => {});

  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
  // 写到临时文件再改名（写到一半断电不会坏）；Windows 上目标被占用会 EPERM / EBUSY：重试几次
  function write(f, v) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const t = f + ".tmp" + process.pid; fs.writeFileSync(t, JSON.stringify(v));
    for (let i = 0; ; i++) { try { fs.renameSync(t, f); return; } catch (e) { if (i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) { try { fs.writeFileSync(f, JSON.stringify(v)); fs.rmSync(t, { force: true }); return; } catch (e2) { throw e; } } const w = Date.now() + 40 * (i + 1); while (Date.now() < w) { /* 等一下 */ } } }
  }
  const DEF = { source: "auto", consent: { local: false, partner: false }, keepPhotos: true, partner: { url: "", method: "POST", body: "json", imageField: "images", auth: "Authorization", token: "", extra: {}, map: {}, timeoutMs: 60000, name: "合作方" } };
  let cfg = mergeCfg(read(CFG, {}));
  function mergeCfg(c) { return { ...DEF, ...c, consent: { ...DEF.consent, ...(c.consent || {}) }, partner: { ...DEF.partner, ...(c.partner || {}) } }; }
  let db = read(DB, { reports: [] });
  if (!Array.isArray(db.reports)) db.reports = [];
  const save = () => write(DB, db);

  const partnerReady = () => !!(cfg.partner.url && /^https?:\/\//i.test(cfg.partner.url));
  // 给界面看的设置：口令只说有没有，不给原文
  function config() {
    const p = cfg.partner;
    return { source: cfg.source, consent: { ...cfg.consent }, keepPhotos: cfg.keepPhotos, profile: profile.name, disclaimer: DISCLAIMER,
      partner: { url: p.url, name: p.name, method: p.method, body: p.body, imageField: p.imageField, auth: p.auth, hasToken: !!p.token, extra: p.extra, map: p.map, codes: p.codes || {}, minPhotos: p.minPhotos || 0, fieldPattern: p.fieldPattern || "{zone}_{light}", labeled: p.labeled || "auto", timeoutMs: p.timeoutMs, ready: partnerReady() },
      zones: ZONES.map((z) => ({ key: z.key, name: z.name })), lights: LIGHTS.map((l) => ({ key: l.key, name: l.name, see: l.see })),
      local: { eyes: !!look, quiz: QUIZ.map((x) => ({ key: x.key, name: dimName(x.key), q: x.q, options: x.options.map((a) => a[0]) })) },
      sources: [{ key: "auto", name: "自动：有合作方接口就用，连不上自动换成捞捞自己的" }, { key: "partner", name: "只用合作方接口" }, { key: "local", name: "只用捞捞自己的分析（看图 + 问卷）" }] };
  }
  function setConfig(c = {}) {
    const n = mergeCfg(cfg);
    if (c.source != null) { if (!["auto", "partner", "local"].includes(c.source)) throw new Error("数据来源只有：auto / partner / local"); n.source = c.source; }
    if (c.consent) { if (c.consent.local != null) n.consent.local = !!c.consent.local; if (c.consent.partner != null) n.consent.partner = !!c.consent.partner; }
    if (c.keepPhotos != null) n.keepPhotos = !!c.keepPhotos;
    if (c.partner) {
      const p = c.partner;
      if (p.url != null) { const u = String(p.url).trim(); if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new Error("接口地址要以 http:// 或 https:// 开头"); n.partner.url = u; }
      for (const k of ["name", "method", "body", "imageField", "auth", "fieldPattern", "labeled"]) if (p[k] != null) n.partner[k] = String(p[k]).trim().slice(0, 200);
      if (p.token != null && p.token !== "") n.partner.token = String(p.token).trim();      // 空的不覆盖（界面上看不到原口令）
      if (p.clearToken) n.partner.token = "";
      if (p.minPhotos != null) n.partner.minPhotos = Math.max(0, Math.min(15, +p.minPhotos || 0));
      if (p.timeoutMs != null) n.partner.timeoutMs = Math.max(3000, Math.min(300000, +p.timeoutMs || 60000));
      for (const k of ["extra", "map", "codes"]) if (p[k] != null) { let v = p[k]; if (typeof v === "string") { v = v.trim(); if (!v) v = {}; else { try { v = JSON.parse(v); } catch (e) { throw new Error(`「${k === "map" ? "字段对应" : "额外参数"}」不是正确的 JSON`); } } } if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`「${k === "map" ? "字段对应" : "额外参数"}」要写成 {…}`); n.partner[k] = v; }
      if (!["json", "multipart"].includes(n.partner.body)) n.partner.body = "json";
      n.partner.method = /^put$/i.test(n.partner.method) ? "PUT" : "POST";
    }
    cfg = n; write(CFG, cfg);
    return config();
  }
  const dimName = (k) => { const d = profile.dims.find((x) => x.key === k); return d ? d.name : k; };

  // ---------- 插头 1：合作方接口 ----------
  // 发：JSON { [imageField]: [base64…], ...extra }，或者 multipart（每张图一个文件字段）；收：JSON，按「字段对应」读出各项
  async function partnerScan(images) {
    const p = cfg.partner;
    if (!partnerReady()) throw new Error("还没填合作方的接口地址");
    if (!cfg.consent.partner) throw new Error("没有同意把照片发给合作方");
    const need = +p.minPhotos || 0;
    if (need && images.length < need) throw Object.assign(new Error(`${p.name || "合作方"}要求拍够 ${need} 张（现在 ${images.length} 张）：每个部位白光、偏振光、紫外光各一张`), { retake: true });
    const raw = images.map((x) => String(x.url).replace(/^data:[^,]*,/, ""));
    // 照片带了部位、光源（分区实拍）：每张都标上；部位 / 光源的叫法可以按合作方的改（设置里 codes）
    const labeled = p.labeled !== "off" && images.some((x) => x.zone || x.light);
    const code = (kind, k) => ((p.codes || {})[kind] || {})[k] || k;
    const tag = (x) => ({ zone: x.zone ? code("zones", x.zone) : null, zone_name: x.zone ? (zoneOf(x.zone) || {}).name || x.zone : null, light: x.light ? code("lights", x.light) : null, light_name: x.light ? (lightOf(x.light) || {}).name || x.light : null });
    const headers = {};
    if (p.token) headers[p.auth || "Authorization"] = /^authorization$/i.test(p.auth || "Authorization") && !/^\w+\s/.test(p.token) ? "Bearer " + p.token : p.token;
    let body;
    if (p.body === "multipart") {
      const B = "----laolao" + Date.now().toString(36), parts = [];
      for (const [k, v] of Object.entries(p.extra || {})) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${typeof v === "object" ? JSON.stringify(v) : v}\r\n`));
      raw.forEach((b, i) => {
        // 分区实拍：字段名默认「部位_光源」（front_white…），合作方要别的样子在设置里写 fieldPattern，比如 "{zone}-{light}"
        const t = tag(images[i]);
        const field = labeled && t.zone && t.light ? String(p.fieldPattern || "{zone}_{light}").replace("{zone}", t.zone).replace("{light}", t.light) : p.imageField || "images";
        parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${field}"; filename="${labeled && t.zone ? `${t.zone}_${t.light || i + 1}` : "photo" + (i + 1)}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`)); parts.push(Buffer.from(b, "base64")); parts.push(Buffer.from("\r\n"));
      });
      if (labeled) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="photos"\r\n\r\n${JSON.stringify(images.map((x) => tag(x)))}\r\n`));
      parts.push(Buffer.from(`--${B}--\r\n`));
      body = Buffer.concat(parts); headers["Content-Type"] = "multipart/form-data; boundary=" + B;
    } else {
      const imgs = labeled ? raw.map((b, i) => ({ ...tag(images[i]), image: b })) : raw;
      body = JSON.stringify({ ...(p.extra || {}), [p.imageField || "images"]: imgs, ...(labeled ? { zones: ZONES.length, lights: LIGHTS.map((l) => code("lights", l.key)) } : {}) });
      headers["Content-Type"] = "application/json";
    }
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), p.timeoutMs || 60000);
    let res, text;
    try { res = await fetchFn(p.url, { method: p.method || "POST", headers, body, signal: ac.signal }); text = await res.text(); }
    catch (e) { throw new Error(ac.signal.aborted ? `合作方接口 ${Math.round((p.timeoutMs || 60000) / 1000)} 秒没回` : "连不上合作方接口：" + (e.cause && e.cause.code ? e.cause.code : e.message)); }
    finally { clearTimeout(t); }
    if (res.status === 401 || res.status === 403) throw new Error(`合作方接口拒绝了（${res.status}）：口令不对或者没有权限了`);
    if (res.status === 402 || res.status === 429) throw new Error(`合作方接口不给用了（${res.status}）：额度用完或者太频繁`);
    // 合作方说照片不合格（400 / 422，或者 200 但 code 不是 0、带了 msg）：原话转告用户重拍，不悄悄换成别的分析
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    const said = j && typeof j === "object" ? first(j, ["msg", "message", "error", "errmsg", "detail"]) || (j.data && first(j.data, ["msg", "message"])) : null;
    const bizErr = j && typeof j === "object" && j.code != null && Number.isFinite(+j.code) && +j.code !== 0 && +j.code !== 200 && said && !/^(ok|success|成功)$/i.test(String(said));
    if ((res.status === 400 || res.status === 422 || bizErr) && said) throw Object.assign(new Error(`${p.name || "合作方"}说：${String(said).slice(0, 160)}`), { retake: true });
    if (!res.ok) throw new Error(`合作方接口出错（${res.status}）：${String(text || "").slice(0, 120)}`);
    const r = normalize(text, profile, p.map);
    return { dims: r.dims, at: r.at, sourceName: p.name || "合作方" };
  }

  // ---------- 插头 2：捞捞自己的分析（本机看图模型 + 问卷） ----------
  const SEE = profile.dims.filter((d) => ["oil", "dandruff", "redness", "density", "thickness", "follicle", "strength"].includes(d.key));
  const LOOK_PROMPT = () => `你在看用户自己拍的头皮 / 头发近照（可能是普通手机照片，也可能是放大镜头拍的）。只根据照片里看得见的东西，给下面几项各评一个等级。
等级只能写：正常、轻度、中度、重度、看不清。照片里看不出来、拍得模糊、或者不是这一块，就写「看不清」，不要猜。
${SEE.map((d) => `· ${d.key}（${d.name}）：看${d.photo}`).join("\n")}
where 写在照片的哪一块看到的（比如「发际线」「头顶」「中间」「左边」），看不出就空着。
如果照片根本不是头皮或头发，is_scalp 写 false。
只输出一个 JSON，不要别的字：
{"is_scalp": true, ${SEE.map((d) => `"${d.key}": {"level": "…", "where": ""}`).join(", ")}}`;
  function parseLook(text) {
    const s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("看图模型没有按格式回答");
    let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error("看图模型回答的格式不对"); }
    if (j.is_scalp === false || j.is_scalp === "false") throw new Error("照片里看不出头皮或头发：换一张近一点、清楚一点的（拨开头发拍头皮）");
    const dims = [];
    for (const d of SEE) {
      const v = j[d.key]; const lvRaw = v && typeof v === "object" ? v.level : v;
      const lv = toLevel(lvRaw);
      dims.push({ key: d.key, name: d.name, level: lv, label: labelOf(lv), regions: asList(v && v.where), note: lv == null ? "" : "看照片" });
    }
    return dims;
  }
  function quizDims(answers = {}) {
    const out = [];
    for (const it of QUIZ) {
      const a = answers[it.key] != null ? answers[it.key] : answers[dimName(it.key)];
      if (a == null || a === "") continue;
      const hit = it.options.find(([t]) => t === String(a).trim()) || (/^\d+$/.test(String(a)) ? it.options[+a - 1] : null) || it.options.find(([t]) => String(a).includes(t) || t.includes(String(a).trim()));
      if (!hit) continue;
      out.push({ key: it.key, name: dimName(it.key), level: hit[1], label: labelOf(hit[1]), regions: [], note: "问卷：" + hit[0] });
    }
    return out;
  }
  async function localScan(images, answers) {
    let seen = [], why = "";
    if (images.length) {
      if (!look) why = "这台电脑上的看图模型还没准备好，这次只用问卷";
      else {
        // 分区实拍：每个部位挑白光那张（看出油、头屑、发量最准），最多 4 张；告诉模型第几张是哪个部位
        const white = images.filter((x) => x.zone && (!x.light || x.light === "white"));
        const use = (white.length ? white : images).slice(0, 4);
        const label = use.some((x) => x.zone) ? "\n这几张依次是：" + use.map((x, i) => `第 ${i + 1} 张 ${(zoneOf(x.zone) || {}).name || "未标部位"}${x.light ? "（" + ((lightOf(x.light) || {}).name || x.light) + "）" : ""}`).join("，") + "。where 就写部位名。" : "";
        const txt = await look(use.map((x) => x.url), LOOK_PROMPT() + label);
        seen = parseLook(txt);
      }
    }
    const q = quizDims(answers);
    // 看图看出来的为准；看不出来的用问卷补
    const by = new Map(q.map((d) => [d.key, d]));
    for (const d of seen) if (d.level != null) by.set(d.key, d); else if (!by.has(d.key)) by.set(d.key, d);
    const dims = fillDims(profile, [...by.values()]);
    if (!dims.some((d) => d.level != null)) throw new Error(images.length && !why ? "照片里一项都没看清：拨开头发、离近一点、光线亮一点再拍" : "没有可以分析的：传几张头皮照片，或者答一下问卷");
    return { dims, sourceName: images.length && !why ? "捞捞自己的分析（看照片 + 问卷，参考）" : "捞捞自己的分析（问卷，参考）", note: why };
  }

  // ---------- 做一次检测：按设置选插头；合作方不行了自动换成我们自己的 ----------
  async function scan({ images = [], answers = {}, source } = {}) {
    if (!cfg.consent.local) throw new Error("先同意「检测照片和报告保存在这台电脑上」才能检测");
    // 照片：data URL，或者分区实拍的 { url, zone, light }（5 个部位 × 3 种光，最多 15 张）
    images = (Array.isArray(images) ? images : []).map((x) => (typeof x === "string" ? { url: x } : x && typeof x === "object" ? { url: String(x.url || x.data || ""), zone: (zoneOf(x.zone) || {}).key || null, light: (lightOf(x.light) || {}).key || null } : null))
      .filter((x) => x && /^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(x.url));
    const MAXN = images.some((x) => x.zone) ? ZONES.length * LIGHTS.length : 6;
    if (images.length > MAXN) images = images.slice(0, MAXN);
    for (const x of images) if (x.url.length > 12 * 1048576) throw new Error("照片太大了（一张不要超过 9M）");
    const dup = new Set(); for (const x of images) if (x.zone && x.light) { const k = x.zone + "/" + x.light; if (dup.has(k)) throw new Error(`「${(zoneOf(x.zone) || {}).name}·${(lightOf(x.light) || {}).name}」有两张：改一下其中一张的部位或光源`); dup.add(k); }
    const want = source || cfg.source;
    let r = null, fallback = "", src = "local";
    const canPartner = partnerReady() && cfg.consent.partner && images.length;
    if (want === "partner" && !canPartner) throw new Error(!partnerReady() ? "还没填合作方的接口地址" : !cfg.consent.partner ? "没有同意把照片发给合作方" : "合作方接口要照片");
    if ((want === "partner" || want === "auto") && canPartner) {
      try { r = await partnerScan(images); src = "partner"; }
      catch (e) {
        if (want === "partner" || e.retake) throw e;
        fallback = `${cfg.partner.name || "合作方"}的接口这次没用上（${e.message}），自动换成了捞捞自己的分析`;
        log("检测：" + fallback);
      }
    } else if (want === "auto" && partnerReady() && !cfg.consent.partner && images.length) fallback = "没有同意把照片发给合作方，这次用的是捞捞自己的分析";
    if (!r) { r = await localScan(images, answers); src = Object.keys(answers || {}).length && !images.length ? "quiz" : "local"; if (r.note) fallback = [fallback, r.note].filter(Boolean).join("；"); }
    return add({ dims: r.dims, at: r.at || now().getTime(), source: src, sourceName: r.sourceName, images, ...(fallback ? { fallback } : {}) });
  }
  function add({ dims, at, source, sourceName, images = [], fallback, demo }) {
    const id = "R" + String(at).slice(-9) + Math.random().toString(36).slice(2, 5);
    const photos = [];
    if (cfg.keepPhotos && images.length) {
      fs.mkdirSync(PH, { recursive: true });
      images.forEach((x, i) => { const u = typeof x === "string" ? x : x.url; const m = /^data:image\/(\w+);base64,(.*)$/s.exec(u); if (!m) return; const f = `${id}-${i + 1}${x.zone ? "-" + x.zone : ""}${x.light ? "-" + x.light : ""}.${m[1] === "jpeg" ? "jpg" : m[1]}`; fs.writeFileSync(path.join(PH, f), Buffer.from(m[2], "base64")); photos.push(f); });
    }
    const rep = { id, at, source, sourceName: sourceName || SOURCE_NAMES[source] || source, profile: o.profile || "scalp", dims, photos, ...(fallback ? { fallback } : {}), ...(demo ? { demo: true } : {}) };
    db.reports.push(rep); db.reports.sort((a, b) => a.at - b.at);
    if (db.reports.length > 500) { for (const x of db.reports.splice(0, db.reports.length - 500)) for (const f of x.photos || []) fs.rmSync(path.join(PH, f), { force: true }); }
    save();
    return brief(rep);
  }
  const SOURCE_NAMES = { partner: "合作方", import: "导入的文件", local: "捞捞自己的分析", quiz: "捞捞自己的分析（问卷）", demo: "演示数据（虚构）" };

  // ---------- 导入合作方导出的文件 ----------
  function importText(text, fileName = "") {
    if (!cfg.consent.local) throw new Error("先同意「检测照片和报告保存在这台电脑上」才能导入");
    const s = String(text || "").replace(/^﻿/, "").trim();
    if (!s) throw new Error("文件是空的");
    const added = [];
    if (/^[[{]/.test(s)) {
      let j; try { j = JSON.parse(s); } catch (e) { throw new Error("JSON 文件格式不对"); }
      // 一份报告，或者好几份（数组 / { reports: [...] }）
      const many = Array.isArray(j) && j.length && typeof j[0] === "object" && (j[0].dims || j[0].items || j[0].result || j[0].data) ? j : j && Array.isArray(j.reports) ? j.reports : null;
      for (const one of many || [j]) { const r = normalize(one.dims ? { items: one.dims, at: one.at } : one, profile, one.dims ? { items: "items" } : cfg.partner.map); added.push(add({ dims: r.dims, at: r.at || now().getTime(), source: "import", sourceName: "导入：" + path.basename(fileName || "文件") })); }
    } else {
      const rows = parseCsv(s);
      if (rows.length < 2) throw new Error("CSV 里没有数据：第一行写表头（日期、出油量、头屑程度…），下面一行一次检测");
      const head = rows[0].map((h) => String(h).trim()), dIdx = head.findIndex((h) => /日期|时间|date|time/i.test(h));
      const cols = head.map((h, i) => (i === dIdx ? null : { i, d: dimOf(profile, h), h })).filter((c) => c && (c.d || c.h));
      if (!cols.some((c) => c.d)) throw new Error("CSV 的表头里认不出检测项目（写成：出油量、头屑程度、敏感泛红、发量密度…）");
      for (const r of rows.slice(1)) {
        const dims = cols.filter((c) => String(r[c.i] || "").trim()).map((c) => { const lv = toLevel(String(r[c.i]).trim()); return { key: c.d ? c.d.key : c.h, name: c.d ? c.d.name : c.h, level: lv, label: labelOf(lv), regions: [], note: "" }; });
        if (!dims.length) continue;
        added.push(add({ dims: fillDims(profile, dims), at: (dIdx >= 0 && parseTime(r[dIdx])) || now().getTime(), source: "import", sourceName: "导入：" + path.basename(fileName || "文件") }));
      }
    }
    if (!added.length) throw new Error("文件里没有读到检测结果");
    return { added: added.length, reports: added };
  }

  // 文件：Excel 另存的 CSV 在中文 Windows 上常是 GBK 编码，读 UTF-8 出乱码就按 GBK 再读一次
  function importFile(f) {
    const buf = fs.readFileSync(f);
    if (buf.length > 20 * 1048576) throw new Error("文件太大了（超过 20M）");
    let text = buf.toString("utf8");
    if (/\uFFFD/.test(text)) { try { text = new TextDecoder("gbk").decode(buf); } catch (e) { /* 没有 GBK 解码就按 UTF-8 */ } }
    return importText(text, path.basename(f));
  }

  // ---------- 演示数据（虚构，标着「演示」）：六周，大体变好，最后一周水润度差了一点（演示「要调整」） ----------
  function demo() {
    if (!cfg.consent.local) setConfig({ consent: { local: true } });
    db.reports = db.reports.filter((r) => !r.demo);
    const T = now().getTime(), W = 7 * 864e5;
    const plan = [[2, 2, 3, 3, 4, 3, null, 2], [2, 3, 3, 3, 4, 3, null, 3], [3, 3, 3, 3, 4, null, 3, 3], [3, 3, 4, 3, 4, 3, 3, 3], [3, 3, 4, 4, 4, 3, 3, 3], [4, 4, 4, 4, 4, 3, null, 2]];
    plan.forEach((lv, i) => add({ at: T - (plan.length - 1 - i) * W - 3600e3, source: "demo", demo: true, sourceName: SOURCE_NAMES.demo,
      dims: profile.dims.map((d, k) => ({ key: d.key, name: d.name, level: lv[k], label: labelOf(lv[k]), regions: lv[k] != null && lv[k] < 4 ? ["头顶", "后脑"].slice(0, 1 + (k % 2)) : [], note: "" })) }));
    return { added: plan.length };
  }
  function wipe() {
    db = { reports: [] }; save();
    try { fs.rmSync(PH, { recursive: true, force: true }); } catch (e) {}
    return { ok: true };
  }
  function remove(id) { const i = db.reports.findIndex((r) => r.id === id); if (i < 0) throw new Error("没有这次检测"); for (const f of db.reports[i].photos || []) fs.rmSync(path.join(PH, f), { force: true }); db.reports.splice(i, 1); save(); return { ok: true }; }

  // ---------- 查、比、看趋势 ----------
  const ymd = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function brief(r) {
    if (!r) return null;
    const bad = r.dims.filter((d) => d.level != null && d.level < 4);
    return { id: r.id, date: ymd(r.at), at: r.at, source: r.sourceName, ...(r.demo ? { demo: true } : {}), ...(r.fallback ? { fallback: r.fallback } : {}),
      items: r.dims.map((d) => ({ name: d.name, level: d.label, ...(d.regions && d.regions.length ? { regions: d.regions.join("、") } : {}), ...(d.zones ? { zones: Object.entries(d.zones).map(([z, v]) => `${z}${labelOf(v)}`).join("、") } : {}), ...(d.note ? { note: d.note } : {}) })),
      summary: bad.length ? `要注意：${bad.sort((a, b) => a.level - b.level).map((d) => `${d.name}${d.label}`).join("、")}` : r.dims.some((d) => d.level != null) ? "测出来的几项都正常" : "这次没有测出结果",
      unknown: r.dims.filter((d) => d.level == null).map((d) => d.name), photos: (r.photos || []).length };
  }
  const get = (id) => (id && id !== "latest" ? db.reports.find((r) => r.id === id) : db.reports[db.reports.length - 1]) || null;
  // 「比上周」：最新这一次，和 6 天以前最近的那一次比；没有就和上一次比
  function baseOf(latest, { days, base } = {}) {
    if (base) { const b = db.reports.find((r) => r.id === base) || db.reports.filter((r) => ymd(r.at) === base).pop(); if (!b) throw new Error("没有这一次：" + base); return b; }
    const prev = db.reports.filter((r) => r.at < latest.at);
    if (!prev.length) return null;
    const d = days == null ? 7 : Math.max(0, +days);
    if (!d) return prev[prev.length - 1];
    return prev.filter((r) => r.at <= latest.at - (d - 1) * 864e5).pop() || prev[0];
  }
  function compare({ id, base, days } = {}) {
    const a = get(id); if (!a) throw new Error("还没有检测记录：先做一次检测（或者导入、放演示数据）");
    const b = baseOf(a, { days, base });
    if (!b) return { latest: brief(a), base: null, note: "只有这一次检测，没法对比：过几天再测一次就能看变化", radar: radar(a) };
    const rows = [], better = [], worse = [];
    for (const d of a.dims) {
      const x = b.dims.find((y) => y.key === d.key);
      const from = x ? x.level : null, to = d.level;
      let change = "不变";
      if (to == null && from == null) change = "都没测出"; else if (to == null) change = "这次没测出"; else if (from == null) change = "上次没测出";
      else if (to > from) { change = "进步"; better.push(`${d.name}（${labelOf(from)} → ${labelOf(to)}）`); } else if (to < from) { change = "退步"; worse.push(`${d.name}（${labelOf(from)} → ${labelOf(to)}）`); }
      rows.push({ name: d.name, from: labelOf(from), to: labelOf(to), change });
    }
    const gap = Math.round((a.at - b.at) / 864e5);
    return { latest: { id: a.id, date: ymd(a.at), source: a.sourceName }, base: { id: b.id, date: ymd(b.at), source: b.sourceName }, days: gap,
      better, worse, same: rows.filter((r) => r.change === "不变").map((r) => r.name), items: rows,
      advice: adviceOf(a, worse.length ? a.dims.filter((d) => rows.find((r) => r.name === d.name && r.change === "退步")) : null),
      ...(a.demo || b.demo ? { demo: "这是虚构的演示数据" } : {}), ...(a.source !== b.source ? { mixed: `两次的来源不一样（${b.sourceName} / ${a.sourceName}），等级的标准可能不完全一样，变化仅供参考` } : {}),
      disclaimer: DISCLAIMER, radar: radar(a, b) };
  }
  function adviceOf(r, focus) {
    const list = (focus && focus.length ? focus : r.dims.filter((d) => d.level != null && d.level < 4).sort((a, b) => a.level - b.level)).slice(0, 3);
    const out = list.map((d) => ({ name: d.name, level: d.label, tips: (TIPS[d.key] || []).slice(0, 2) }));
    if (r.dims.some((d) => d.level === 1)) out.push({ name: "提醒", tips: ["有一项是重度：如果一直不好、疼痛或者掉发很多，请去看皮肤科医生"] });
    return out;
  }
  function trend({ item, n = 8 } = {}) {
    const d = dimOf(profile, item) || profile.dims.find((x) => x.name === item);
    const key = d ? d.key : String(item || "");
    if (!key) throw new Error("说一下看哪一项：" + profile.dims.map((x) => x.name).join("、"));
    const pts = db.reports.slice(-Math.max(2, Math.min(30, +n || 8))).map((r) => { const x = r.dims.find((y) => y.key === key); return { date: ymd(r.at), level: x ? x.label : "信息不足", v: x ? x.level : null }; });
    if (!pts.length) throw new Error("还没有检测记录");
    const vs = pts.filter((p) => p.v != null);
    const dir = vs.length < 2 ? "测出来的次数太少，看不出趋势" : vs[vs.length - 1].v > vs[0].v ? "在变好" : vs[vs.length - 1].v < vs[0].v ? "在变差" : "基本没变";
    return { item: d ? d.name : key, points: pts.map(({ date, level }) => ({ date, level })), trend: dir };
  }
  function history({ n = 10 } = {}) { return { count: db.reports.length, reports: db.reports.slice(-Math.max(1, Math.min(50, +n || 10))).reverse().map((r) => ({ id: r.id, date: ymd(r.at), source: r.sourceName, ...(r.demo ? { demo: true } : {}), summary: brief(r).summary })) }; }
  // 雷达图要的数（界面画；越靠外越好；信息不足的不连线）
  function radar(a, b) {
    const one = (r) => ({ id: r.id, date: ymd(r.at), source: r.sourceName, demo: !!r.demo, dims: r.dims.map((d) => ({ key: d.key, name: d.name, level: d.level, label: d.label, regions: d.regions || [] })) });
    return { profile: profile.name, max: 4, latest: a ? one(a) : null, base: b ? one(b) : null };
  }
  function latest() {
    const a = get(); if (!a) return { none: true, note: "还没有检测记录：在右边「检测报告」里做一次检测、导入合作方的文件，或者先放演示数据看看", disclaimer: DISCLAIMER };
    return { ...brief(a), advice: adviceOf(a), disclaimer: DISCLAIMER, radar: radar(a) };
  }
  // 界面：最新一次 + 和哪次比（默认上周）+ 列表
  function view({ base } = {}) {
    const a = get();
    let cmp = null; if (a) { try { cmp = compare({ base, days: base ? undefined : 7 }); } catch (e) { cmp = null; } }
    return { config: config(), count: db.reports.length, latest: a ? brief(a) : null, compare: cmp, radar: a ? (cmp && cmp.radar) || radar(a) : null,
      list: db.reports.slice(-30).reverse().map((r) => ({ id: r.id, date: ymd(r.at), source: r.sourceName, demo: !!r.demo, summary: brief(r).summary })) };
  }
  function photo(f) { const p = path.join(PH, path.basename(String(f || ""))); if (!fs.existsSync(p)) throw new Error("照片已经删了"); return "data:image/" + (/\.png$/i.test(p) ? "png" : "jpeg") + ";base64," + fs.readFileSync(p).toString("base64"); }

  // ---------- 给捞小智的工具 ----------
  // 给模型看的不带雷达图的数（省上下文；界面要画图另外调 view）
  const lean = (r) => { if (!r || typeof r !== "object") return r; const { radar: _r, ...x } = r; void _r; return x; };
  function tools(imagesNow) {
    const S = (d) => ({ type: "string", description: d }), I = (d) => ({ type: "integer", description: d });
    const names = profile.dims.map((d) => d.name).join("、");
    return [
      { name: "checkup_latest", desc: `看最近一次${profile.name}的结果：${names}各是什么等级（正常 / 轻度 / 中度 / 重度 / 信息不足）、关注部位、护理参考`, params: {}, say: () => `看最近一次${profile.name}`, run: () => lean(latest()) },
      { name: "checkup_compare", desc: "和以前比：最近一次和上周（days=7，默认）或者 days 天前比；也可以 base 写某一次的编号或日期（YYYY-MM-DD）。返回哪几项进步了、哪几项退步了、要调整什么", params: { days: I("和几天前比，默认 7"), base: S("和哪一次比：编号或日期") }, say: (a) => (a.base ? `和 ${a.base} 那次比一比` : `和${a.days && +a.days !== 7 ? ` ${a.days} 天前` : "上周"}比一比`), run: (a) => lean(compare({ days: a.days, base: a.base })) },
      { name: "checkup_trend", desc: `看某一项最近几次的变化（item 写项目名：${names}）`, params: { item: S("项目名"), n: I("看最近几次，默认 8") }, req: ["item"], say: (a) => `看「${a.item || ""}」的变化`, run: (a) => trend(a) },
      { name: "checkup_history", desc: "列出以前每一次检测（日期、来源、要注意的项目）", params: { n: I("最近几次，默认 10") }, say: () => "翻一下检测记录", run: (a) => history(a) },
      { name: "checkup_quiz", desc: "拿到自测问卷的题目（看照片看不出来的项目靠它补）。要帮用户自测时先调这个，一题一题问", params: {}, say: () => "拿自测问卷", run: () => ({ questions: QUIZ.map((x) => ({ key: x.key, item: dimName(x.key), question: x.q, options: x.options.map((a) => a[0]) })), note: "一题一题问，用户答完再调 checkup_scan，answers 里按 key 写他选的那一项原文" }) },
      { name: "checkup_scan", desc: "做一次检测：用用户这次发来的头皮照片（有的话）和问卷答案（answers：{ key: 选项原文 }），按设置用合作方接口或者捞捞自己的分析。用户要先在界面上同意保存检测数据", params: { answers: { type: "object", description: "问卷答案，比如 {\"moisture\": \"偶尔\", \"strength\": \"很少\"}" } }, changes: true, say: () => `做一次${profile.name}`, run: async (a) => { const r = await scan({ images: imagesNow ? imagesNow() : [], answers: a.answers || {} }); return { ...r, advice: adviceOf(get(r.id)), disclaimer: DISCLAIMER }; } },
    ];
  }
  const RE = /头皮|头发|发量|掉发|脱发|秃|发际线|头屑|出油|油头|泛红|毛囊|发丝|水润|检测|报告|八维|雷达|进步|退步|变好|变差|上周|这周|对比|比一比|自测|护理/;

  // 分区实拍的清单：每个部位、每种光拍什么；n 张照片按顺序自动标上部位和光源
  const plan = () => ({ total: ZONES.length * LIGHTS.length, zones: ZONES.map((z) => ({ key: z.key, name: z.name })), lights: LIGHTS.map((l) => ({ key: l.key, name: l.name, see: l.see })),
    tips: ["用专业头皮检测仪（放大 50～200 倍，带白光、偏振光、紫外光），镜头贴着头皮", "每个部位：拨开头发露出头皮，白光、偏振光、紫外光各拍一张，三张拍同一个位置", "部位顺序：前额 → 头顶 → 左侧 → 右侧 → 后枕；按这个顺序拍，导入时能自动标好", "对好焦、不要晃；画面里头皮和发根要清楚"] });
  return { plan, autoLabel: (n) => autoLabel(n), config, setConfig, scan, importText, importFile, demo, wipe, remove, compare, trend, history, latest, view, photo, tools, RE, profile, QUIZ, DISCLAIMER, get: (id) => brief(get(id)) };
}

module.exports = { create, normalize, toLevel, parseCsv, autoLabel, zoneOf, lightOf, PROFILES, ZONES, LIGHTS, QUIZ, TIPS, DISCLAIMER };
