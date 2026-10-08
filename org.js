// 学校 / 单位选择（注册页、产品页里的注册表单、编辑资料共用）
// 本科大学：从教育部 2026 年本科院校名单（schools-2026.json，1412 所）里搜索，可按省份筛选，名单里没有也能手动填写；
// 专科、高中、初中、小学、职场人员、个人使用：名称可以填，也可以选「不填写」。
(function () {
  const TYPES = [
    ["university", "本科大学", "全国 1412 所本科院校"],
    ["college", "专科 / 高职", "学校名称"],
    ["high", "高中", "学校名称"],
    ["middle", "初中", "学校名称"],
    ["primary", "小学", "学校名称"],
    ["work", "职场人员", "公司或单位名称"],
    ["personal", "个人使用", "给自己的空间起个名字"],
  ];
  const NAME_OF = Object.fromEntries(TYPES.map((t) => [t[0], t[1]]));
  const PH = {
    university: "搜索学校，如：浙大、华科",
    college: "例如：深圳职业技术大学（选填）",
    high: "例如：杭州第二中学（选填）",
    middle: "例如：北京市第八中学（选填）",
    primary: "例如：实验小学（选填）",
    work: "例如：某某科技有限公司（选填）",
    personal: "例如：我的书房、考研小站（选填）",
  };
  const MAXLEN = 40;
  // 常见简称 → 全称（简称搜不到全称时补上）
  const ALIAS = {
    北大: "北京大学", 清华: "清华大学", 人大: "中国人民大学", 北师大: "北京师范大学", 北航: "北京航空航天大学", 北理: "北京理工大学", 北理工: "北京理工大学",
    北邮: "北京邮电大学", 中科大: "中国科学技术大学", 国科大: "中国科学院大学", 复旦: "复旦大学", 上交: "上海交通大学", 交大: "上海交通大学", 同济: "同济大学",
    华师大: "华东师范大学", 华东师大: "华东师范大学", 上财: "上海财经大学", 浙大: "浙江大学", 南大: "南京大学", 东南: "东南大学", 南航: "南京航空航天大学",
    南理工: "南京理工大学", 武大: "武汉大学", 华科: "华中科技大学", 华中大: "华中科技大学", 华师: "华中师范大学", 中大: "中山大学", 华工: "华南理工大学",
    华南理工: "华南理工大学", 暨大: "暨南大学", 深大: "深圳大学", 南科大: "南方科技大学", 厦大: "厦门大学", 川大: "四川大学", 电子科大: "电子科技大学",
    成电: "电子科技大学", 西南交大: "西南交通大学", 重大: "重庆大学", 西交: "西安交通大学", 西交大: "西安交通大学", 西工大: "西北工业大学", 西电: "西安电子科技大学",
    兰大: "兰州大学", 山大: "山东大学", 中海大: "中国海洋大学", 哈工大: "哈尔滨工业大学", 哈工程: "哈尔滨工程大学", 吉大: "吉林大学", 大工: "大连理工大学",
    东北大: "东北大学", 南开: "南开大学", 天大: "天津大学", 湖大: "湖南大学", 中南: "中南大学", 郑大: "郑州大学", 苏大: "苏州大学", 合工大: "合肥工业大学",
    西农: "西北农林科技大学", 北外: "北京外国语大学", 上外: "上海外国语大学", 央财: "中央财经大学", 贸大: "对外经济贸易大学", 法大: "中国政法大学",
    北交: "北京交通大学", 北科: "北京科技大学", 北林: "北京林业大学", 中农: "中国农业大学", 北中医: "北京中医药大学", 协和: "北京协和医学院", 中传: "中国传媒大学",
    央美: "中央美术学院", 央音: "中央音乐学院", 北体: "北京体育大学", 西南大学: "西南大学", 西财: "西南财经大学", 中南财: "中南财经政法大学", 云大: "云南大学",
    广大: "广州大学", 宁大: "宁波大学", 杭电: "杭州电子科技大学", 浙工大: "浙江工业大学", 南师大: "南京师范大学", 南邮: "南京邮电大学", 河海: "河海大学",
  };
  const FLAG = ["", "民办", "中外合作", "境外合作"];

  let DATA = null, LOADING = null;
  function loadData() {
    if (DATA) return Promise.resolve(DATA);
    if (!LOADING) {
      LOADING = fetch("schools-2026.json?v=1", { cache: "force-cache" })
        .then((r) => { if (!r.ok) throw new Error("学校名单加载失败"); return r.json(); })
        .then((j) => {
          const all = [];
          j.p.forEach(([prov, list]) => list.forEach(([n, c, f]) => all.push({ n, prov, c: c.replace(/市$/, "") || prov, f })));
          DATA = { all, provs: j.p.map((x) => [x[0], x[1].length]), src: j.src, byName: new Map(all.map((s) => [s.n, s])) };
          return DATA;
        })
        .catch((e) => { LOADING = null; throw e; });
    }
    return LOADING;
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = (s) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAXLEN);

  // 打分：全称完全一致 > 简称 > 开头一致 > 包含 > 按顺序包含每个字（越紧凑越靠前）
  function match(name, q) {
    if (name === q) return { s: 1000, hit: null };
    const i = name.indexOf(q);
    if (i === 0) return { s: 800 - name.length, hit: [0, q.length] };
    if (i > 0) return { s: 600 - i - name.length, hit: [i, i + q.length] };
    let pos = -1, first = -1; const idx = [];
    for (const ch of q) { pos = name.indexOf(ch, pos + 1); if (pos < 0) return null; if (first < 0) first = pos; idx.push(pos); }
    return { s: 300 - (pos - first) * 6 - name.length, idx };
  }
  function hl(name, m) {
    if (!m) return esc(name);
    if (m.hit) return esc(name.slice(0, m.hit[0])) + "<mark>" + esc(name.slice(m.hit[0], m.hit[1])) + "</mark>" + esc(name.slice(m.hit[1]));
    if (m.idx) { const set = new Set(m.idx); return [...name].map((ch, k) => set.has(k) ? "<mark>" + esc(ch) + "</mark>" : esc(ch)).join(""); }
    return esc(name);
  }
  function search(q, prov) {
    const pool = prov ? DATA.all.filter((s) => s.prov === prov) : DATA.all;
    q = q.replace(/\s+/g, "");
    if (!q) return prov ? pool.map((s) => ({ s, m: null })) : [];
    const out = [];
    const alias = ALIAS[q];
    for (const s of pool) {
      const m = match(s.n, q);
      if (m) { if (alias === s.n) m.s = 900; out.push({ s, m }); }
      else if (alias === s.n) out.push({ s, m: { s: 900 } });
    }
    out.sort((a, b) => b.m.s - a.m.s);
    return out.slice(0, 60);
  }

  const SVG = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  };
  let seq = 0;

  // 在 root 里画出选择器；opts.value = { type, name }，opts.onChange(value)
  function mount(root, opts) {
    opts = opts || {};
    const id = "org" + (++seq);
    const st = { type: "university", name: "", picked: false, skip: false, prov: "", open: false, active: -1, results: [] };
    const v0 = opts.value || {};
    if (NAME_OF[v0.type]) st.type = v0.type;
    if (v0.name) st.name = clean(v0.name);
    if (opts.skipDefault && !v0.name && v0.type) st.skip = true;

    root.classList.add("org");
    root.innerHTML = `
      <div class="org-types" role="radiogroup" aria-label="学校或单位类型">${TYPES.map(([k, n]) => `<button type="button" role="radio" data-type="${k}">${n}</button>`).join("")}</div>
      <div class="org-row">
        <div class="org-field">
          <select class="org-prov" aria-label="按省份筛选"><option value="">全国</option></select>
          <span class="org-ic" aria-hidden="true">${SVG.search}</span>
          <input class="org-in" id="${id}In" maxlength="${MAXLEN}" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}List">
          <span class="org-ok" aria-hidden="true">${SVG.check}</span>
          <button type="button" class="org-clear" aria-label="清空">${SVG.x}</button>
          <ul class="org-list" id="${id}List" role="listbox" aria-label="学校"></ul>
        </div>
        <button type="button" class="org-skip" aria-pressed="false">不填写</button>
      </div>
      <div class="org-hint" aria-live="polite"></div>`;
    const q = (s) => root.querySelector(s);
    const inp = q(".org-in"), list = q(".org-list"), sel = q(".org-prov"), hint = q(".org-hint"), skipB = q(".org-skip"), field = q(".org-field");
    inp.value = st.name;

    function value() {
      return { type: st.type, name: st.skip ? "" : clean(inp.value), verified: st.type === "university" && st.picked && !st.skip };
    }
    function emit() { if (opts.onChange) opts.onChange(value()); }
    function setHint() {
      const univ = st.type === "university", name = clean(inp.value);
      root.classList.toggle("picked", univ && st.picked && !st.skip);
      if (st.skip) { hint.innerHTML = `已选择不填写${opts.later === false ? "" : "，以后可以在「我的 → 编辑资料」里补上"}`; hint.className = "org-hint"; return; }
      if (univ) {
        if (st.picked) { const s = DATA && DATA.byName.get(name); hint.innerHTML = `已选择 <b>${esc(name)}</b>${s ? ` · ${esc(s.prov)}${s.c && s.c !== s.prov ? " " + esc(s.c) : ""}${FLAG[s.f] ? " · " + FLAG[s.f] : ""}` : ""}`; hint.className = "org-hint ok"; }
        else if (name) { hint.textContent = "没有点选名单里的学校，会按你输入的名字保存"; hint.className = "org-hint warn"; }
        else { hint.textContent = "输入几个字搜索，或先选省份再挑；名单里没有也能直接填写"; hint.className = "org-hint"; }
      } else {
        hint.textContent = name ? "会显示在你的资料里，只有你自己和管理员能看到" : `${NAME_OF[st.type]}：名称可以填，也可以选「不填写」`;
        hint.className = "org-hint";
      }
    }
    function render() {
      const univ = st.type === "university";
      root.querySelectorAll("[data-type]").forEach((b) => { const on = b.dataset.type === st.type; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
      root.classList.toggle("univ", univ); root.classList.toggle("skip", st.skip); root.classList.toggle("has-val", !!inp.value);
      inp.placeholder = st.skip ? "不填写" : PH[st.type];
      inp.disabled = st.skip; sel.disabled = st.skip;
      inp.setAttribute("role", univ ? "combobox" : "textbox");
      inp.setAttribute("aria-label", univ ? "学校名称" : NAME_OF[st.type] + " 名称");
      skipB.classList.toggle("on", st.skip); skipB.setAttribute("aria-pressed", String(st.skip));
      skipB.textContent = st.skip ? "改为填写" : "不填写";
      setHint();
    }
    function close() { st.open = false; st.active = -1; field.classList.remove("open"); inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); }
    function openList() {
      if (st.type !== "university" || st.skip) return close();
      if (!DATA) {
        list.innerHTML = '<li class="org-empty">正在加载学校名单…</li>'; field.classList.add("open"); st.open = true;
        loadData().then(() => { fillProv(); if (document.activeElement === inp || st.open) openList(); }).catch(() => { list.innerHTML = '<li class="org-empty">名单没加载出来，直接输入学校全称也可以</li>'; });
        return;
      }
      const text = inp.value.trim();
      st.results = search(text, st.prov);
      let html = "";
      if (!text && !st.prov) html = `<li class="org-empty">输入学校名称搜索，例如「华科」「西安交通」<br>也可以在左边选省份，看这个省的全部本科院校</li>`;
      else if (!st.results.length) html = `<li class="org-empty">没找到「${esc(text)}」${st.prov ? `（${esc(st.prov)}）` : ""}</li>`;
      else html = (st.prov && !text ? `<li class="org-group" role="presentation">${esc(st.prov)} · ${st.results.length} 所本科院校</li>` : "") +
        st.results.map((r, k) => `<li role="option" id="${id}o${k}" data-k="${k}" aria-selected="false"><span class="org-n">${hl(r.s.n, r.m)}</span><span class="org-m">${esc(r.s.prov === r.s.c ? r.s.prov : r.s.prov + " · " + r.s.c)}${FLAG[r.s.f] ? `<i>${FLAG[r.s.f]}</i>` : ""}</span></li>`).join("");
      if (text && !(st.results[0] && st.results[0].s.n === text)) html += `<li class="org-own" data-own="1" role="option" id="${id}own"><span>${SVG.pen}</span>名单里没有？就用「${esc(clean(text))}」</li>`;
      list.innerHTML = html;
      st.active = -1; st.open = true; field.classList.add("open"); inp.setAttribute("aria-expanded", "true");
    }
    function fillProv() {
      if (!DATA || sel.options.length > 1) return;
      sel.insertAdjacentHTML("beforeend", DATA.provs.map(([p, n]) => `<option value="${esc(p)}">${esc(p)}</option>`).join(""));
      sel.value = st.prov;
    }
    function options() { return [...list.querySelectorAll("[role=option]")]; }
    function setActive(k) {
      const os = options(); if (!os.length) return;
      st.active = (k + os.length) % os.length;
      os.forEach((o, i) => { o.classList.toggle("act", i === st.active); o.setAttribute("aria-selected", String(i === st.active)); });
      const o = os[st.active]; inp.setAttribute("aria-activedescendant", o.id); o.scrollIntoView({ block: "nearest" });
    }
    function choose(o) {
      if (!o) return;
      if (o.dataset.own) { st.picked = false; inp.value = clean(inp.value); }
      else { const r = st.results[+o.dataset.k]; inp.value = r.s.n; st.picked = true; }
      close(); render(); emit();
    }

    root.querySelector(".org-types").addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]"); if (!b || b.dataset.type === st.type) return;
      const wasUniv = st.type === "university";
      st.type = b.dataset.type;
      if (wasUniv !== (st.type === "university")) { inp.value = ""; st.picked = false; }
      close(); render(); emit();
    });
    root.querySelector(".org-types").addEventListener("keydown", (e) => {
      const ks = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(e.key in ks)) return;
      e.preventDefault();
      const bs = [...root.querySelectorAll("[data-type]")], i = bs.findIndex((b) => b.dataset.type === st.type);
      const n = bs[(i + ks[e.key] + bs.length) % bs.length]; n.click(); n.focus();
    });
    inp.addEventListener("focus", () => { if (st.type === "university") { loadData().then(fillProv).catch(() => {}); if (inp.value.trim() && !st.picked) openList(); else if (!inp.value.trim()) openList(); } });
    inp.addEventListener("input", () => {
      st.picked = false;
      if (st.type === "university") openList();
      root.classList.toggle("has-val", !!inp.value); setHint(); emit();
    });
    inp.addEventListener("keydown", (e) => {
      if (st.type !== "university") return;
      if (e.key === "ArrowDown") { e.preventDefault(); if (!st.open) openList(); setActive(st.active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(st.active - 1); }
      else if (e.key === "Enter" && st.open) { const os = options(); if (st.active >= 0 || os.length === 1 || (os[0] && !os[0].dataset.own && inp.value.trim())) { e.preventDefault(); choose(os[st.active >= 0 ? st.active : 0]); } }
      else if (e.key === "Escape" && st.open) { e.preventDefault(); e.stopPropagation(); close(); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (!root.contains(document.activeElement)) { close(); inp.value = clean(inp.value); setHint(); } }, 120));
    list.addEventListener("mousedown", (e) => e.preventDefault());   // 点选项时别让输入框先失焦
    list.addEventListener("click", (e) => choose(e.target.closest("[role=option]")));
    sel.addEventListener("change", () => { st.prov = sel.value; inp.focus(); openList(); });
    sel.addEventListener("focus", () => loadData().then(fillProv).catch(() => {}));
    q(".org-clear").addEventListener("click", () => { inp.value = ""; st.picked = false; render(); emit(); inp.focus(); });
    skipB.addEventListener("click", () => {
      st.skip = !st.skip; close(); render(); emit();
      if (!st.skip) inp.focus();
    });
    document.addEventListener("click", (e) => { if (st.open && !root.contains(e.target)) close(); });

    // 已有的学校名：在名单里就标成已选
    if (st.type === "university" && st.name) loadData().then(() => { st.picked = DATA.byName.has(clean(inp.value)); setHint(); root.classList.toggle("picked", st.picked && !st.skip); }).catch(() => {});
    render();
    return {
      value,
      set(v) { v = v || {}; st.type = NAME_OF[v.type] ? v.type : "university"; inp.value = clean(v.name); st.skip = !!(v.type && !v.name && opts.skipDefault); st.picked = false; close(); render();
        if (st.type === "university" && inp.value) loadData().then(() => { st.picked = DATA.byName.has(inp.value); setHint(); root.classList.toggle("picked", st.picked && !st.skip); }).catch(() => {}); },
      focus() { (st.skip ? skipB : inp).focus(); },
      preload: () => loadData().catch(() => {}),
    };
  }

  // 「浙江大学」「职场人员 · 某某公司」这样的一行文字
  function label(type, name) {
    if (!NAME_OF[type]) return "";
    if (name) return type === "university" || type === "college" || type === "high" || type === "middle" || type === "primary" ? name : NAME_OF[type] + " · " + name;
    return NAME_OF[type];
  }
  window.CCOrg = { mount, label, TYPES, NAME_OF, MAXLEN, clean };
})();
