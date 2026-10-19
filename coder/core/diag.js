// 捞捞编程 · 读懂编译器 / 解释器的报错：哪一行、什么错，再配一句中文提示（初学者最常见的几十种）
// 返回 [{ line, col, severity: "error"|"warning", message, hint }]，只要「你写的这个文件」里的
"use strict";
const path = require("path");
const fs = require("fs");

// 常见报错 → 中文提示。按顺序匹配，第一个对上的算数
const HINTS = [
  // C / C++
  [/expected ';' before|expected ';' at end|expected ';' after/i, "这一行（或上一行）末尾少了分号 ;"],
  [/expected '=', ',', ';', 'asm' or '__attribute__' before|expected .*';'.* before/i, "上一行末尾可能少了分号 ;"],
  [/'(cout|cin|endl|string|vector|map|set|sort|swap|max|min|getline)' was not declared in this scope|'(cout|cin|endl|string|vector)' undeclared/i, (m) => `「${m[1] || m[2]}」是标准库里的：在 #include 下面加一行 using namespace std;（或者写成 std::${m[1] || m[2]}），也检查有没有 #include 对应的头文件`],
  [/'(\w+)' undeclared|'(\w+)' was not declared in this scope|use of undeclared identifier '(\w+)'/i, (m) => `「${m[1] || m[2] || m[3]}」没有定义：检查名字有没有拼错，或者忘了先声明（比如 int ${m[1] || m[2] || m[3]};）`],
  [/implicit declaration of function '(\w+)'/i, (m) => `「${m[1]}」这个函数没找到：是不是拼错了，或者少了 #include（比如 printf 要 #include <stdio.h>，sqrt 要 #include <math.h>）`],
  [/format '%d' expects argument of type 'int \*'|expects argument of type '(int|float|double|char) \*'/i, "scanf 要给变量的地址：在变量名前面加 &（比如 scanf(\"%d\", &n)）"],
  [/format '%(\w+)' expects argument of type '([^']+)', but argument \d+ has type '([^']+)'/i, (m) => `%${m[1]} 要配 ${m[2]} 类型的值，你给的是 ${m[3]}：换一个格式符，或者换变量`],
  [/expected '\)' before|expected '\)'/i, "括号没配对：少了一个 )"],
  [/expected '\}' at end of input|expected declaration or statement at end of input/i, "大括号没配对：最后少了一个 }"],
  [/expected '\{'/i, "这里应该有一个 {"],
  [/stray '\\(\d+)' in program|stray '\\\d+'/i, "代码里混进了中文符号（中文分号、中文括号、中文引号）：换成英文半角的"],
  [/missing terminating " character|missing terminating ' character/i, "字符串的引号没写完：少了结尾的 \""],
  [/assignment to expression with array type/i, "数组不能直接用 = 赋值；字符串用 strcpy(目标, 来源)"],
  [/control reaches end of non-void function/i, "这个函数说了要返回值，但有的情况没写 return"],
  [/suggest parentheses around assignment used as truth value/i, "if 里用了 =（赋值）：判断相等要写 =="],
  [/unused variable '(\w+)'/i, (m) => `变量「${m[1]}」定义了但没用到（不影响运行）`],
  [/'(\w+)' is used uninitialized|may be used uninitialized/i, (m) => `变量${m[1] ? "「" + m[1] + "」" : ""}还没赋值就用了，里面是随机的数：先给它一个初始值`],
  [/comparison of integer expressions of different signedness/i, "有符号和无符号整数比较（比如 int 和 size()）：一般不影响，可以把 int 换成 size_t"],
  [/no match for 'operator<<'|no match for 'operator>>'/i, "cout / cin 后面跟的东西不能直接输出 / 输入"],
  [/undefined reference to `?WinMain|undefined reference to `?main/i, "没找到 main 函数：检查是不是写成了 mian、Main"],
  [/undefined reference to `?(\w+)/i, (m) => `用了「${m[1]}」但没有写它的函数体（只声明没定义），或者名字拼错了`],
  [/redefinition of '(\w+)'|redeclaration of '(\w+)'|conflicting declaration/i, (m) => `「${m[1] || m[2] || ""}」定义了两次：改个名字或删掉一个`],
  [/too few arguments to function/i, "调用函数时少传了参数"],
  [/too many arguments to function/i, "调用函数时多传了参数"],
  [/array subscript .* is above array bounds|index \d+ is out of bounds/i, "数组下标越界：下标从 0 开始，最大是 长度-1"],
  // Python
  [/IndentationError: expected an indented block/i, "冒号 : 后面的下一行要缩进（按 Tab 或 4 个空格）"],
  [/IndentationError: unexpected indent/i, "这一行多缩进了：和上一行对齐"],
  [/IndentationError|TabError/i, "缩进不对：同一块代码要对齐，别混用 Tab 和空格"],
  [/SyntaxError: invalid character '(.)'/i, (m) => `「${m[1]}」是中文符号：换成英文半角的`],
  [/SyntaxError: expected ':'/i, "if / for / while / def 这一行末尾要有冒号 :"],
  [/SyntaxError: '\(' was never closed|SyntaxError: unexpected EOF/i, "括号没配对：少了一个 )"],
  [/SyntaxError: unterminated string literal/i, "字符串的引号没写完"],
  [/SyntaxError: invalid syntax\. Perhaps you forgot a comma/i, "这里可能少了一个逗号 ,"],
  [/SyntaxError: Missing parentheses in call to 'print'/i, "Python 3 里 print 要加括号：print(\"...\")"],
  [/SyntaxError: invalid syntax\. Maybe you meant '==' or ':=' instead of '='/i, "判断相等要写 ==，一个 = 是赋值"],
  [/SyntaxError/i, "这一行写法不对：检查括号、引号、冒号是不是英文半角、有没有配对"],
  [/NameError: name '(\w+)' is not defined/i, (m) => `「${m[1]}」没定义：是不是拼错了（大小写也算），或者还没赋值就用了；字符串要加引号`],
  [/TypeError: can only concatenate str \(not "(\w+)"\) to str/i, (m) => `字符串不能直接和 ${m[1]} 用 + 拼：用 str(数字) 转一下，或者用 f"...{变量}..."`],
  [/TypeError: unsupported operand type\(s\) for [+\-*/]+: 'int' and 'str'|'str' and 'int'/i, "数字和字符串不能直接算：input() 拿到的是字符串，要用 int(input()) 转成数字"],
  [/ValueError: invalid literal for int\(\) with base 10: '([^']*)'/i, (m) => `「${m[1]}」转不成整数：输入的不是数字，或者一行里有好几个数（用 input().split()）`],
  [/IndexError: (list|string|tuple) index out of range/i, "下标越界：下标从 0 开始，最大是 len()-1"],
  [/ZeroDivisionError/i, "除数是 0：先判断一下"],
  [/KeyError: (.*)/i, (m) => `字典里没有 ${m[1]} 这个键：先用 in 判断一下`],
  [/AttributeError: '(\w+)' object has no attribute '(\w+)'/i, (m) => `${m[1]} 类型没有「${m[2]}」这个方法 / 属性：检查拼写`],
  [/ModuleNotFoundError: No module named '([\w.]+)'/i, (m) => `没装「${m[1]}」这个库：捞捞编程自带的 Python 只有标准库`],
  [/RecursionError/i, "递归太深了：检查递归有没有停下来的条件"],
  [/EOFError/i, "程序还要输入，但已经没有了：在下面的输入框里多输入几行"],
  // Java
  [/class (\w+) is public, should be declared in a file named/i, (m) => `public class ${m[1]} 要放在叫 ${m[1]}.java 的文件里：改类名或者改文件名`],
  [/cannot find symbol/i, "找不到这个名字：检查拼写和大小写（Java 区分大小写，比如 String、System），或者少了 import"],
  [/incompatible types: possible lossy conversion from (\w+) to (\w+)/i, (m) => `${m[1]} 转成 ${m[2]} 可能丢精度：要写成 (${m[2]}) 强制转换`],
  [/incompatible types: (\w+) cannot be converted to (\w+)/i, (m) => `${m[1]} 不能当成 ${m[2]} 用`],
  [/missing return statement/i, "这个方法说了要返回值，但有的情况没写 return"],
  [/';' expected/i, "这里少了分号 ;"],
  [/reached end of file while parsing/i, "大括号没配对：最后少了一个 }"],
  [/variable (\w+) might not have been initialized/i, (m) => `变量 ${m[1]} 还没赋值就用了`],
  [/no main method|can't find main\(String\[\]\) method/i, "没找到 main 方法：public static void main(String[] args)"],
  [/ArrayIndexOutOfBoundsException|StringIndexOutOfBoundsException/i, "下标越界：下标从 0 开始，最大是 length-1"],
  [/NullPointerException/i, "用了一个还是 null 的对象：先 new 一个，或者先判断不是 null"],
  [/InputMismatchException/i, "输入的类型不对：nextInt() 要输入整数"],
  [/NoSuchElementException/i, "程序还要输入，但已经没有了"],
  [/ArithmeticException: \/ by zero/i, "除数是 0：先判断一下"],
  // JavaScript
  [/ReferenceError: (\w+) is not defined/i, (m) => `「${m[1]}」没定义：检查拼写，或者先用 let / const 声明`],
  [/TypeError: (.*) is not a function/i, (m) => `「${m[1]}」不是函数，不能加括号调用：检查名字`],
  [/TypeError: Cannot read propert(y|ies) of (undefined|null)/i, "对 undefined / null 取属性：前面那个变量还没有值"],
  [/SyntaxError: Unexpected token/i, "这里有个不该出现的符号：检查括号、逗号、引号"],
  [/SyntaxError: Unexpected end of input/i, "括号没配对：最后少了 } 或 )"],
  [/Assignment to constant variable/i, "const 声明的变量不能再改：要改就用 let"],
  // Go
  [/declared and not used: (\w+)|(\w+) declared and not used/i, (m) => `变量「${m[1] || m[2]}」声明了没用：Go 不允许，删掉它或者用上`],
  [/"(\S+)" imported and not used/i, (m) => `导入了「${m[1]}」但没用：Go 不允许，删掉这个 import`],
  [/undefined: (\w+)/i, (m) => `「${m[1]}」没定义：检查拼写和大小写`],
  [/syntax error: unexpected newline/i, "这里换行换早了：Go 的 { 要写在同一行末尾"],
  [/missing return/i, "这个函数要返回值，但有的情况没写 return"],
  [/index out of range/i, "下标越界：下标从 0 开始，最大是 len()-1"],
  [/integer divide by zero/i, "除数是 0：先判断一下"],
];

function hintFor(msg) {
  for (const [re, h] of HINTS) { const m = String(msg).match(re); if (m) return typeof h === "function" ? h(m) : h; }
  return "";
}

let ALIAS = "";   // 中文文件名拷成英文名编译时，报错里写的是英文名
const same = (a, file) => {
  if (!a) return false;
  const b = path.basename(file);
  if (ALIAS && (a === ALIAS || path.basename(a.replace(/\\/g, "/")) === ALIAS)) return true;
  return a === file || path.basename(a.replace(/\\/g, "/")) === b || a.replace(/\\/g, "/").endsWith("/" + b);
};
const add = (out, o) => {
  const old = out.find((x) => x.line === o.line && x.message === o.message);
  if (old) return old;
  const d = { ...o, hint: hintFor(o.message) }; out.push(d); return d;
};

function parseDiags(langId, text, file, alias) {
  const out = [];
  ALIAS = alias && alias !== path.basename(file) ? alias : "";
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let last = null;
  if (langId === "c" || langId === "cpp") {
    for (const l of lines) {
      const m = l.match(/^(.*?):(\d+):(\d+): (fatal error|error|warning): (.*)$/);
      if (m && same(m[1], file)) last = add(out, { line: +m[2], col: +m[3], severity: m[4] === "warning" ? "warning" : "error", message: m[5] });
      else if (m) last = null;
      // 编译器给的改法（-fdiagnostics-parseable-fixits）：fix-it:"a.c":{4:35-4:35}:";"（列是按字节数的）
      const fx = l.match(/^fix-it:"(.*)":\{(\d+):(\d+)-(\d+):(\d+)\}:"(.*)"$/);
      if (fx && last && !last.fixRaw && same(fx[1], file)) last.fixRaw = { l1: +fx[2], b1: +fx[3], l2: +fx[4], b2: +fx[5], text: fx[6].replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
      const k = l.match(/(?:^|:\s)(undefined reference to .*)$/);
      if (k && !out.some((x) => x.message === k[1])) add(out, { line: 0, col: 0, severity: "error", message: k[1] });
    }
  } else if (langId === "python") {
    let at = null;
    for (const l of lines) {
      const m = l.match(/^\s*File "(.*)", line (\d+)/);
      if (m && same(m[1], file)) at = +m[2];
      const e = l.match(/^(\w+(?:Error|Exception|Warning)|KeyboardInterrupt)(?::\s?(.*))?$/);
      if (e) add(out, { line: at || 0, col: 0, severity: "error", message: e[1] + (e[2] ? ": " + e[2] : "") });
    }
  } else if (langId === "java") {
    let rt = null;
    for (const l of lines) {
      const m = l.match(/^(.*\.java):(\d+): (error|warning): (.*)$/);
      if (m && same(m[1], file)) { last = add(out, { line: +m[2], col: 0, severity: m[3], message: m[4] }); continue; }
      // javac 在报错下面打一行代码、再一行 ^ 指着位置
      if (last && !last.col && /^\s*\^\s*$/.test(l)) { last.col = l.indexOf("^") + 1; last.caretChars = true; last = null; continue; }
      const x = l.match(/^Exception in thread "\w+" (.*)$|^error: (.*)$/);
      if (x && !/^compilation failed$/.test(x[2] || "")) rt = { message: x[1] || x[2] };
      const at = l.match(/^\s+at .*\((.*\.java):(\d+)\)/);
      if (rt && at && same(at[1], file)) { add(out, { line: +at[2], col: 0, severity: "error", message: rt.message }); rt = null; }
    }
    if (rt) add(out, { line: 0, col: 0, severity: "error", message: rt.message });
  } else if (langId === "javascript") {
    let at = null, msg = null;
    for (const l of lines) {
      const m = l.match(/^(.*\.m?js):(\d+)$/) || l.match(/\(?((?:[A-Za-z]:)?[^():]*\.m?js):(\d+):(\d+)\)?$/);
      if (m && same(m[1], file) && !at) at = +m[2];
      const e = l.match(/^(\w*Error)(?::\s?(.*))?$/);
      if (e && !msg) msg = e[1] + (e[2] ? ": " + e[2] : "");
    }
    if (msg) add(out, { line: at || 0, col: 0, severity: "error", message: msg });
  } else if (langId === "go") {
    let panic = null;
    for (const l of lines) {
      const m = l.match(/^(?:\.\/|.*?[\\/])?([^\\/\s:]+\.go):(\d+):(\d+): (.*)$/);
      if (m && same(m[1], file)) add(out, { line: +m[2], col: +m[3], severity: "error", message: m[4] });
      const p = l.match(/^panic: (.*)$/); if (p) panic = p[1];
      const at = l.match(/^\s+(.*\.go):(\d+)/);
      if (panic && at && same(at[1], file)) { add(out, { line: +at[2], col: 0, severity: "error", message: panic }); panic = null; }
    }
    if (panic) add(out, { line: 0, col: 0, severity: "error", message: panic });
  }
  let src = null;
  try { src = String(fs.readFileSync(file, "utf8")).replace(/\r/g, "").split("\n"); } catch (e) {}
  if (src) for (const d of out) { try { refine(langId, d, src); } catch (e) {} }
  return out.slice(0, 50);
}

// ---------- 把「改法」算准：在哪一行哪一个字后面加 / 改什么，配一句说清楚的中文 ----------
// d.fix = { line（第几行，从 1 开始）, ch（第几个字，从 0 开始）, endLine, endCh, text（换成什么） }
const byteToChar = (line, b) => Buffer.from(String(line || ""), "utf8").subarray(0, Math.max(0, b - 1)).toString("utf8").length;
const codeEnd = (line) => {   // 这一行代码的末尾（去掉行尾空格和 // 注释）
  let s = String(line || ""), inS = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) { if (c === "\\") i++; else if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'") inS = c;
    else if (c === "/" && s[i + 1] === "/") { s = s.slice(0, i); break; }
    else if (c === "#" && false) break;
  }
  return s.replace(/\s+$/, "").length;
};
function refine(langId, d, src) {
  if (d.severity === "warning") return;
  const L = (n) => src[n - 1] == null ? "" : src[n - 1];
  if (d.fixRaw) {
    const f = d.fixRaw; delete d.fixRaw;
    d.fix = { line: f.l1, ch: byteToChar(L(f.l1), f.b1), endLine: f.l2, endCh: byteToChar(L(f.l2), f.b2), text: f.text };
  }
  const semi = /expected .*';'|';' expected/.test(d.message);
  // 编译器没给改法，但说的是「少了分号」：分号该在哪儿自己算
  if (!d.fix && semi && d.line > 0) {
    const line = L(d.line), first = line.search(/\S/);
    if (langId === "java" && d.col > 0) {
      d.fix = { line: d.line, ch: d.col - 1, endLine: d.line, endCh: d.col - 1, text: ";" };
    } else if (first >= 0 && (!d.col || d.col <= first + 1)) {
      // 报错指着这一行开头：分号其实是上一行（往上找第一行有代码的）末尾少的
      let p = d.line - 1;
      while (p >= 1 && (!L(p).trim() || /^\s*(\/\/|\/\*|\*)/.test(L(p)))) p--;
      if (p >= 1) { const e = codeEnd(L(p)); d.fix = { line: p, ch: e, endLine: p, endCh: e, text: ";" }; }
    } else if (d.col > 0) {
      d.fix = { line: d.line, ch: d.col - 1, endLine: d.line, endCh: d.col - 1, text: ";" };
    }
  }
  // Python：if / for / while / def … 这一行最后少了冒号
  if (!d.fix && langId === "python" && /expected ':'/.test(d.message) && d.line > 0) {
    const e = codeEnd(L(d.line)); if (L(d.line).slice(0, e).trim() && !/:$/.test(L(d.line).slice(0, e))) d.fix = { line: d.line, ch: e, endLine: d.line, endCh: e, text: ":" };
  }
  if (!d.fix) return;
  const f = d.fix, ins = f.line === f.endLine && f.ch === f.endCh;
  // 报错写在下一行、毛病在上一行：标红的地方挪到真正要改的那一行
  if (ins && f.line !== d.line) { d.reported = d.line; d.line = f.line; }
  const before = L(f.line).slice(0, f.ch).trim(), tail = before.length > 24 ? "…" + before.slice(-14) : before;
  const atEnd = f.ch >= codeEnd(L(f.line));
  if (ins && f.text === ";") d.hint = atEnd ? `第 ${f.line} 行最后少了一个分号 ;（${({ java: "Java ", cpp: "C++ ", javascript: "JavaScript " })[langId] || "C 语言"}里每句话都要用分号结尾）` : `第 ${f.line} 行${tail ? "「" + tail + "」" : ""}的后面少了一个分号 ;`;
  else if (ins && f.text === ":") d.hint = `第 ${f.line} 行最后少了冒号 :（if / for / while / def 这一行的末尾都要有）`;
  else if (ins) d.hint = `第 ${f.line} 行${tail ? "「" + tail + "」后面" : "这里"}少了「${f.text}」`;
  else {
    const old = f.line === f.endLine ? L(f.line).slice(f.ch, f.endCh) : "";
    if (!f.text) d.hint = `把第 ${f.line} 行的「${old}」删掉`;
    else d.hint = `把第 ${f.line} 行的「${old}」改成「${f.text}」` + (/^std::/.test(f.text) && old && !/::/.test(old) ? "（或者在 #include 下面加一行 using namespace std;，以后就不用每次写 std:: 了）" : "");
  }
}

module.exports = { parseDiags, hintFor, HINTS };
