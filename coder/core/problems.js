// 捞捞编程 · 在软件里做力扣 / Codeforces 的题
//   题面：点开时从网站实时拿（力扣的公开 GraphQL、Codeforces 的题目页），只存在你自己电脑上（题面版权归原网站，软件里不带）
//   本地运行样例：力扣是「写一个函数」的题 → 自动生成 main（读样例输入 → 调你的函数 → 打印结果）跟样例输出比；
//                 Codeforces 是「读输入、打印输出」的题 → 直接用样例输入跑
//   提交：登录了力扣就交到力扣，用它全部的测试数据判（和网页上一样）；没登录 / Codeforces 只能比样例
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

// ---------- 联网（带 cookie） ----------
function req(method, url, { body, headers = {}, timeoutMs = 20000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, timeout: timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 LaolaoCode",
        Accept: raw ? "text/html,application/xhtml+xml" : "application/json", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && !raw) { res.resume(); return reject(Object.assign(new Error("要重新登录力扣"), { status: res.statusCode })); }
      const chunks = []; let n = 0;
      res.on("data", (c) => { n += c.length; if (n > 2e7) r.destroy(new Error("太大了")); else chunks.push(c); });
      res.on("end", () => {
        const s = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode === 403 || res.statusCode === 401) return reject(Object.assign(new Error(res.statusCode === 403 ? "网站拒绝了（可能要重新登录，或者被人机验证拦住了）" : "要重新登录"), { status: res.statusCode, body: s.slice(0, 300) }));
        if (res.statusCode === 429) return reject(new Error("交得太快了，等几秒再试"));
        if (res.statusCode >= 400) return reject(Object.assign(new Error("网站返回 " + res.statusCode), { status: res.statusCode }));
        if (raw) return resolve(s);
        try { resolve(JSON.parse(s)); } catch (e) { reject(new Error("网站返回的不是数据（可能改版了）")); }
      });
    });
    r.on("timeout", () => r.destroy(new Error("连接超时")));
    r.on("error", (e) => reject(new Error(/ENOTFOUND|EAI_AGAIN/.test(e.message) ? "没联网" : e.message)));
    if (data) r.write(data);
    r.end();
  });
}

const LC = "https://leetcode.cn";
const Q_DETAIL = `query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) {
  questionId questionFrontendId title titleSlug translatedTitle translatedContent content difficulty isPaidOnly
  exampleTestcases sampleTestCase metaData codeSnippets { lang langSlug code } topicTags { slug translatedName } } }`;
const Q_USER = `query globalData { userStatus { isSignedIn username userSlug realName avatar } }`;

const decode = (s) => String(s).replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const textOf = (html) => decode(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|pre|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, ""));

// 力扣题面里的「输出：xxx」
function lcOutputs(html) {
  const t = textOf(html);
  const out = [];
  const re = /(?:输出|Output)\s*[:：]\s*([^\n]*)/g;
  let m;
  while ((m = re.exec(t))) out.push(m[1].trim());
  return out;
}

// ---------- 力扣 ----------
async function fetchLeetcode(slug) {
  const r = await req("POST", LC + "/graphql/", { body: { query: Q_DETAIL, variables: { titleSlug: slug }, operationName: "questionData" }, headers: { Referer: `${LC}/problems/${slug}/` } });
  const q = r && r.data && r.data.question;
  if (!q) throw new Error("力扣上没找到这道题");
  if (q.isPaidOnly && !q.translatedContent && !q.content) throw new Error("这是力扣会员题，看不了题面");
  let meta = {};
  try { meta = JSON.parse(q.metaData || "{}"); } catch (e) {}
  const html = q.translatedContent || q.content || "";
  const nParams = (meta.params || []).length || 1;
  const lines = String(q.exampleTestcases || q.sampleTestCase || "").split("\n");
  const outs = lcOutputs(html);
  const samples = [];
  for (let i = 0, k = 0; i + nParams <= lines.length; i += nParams, k++) samples.push({ input: lines.slice(i, i + nParams).join("\n"), output: outs[k] != null ? outs[k] : null });
  const snippets = {};
  for (const s of q.codeSnippets || []) snippets[s.langSlug] = s.code;
  return { id: "lc:" + slug, src: "lc", slug, questionId: q.questionId, no: q.questionFrontendId, title: q.translatedTitle || q.title, level: { Easy: "简单", Medium: "中等", Hard: "困难" }[q.difficulty] || q.difficulty,
    html, samples, meta, snippets, tags: (q.topicTags || []).map((t) => t.translatedName || t.slug), url: `${LC}/problems/${slug}/`, at: Date.now() };
}

