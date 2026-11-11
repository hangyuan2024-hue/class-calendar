// LaTeX → PowerPoint 的公式（OMML，PowerPoint 里「插入 → 公式」做出来的那种，老师双击还能改）。
// 只管中小学、大学课堂上常见的写法：分式、根号、上下标、求和 / 积分 / 极限、希腊字母和各种符号、括号、矩阵、分段函数、
// 三角 / 对数函数、向量和上划线这些重音、\text{} 里的文字。认不出的命令原样当文字放进去（不会让 PowerPoint 打不开）。
//   toOmml(latex) → "<m:oMath>…</m:oMath>"      linear(latex) → 一行能看懂的文字（不认识公式的软件里显示这个）
"use strict";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- 符号表 ----------
const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω" };
const SYM = { times: "×", div: "÷", pm: "±", mp: "∓", cdot: "⋅", ast: "∗", star: "⋆", circ: "∘", bullet: "∙", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫",
  infty: "∞", partial: "∂", nabla: "∇", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", leftrightarrow: "↔", iff: "⇔", implies: "⇒", mapsto: "↦", uparrow: "↑", downarrow: "↓",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", setminus: "∖",
  angle: "∠", triangle: "△", perp: "⊥", parallel: "∥", degree: "°", prime: "′", because: "∵", therefore: "∴", cdots: "⋯", ldots: "…", dots: "…", vdots: "⋮", ddots: "⋱", mid: "∣", nmid: "∤", aleph: "ℵ", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", wp: "℘",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", "|": "‖", Vert: "‖", vert: "|", "{": "{", "}": "}", "%": "%", "#": "#", "&": "&", _: "_", $: "$", backslash: "\\", odot: "⊙", oplus: "⊕", otimes: "⊗", square: "□", Box: "□", lozenge: "◊", checkmark: "✓" };
const SPACE = { ",": " ", ":": " ", ";": " ", " ": " ", quad: " ", qquad: "  ", "!": "" };
const NARY = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂", bigvee: "⋁", bigwedge: "⋀", bigoplus: "⨁", bigotimes: "⨂" };
const FUNC = ["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "log", "ln", "lg", "exp", "det", "dim", "ker", "gcd", "deg", "arg", "hom", "Pr"];
const LIMF = ["lim", "max", "min", "sup", "inf", "limsup", "liminf"];   // 下标写在正下方
const ACC = { hat: "̂", widehat: "̂", tilde: "̃", widetilde: "̃", dot: "̇", ddot: "̈", vec: "⃗", overrightarrow: "⃗", check: "̌", breve: "̆", acute: "́", grave: "̀" };
const BB = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ" };
const DELIM = { "(": "(", ")": ")", "[": "[", "]": "]", "\\{": "{", "\\}": "}", "|": "|", "\\|": "‖", ".": "", "\\langle": "⟨", "\\rangle": "⟩", "\\lfloor": "⌊", "\\rfloor": "⌋", "\\lceil": "⌈", "\\rceil": "⌉", "\\vert": "|", "\\Vert": "‖", "/": "/" };
const MATRIX = { matrix: ["", ""], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], array: ["", ""], smallmatrix: ["", ""] };
const RELATION = new Set(["=", "<", ">", "≤", "≥", "≠", "≈", "≡", "∼", "≅", "→", "⇒", "⇔", "∈", "⊂", "⊆"]);

// ---------- 分词 ----------
function tokens(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)\s*|^\\(.)/.exec(src.slice(i));
      out.push({ k: "cmd", v: m[1] || m[2] }); i += m[0].length; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if ("{}[]^_&".includes(c)) { out.push({ k: c }); i++; continue; }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i)); out.push({ k: "num", v: m[0] }); i += m[0].length; continue; }
    if (c === "'") { out.push({ k: "ch", v: "′" }); i++; continue; }
    out.push({ k: "ch", v: c }); i++;
  }
  return out;
}

