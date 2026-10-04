// 捞捞课程表 电脑版 · 后台接口（和网站共用同一个数据库、同一套账号）
// 登录信息只放在主进程里，界面拿不到令牌
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ACCOUNT_RE = /^[a-z0-9_]{3,20}$/;
const ROLE_NAMES = { admin: "管理员", developer: "开发者", tester: "测试员", teacher: "老师", monitor: "班委", student: "学生" };

// 读网站的 config.js（打包时会复制一份进来），拿到数据库地址和公开密钥
function loadSiteConfig(candidates) {
  for (const f of candidates) {
    try {
      const src = fs.readFileSync(f, "utf8"), win = {};
      vm.runInNewContext(src, { window: win }, { timeout: 500 });
      if (win.APP_CONFIG && win.APP_CONFIG.SUPABASE_URL) return win.APP_CONFIG;
    } catch (e) { /* 试下一个 */ }
  }
  throw new Error("缺少 config.js（数据库地址）");
}

function humanError(j, status) {
  const m = String((j && (j.msg || j.error_description || j.message || j.error || j.hint)) || "");
  if (/invalid login credentials/i.test(m)) return "账号或密码错误";
  if (/email not confirmed/i.test(m)) return "账号还没激活，请联系管理员";
  if (/[一-龥]/.test(m)) return m;
  if (/row-level security|permission denied|42501/i.test(m) || status === 403) return "没有权限执行这个操作";
  if (/JWT expired/i.test(m)) return "登录已过期，请重新登录";
  return m || `请求失败（${status}）`;
}

class Api {
  // store: { load() → 登录信息或 null, save(s) }
  constructor({ url, key, domain, store, fetchImpl }) {
    this.base = url.replace(/\/+$/, "");
    this.key = key;
    this.domain = domain || "calendar.test";
    this.store = store;
    this.fetch = fetchImpl || globalThis.fetch;
    this.refreshing = null;
    this.online = true;
  }

  async call(url, opts = {}, token) {
    const method = (opts.method || "GET").toUpperCase();
    const retryable = method === "GET" || opts.retry;
    for (let attempt = 0; ; attempt++) {
      let res = null, netErr = null;
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout || 20000);
      try {
        res = await this.fetch(url, {
          method, body: opts.body, signal: ctl.signal,
          headers: { apikey: this.key, Authorization: "Bearer " + (token || this.key), "Content-Type": "application/json", ...(opts.headers || {}) },
        });
      } catch (e) { netErr = e; } finally { clearTimeout(timer); }
      const busy = netErr || [429, 502, 503, 504].includes(res.status);
      if (busy && retryable && attempt < (netErr ? 1 : 3)) { await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 400)); continue; }
      if (netErr) { this.online = false; const e = new Error(netErr.name === "AbortError" ? "服务器响应太慢，请稍后重试" : "网络连接失败，请检查网络"); e.offline = true; throw e; }
      this.online = true;
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = { message: text }; }
      if (!res.ok) {
        const e = new Error([429, 502, 503, 504].includes(res.status) ? "现在用的人太多了，请过一会儿再试" : humanError(body, res.status));
        e.status = res.status; throw e;
      }
      return body;
    }
  }

  keep(j) {
    const s = { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user_id: j.user && j.user.id };
    this.store.save(s);
    return s;
  }

  async session() {
    const s = this.store.load();
    if (!s || !s.access_token) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s;
    if (!this.refreshing) {
      this.refreshing = this.call(this.base + "/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then((j) => this.keep(j))
        .catch((e) => { if (e.status === 400 || e.status === 401) { this.store.save(null); return null; } return s; })   // 断网时先留着
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async signIn(account, password) {
    account = String(account || "").trim().toLowerCase();
    if (!ACCOUNT_RE.test(account)) throw new Error("账号是 3~20 位小写字母、数字或下划线");
    if (!password) throw new Error("请输入密码");
    const j = await this.call(this.base + "/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: account + "@" + this.domain, password }) });
    return this.keep(j);
  }

  async signOut() {
    const s = this.store.load();
    if (s) { try { await this.call(this.base + "/auth/v1/logout?scope=local", { method: "POST", timeout: 5000 }, s.access_token); } catch (e) {} }
    this.store.save(null);
  }

  async rest(p, opts = {}) {
    const s = await this.session();
    return this.call(this.base + "/rest/v1/" + p, opts, s && s.access_token);
  }
  rpc(fn, args, opts = {}) { return this.rest("rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}), ...opts }); }
}

module.exports = { Api, loadSiteConfig, ROLE_NAMES, ACCOUNT_RE, humanError };