// ---------- Codeforces ----------
function cutDiv(html, cls) {
  const k = html.indexOf(`<div class="${cls}"`); if (k < 0) return "";
  let depth = 0; const re = /<div\b|<\/div>/g; re.lastIndex = k;
  let m;
  while ((m = re.exec(html))) { if (m[0] === "</div>") { depth--; if (depth === 0) return html.slice(k, re.lastIndex); } else depth++; }
  return "";
}
const preText = (s) => decode(s.replace(/<div class="test-example-line[^"]*">/g, "").replace(/<\/div>/g, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n{2,}/g, "\n").replace(/^\n+/, "");
async function fetchCodeforces(contest, index) {
  let html = "", last = null;
  for (const host of ["https://codeforces.com", "https://mirror.codeforces.com"]) {
    try { html = await req("GET", `${host}/problemset/problem/${contest}/${index}?locale=en`, { raw: true, timeoutMs: 25000 }); if (html.includes("problem-statement")) break; last = new Error("Codeforces 弹了人机验证，软件里打不开，点「在网站上看」"); html = ""; } catch (e) { last = e; }
  }
  if (!html) throw last || new Error("Codeforces 打不开");
  return parseCodeforces(html, contest, index);
}
function parseCodeforces(html, contest, index) {
  const st = cutDiv(html, "problem-statement");
  if (!st) throw new Error("Codeforces 的页面看不懂（可能改版了）");
  const title = decode((st.match(/<div class="title">([^<]*)<\/div>/) || [])[1] || "");
  const prop = (cls) => decode(((st.match(new RegExp(`<div class="${cls}"><div class="property-title">[^<]*</div>([^<]*)</div>`)) || [])[1] || "").trim());
  const tl = prop("time-limit"), ml = prop("memory-limit");
  const samples = [];
  const tests = cutDiv(st, "sample-tests");
  const ins = [...tests.matchAll(/<div class="input">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => preText(m[1]));
  const outs = [...tests.matchAll(/<div class="output">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => preText(m[1]));
  ins.forEach((x, i) => samples.push({ input: x, output: outs[i] != null ? outs[i] : null }));
  // 题面正文：去掉标题栏和样例（样例单独显示）
  const body = st.replace(cutDiv(st, "header"), "").replace(tests, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  return { id: `cf:${contest}${index}`, src: "cf", no: `${contest}${index}`, title: title.replace(/^[A-Z]\d?\.\s*/, ""), level: "", html: body, samples, limits: [tl && "时间 " + tl, ml && "内存 " + ml].filter(Boolean).join(" · "),
    url: `https://codeforces.com/problemset/problem/${contest}/${index}`, at: Date.now() };
}

// ---------- 代码模板 ----------
const LC_LANG = { c: "c", cpp: "cpp", python: "python3", java: "java", javascript: "javascript", go: "golang" };
const EXT = { c: ".c", cpp: ".cpp", python: ".py", java: ".java", javascript: ".js", go: ".go" };
function template(p, lang) {
  const head = { c: "//", cpp: "//", java: "//", javascript: "//", go: "//", python: "#" }[lang] || "//";
  const top = `${head} ${p.src === "lc" ? "力扣" : "Codeforces"} ${p.no}. ${p.title}\n${head} ${p.url}\n${head} 题目在左边。本地「运行样例」${p.src === "lc" ? "，登录力扣后「提交」用它全部的测试数据判" : "比的是样例输出"}\n\n`;
  if (p.src === "lc") {
    const code = p.snippets && p.snippets[LC_LANG[lang]];
    if (!code) throw new Error("力扣这道题不支持这种语言");
    return top + code + "\n";
  }
  const body = {
    c: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
    cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    return 0;\n}\n",
    python: "import sys\ninput = sys.stdin.readline\n\n\n",
    java: "import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        \n    }\n}\n",
    javascript: "const lines = require('fs').readFileSync(0, 'utf8').split('\\n');\n\n",
    go: "package main\n\nimport (\n\t\"bufio\"\n\t\"fmt\"\n\t\"os\"\n)\n\nfunc main() {\n\tin := bufio.NewReader(os.Stdin)\n\t_ = in\n\tfmt.Println()\n}\n",
  }[lang];
  if (!body) throw new Error("还不支持这种语言");
  return top + body;
}

// ---------- 力扣题本地跑：给你的函数配一个 main ----------
// 支持的参数 / 返回类型（力扣 metaData 里的写法）
const SIMPLE = new Set(["integer", "long", "double", "boolean", "string", "character", "integer[]", "long[]", "double[]", "boolean[]", "string[]", "character[]",
  "integer[][]", "character[][]", "string[][]", "list<integer>", "list<string>", "list<list<integer>>", "list<list<string>>", "list<double>", "list<boolean>", "ListNode", "TreeNode", "void"]);
function harnessSupport(meta, lang) {
  if (!meta || !meta.name || meta.systemdesign || meta.manual) return "这道题是「设计一个类」或者特殊判定的，本地没法自动跑，登录力扣后在线运行";
  const types = (meta.params || []).map((p) => p.type).concat(meta.return ? [meta.return.type] : []);
  const bad = types.find((t) => !SIMPLE.has(t));
  if (bad) return `本地还不支持「${bad}」类型的参数，登录力扣后在线运行`;
  if (lang === "c" && types.some((t) => /^list<list<string>>|string\[\]\[\]$/.test(t))) return "C 语言本地还不支持这种参数，登录力扣后在线运行";
  if (!["c", "cpp", "python"].includes(lang)) return "本地运行只支持 C / C++ / Python，登录力扣后在线运行";
  return "";
}
const norm = (t) => t.replace(/^list<(.+)>$/, "$1[]").replace(/^list<(.+)\[\]>$/, "$1[][]");   // list<integer> → integer[]

// ---- Python ----
function pyHarness(code, meta) {
  const args = (meta.params || []).map((p, i) => `_ll_in(_lines[${i}], ${JSON.stringify(norm(p.type))})`).join(", ");
  const out = meta.return && meta.return.type === "void" && meta.output ? `_ll_args[${meta.output.paramindex || 0}]` : "_ll_r";
  const rt = JSON.stringify(norm(meta.return && meta.return.type !== "void" ? meta.return.type : meta.output ? (meta.params[meta.output.paramindex || 0] || {}).type || "" : ""));
  return `import sys, json, math
from typing import *
from collections import *
from heapq import *
from bisect import *
from functools import *
from itertools import *
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
${code}

def _ll_in(s, t):
    v = json.loads(s)
    if t == "ListNode":
        h = None
        for x in reversed(v):
            h = ListNode(x, h)
        return h
    if t == "TreeNode":
        if not v:
            return None
        it = iter(v)
        root = TreeNode(next(it))
        q = deque([root])
        while q:
            n = q.popleft()
            for side in ("left", "right"):
                x = next(it, None)
                if x is not None:
                    c = TreeNode(x)
                    setattr(n, side, c)
                    q.append(c)
        return root
    if t == "character[][]":
        return [list(r) for r in v]
    return v
def _ll_out(v, t):
    if t == "ListNode":
        a = []
        while v:
            a.append(v.val)
            v = v.next
        return a
    if t == "TreeNode":
        a, q = [], deque([v])
        while q:
            n = q.popleft()
            if n is None:
                a.append(None)
                continue
            a.append(n.val)
            q.append(n.left)
            q.append(n.right)
        while a and a[-1] is None:
            a.pop()
        return a
    return v
_all = sys.stdin.read().split("\\n")
while _all and not _all[-1].strip():
    _all.pop()
_K = ${Math.max(1, (meta.params || []).length)}
for _g in range(0, len(_all), _K):
    _lines = _all[_g:_g + _K] + [""] * _K
    _ll_args = [${args}]
    _ll_r = Solution().${meta.name}(*_ll_args)
    print(json.dumps(_ll_out(${out}, ${rt}), ensure_ascii=False, separators=(",", ":")), flush=True)
`;
}

// ---- C++ ----
const CPP_T = { integer: "int", long: "long long", double: "double", boolean: "bool", string: "string", character: "char", ListNode: "ListNode*", TreeNode: "TreeNode*" };
function cppType(t) { t = norm(t); if (t.endsWith("[]")) return `vector<${cppType(t.slice(0, -2))}>`; return CPP_T[t] || "int"; }
function cppHarness(code, meta) {
  const ps = meta.params || [];
  const decl = ps.map((p, i) => `    ${cppType(p.type)} a${i}; { const char *s = L[${i}].c_str(); rd(s, a${i}); }`).join("\n");
  const call = `Solution().${meta.name}(${ps.map((_, i) => "a" + i).join(", ")})`;
  const voidRet = !meta.return || meta.return.type === "void";
  const body = voidRet ? `    ${call};\n    pr(cout, a${meta.output ? meta.output.paramindex || 0 : 0}); cout << "\\n";` : `    auto r = ${call};\n    pr(cout, r); cout << "\\n";`;
  return `#include <bits/stdc++.h>
using namespace std;
struct ListNode { int val; ListNode *next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode *n) : val(x), next(n) {} };
struct TreeNode { int val; TreeNode *left, *right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode *l, TreeNode *r) : val(x), left(l), right(r) {} };
${code}
// ---------- 下面是捞捞编程自动加的：读样例、调用你的函数、打印结果 ----------
#pragma GCC diagnostic ignored "-Wunused-function"
static void ws_(const char *&s) { while (*s == ' ' || *s == '\\n' || *s == '\\r' || *s == '\\t') s++; }
static void rd(const char *&s, long long &x) { ws_(s); x = strtoll(s, (char **)&s, 10); }
static void rd(const char *&s, int &x) { long long y; rd(s, y); x = (int)y; }
static void rd(const char *&s, double &x) { ws_(s); x = strtod(s, (char **)&s); }
static void rd(const char *&s, bool &x) { ws_(s); x = (*s == 't'); while (isalpha((unsigned char)*s)) s++; }
static void rd(const char *&s, string &x) { ws_(s); x.clear(); if (*s == '"') s++; while (*s && *s != '"') { if (*s == '\\\\' && s[1]) { s++; x += (*s == 'n' ? '\\n' : *s == 't' ? '\\t' : *s); } else x += *s; s++; } if (*s == '"') s++; }
static void rd(const char *&s, char &x) { string t; rd(s, t); x = t.empty() ? 0 : t[0]; }
template <class T> static void rd(const char *&s, vector<T> &v) { ws_(s); v.clear(); if (*s == '[') s++; ws_(s); while (*s && *s != ']') { T x; rd(s, x); v.push_back(x); ws_(s); if (*s == ',') s++; ws_(s); } if (*s == ']') s++; }
static void rd(const char *&s, vector<bool> &v) { vector<int> t; ws_(s); v.clear(); if (*s == '[') s++; ws_(s); while (*s && *s != ']') { bool b; rd(s, b); v.push_back(b); ws_(s); if (*s == ',') s++; ws_(s); } if (*s == ']') s++; }
static void rd(const char *&s, ListNode *&h) { vector<int> v; rd(s, v); h = nullptr; for (int i = (int)v.size() - 1; i >= 0; i--) h = new ListNode(v[i], h); }
static void rd(const char *&s, TreeNode *&root) {
  ws_(s); root = nullptr; if (*s == '[') s++; vector<TreeNode *> a; ws_(s);
  while (*s && *s != ']') { ws_(s); if (!strncmp(s, "null", 4)) { a.push_back(nullptr); s += 4; } else { int x; rd(s, x); a.push_back(new TreeNode(x)); } ws_(s); if (*s == ',') s++; }
  if (*s == ']') s++; if (a.empty() || !a[0]) return; root = a[0]; size_t k = 1;
  queue<TreeNode *> q; q.push(root);
  while (!q.empty() && k < a.size()) { TreeNode *n = q.front(); q.pop(); if (k < a.size()) { n->left = a[k++]; if (n->left) q.push(n->left); } if (k < a.size()) { n->right = a[k++]; if (n->right) q.push(n->right); } }
}
static void pr(ostream &o, long long x) { o << x; }
static void pr(ostream &o, int x) { o << x; }
static void pr(ostream &o, double x) { o << fixed << setprecision(5) << x; }
static void pr(ostream &o, bool x) { o << (x ? "true" : "false"); }
static void pr(ostream &o, const string &x) { o << '"'; for (char c : x) { if (c == '"' || c == '\\\\') o << '\\\\'; o << c; } o << '"'; }
static void pr(ostream &o, char c) { o << '"' << c << '"'; }
template <class T> static void pr(ostream &o, const vector<T> &v) { o << '['; for (size_t i = 0; i < v.size(); i++) { if (i) o << ','; pr(o, (T)v[i]); } o << ']'; }
static void pr(ostream &o, ListNode *h) { o << '['; for (bool f = true; h; h = h->next, f = false) { if (!f) o << ','; o << h->val; } o << ']'; }
static void pr(ostream &o, TreeNode *r) {
  vector<string> a; queue<TreeNode *> q; q.push(r);
  while (!q.empty()) { TreeNode *n = q.front(); q.pop(); if (!n) { a.push_back("null"); continue; } a.push_back(to_string(n->val)); q.push(n->left); q.push(n->right); }
  while (!a.empty() && a.back() == "null") a.pop_back();
  o << '['; for (size_t i = 0; i < a.size(); i++) { if (i) o << ','; o << a[i]; } o << ']';
}
int main() {
    vector<string> A; string line; while (getline(cin, line)) { if (!line.empty() && line.back() == '\\r') line.pop_back(); A.push_back(line); }
    while (!A.empty() && A.back().find_first_not_of(" \\t") == string::npos) A.pop_back();
    const size_t K = ${Math.max(1, ps.length)};
    for (size_t g = 0; g < A.size(); g += K) {
    vector<string> L(A.begin() + g, A.begin() + min(A.size(), g + K)); while (L.size() < K) L.push_back("");
${decl}
${body}
    cout.flush();
    }
    return 0;
}
`;
}

// ---- C ----
function cHarness(code, meta) {
  const ps = meta.params || [];
  const decl = [], args = [];
  ps.forEach((p, i) => {
    const t = norm(p.type), s = `L[${i}]`;
    switch (t) {
      case "integer": decl.push(`int a${i} = (int)ll_num(${s});`); args.push(`a${i}`); break;
      case "long": decl.push(`long long a${i} = (long long)ll_num(${s});`); args.push(`a${i}`); break;
      case "double": decl.push(`double a${i} = ll_num(${s});`); args.push(`a${i}`); break;
      case "boolean": decl.push(`bool a${i} = strstr(${s}, "true") != NULL;`); args.push(`a${i}`); break;
      case "character": decl.push(`char a${i}; { const char *q = ${s}; char *t = ll_str(&q); a${i} = t[0]; }`); args.push(`a${i}`); break;
      case "string": decl.push(`char *a${i}; { const char *q = ${s}; a${i} = ll_str(&q); }`); args.push(`a${i}`); break;
      case "integer[]": case "long[]": case "boolean[]": decl.push(`int n${i}; int *a${i} = ll_ints(${s}, &n${i});`); args.push(`a${i}`, `n${i}`); break;
      case "double[]": decl.push(`int n${i}; double *a${i} = ll_dbls(${s}, &n${i});`); args.push(`a${i}`, `n${i}`); break;
      case "string[]": decl.push(`int n${i}; char **a${i} = ll_strs(${s}, &n${i});`); args.push(`a${i}`, `n${i}`); break;
      case "character[]": decl.push(`int n${i}; char *a${i} = ll_chars(${s}, &n${i});`); args.push(`a${i}`, `n${i}`); break;
      case "integer[][]": decl.push(`int n${i}; int *c${i}; int **a${i} = ll_mat(${s}, &n${i}, &c${i});`); args.push(`a${i}`, `n${i}`, `c${i}`); break;
      case "character[][]": decl.push(`int n${i}; int *c${i}; char **a${i} = ll_cmat(${s}, &n${i}, &c${i});`); args.push(`a${i}`, `n${i}`, `c${i}`); break;
      case "ListNode": decl.push(`struct ListNode *a${i} = ll_list(${s});`); args.push(`a${i}`); break;
      case "TreeNode": decl.push(`struct TreeNode *a${i} = ll_tree(${s});`); args.push(`a${i}`); break;
      default: throw new Error("C 语言本地还不支持「" + p.type + "」");
    }
  });
  const rt = norm(meta.return ? meta.return.type : "void");
  let call = "", show = "";
  const f = meta.name;
  switch (rt) {
    case "integer": case "long": call = `long long r = ${f}(${args.join(", ")});`; show = `printf("%lld", r);`; break;
    case "double": call = `double r = ${f}(${args.join(", ")});`; show = `printf("%.5f", r);`; break;
    case "boolean": call = `bool r = ${f}(${args.join(", ")});`; show = `printf(r ? "true" : "false");`; break;
    case "character": call = `char r = ${f}(${args.join(", ")});`; show = `printf("\\"%c\\"", r);`; break;
    case "string": call = `char *r = ${f}(${args.join(", ")});`; show = `ll_pstr(r);`; break;
    case "integer[]": case "long[]": case "boolean[]": call = `int rn = 0; int *r = ${f}(${args.concat("&rn").join(", ")});`; show = rt === "boolean[]" ? `ll_pbools(r, rn);` : `ll_pints(r, rn);`; break;
    case "double[]": call = `int rn = 0; double *r = ${f}(${args.concat("&rn").join(", ")});`; show = `ll_pdbls(r, rn);`; break;
    case "string[]": call = `int rn = 0; char **r = ${f}(${args.concat("&rn").join(", ")});`; show = `ll_pstrs(r, rn);`; break;
    case "integer[][]": call = `int rn = 0; int *rc = NULL; int **r = ${f}(${args.concat("&rn", "&rc").join(", ")});`; show = `ll_pmat(r, rn, rc);`; break;
    case "character[][]": call = `${f}(${args.join(", ")});`; show = `ll_pcmat(a0, n0, c0);`; break;
    case "ListNode": call = `struct ListNode *r = ${f}(${args.join(", ")});`; show = `ll_plist(r);`; break;
    case "TreeNode": call = `struct TreeNode *r = ${f}(${args.join(", ")});`; show = `ll_ptree(r);`; break;
    case "void": {
      call = `${f}(${args.join(", ")});`;
      const k = meta.output ? meta.output.paramindex || 0 : 0, t = norm((ps[k] || {}).type || "");
      show = { "integer[]": `ll_pints(a${k}, n${k});`, "character[]": `ll_pchars(a${k}, n${k});`, "integer[][]": `ll_pmat(a${k}, n${k}, c${k});`, "character[][]": `ll_pcmat(a${k}, n${k}, c${k});`, ListNode: `ll_plist(a${k});`, string: `ll_pstr(a${k});` }[t] || "";
      if (!show) throw new Error("C 语言本地还不支持这道题的输出方式");
      break;
    }
    default: throw new Error("C 语言本地还不支持返回「" + meta.return.type + "」");
  }
  return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <limits.h>
#include <math.h>
#include <ctype.h>
struct ListNode { int val; struct ListNode *next; };
struct TreeNode { int val; struct TreeNode *left; struct TreeNode *right; };
${code}
/* ---------- 下面是捞捞编程自动加的：读样例、调用你的函数、打印结果 ---------- */
#pragma GCC diagnostic ignored "-Wunused-function"
static void ll_ws(const char **s) { while (**s == ' ' || **s == '\\n' || **s == '\\r' || **s == '\\t') (*s)++; }
static double ll_num(const char *s) { ll_ws(&s); return strtod(s, NULL); }
static char *ll_str(const char **s) { ll_ws(s); size_t cap = strlen(*s) + 1, n = 0; char *o = malloc(cap); if (**s == '"') (*s)++; while (**s && **s != '"') { if (**s == '\\\\' && (*s)[1]) { (*s)++; o[n++] = (**s == 'n' ? '\\n' : **s == 't' ? '\\t' : **s); } else o[n++] = **s; (*s)++; } if (**s == '"') (*s)++; o[n] = 0; return o; }
static int ll_count(const char *s) { int d = 0, n = 0, any = 0; for (; *s; s++) { if (*s == '"') { s++; while (*s && *s != '"') { if (*s == '\\\\') s++; s++; } any = 1; continue; } if (*s == '[') { d++; continue; } if (*s == ']') { if (--d == 0) break; continue; } if (d == 1 && *s == ',') n++; else if (d >= 1 && !isspace((unsigned char)*s)) any = 1; } return any ? n + 1 : 0; }
static int *ll_ints_p(const char **s, int *n) { ll_ws(s); int cnt = ll_count(*s); int *a = malloc(sizeof(int) * (cnt + 1)); *n = 0; if (**s == '[') (*s)++; ll_ws(s); while (**s && **s != ']') { if (!strncmp(*s, "true", 4)) { a[(*n)++] = 1; *s += 4; } else if (!strncmp(*s, "false", 5)) { a[(*n)++] = 0; *s += 5; } else a[(*n)++] = (int)strtol(*s, (char **)s, 10); ll_ws(s); if (**s == ',') (*s)++; ll_ws(s); } if (**s == ']') (*s)++; return a; }
static int *ll_ints(const char *s, int *n) { return ll_ints_p(&s, n); }
static double *ll_dbls(const char *s, int *n) { ll_ws(&s); int cnt = ll_count(s); double *a = malloc(sizeof(double) * (cnt + 1)); *n = 0; if (*s == '[') s++; ll_ws(&s); while (*s && *s != ']') { a[(*n)++] = strtod(s, (char **)&s); ll_ws(&s); if (*s == ',') s++; ll_ws(&s); } return a; }
static char **ll_strs_p(const char **s, int *n) { ll_ws(s); int cnt = ll_count(*s); char **a = malloc(sizeof(char *) * (cnt + 1)); *n = 0; if (**s == '[') (*s)++; ll_ws(s); while (**s && **s != ']') { a[(*n)++] = ll_str(s); ll_ws(s); if (**s == ',') (*s)++; ll_ws(s); } if (**s == ']') (*s)++; return a; }
static char **ll_strs(const char *s, int *n) { return ll_strs_p(&s, n); }
static char *ll_chars(const char *s, int *n) { char **t = ll_strs(s, n); char *a = malloc(*n + 1); for (int i = 0; i < *n; i++) a[i] = t[i][0]; a[*n] = 0; return a; }
static int **ll_mat(const char *s, int *n, int **cols) { ll_ws(&s); int cnt = ll_count(s); int **a = malloc(sizeof(int *) * (cnt + 1)); *cols = malloc(sizeof(int) * (cnt + 1)); *n = 0; if (*s == '[') s++; ll_ws(&s); while (*s && *s != ']') { int m; a[*n] = ll_ints_p(&s, &m); (*cols)[(*n)++] = m; ll_ws(&s); if (*s == ',') s++; ll_ws(&s); } return a; }
static char **ll_cmat(const char *s, int *n, int **cols) { ll_ws(&s); int cnt = ll_count(s); char **a = malloc(sizeof(char *) * (cnt + 1)); *cols = malloc(sizeof(int) * (cnt + 1)); *n = 0; if (*s == '[') s++; ll_ws(&s); while (*s && *s != ']') { int m; char **t = ll_strs_p(&s, &m); a[*n] = malloc(m + 1); for (int j = 0; j < m; j++) a[*n][j] = t[j][0]; a[*n][m] = 0; (*cols)[(*n)++] = m; ll_ws(&s); if (*s == ',') s++; ll_ws(&s); } return a; }
static struct ListNode *ll_list(const char *s) { int n; int *v = ll_ints(s, &n); struct ListNode *h = NULL; for (int i = n - 1; i >= 0; i--) { struct ListNode *x = malloc(sizeof *x); x->val = v[i]; x->next = h; h = x; } return h; }
static struct TreeNode *ll_tree(const char *s) {
  ll_ws(&s); int cnt = ll_count(s); struct TreeNode **a = malloc(sizeof(void *) * (cnt + 1)); int n = 0; if (*s == '[') s++;
  while (*s && *s != ']') { ll_ws(&s); if (!strncmp(s, "null", 4)) { a[n++] = NULL; s += 4; } else { struct TreeNode *t = malloc(sizeof *t); t->val = (int)strtol(s, (char **)&s, 10); t->left = t->right = NULL; a[n++] = t; } ll_ws(&s); if (*s == ',') s++; }
  if (!n || !a[0]) return NULL; int k = 1; struct TreeNode **q = malloc(sizeof(void *) * (n + 1)); int qh = 0, qt = 0; q[qt++] = a[0];
  while (qh < qt && k < n) { struct TreeNode *x = q[qh++]; if (k < n) { x->left = a[k++]; if (x->left) q[qt++] = x->left; } if (k < n) { x->right = a[k++]; if (x->right) q[qt++] = x->right; } }
  return a[0];
}
static void ll_pstr(const char *s) { putchar('"'); for (; s && *s; s++) { if (*s == '"' || *s == '\\\\') putchar('\\\\'); putchar(*s); } putchar('"'); }
static void ll_pints(const int *a, int n) { putchar('['); for (int i = 0; i < n; i++) printf(i ? ",%d" : "%d", a[i]); putchar(']'); }
static void ll_pbools(const int *a, int n) { putchar('['); for (int i = 0; i < n; i++) printf("%s%s", i ? "," : "", a[i] ? "true" : "false"); putchar(']'); }
static void ll_pdbls(const double *a, int n) { putchar('['); for (int i = 0; i < n; i++) printf(i ? ",%.5f" : "%.5f", a[i]); putchar(']'); }
static void ll_pchars(const char *a, int n) { putchar('['); for (int i = 0; i < n; i++) printf(i ? ",\\"%c\\"" : "\\"%c\\"", a[i]); putchar(']'); }
static void ll_pstrs(char **a, int n) { putchar('['); for (int i = 0; i < n; i++) { if (i) putchar(','); ll_pstr(a[i]); } putchar(']'); }
static void ll_pmat(int **a, int n, int *c) { putchar('['); for (int i = 0; i < n; i++) { if (i) putchar(','); ll_pints(a[i], c ? c[i] : 0); } putchar(']'); }
static void ll_pcmat(char **a, int n, int *c) { putchar('['); for (int i = 0; i < n; i++) { if (i) putchar(','); ll_pchars(a[i], c[i]); } putchar(']'); }
static void ll_plist(struct ListNode *h) { putchar('['); for (int f = 1; h; h = h->next, f = 0) printf(f ? "%d" : ",%d", h->val); putchar(']'); }
static void ll_ptree(struct TreeNode *r) {
  static struct TreeNode *q[20000]; static char buf[200000]; static int ends[20000]; int qh = 0, qt = 0, last = -1, k = 0, bn = 0; q[qt++] = r;
  while (qh < qt && qt < 19990) { struct TreeNode *x = q[qh++]; if (k) buf[bn++] = ','; if (!x) bn += sprintf(buf + bn, "null"); else { bn += sprintf(buf + bn, "%d", x->val); last = k; q[qt++] = x->left; q[qt++] = x->right; } ends[k++] = bn; }
  buf[last >= 0 ? ends[last] : 0] = 0; printf("[%s]", buf);
}
int main(void) {
    static char buf[1 << 20]; static char *A[4096]; int na = 0;
    while (na < 4096 && fgets(buf, sizeof buf, stdin)) { buf[strcspn(buf, "\\r\\n")] = 0; size_t m = strlen(buf) + 1; A[na] = malloc(m); memcpy(A[na++], buf, m); }
    while (na > 0 && strspn(A[na - 1], " \\t") == strlen(A[na - 1])) na--;
    const int K = ${Math.max(1, ps.length)};
    static char empty[1] = "";
    for (int g = 0; g < na; g += K) {
    char *L[${Math.max(1, ps.length)}]; for (int i = 0; i < K; i++) L[i] = g + i < na ? A[g + i] : empty;
    ${decl.join("\n    ")}
    ${call}
    ${show}
    putchar('\\n'); fflush(stdout);
    }
    return 0;
}
`;
}

// 结果比一比（力扣：都是 JSON 一样的写法；小数差一点点算对）
function sameJson(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  return a === b;
}
function lcSame(got, want) {
  if (want == null) return null;
  // 「2, nums = [1,2,_]」这种：只比前面的返回值
  const m = want.match(/^(.+?),\s*[A-Za-z_]\w*\s*=/);
  if (m) want = m[1];
  const g = String(got).trim(), w = want.trim();
  try { return sameJson(JSON.parse(g), JSON.parse(w)); } catch (e) {}
  return g.replace(/\s+/g, "") === w.replace(/\s+/g, "");
}
// Codeforces：按空白分开逐个比（行末空格、最后的换行不算）
function cfSame(got, want) {
  if (want == null) return null;
  const a = String(got).trim().split(/\s+/), b = String(want).trim().split(/\s+/);
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i] || (/^-?\d*\.\d+$/.test(b[i]) && Math.abs(+x - +b[i]) <= 1e-6 * Math.max(1, Math.abs(+b[i]))) || x.toLowerCase() === b[i].toLowerCase() && /^(yes|no)$/i.test(x));
}

// ---------- 力扣：登录后在线运行 / 提交 ----------
async function lcSession(getCookies) {
  const list = (await getCookies()) || [];
  const map = Object.fromEntries(list.map((c) => [c.name, c.value]));
  if (!map.LEETCODE_SESSION) return null;
  return { cookie: list.map((c) => `${c.name}=${c.value}`).join("; "), csrf: map.csrftoken || "" };
}
const lcHeaders = (s, slug) => ({ Cookie: s.cookie, "x-csrftoken": s.csrf, Referer: `${LC}/problems/${slug}/`, Origin: LC, "X-Requested-With": "XMLHttpRequest" });
async function lcUser(getCookies) {
  const s = await lcSession(getCookies); if (!s) return { signedIn: false };
  const r = await req("POST", LC + "/graphql/", { body: { query: Q_USER, operationName: "globalData", variables: {} }, headers: lcHeaders(s, "") });
  const u = r && r.data && r.data.userStatus;
  return u && u.isSignedIn ? { signedIn: true, name: u.realName || u.username, slug: u.userSlug || u.username } : { signedIn: false };
}
async function lcPoll(s, slug, id, onTick) {
  for (let i = 0; i < 40; i++) {
    await new Promise((ok) => setTimeout(ok, i < 3 ? 900 : 1500));
    const r = await req("GET", `${LC}/submissions/detail/${id}/check/`, { headers: lcHeaders(s, slug) });
    if (r && r.state === "SUCCESS") return r;
    if (onTick) onTick(r && r.state);
  }
  throw new Error("力扣判了太久，去网站上看结果");
}
const VERDICT = { Accepted: "通过", "Wrong Answer": "答案错误", "Time Limit Exceeded": "超时", "Memory Limit Exceeded": "内存超了", "Runtime Error": "运行出错", "Compile Error": "编译出错", "Output Limit Exceeded": "输出太多" };
async function lcRemote(getCookies, p, lang, code, mode, onTick) {
  const s = await lcSession(getCookies);
  if (!s) throw Object.assign(new Error("还没登录力扣"), { login: true });
  const ls = LC_LANG[lang]; if (!ls) throw new Error("力扣不支持这种语言");
  const slug = p.slug;
  if (mode === "run") {
    const data_input = p.samples.map((x) => x.input).join("\n");
    const r = await req("POST", `${LC}/problems/${slug}/interpret_solution/`, { body: { lang: ls, question_id: p.questionId, typed_code: code, data_input }, headers: lcHeaders(s, slug) });
    if (!r || !r.interpret_id) throw new Error("力扣没接受这次运行");
    const c = await lcPoll(s, slug, r.interpret_id, onTick);
    return { remote: true, mode, status: VERDICT[c.status_msg] || c.status_msg, ok: c.run_success && c.correct_answer, compileError: c.full_compile_error || c.compile_error || "", runtimeError: c.full_runtime_error || c.runtime_error || "",
      cases: (c.code_answer || []).map((g, i) => ({ input: (p.samples[i] || {}).input || "", got: g, want: (c.expected_code_answer || [])[i], pass: (c.expected_code_answer || [])[i] === g, stdout: (c.std_output_list || [])[i] || "" })) };
  }
  const r = await req("POST", `${LC}/problems/${slug}/submit/`, { body: { lang: ls, question_id: p.questionId, typed_code: code }, headers: lcHeaders(s, slug) });
  if (!r || !r.submission_id) throw new Error((r && r.error) || "力扣没接受这次提交");
  const c = await lcPoll(s, slug, r.submission_id, onTick);
  return { remote: true, mode, id: r.submission_id, status: VERDICT[c.status_msg] || c.status_msg, ok: c.status_msg === "Accepted", passed: c.total_correct, total: c.total_testcases,
    runtime: c.status_runtime, memory: c.status_memory, runtimePct: c.runtime_percentile, memoryPct: c.memory_percentile,
    compileError: c.full_compile_error || c.compile_error || "", runtimeError: c.full_runtime_error || c.runtime_error || "",
    last: c.last_testcase || c.input_formatted || "", want: c.expected_output || "", got: c.code_output || "", url: `${LC}/submissions/detail/${r.submission_id}/` };
}

module.exports = { fetchLeetcode, fetchCodeforces, parseCodeforces, template, harnessSupport, pyHarness, cppHarness, cHarness, lcSame, cfSame, lcOutputs, lcUser, lcRemote, lcSession, EXT, LC_LANG, textOf };