// ---------- 解析成树 ----------
function parse(src) {
  const T = tokens(src);
  let p = 0;
  const peek = () => T[p], next = () => T[p++];
  const isEnd = (t, stop) => !t || stop(t);
  // 一组：{...} 或者一个记号
  function group() {
    const t = peek();
    if (!t) return [];
    if (t.k === "{") { next(); const e = list((x) => x.k === "}"); if (peek() && peek().k === "}") next(); return e; }
    if (t.k === "num" && t.v.length > 1) { const d = t.v[0]; t.v = t.v.slice(1); return [{ t: "run", s: d, plain: true }]; }
    const a = atom(true);   // 不带花括号：只取一个（\frac12 就是 1 和 2）
    return a ? [a] : [];
  }
  function optArg() {
    if (!peek() || peek().k !== "[") return null;
    next(); const e = list((x) => x.k === "]"); if (peek() && peek().k === "]") next(); return e;
  }
  function textArg() {   // \text{...} 里原样的文字
    if (!peek() || peek().k !== "{") return "";
    next(); let depth = 1, s = "";
    while (peek() && depth) { const t = next(); if (t.k === "{") depth++; else if (t.k === "}") { depth--; if (!depth) break; } s += t.k === "cmd" ? (SPACE[t.v] != null ? " " : SYM[t.v] || GREEK[t.v] || t.v) : t.k === "num" || t.k === "ch" ? t.v : t.k === "&" ? "&" : t.k === "^" || t.k === "_" ? t.k : t.k; }
    return s;
  }
  function delimTok() {
    const t = next(); if (!t) return "";
    const k = t.k === "cmd" ? "\\" + t.v : t.k === "ch" ? t.v : t.k;
    return DELIM[k] != null ? DELIM[k] : t.k === "cmd" ? SYM[t.v] || "" : t.v || "";
  }
  function scripts(base) {
    let sub = null, sup = null;
    for (;;) {
      const t = peek();
      if (t && t.k === "_" && !sub) { next(); sub = group(); continue; }
      if (t && t.k === "^" && !sup) { next(); sup = group(); continue; }
      if (t && t.k === "ch" && t.v === "′" && !sup) { next(); sup = [{ t: "run", s: "′", plain: true }]; continue; }
      break;
    }
    if (!sub && !sup) return base;
    return { t: "scr", base, sub, sup };
  }
  function env(name) {
    // \begin{xxx} … \end{xxx}：一行一行（\\ 分行），一格一格（& 分格）
    if (name === "array" && peek() && peek().k === "{") textArg();   // 列格式 {cc} 不管
    const rows = [[[]]];
    for (;;) {
      const t = peek(); if (!t) break;
      if (t.k === "cmd" && t.v === "end") { next(); textArg(); break; }
      if (t.k === "&") { next(); rows[rows.length - 1].push([]); continue; }
      if (t.k === "cmd" && t.v === "\\") { next(); rows.push([[]]); continue; }
      const row = rows[rows.length - 1];
      row[row.length - 1].push(...list((x) => x.k === "&" || (x.k === "cmd" && (x.v === "\\" || x.v === "end"))));
    }
    while (rows.length > 1 && rows[rows.length - 1].every((c) => !c.length)) rows.pop();
    if (name === "cases") return { t: "cases", rows };
    if (/^(aligned|align\*?|gathered|split|eqnarray)$/.test(name)) return { t: "lines", rows };
    const [b, e] = MATRIX[name] || ["", ""];
    return { t: "matrix", rows, b, e };
  }
  // 一个东西（不带上下标）
  function atom(inGroup) {
    const t = next();
    if (!t) return null;
    if (t.k === "num") return { t: "run", s: t.v, plain: true };
    if (t.k === "ch") return { t: "run", s: t.v, plain: !/[A-Za-z]/.test(t.v) };
    if (t.k === "{") { const e = list((x) => x.k === "}"); if (peek() && peek().k === "}") next(); return { t: "grp", e }; }
    if (t.k === "[" || t.k === "]") return { t: "run", s: t.k, plain: true };
    if (t.k === "^" || t.k === "_") return { t: "run", s: "", plain: true };
    if (t.k === "&" || t.k === "}") return { t: "run", s: "", plain: true };
    const c = t.v;
    if (c === "frac" || c === "dfrac" || c === "tfrac" || c === "cfrac") return { t: "frac", n: group(), d: group() };
    if (c === "binom" || c === "dbinom" || c === "tbinom") return { t: "binom", n: group(), d: group() };
    if (c === "sqrt") { const deg = optArg(); return { t: "sqrt", deg, e: group() }; }
    if (NARY[c]) {
      let sub = null, sup = null;
      if (peek() && peek().k === "cmd" && (peek().v === "limits" || peek().v === "nolimits")) next();
      for (;;) { const s = peek(); if (s && s.k === "_" && !sub) { next(); sub = group(); continue; } if (s && s.k === "^" && !sup) { next(); sup = group(); continue; } break; }
      // 求和 / 积分的「被作用的部分」：一直到等号这类关系符（或者这一组结束）
      const e = list((x) => x.k === "&" || x.k === "}" || x.k === "]" || (x.k === "ch" && RELATION.has(x.v)) || (x.k === "cmd" && (x.v === "\\" || x.v === "end" || x.v === "right" || RELATION.has(SYM[x.v]))));
      return { t: "nary", chr: NARY[c], sub, sup, e, int: /int/.test(c) };
    }
    if (FUNC.includes(c) || LIMF.includes(c) || c === "operatorname") {
      const name = c === "operatorname" ? textArg() : c;
      let lim = null, sup = null;
      for (;;) { const s = peek(); if (s && s.k === "_" && !lim) { next(); lim = group(); continue; } if (s && s.k === "^" && !sup) { next(); sup = group(); continue; } break; }
      const arg = peek() && !(peek().k === "ch" && RELATION.has(peek().v)) && peek().k !== "}" && peek().k !== "&" ? [atomWithScripts(true)] : [];
      return { t: "func", name, lim, sup, under: LIMF.includes(c), e: arg };
    }
    if (c === "left") {
      const b = delimTok();
      const e = list((x) => x.k === "cmd" && x.v === "right");
      let en = "";
      if (peek() && peek().k === "cmd" && peek().v === "right") { next(); en = delimTok(); }
      return { t: "delim", b, e: en, body: e };
    }
    if (c === "right") return { t: "run", s: "", plain: true };
    if (/^(big|Big|bigg|Bigg)[lrm]?$/.test(c)) { const d = delimTok(); return { t: "run", s: d, plain: true }; }
    if (ACC[c]) return { t: "acc", chr: ACC[c], e: group() };
    if (c === "bar" || c === "overline") return { t: "bar", pos: "top", e: group() };
    if (c === "underline") return { t: "bar", pos: "bot", e: group() };
    if (c === "overbrace" || c === "underbrace") return { t: "grp", e: group() };
    if (c === "text" || c === "textrm" || c === "mbox" || c === "textbf" || c === "textit") return { t: "run", s: textArg(), plain: true, text: true, bold: c === "textbf" };
    if (c === "mathrm") return { t: "style", plain: true, e: group() };
    if (c === "mathbf" || c === "boldsymbol" || c === "bm") return { t: "style", bold: true, e: group() };
    if (c === "mathit") return { t: "style", e: group() };
    if (c === "mathbb") { const s = textArg(); return { t: "run", s: [...s].map((x) => BB[x] || x).join(""), plain: true }; }
    if (c === "mathcal" || c === "mathscr") return { t: "style", e: group() };
    if (c === "displaystyle" || c === "textstyle" || c === "limits" || c === "nolimits" || c === "left." || c === "middle") return { t: "run", s: "", plain: true };
    if (c === "begin") { const name = textArg(); return env(name); }
    if (c === "end") { textArg(); return { t: "run", s: "", plain: true }; }
    if (c === "not") { const a = atom(); return a && a.t === "run" && a.s === "=" ? { t: "run", s: "≠", plain: true } : { t: "grp", e: [{ t: "run", s: "/", plain: true }, a].filter(Boolean) }; }
    if (c === "pmod") return { t: "grp", e: [{ t: "run", s: " (mod ", plain: true }, { t: "grp", e: group() }, { t: "run", s: ")", plain: true }] };
    if (c === "bmod" || c === "mod") return { t: "run", s: " mod ", plain: true };
    if (GREEK[c]) return { t: "run", s: GREEK[c], plain: /^[A-Z]/.test(c) };
    if (SYM[c] != null) return { t: "run", s: SYM[c], plain: true };
    if (SPACE[c] != null) return { t: "run", s: SPACE[c], plain: true };
    if (c === "\\") return { t: "run", s: "", plain: true };
    return { t: "run", s: c, plain: true };   // 认不出的命令：把名字当文字
  }
  function atomWithScripts(inGroup) { const a = atom(inGroup); return a ? scripts(a) : null; }
  function list(stop) {
    const out = [];
    while (!isEnd(peek(), stop)) {
      const before = p;
      const a = atomWithScripts();
      if (a) out.push(a);
      if (p === before) next();   // 保险：不会卡死
    }
    return out;
  }
  return list(() => false);
}

