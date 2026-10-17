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
  // 3.3.2：两条线路（和网站 auth.js、小程序 api.js 一样）：国内直连 + 海外中转（config.js 的 SUPABASE_URL_ALT）。
  //   一条连不上（断网、超时）自动换另一条；真的连通了才记住用哪条（routeStore），下次直接走那条。
  //   还不知道哪条能用时，第一次请求最多等 8 秒就换线路，海外用户不用干等 20 秒。
  constructor({ url, alt, key, domain, store, fetchImpl, routeStore }) {
    this.routes = [url, alt].filter(Boolean).map((u) => String(u).replace(/\/+$/, "")).filter((u, i, a) => a.indexOf(u) === i);
    this.routeStore = routeStore || null;
    let saved = null; try { saved = this.routeStore ? this.routeStore.load() : null; } catch (e) {}
    this.ri = Number.isInteger(saved) && saved >= 0 && saved < this.routes.length ? saved : 0;
    this.routeKnown = Number.isInteger(saved) && saved >= 0 && saved < this.routes.length;
    this.key = key;
    this.domain = domain || "calendar.test";
    this.store = store;
    this.fetch = fetchImpl || globalThis.fetch;
    this.refreshing = null;
    this.online = true;
  }

  get base() { return this.routes[this.ri]; }
  // path：以 / 开头的接口路径（老写法传完整网址也认）
  async call(path, opts = {}, token) {
    const method = (opts.method || "GET").toUpperCase();
    const retryable = method === "GET" || opts.retry;
    let rel = String(path); for (const r of this.routes) if (rel.startsWith(r)) { rel = rel.slice(r.length); break; }
    let switched = false;
    for (let attempt = 0; ; attempt++) {
      let res = null, netErr = null;
      const url = this.base + rel, tmo = this.routeKnown || this.routes.length < 2 ? opts.timeout || 20000 : Math.min(opts.timeout || 20000, 8000);
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), tmo);
      try {
        res = await this.fetch(url, {
          method, body: opts.body, signal: ctl.signal,
          headers: { apikey: this.key, Authorization: "Bearer " + (token || this.key), "Content-Type": "application/json", ...(opts.headers || {}) },
        });
      } catch (e) { netErr = e; } finally { clearTimeout(timer); }
      // 这条线路连不上：换另一条再试一次（每次请求最多换一次）
      if (netErr && this.routes.length > 1 && !switched) { switched = true; this.ri = (this.ri + 1) % this.routes.length; attempt--; continue; }
      if (res && !this.routeKnown) { this.routeKnown = true; try { if (this.routeStore) this.routeStore.save(this.ri); } catch (e) {} }
      else if (res && switched) { try { if (this.routeStore) this.routeStore.save(this.ri); } catch (e) {} }
      const busy = netErr || [429, 502, 503, 504].includes(res.status);
      if (busy && retryable && attempt < (netErr ? 1 : 3)) { await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 400)); continue; }
      if (netErr) { this.online = false; const e = new Error(netErr.name === "AbortError" ? "服务器响应太慢，请稍后重试" : "网络连接失败，请检查网络"); e.offline = true; throw e; }
      this.online = true;
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = { message: text }; }
      if (!res.ok) {
        const e = new Error([429, 502, 503, 504].includes(res.status) ? "现在用的人太多了，请过一会儿再试" : humanError(body, res.status));
        e.status = res.status; e.raw = String((body && (body.error_description || body.msg || body.message || body.error || body.error_code)) || ""); throw e;
      }
      return body;
    }
  }

  // 3.3.3：过期时间按「本机现在 + 有效秒数」算，不用服务器给的绝对时间——电脑时钟慢了几分钟、几小时时，
  //   以前会拿着已经过期的令牌去请求，服务器回 401，电脑版就当成「登录失效」把账号退出了
  keep(j) {
    const s = { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || (j.expires_at ? Math.max(300, j.expires_at - Math.floor(Date.now() / 1000)) : 3600)), user_id: j.user && j.user.id };
    this.store.save(s);
    return s;
  }

  // force：服务器说令牌不行了（401），不管本机认为过没过期，都换一个新的
  async session(force) {
    const s = this.store.load();
    if (!s || !s.access_token) return null;
    if (!force && s.expires_at - 300 > Date.now() / 1000) return s;      // 提前 5 分钟换，睡眠唤醒后也来得及
    if (!this.refreshing) {
      this.refreshing = this.refreshOnce(s).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  // 3.3.3 修「电脑版有时候无缘无故自己退出登录」：
  //   · 换令牌的请求最多等 6 秒。以前要等 20 秒，超时后换线路再用同一个旧令牌去换——服务器其实已经换过了，
  //     旧令牌 10 秒后作废，第二次就被拒，电脑版以为登录失效直接退出。6 秒内重试，服务器会认这次是同一次换令牌
  //   · 只有服务器明确说「这个登录已经无效」才退出；网络不好、服务器忙、线路超时都先保留登录，过一会儿再试
  async refreshOnce(s) {
    try {
      const j = await this.call(this.base + "/auth/v1/token?grant_type=refresh_token", { method: "POST", timeout: 6000, body: JSON.stringify({ refresh_token: s.refresh_token }) });
      if (!j || !j.access_token) return s;
      return this.keep(j);
    } catch (e) {
      const now = this.store.load();
      if (now && now.refresh_token !== s.refresh_token) return now;          // 别的地方已经换好了
      const dead = (e.status === 400 || e.status === 401 || e.status === 403) && /refresh.?token|invalid.?grant|not.?found|already.?used|revoked|session/i.test(String(e.raw || e.message || ""));
      if (dead) { this.store.save(null); return null; }
      return s;                                                             // 断网、超时、服务器忙：先留着
    }
  }

  async signIn(account, password) {
    account = String(account || "").trim().toLowerCase();
    if (!ACCOUNT_RE.test(account)) throw new Error("账号是 3~20 位小写字母、数字或下划线");
    if (!password) throw new Error("请输入密码");
    const j = await this.call(this.base + "/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: account + "@" + this.domain, password }) });
    return this.keep(j);
  }

  // 注册（和网页版同一套：账号对应内部邮箱 <账号>@<域名>）；org = { type, name } 学校 / 单位，可不填
  async signUp(account, password, { name, role, gender, org } = {}) {
    account = String(account || "").trim().toLowerCase();
    name = String(name || "").trim();
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    if (!name) throw new Error("请填写姓名");
    if (String(password || "").length < 8) throw new Error("密码至少 8 位");
    const meta = { name, role: role === "teacher" ? "teacher" : "student", identity: role === "teacher" || role === "other" ? role : "student", gender: gender === "m" || gender === "f" ? gender : "" };
    const ORG = ["university", "college", "high", "middle", "primary", "work", "personal"];
    if (org && ORG.includes(org.type)) { meta.org_type = org.type; meta.org_name = String(org.name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40); }
    let j;
    try { j = await this.call(this.base + "/auth/v1/signup", { method: "POST", body: JSON.stringify({ email: account + "@" + this.domain, password, data: meta }) }); }
    catch (e) {
      if (/already (registered|exists)/i.test(e.message)) e.message = "这个账号已经被注册了，换一个或直接登录";
      else if (/password should be/i.test(e.message)) e.message = "密码太短，至少 8 位";
      else if (/signups? not allowed|signup is disabled/i.test(e.message)) e.message = "暂时关闭了注册，请联系管理员";
      throw e;
    }
    if (j && j.access_token) return this.keep(j);
    return this.signIn(account, password);   // 部分配置下注册不直接返回登录状态，再登录一次
  }
  // 没登录也能调的接口（查账号能不能用、找回密码）：用公开密钥
  anonRpc(fn, args) { return this.call(this.base + "/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) }); }

  async signOut() {
    const s = this.store.load();
    if (s) { try { await this.call(this.base + "/auth/v1/logout?scope=local", { method: "POST", timeout: 5000 }, s.access_token); } catch (e) {} }
    this.store.save(null);
  }

  // 3.3.3：请求被 401 拒了（令牌过期、电脑刚睡醒、时钟不准）：先换一个新令牌再试一次，换不到才算真的登录失效
  async rest(p, opts = {}) {
    const s = await this.session();
    try { return await this.call(this.base + "/rest/v1/" + p, opts, s && s.access_token); }
    catch (e) {
      if (e.status !== 401 || !s) throw e;
      const s2 = await this.session(true);
      if (!s2) throw e;                                       // 登录确实失效了（已经清掉）
      if (s2.access_token === s.access_token) { e.keep = true; throw e; }   // 没换成（网络不好）：别退出，下次再试
      return this.call(this.base + "/rest/v1/" + p, opts, s2.access_token);
    }
  }
  rpc(fn, args, opts = {}) { return this.rest("rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}), ...opts }); }
}

module.exports = { Api, loadSiteConfig, ROLE_NAMES, ACCOUNT_RE, humanError };
