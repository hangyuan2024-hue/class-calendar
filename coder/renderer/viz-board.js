// 捞捞编程 · 画出来：把「一步」的程序状态画成画面（core/trace.js 的结果）
//   数组 → 柱子 / 格子（下面标出 i、j、lo、hi、指针指着哪一格）；二维数组 → 网格；字符串 → 一格一个字；
//   结构体 → 盒子；链表 → 一串节点加箭头；二叉树 → 树；字典 / map → 表；普通变量 → 小牌子（变了会亮一下）
// 画面不是每步重画：同一个变量的格子、柱子会复用（morph），高度、颜色有过渡动画。
"use strict";
(function (root) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IDX = /^(i|j|k|l|r|ii|jj|lo|hi|mid|low|high|left|right|start|end|begin|idx|index|pos|cur|min|max|minidx|maxidx|min_idx|max_idx|mi|mx|p|q|top|front|rear|head|tail|slow|fast|s|e|u|v|w|row|col|c)$/i;

  // ---------- 值 → 文字 ----------
  function fmtNum(v) { if (typeof v !== "number") return String(v); if (Number.isInteger(v)) return String(v); const s = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); return s; }
  function chr(c) { if (c === 0) return "\\0"; if (c === 10) return "\\n"; if (c === 9) return "\\t"; if (c === 32) return "␣"; if (c < 32 || c > 126) return c >= 128 ? "·" : "?"; return String.fromCharCode(c); }
  function short(v, py) {
    if (!v) return "?";
    switch (v.k) {
      case "n": return v.e ? esc(v.e) : fmtNum(v.v);
      case "c": return `'${esc(chr(v.v))}'`;
      case "b": return py ? (v.v ? "True" : "False") : v.v ? "true" : "false";
      case "s": return `"${esc(v.v.length > 24 ? v.v.slice(0, 24) + "…" : v.v)}"`;
      case "z": return py ? "None" : "NULL";
      case "a": return `[${v.v.slice(0, 6).map((x) => short(x, py)).join(", ")}${(v.n || v.v.length) > 6 ? ", …" : ""}]`;
      case "o": return `${esc(v.t || "")}{…}`;
      case "m": return `{${v.v.length} 项}`;
      case "p": return v.d ? "→ " + short(v.d, py) : "→ ?";
      default: return esc(v.v);
    }
  }
  const isNum = (x) => x && (x.k === "n" || x.k === "c" || x.k === "b");
  const numOf = (x) => (x.k === "b" ? (x.v ? 1 : 0) : x.v);
  const scalar = (v) => v && (v.k === "n" || v.k === "c" || v.k === "b" || v.k === "z" || v.k === "x" || (v.k === "s" && !v.n && v.v.length <= 30) || (v.k === "p" && (!v.d || isNum(v.d) || v.ref || v.bad)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- 一步里所有变量（按 frame 分开） ----------
  // 返回 [{ key, title, fn, depth, cur, vars: [[name, val]] }]，最外层在前
  function scopes(step) {
    const out = [];
    // Python 的主程序那一层没有自己的变量（都在全局里）：不单独画
    const fs = (step.f || []).slice().reverse().filter((f) => !(f.fn === "主程序" && !(f.v || []).length));
    if (step.g && step.g.length) out.push({ key: "g", title: "全局变量", vars: step.g, global: true, cur: !fs.length, py: (step.f || []).some((f) => f.fn === "主程序") });
    fs.forEach((f, i) => out.push({ key: `f${i}:${f.fn}`, title: f.fn || "", fn: f.fn, depth: i, cur: i === fs.length - 1, vars: f.v || [], line: f.l }));
    return out;
  }
  function varMap(step) { const m = new Map(); for (const sc of scopes(step)) for (const [n, v] of sc.vars) m.set(sc.key + "/" + n, v); return m; }

  // ---------- 下标标记：哪些变量指着数组的哪一格 ----------
  // CTX：这一步所有的 scope（render 时设置）—— 用来找「别的函数里的指针指着这个数组」
  let CTX = { scopes: [] };
  const intoArr = (p, arr, len) => p.k === "p" && arr.addr && arr.es && p.a >= arr.addr && p.a < arr.addr + arr.es * len && (p.a - arr.addr) % arr.es === 0 ? (p.a - arr.addr) / arr.es : -1;
  function markers(arr, scope, globals, len) {
    const mk = {};
    const add = (i, name) => { if (i >= 0 && i < len && !(mk[i] || []).includes(name)) (mk[i] ||= []).push(name); };
    const idxVars = (vars, off) => { for (const [n, v] of vars) if (v.k === "n" && Number.isInteger(v.v) && IDX.test(n)) add(off + v.v, n); };
    // 别的函数里有指针指着这个数组（比如 main 里的 a 传给 bubble(int a[], int n)）：那个函数里的 i、j 标在这个数组上
    let viaPtr = false;
    for (const sc of CTX.scopes) {
      if (sc === scope) continue;
      for (const [n, v] of sc.vars) {
        const off = intoArr(v, arr, len);
        if (off < 0) continue;
        viaPtr = true;
        if (off > 0 || !sc.vars.some(([m, x]) => x.k === "n" && IDX.test(m))) add(off, n);
        if (sc.cur || !CTX.scopes.some((o) => o.cur && o !== sc && o.vars.some(([, x]) => intoArr(x, arr, len) >= 0))) idxVars(sc.vars, off);
      }
    }
    // 自己这一层的下标变量（数组是全局的：用正在执行的那一层的）
    if (!viaPtr) idxVars(scope.global ? (CTX.scopes.find((x) => x.cur && !x.global) || { vars: [] }).vars : scope.vars, 0);
    for (const [n, v] of scope.vars.concat(scope.global ? [] : globals)) { const off = intoArr(v, arr, len); if (off >= 0) add(off, n); }
    return mk;
  }

  // ---------- 各种画法 ----------
  function bars(name, v, prev, mk, opt) {
    const a = v.v, n = a.length;
    const nums = a.map(numOf);
    const lo = Math.min(0, ...nums), hi = Math.max(1, ...nums), span = hi - lo || 1;
    const pa = prev && prev.k === "a" ? prev.v : null;
    const changed = a.map((x, i) => pa && pa[i] && !same(pa[i], x));
    const nch = changed.filter(Boolean).length;
    const dense = n > 24;
    const cells = a.map((x, i) => {
      const h = Math.max(2, ((nums[i] - lo) / span) * 100);
      const cls = changed[i] ? (nch === 2 ? "swap" : "chg") : mk[i] ? "on" : "";
      return `<div class="vb-bar ${cls}"><div class="tk">${dense ? "" : `<span class="v">${short(x)}</span>`}<i style="height:${h.toFixed(1)}%"></i></div>${opt.mini && dense ? "" : `<span class="ix">${i}</span>`}<span class="mk">${mk[i] ? esc(mk[i].join(",")) : ""}</span></div>`;
    }).join("");
    return `<div class="vb-bars${dense ? " dense" : ""}" style="--n:${n}">${cells}</div>${(v.n || n) > n ? `<div class="vb-more">只画了前 ${n} 个，一共 ${v.n} 个</div>` : ""}`;
  }
  function cellsRow(v, prev, mk, py) {
    const pa = prev && prev.k === "a" ? prev.v : null;
    return `<div class="vb-cells">${v.v.map((x, i) => {
      const ch = pa && pa[i] && !same(pa[i], x);
      return `<div class="vb-cell ${ch ? "chg" : mk[i] ? "on" : ""}"><b>${short(x, py)}</b><small>${i}</small><span class="mk">${mk[i] ? esc(mk[i].join(",")) : ""}</span></div>`;
    }).join("")}${(v.n || v.v.length) > v.v.length ? `<div class="vb-cell more">…</div>` : ""}</div>`;
  }
  function strCells(v, prev, mk) {
    const s = v.v, n = Math.min(v.n || s.length + 1, 48);
    const ps = prev && prev.k === "s" ? prev.v : null;
    let h = "";
    for (let i = 0; i < n; i++) {
      const c = i < s.length ? s[i] : i === s.length ? "\\0" : "";
      if (i > s.length && !mk[i]) { if (i === s.length + 1) h += `<div class="vb-cell ghost">…</div>`; continue; }
      const ch = ps != null && (ps[i] || "") !== (s[i] || "") && i <= Math.max(s.length, ps.length);
      h += `<div class="vb-cell ${ch ? "chg" : mk[i] ? "on" : ""} ${i === s.length ? "nul" : ""}"><b>${esc(c === " " ? "␣" : c)}</b><small>${i}</small><span class="mk">${mk[i] ? esc(mk[i].join(",")) : ""}</span></div>`;
    }
    return `<div class="vb-cells str">${h}</div>`;
  }
  function grid(v, prev, scope, globals) {
    const rows = v.v;
    const all = rows.flatMap((r) => r.v.filter(isNum).map(numOf));
    const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    const pr = prev && prev.k === "a" ? prev.v : null;
    // 行、列下标：i/r/row 指行，j/c/col 指列
    let ri = -1, ci = -1;
    for (const [n, x] of scope.vars.concat(globals)) if (x.k === "n") { if (/^(i|r|row|x)$/i.test(n)) ri = x.v; if (/^(j|c|col|y)$/i.test(n)) ci = x.v; }
    return `<table class="vb-grid"><tr><th></th>${rows[0].v.map((_, j) => `<th class="${j === ci ? "on" : ""}">${j}</th>`).join("")}</tr>${rows.map((r, i) => `<tr><th class="${i === ri ? "on" : ""}">${i}</th>${r.v.map((x, j) => {
      const ch = pr && pr[i] && pr[i].v && pr[i].v[j] && !same(pr[i].v[j], x);
      const t = isNum(x) ? (numOf(x) - lo) / span : 0;
      return `<td class="${ch ? "chg" : ""}${i === ri && j === ci ? " cur" : i === ri || j === ci ? " line" : ""}" style="--t:${t.toFixed(2)}">${short(x)}</td>`;
    }).join("")}</tr>`).join("")}</table>`;
  }
  function mapTable(v, prev, py) {
    const pm = new Map(prev && prev.k === "m" ? prev.v.map(([k, x]) => [JSON.stringify(k), x]) : []);
    return `<table class="vb-map">${v.v.map(([k, x]) => { const old = pm.get(JSON.stringify(k)); const ch = prev && (!old || !same(old, x)); return `<tr class="${ch ? "chg" : ""}"><td>${short(k, py)}</td><td>${value(x, old, py, 1)}</td></tr>`; }).join("") || `<tr><td class="empty">空的</td></tr>`}</table>`;
  }
  // 链表 / 树：结构体里指向同类结构体的字段
  function selfPtrs(o) { return Object.entries(o.v || {}).filter(([, x]) => (x.k === "p" && (!x.d || x.d.k === "o") && (x.ref || !x.d || x.d.t === o.t)) || x.k === "z").map(([k]) => k); }
  function chain(p, py) {
    const nodes = []; let cur = p, guard = 0, end = "";
    while (cur && guard++ < 14) {
      if (cur.k === "z") { end = py ? "None" : "NULL"; break; }
      if (cur.k !== "p") break;
      if (cur.ref) { end = "↺"; break; }
      if (!cur.d || cur.d.k !== "o") { end = cur.bad ? "坏地址" : "…"; break; }
      const o = cur.d, links = selfPtrs(o);
      const data = Object.entries(o.v).filter(([k]) => !links.includes(k));
      nodes.push(`<div class="vb-node"><div class="nd">${data.map(([k, x]) => `<span><small>${esc(k)}</small>${scalar(x) ? short(x, py) : short(x, py)}</span>`).join("") || "<span>·</span>"}</div><i class="ptr"></i></div>`);
      cur = o.v[links[0]];
      if (guard === 14 && cur) end = "…";
    }
    return `<div class="vb-chain">${nodes.join('<span class="arrow"></span>')}${nodes.length ? '<span class="arrow"></span>' : ""}<span class="vb-null">${esc(end || (py ? "None" : "NULL"))}</span></div>`;
  }
  function tree(p, py, depth = 0) {
    if (!p || p.k === "z") return `<div class="vb-tn nil">·</div>`;
    if (p.k !== "p" || !p.d || p.d.k !== "o" || depth > 6) return `<div class="vb-tn nil">…</div>`;
    const o = p.d, links = selfPtrs(o);
    const data = Object.entries(o.v).filter(([k]) => !links.includes(k)).map(([, x]) => short(x, py)).join(" ");
    const kids = links.slice(0, 2).map((k) => o.v[k]);
    const leaf = kids.every((k) => !k || k.k === "z");
    return `<div class="vb-tree"><div class="vb-tn">${data}</div>${leaf ? "" : `<div class="vb-tk">${kids.map((k) => tree(k, py, depth + 1)).join("")}</div>`}</div>`;
  }
  function struct(o, prev, py, nested) {
    const po = prev && prev.k === "o" ? prev.v : null;
    return `<div class="vb-struct${nested ? " nested" : ""}"><div class="st">${esc(o.t || "struct")}</div>${Object.entries(o.v).map(([k, x]) => {
      const ch = po && po[k] && !same(po[k], x);
      return `<div class="fr ${ch ? "chg" : ""}"><span class="nm">${esc(k)}</span>${value(x, po && po[k], py, 1)}</div>`;
    }).join("")}</div>`;
  }
  // 小一点的值（结构体字段、字典的值里面）
  function value(x, prev, py, nested) {
    if (!x) return "";
    if (x.k === "a") {
      if (x.v.length && x.v.every(isNum) && x.v.length <= 16) return cellsRow(x, prev, {}, py);
      return `<span class="vb-v">${short(x, py)}</span>`;
    }
    if (x.k === "o") return struct(x, prev, py, true);
    if (x.k === "s" && x.n) return `<span class="vb-v">"${esc(x.v)}"</span>`;
    return `<span class="vb-v">${short(x, py)}</span>`;
  }

  // 一个变量：返回 { html, big }（big = 要占一整行的大东西）
  function widget(name, v, prev, scope, globals, opt) {
    const py = opt.py;
    if (v.k === "a" && v.v.length) {
      const rows = v.v;
      if (rows.every((r) => r.k === "a" && r.v.length && r.v.every(isNum)) && rows.length <= 24) return { big: 1, kind: "grid", html: grid(v, prev, scope, globals) };
      if (rows.every((r) => r.k === "s" && r.n) && rows.length <= 24) return { big: 1, kind: "rows", html: `<div class="vb-rows">${rows.map((r, i) => `<div><small>${i}</small>${strCells(r, prev && prev.v && prev.v[i], {})}</div>`).join("")}</div>` };
      const mk = markers(v, scope, globals, rows.length);
      if (rows.every(isNum) && rows.length >= 2) return { big: 1, kind: "bars", html: bars(name, v, prev, mk, opt) };
      return { big: 1, kind: "cells", html: cellsRow(v, prev, mk, py) };
    }
    if (v.k === "a") return { html: `<span class="vb-v">[]</span>` };
    if (v.k === "s" && v.n) return { big: 1, kind: "str", html: strCells(v, prev, markers(v, scope, globals, v.n)) };
    if (v.k === "s" && v.v.length > 30) return { big: 1, kind: "text", html: `<div class="vb-text">"${esc(v.v)}"</div>` };
    if (v.k === "m") return { big: 1, kind: "map", html: mapTable(v, prev, py) };
    if (v.k === "o") return { big: 1, kind: "struct", html: struct(v, prev, py) };
    if (v.k === "p" && v.d && v.d.k === "o") {
      const links = selfPtrs(v.d);
      if (links.length >= 2) return { big: 1, kind: "tree", html: tree(v, py) };
      if (links.length === 1) return { big: 1, kind: "list", html: chain(v, py) };
      return { big: 1, kind: "struct", html: `<div class="vb-pt"><span class="arrow"></span>${struct(v.d, prev && prev.d, py)}</div>` };
    }
    if (v.k === "p" && v.d && v.d.k === "a") return { big: 1, kind: "cells", html: cellsRow(v.d, prev && prev.d, {}, py) };
    if (v.k === "p" && v.d && v.d.k === "m") return { big: 1, kind: "map", html: mapTable(v.d, prev && prev.d, py) };
    // 指针指进某个数组：p → a[3]
    if (v.k === "p" && !(v.d && /^[aom]$/.test(v.d.k))) {
      for (const sc of [scope].concat(CTX.scopes)) for (const [n, x] of sc.vars) if (x.k === "a") { const off = intoArr(v, x, x.n || x.v.length); if (off >= 0) return { html: `<span class="vb-v ptr">→ ${sc === scope || sc.global ? "" : esc(sc.fn) + " 里的 "}${esc(n)}[${off}]</span>` }; }
    }
    return { html: `<span class="vb-v">${short(v, py)}</span>` };
  }

  // ---------- 整个画面 ----------
  function boardHtml(step, prev, opt) {
    const sc = scopes(step), psc = prev ? varMap(prev) : null;
    const globals = step.g || [];
    CTX = { scopes: sc };
    // 正在执行的那一层放最上面，往下是调用它的，最后是全局变量；递归很深：只画最里面三层和最外层
    const frames = sc.filter((s) => !s.global).reverse();
    let hidden = 0, fr = frames;
    if (frames.length > 4) { hidden = frames.length - 4; fr = frames.slice(0, 3).concat(frames.slice(-1)); }
    const list = fr.concat(sc.filter((s) => s.global));
    return list.map((s, i) => {
      const chips = [], bigs = [];
      for (const [n, v] of s.vars) {
        const key = s.key + "/" + n;
        const pv = psc ? psc.get(key) : null;
        const w = widget(n, v, pv, s, s.global ? [] : globals, opt);
        const ch = psc && (pv === undefined || !same(pv, v));
        if (w.big) bigs.push(`<div class="vb-big" data-k="${esc(key)}"><div class="vb-bh"><span class="nm">${esc(n)}</span>${typeLabel(v)}${ch ? '<span class="vb-dot"></span>' : ""}</div>${w.html}</div>`);
        else chips.push(`<div class="vb-chip ${ch ? (psc && pv === undefined ? "new" : "chg" + (opt.n % 2)) : ""}" data-k="${esc(key)}"><span class="nm">${esc(n)}</span>${w.html}</div>`);
      }
      const sep = hidden && !s.global && i === 3 ? `<div class="vb-skip">…中间还有 ${hidden} 层 ${esc(frames[3].fn)}()…</div>` : "";
      return `${sep}<section class="vb-scope${s.cur ? " cur" : ""}${s.global ? " glob" : ""}" data-k="${esc(s.key)}">
        <header><span class="fn">${s.global ? (s.py ? "主程序" : "全局变量") : esc(s.fn === "主程序" ? "主程序" : s.fn + "()")}</span>${s.global ? "" : `<small>第 ${s.line} 行</small>`}${s.cur ? '<span class="here">正在这里</span>' : ""}</header>
        ${chips.length ? `<div class="vb-chips">${chips.join("")}</div>` : ""}${bigs.join("")}${!chips.length && !bigs.length ? '<div class="vb-empty">还没有变量</div>' : ""}
      </section>`;
    }).join("");
  }
  function typeLabel(v) {
    if (v.k === "a") return `<small>${v.t ? esc(v.t.replace("std::", "")) : ""}[${v.n || v.v.length}]</small>`;
    if (v.k === "s" && v.n) return `<small>char[${v.n}]</small>`;
    if (v.k === "p" && v.d && v.d.k === "o") return `<small>→ ${esc(v.d.t || "")}</small>`;
    if (v.k === "o") return `<small>${esc(v.t || "")}</small>`;
    if (v.k === "m") return `<small>${esc(v.t || "map")}</small>`;
    return "";
  }

  // 悬浮小窗：只画最重要的那一个（整次运行里变得最多的大东西），再加几个下标变量
  function pickFocus(steps) {
    const cnt = new Map(); let prev = null;
    for (const st of steps) {
      const m = varMap(st);
      for (const [k, v] of m) {
        const big = v.k === "a" || (v.k === "s" && v.n) || v.k === "m" || v.k === "o" || (v.k === "p" && v.d && (v.d.k === "o" || v.d.k === "a"));
        if (!big) continue;
        const w = (v.k === "a" ? 3 : 2) + (prev && prev.has(k) && !same(prev.get(k), v) ? 4 : 0);
        cnt.set(k, (cnt.get(k) || 0) + w);
      }
      prev = m;
    }
    let best = null, bn = -1;
    for (const [k, n] of cnt) if (n > bn) { best = k; bn = n; }
    return best ? best.split("/").pop() : null;
  }
  function miniHtml(step, prev, focusName, opt) {
    const sc = scopes(step);
    const cur = sc[sc.length - 1] || { vars: [] };
    const globals = step.g || [];
    // 找 focus：先在当前这一层找，再找外面的
    CTX = { scopes: sc };
    const isBig = (v) => v.k === "a" || (v.k === "s" && v.n) || v.k === "m" || v.k === "o" || (v.k === "p" && v.d && (v.d.k === "o" || v.d.k === "a" || v.d.k === "m"));
    let hit = null;
    for (const want of [isBig, () => true]) {
      for (let i = sc.length - 1; i >= 0 && !hit; i--) for (const [n, v] of sc[i].vars) if (n === focusName && want(v)) { hit = { s: sc[i], n, v }; break; }
      if (hit) break;
    }
    const psc = prev ? varMap(prev) : null;
    let body = "";
    if (hit) {
      const w = widget(hit.n, hit.v, psc && psc.get(hit.s.key + "/" + hit.n), hit.s, hit.s.global ? [] : globals, { ...opt, mini: true });
      body = `<div class="vb-big mini" data-k="${esc(hit.s.key + "/" + hit.n)}"><div class="vb-bh"><span class="nm">${esc(hit.n)}</span>${typeLabel(hit.v)}${hit.s.global || hit.s.cur ? "" : `<small>在 ${esc(hit.s.fn)}() 里</small>`}</div>${w.html}</div>`;
    }
    const chips = cur.vars.filter(([n, v]) => n !== focusName && scalar(v)).slice(0, hit ? 6 : 12)
      .map(([n, v]) => { const pv = psc && psc.get(cur.key + "/" + n); const ch = psc && (pv === undefined || !same(pv, v)); return `<div class="vb-chip ${ch ? "chg" + (opt.n % 2) : ""}" data-k="${esc(cur.key + "/" + n)}"><span class="nm">${esc(n)}</span><span class="vb-v">${short(v, opt.py)}</span></div>`; });
    return `${body}${chips.length ? `<div class="vb-chips">${chips.join("")}</div>` : ""}${!body && !chips.length ? '<div class="vb-empty">这一步还没有变量</div>' : ""}`;
  }

  // ---------- 一句话：这一步发生了什么 ----------
  function narrate(step, prev, opt = {}) {
    const py = opt.py;
    if (!prev) return "开始运行";
    const parts = [];
    const fN = (step.f || []).length, pN = (prev.f || []).length;
    if (fN > pN && step.f[0]) {
      const args = (step.f[0].v || []).slice(0, 3).filter(([, v]) => scalar(v)).map(([n, v]) => `${n}=${short(v, py)}`).join(", ");
      parts.push(`调用 <b>${esc(step.f[0].fn)}(${args})</b>`);
    } else if (fN < pN && prev.f[0]) parts.push(`<b>${esc(prev.f[0].fn)}</b> 结束，回到 ${esc(step.f[0] ? step.f[0].fn : "")}`);
    if (prev.ret) parts.push(`返回 ${short(prev.ret, py)}`);
    if (fN === pN || fN < pN) {
      const now = varMap(step), was = varMap(prev);
      let n = 0;
      for (const [k, v] of now) {
        if (n >= 3) break;
        const o = was.get(k);
        const nm = k.split("/").pop();
        if (o === undefined) { if (fN === pN) { parts.push(`新变量 <b>${esc(nm)}</b> = ${short(v, py)}`); n++; } continue; }
        if (same(o, v)) continue;
        if (v.k === "a" && o.k === "a") {
          const d = v.v.map((x, i) => (o.v[i] && !same(o.v[i], x) ? i : -1)).filter((i) => i >= 0);
          if (d.length === 2 && same(v.v[d[0]], o.v[d[1]]) && same(v.v[d[1]], o.v[d[0]])) parts.push(`<b>${esc(nm)}[${d[0]}]</b> 和 <b>${esc(nm)}[${d[1]}]</b> 交换`);
          else if (d.length) parts.push(d.slice(0, 2).map((i) => `<b>${esc(nm)}[${i}]</b>: ${short(o.v[i], py)} → ${short(v.v[i], py)}`).join("，") + (d.length > 2 ? " …" : ""));
          else if (v.v.length !== o.v.length) parts.push(`<b>${esc(nm)}</b> 现在有 ${v.n || v.v.length} 个`);
        } else if (scalar(v) && scalar(o)) parts.push(`<b>${esc(nm)}</b>: ${short(o, py)} → ${short(v, py)}`);
        else parts.push(`<b>${esc(nm)}</b> 变了`);
        n++;
      }
    }
    if (step.o) parts.push(`输出 <code>${esc(step.o.length > 30 ? step.o.slice(0, 30) + "…" : step.o).replace(/\n/g, "↵")}</code>`);
    return parts.join("；") || "";
  }

  // ---------- 复用 DOM（简单的 morph：同样的标签就改属性和文字，不一样就换掉） ----------
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b.cloneNode(true)); return; }
    if (a.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    if (a.nodeType !== 1) return;
    if (a.dataset && b.dataset && a.dataset.k !== b.dataset.k) { a.replaceWith(b.cloneNode(true)); return; }
    for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    const ac = [...a.childNodes], bc = [...b.childNodes];
    for (let i = 0; i < bc.length; i++) { if (i < ac.length) morph(ac[i], bc[i]); else a.appendChild(bc[i].cloneNode(true)); }
    for (let i = bc.length; i < ac.length; i++) ac[i].remove();
  }
  function paint(el, html) {
    const wrap = document.createElement(el.nodeName); wrap.innerHTML = html;
    // 只比较子节点
    const ac = [...el.childNodes], bc = [...wrap.childNodes];
    for (let i = 0; i < bc.length; i++) { if (i < ac.length) morph(ac[i], bc[i]); else el.appendChild(bc[i].cloneNode(true)); }
    for (let i = bc.length; i < ac.length; i++) ac[i].remove();
  }

  function render(el, step, prev, opt = {}) {
    CTX = { scopes: step ? scopes(step) : [] };
    if (!step) { el.innerHTML = ""; return; }
    paint(el, opt.mini ? miniHtml(step, prev, opt.focus, opt) : boardHtml(step, prev, opt));
  }

  // 3D 舞台用：这一步里「重点数组」的值和下标标记（只要一维的数字数组，2~48 个）
  function focusArray(step, focusName) {
    if (!step || !focusName) return null;
    const sc = scopes(step); CTX = { scopes: sc };
    for (let i = sc.length - 1; i >= 0; i--) for (const [n, v] of sc[i].vars) {
      if (n !== focusName || v.k !== "a" || v.v.length < 2 || v.v.length > 48 || !v.v.every(isNum)) continue;
      return { name: n, fn: sc[i].fn || "", values: v.v.map(numOf), marks: markers(v, sc[i], step.g || [], v.v.length) };
    }
    return null;
  }
  root.VizBoard = { render, narrate, pickFocus, scopes, short, morph, focusArray };
})(typeof window !== "undefined" ? window : globalThis);