// ---------- 生成 OMML ----------
const FONT = '<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/>';
const aRPr = (o = {}) => `<a:rPr lang="en-US" altLang="zh-CN"${o.plain ? "" : ' i="1"'}${o.bold ? ' b="1"' : ""}>${FONT}</a:rPr>`;
const ctrl = () => `<m:ctrlPr>${aRPr()}</m:ctrlPr>`;
function run(s, o = {}) {
  if (!s) return "";
  const sty = o.bold && o.plain ? "b" : o.bold ? "bi" : o.plain ? "p" : null;
  return `<m:r>${sty || o.text ? `<m:rPr>${o.text ? "<m:nor/>" : ""}${sty ? `<m:sty m:val="${sty}"/>` : ""}</m:rPr>` : ""}${aRPr(o)}<m:t>${esc(s)}</m:t></m:r>`;
}
function xml(nodes, st = {}) { return (nodes || []).map((n) => one(n, st)).join(""); }
const E = (tag, nodes, st) => `<m:${tag}>${xml(nodes, st)}</m:${tag}>`;
function one(n, st) {
  if (!n) return "";
  switch (n.t) {
    case "run": return run(n.s, { plain: n.plain || st.plain, bold: n.bold || st.bold, text: n.text });
    case "grp": return xml(n.e, st);
    case "style": return xml(n.e, { plain: n.plain || st.plain, bold: n.bold || st.bold });
    case "frac": return `<m:f><m:fPr>${ctrl()}</m:fPr>${E("num", n.n, st)}${E("den", n.d, st)}</m:f>`;
    case "binom": return `<m:d><m:dPr>${ctrl()}</m:dPr><m:e><m:f><m:fPr><m:type m:val="noBar"/>${ctrl()}</m:fPr>${E("num", n.n, st)}${E("den", n.d, st)}</m:f></m:e></m:d>`;
    case "sqrt": return `<m:rad><m:radPr>${n.deg ? "" : '<m:degHide m:val="1"/>'}${ctrl()}</m:radPr>${n.deg ? E("deg", n.deg, st) : "<m:deg/>"}${E("e", n.e, st)}</m:rad>`;
    case "scr": {
      const base = E("e", [n.base], st);
      if (n.sub && n.sup) return `<m:sSubSup><m:sSubSupPr>${ctrl()}</m:sSubSupPr>${base}${E("sub", n.sub, st)}${E("sup", n.sup, st)}</m:sSubSup>`;
      if (n.sup) return `<m:sSup><m:sSupPr>${ctrl()}</m:sSupPr>${base}${E("sup", n.sup, st)}</m:sSup>`;
      return `<m:sSub><m:sSubPr>${ctrl()}</m:sSubPr>${base}${E("sub", n.sub, st)}</m:sSub>`;
    }
    case "nary": return `<m:nary><m:naryPr><m:chr m:val="${n.chr}"/><m:limLoc m:val="${n.int ? "subSup" : "undOvr"}"/>${n.sub ? "" : '<m:subHide m:val="1"/>'}${n.sup ? "" : '<m:supHide m:val="1"/>'}${ctrl()}</m:naryPr>${E("sub", n.sub, st)}${E("sup", n.sup, st)}${E("e", n.e, st)}</m:nary>`;
    case "func": {
      let name = run(n.name, { plain: true });
      if (n.lim && n.under) name = `<m:limLow><m:limLowPr>${ctrl()}</m:limLowPr><m:e>${name}</m:e>${E("lim", n.lim, st)}</m:limLow>`;
      else if (n.lim && n.sup) name = `<m:sSubSup><m:sSubSupPr>${ctrl()}</m:sSubSupPr><m:e>${name}</m:e>${E("sub", n.lim, st)}${E("sup", n.sup, st)}</m:sSubSup>`;
      else if (n.lim) name = `<m:sSub><m:sSubPr>${ctrl()}</m:sSubPr><m:e>${name}</m:e>${E("sub", n.lim, st)}</m:sSub>`;
      else if (n.sup) name = `<m:sSup><m:sSupPr>${ctrl()}</m:sSupPr><m:e>${name}</m:e>${E("sup", n.sup, st)}</m:sSup>`;
      return `<m:func><m:funcPr>${ctrl()}</m:funcPr><m:fName>${name}</m:fName>${E("e", n.e, st)}</m:func>`;
    }
    case "delim": return `<m:d><m:dPr><m:begChr m:val="${esc(n.b)}"/><m:endChr m:val="${esc(n.e)}"/>${ctrl()}</m:dPr>${E("e", n.body, st)}</m:d>`;
    case "acc": return `<m:acc><m:accPr><m:chr m:val="${n.chr}"/>${ctrl()}</m:accPr>${E("e", n.e, st)}</m:acc>`;
    case "bar": return `<m:bar><m:barPr><m:pos m:val="${n.pos}"/>${ctrl()}</m:barPr>${E("e", n.e, st)}</m:bar>`;
    case "matrix": {
      const cols = Math.max(1, ...n.rows.map((r) => r.length));
      const m = `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>${ctrl()}</m:mPr>` +
        n.rows.map((r) => `<m:mr>${Array.from({ length: cols }, (_, i) => E("e", r[i] || [], st)).join("")}</m:mr>`).join("") + "</m:m>";
      return n.b || n.e ? `<m:d><m:dPr><m:begChr m:val="${esc(n.b)}"/><m:endChr m:val="${esc(n.e)}"/>${ctrl()}</m:dPr><m:e>${m}</m:e></m:d>` : m;
    }
    case "cases": {
      const rows = n.rows.map((r) => `<m:e>${r.map((c, i) => (i ? run(" ", { plain: true }) : "") + xml(c, st)).join("")}</m:e>`).join("");
      return `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/>${ctrl()}</m:dPr><m:e><m:eqArr><m:eqArrPr>${ctrl()}</m:eqArrPr>${rows}</m:eqArr></m:e></m:d>`;
    }
    case "lines": return `<m:eqArr><m:eqArrPr>${ctrl()}</m:eqArrPr>${n.rows.map((r) => `<m:e>${r.map((c) => xml(c, st)).join("")}</m:e>`).join("")}</m:eqArr>`;
    default: return "";
  }
}

// 模型、照片识别出来的常常带 $…$、\[…\]、```latex
function clean(latex) {
  let s = String(latex || "").trim();
  s = s.replace(/^```(?:latex|tex|math)?\s*|\s*```$/g, "").trim();
  for (const [a, b] of [["$$", "$$"], ["\\[", "\\]"], ["\\(", "\\)"], ["$", "$"]]) if (s.startsWith(a) && s.endsWith(b) && s.length > a.length + b.length) { s = s.slice(a.length, s.length - b.length).trim(); break; }
  s = s.replace(/^\\begin\{(equation|displaymath)\*?\}|\\end\{(equation|displaymath)\*?\}$/g, "").trim();
  return s;
}

function toOmml(latex) {
  const tree = parse(clean(latex));
  return `<m:oMath>${xml(tree)}</m:oMath>`;
}

// 一行文字版：不认识公式的软件（WPS 旧版、预览图）里显示这个，也给大模型核对用
function lin(nodes) { return (nodes || []).map(l1).join(""); }
const wrap = (s) => (s.length > 1 && !/^[\w.]+$/.test(s) ? `(${s})` : s);
function l1(n) {
  if (!n) return "";
  switch (n.t) {
    case "run": return n.s;
    case "grp": case "style": return lin(n.e);
    case "frac": return `${wrap(lin(n.n))}/${wrap(lin(n.d))}`;
    case "binom": return `C(${lin(n.n)},${lin(n.d)})`;
    case "sqrt": { const e = lin(n.e); return (n.deg ? `${lin(n.deg)}√` : "√") + (e.length > 1 ? `(${e})` : e); }
    case "scr": return l1(n.base) + (n.sub ? "_" + wrap(lin(n.sub)) : "") + (n.sup ? "^" + wrap(lin(n.sup)) : "");
    case "nary": return n.chr + (n.sub ? "_" + wrap(lin(n.sub)) : "") + (n.sup ? "^" + wrap(lin(n.sup)) : "") + " " + lin(n.e);
    case "func": return n.name + (n.lim ? "_" + wrap(lin(n.lim)) : "") + (n.sup ? "^" + wrap(lin(n.sup)) : "") + " " + lin(n.e);
    case "delim": return n.b + lin(n.body) + n.e;
    case "acc": case "bar": return lin(n.e) + (n.chr || "̅");
    case "matrix": return n.b + n.rows.map((r) => r.map(lin).join(", ")).join("; ") + n.e;
    case "cases": return "{ " + n.rows.map((r) => r.map(lin).join(" ")).join("; ");
    case "lines": return n.rows.map((r) => r.map(lin).join(" ")).join("; ");
    default: return "";
  }
}
const linear = (latex) => lin(parse(clean(latex))).replace(/\s+/g, " ").trim();

module.exports = { toOmml, linear, parse, clean };
