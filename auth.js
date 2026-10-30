// 捞捞课程表 · 登录与数据接口（index.html / login.html / dev.html 共用）
// 账号在后台对应一个内部邮箱：<账号>@<AUTH_EMAIL_DOMAIN>，用户不需要真实邮箱。
(function () {
  const CFG = window.APP_CONFIG || {};
  // 两条线路：国内直连（SUPABASE_URL）+ 海外中转（SUPABASE_URL_ALT，Cloudflare Worker，见「海外线路」说明）。
  // 一条连不上就自动换另一条，记住能用的那条 3 天（5.7.0）
  const ROUTES = [CFG.SUPABASE_URL, CFG.SUPABASE_URL_ALT].filter(Boolean).map((u) => String(u).replace(/\/+$/, ""));
  const LS_ROUTE = "cc_api_route_v1";
  let routeI = 0, routeKnown = false;
  try { const r = JSON.parse(localStorage.getItem(LS_ROUTE) || "null"); if (r && ROUTES[r.i] && Date.now() - r.at < 3 * 864e5) { routeI = r.i; routeKnown = true; } } catch (e) {}
  const base = () => ROUTES[routeI] || "";
  function setRoute(i) { if (!ROUTES[i]) return; routeI = i; routeKnown = true; try { localStorage.setItem(LS_ROUTE, JSON.stringify({ i, at: Date.now() })); } catch (e) {} }
  const KEY = CFG.SUPABASE_ANON_KEY || "";
  const DOMAIN = CFG.AUTH_EMAIL_DOMAIN || "calendar.test";
  const LS = "cc_session_v1";

  const ROLE_NAMES = { admin: "管理员", developer: "开发者", tester: "测试员", teacher: "老师", monitor: "班委", student: "学生" };
  const STAFF = ["admin", "developer", "tester"];
  // 后台功能权限（管理员在插件后台给开发者/测试员勾选）
  const STAFF_PERMS = {
    try_testing: "试用测试中的插件", upload: "上传、管理自己的插件", view_code: "查看待审核插件的代码",
    publish: "同意插件上架", reject: "驳回插件", unpublish: "下架已发布的插件",
    set_default: "设置插件默认开启", transfer: "转交插件作者", manage_users: "给用户分配身份",
  };
  const LEGACY_PERMS = { admin: Object.keys(STAFF_PERMS), developer: ["try_testing", "upload"], tester: ["try_testing"] };
  const PERM_NAMES = { can_ingest: "AI 整理", can_edit: "增改事项", can_delete: "删除事项", can_view_members: "看成员名单" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const load = () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } };
  const store = (s) => { try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch {} };

  const ACCOUNT_RE = /^[a-z0-9_]{3,20}$/;
  function normAccount(a) { return String(a || "").trim().toLowerCase(); }

  function humanError(j, status) {
    const m = String(j.msg || j.error_description || j.message || j.error || j.hint || "");
    if (/invalid login credentials/i.test(m)) return "账号或密码错误";
    if (/already (registered|exists)/i.test(m)) return "这个账号已经被注册了，换一个或直接登录";
    if (/password should be/i.test(m)) return "密码太短，至少 8 位";
    if (/signups? not allowed|signup is disabled/i.test(m)) return "暂时关闭了注册，请联系管理员";
    if (/email not confirmed/i.test(m)) return "账号还没激活，请联系管理员";
    if (/[\u4e00-\u9fa5]/.test(m)) return m;   // 数据库里写好的中文提示直接显示
    if (/row-level security|permission denied|42501/i.test(m) || status === 403) return "没有权限执行这个操作";
    if (/JWT expired/i.test(m)) return "登录已过期，请重新登录";
    return m || `请求失败（${status}）`;
  }

  // 人多的时候：读数据的请求遇到「服务器忙 / 网络抖动」会自动重试（等一小会儿、每人错开时间），
  // 写数据的请求不重试（避免重复提交）。每个请求最多等 20 秒。
  const SAFE_RPC = /\/rpc\/(app_bootstrap2?|class_ctx|class_groups_get|class_item_history|my_classes|my_perms|feature_state|mail_my|growth_board|wall_my_reports|wall_report_list|credit_list|class_roster|parse_feedback_list|ingest_job_status|class_features_get|admin_features|ics_my_feed|udata_pull|udata_push|device_alive|device_list|class_schedule_get|courses_get|checkin_list|checkin_get|checkin_code|checkin_detail|checkin_sign|checkin_mark|xp_me|manage_classes|teacher_overview)$/;   // 6.9.6 签到相关也重试：几十人同时扫码时服务器偶尔忙；重复签到只会返回「已经签过」
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function call(url, opts, token) {
    const method = (opts.method || "GET").toUpperCase();
    const retryable = method === "GET" || SAFE_RPC.test(url.split("?")[0]);
    let switched = false;
    for (let attempt = 0; ; attempt++) {
      let res, netErr = null;
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      // 还不知道哪条线路能用：第一次只等 8 秒，连不上就换线路（海外连国内服务器常常卡住不动）
      const timer = ctl ? setTimeout(() => ctl.abort(), !routeKnown && ROUTES.length > 1 ? 8000 : 20000) : 0;
      try {
        res = await fetch(url, {
          ...opts, signal: ctl ? ctl.signal : undefined,
          headers: { apikey: KEY, Authorization: "Bearer " + (token || KEY), "Content-Type": "application/json", ...(opts.headers || {}) },
        });
      } catch (e) { netErr = e; } finally { clearTimeout(timer); }
      // 这条线路连不上：换另一条再试一次（连接失败说明请求没送到，写数据也可以安全重试；超时的写请求不重试，免得重复提交）
      if (netErr && !switched && ROUTES.length > 1 && navigator.onLine !== false && (netErr.name !== "AbortError" || retryable || !routeKnown)) {
        const cur = ROUTES.find((b) => url.startsWith(b));
        const other = ROUTES.findIndex((b) => b !== cur);
        if (cur && other >= 0) { url = ROUTES[other] + url.slice(cur.length); switched = true; attempt--; continue; }
      }
      // 只有真的连通了才记住这条线路（换过去也失败的，不会把以后的请求都带偏）
      if (res && (!routeKnown || switched)) { const i = ROUTES.findIndex((b) => url.startsWith(b)); if (i >= 0 && (i !== routeI || !routeKnown)) setRoute(i); }
      // 6.15 服务器的防刷限制（rate_limited）：不是「忙」，重试只会更糟，直接告诉用户
      let limited = false;
      if (res && res.status === 429) { try { limited = /rate_limited/.test(await res.clone().text()); } catch {} }
      const busy = netErr || (res && !limited && [429, 502, 503, 504].includes(res.status));
      // 服务器忙：最多重试 3 次；连不上网：只重试 1 次（断网时别让人干等）
      const maxTry = netErr ? (navigator.onLine === false ? 0 : 1) : 3;
      if (busy && retryable && attempt < maxTry) {
        const ra = res && Number(res.headers.get("Retry-After"));
        await sleep(ra ? Math.min(ra, 10) * 1000 : 500 * 2 ** attempt + Math.random() * 600);
        continue;
      }
      if (netErr) throw new Error(netErr.name === "AbortError" ? "服务器响应太慢，请稍后重试" : "网络连接失败，请检查网络后重试");
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
      if (!res.ok) {
        if (limited) { const err = new Error("操作太频繁，已被暂时限制，请过几分钟再试"); err.status = 429; err.limited = true; throw err; }
        if ([429, 502, 503, 504].includes(res.status)) throw new Error("现在用的人太多了，请过一会儿再试");
        // 数据库（PostgREST）的错误都带 code；403 却没有 code，说明是网关（大小限制 / 安全规则）在门口就拦下了，根本没到数据库
        const fromDb = body && typeof body === "object" && (body.code != null || body.msg != null || body.error != null);
        if (res.status === 403 && !fromDb) {
          const err = new Error("服务器网关拦下了这次请求（403），可能是内容太大或触发了安全规则"); err.status = 403; err.gateway = true; throw err;
        }
        // 后端 5.4.0：这台设备已在其他设备上被踢出（服务器作废了这张凭证）
        if (body && /device_revoked/.test(String(body.message || body.hint || ""))) { const err = new Error("这台设备已在其他设备上被退出登录"); err.status = 401; err.revoked = true; err.reason = String(body.details || "").slice(0, 120); throw err; }
        const err = new Error(humanError(body || {}, res.status)); err.status = res.status; throw err;
      }
      return body;
    }
  }

  function keep(j) {
    const s = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      user_id: j.user && j.user.id,
    };
    store(s);
    return s;
  }

  let refreshing = null;
  async function session() {
    const s = load();
    if (!s || !s.access_token) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s;
    if (!refreshing) {
      refreshing = call(base() + "/auth/v1/token?grant_type=refresh_token",
        { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then(keep)
        // 只有服务器明确说「登录已失效」才退出；网络不好、服务器忙时保留登录，下次再续
        .catch((e) => { if (e && (e.status === 400 || e.status === 401)) { store(null); meCache = null; lost(e.revoked ? "revoked" : "expired", e.reason); return null; } return s; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function signIn(account, password) {
    account = normAccount(account);
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    const j = await call(base() + "/auth/v1/token?grant_type=password",
      { method: "POST", body: JSON.stringify({ email: account + "@" + DOMAIN, password }) });
    meCache = null;
    return keep(j);
  }

  const ORG_TYPES = ["university", "college", "high", "middle", "primary", "work", "personal"];
  // org：{ type, name }，学校 / 单位，选填（数据库升级前也会先存在账号资料里，升级后自动补进个人资料）
  async function signUp(account, password, name, role, gender, org) {
    account = normAccount(account);
    name = String(name || "").trim();
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    if (!name) throw new Error("请填写姓名（会显示为插件作者）");
    if (String(password).length < 8) throw new Error("密码至少 8 位");
    const j = await call(base() + "/auth/v1/signup",
      { method: "POST", body: JSON.stringify({ email: account + "@" + DOMAIN, password, data: { name, role: role === "teacher" ? "teacher" : "student", identity: role === "teacher" || role === "other" ? role : "student", gender: gender === "m" || gender === "f" ? gender : "", ...orgMeta(org) } }) });
    meCache = null;
    if (j && j.access_token) return keep(j);
    // 部分配置下注册不直接返回登录状态，再登录一次
    return signIn(account, password);
  }

  function orgMeta(org) {
    if (!org || !ORG_TYPES.includes(org.type)) return {};
    const n = String(org.name || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
    return { org_type: org.type, org_name: n };
  }

  // 退出：先让服务器作废这次登录（包括刷新令牌），再清掉本机的登录信息
  async function signOut() {
    let s = null;
    try { s = await session(); } catch {}
    s = s || load();
    if (s) { try { await call(base() + "/auth/v1/logout?scope=local", { method: "POST" }, s.access_token); } catch {} }
    store(null); meCache = null;
  }

  // PostgREST 查询：path 如 "plugins?select=id,name"
  async function rest(path, opts = {}) {
    const s = await session();
    try { return await call(base() + "/rest/v1/" + path, opts, s && s.access_token); }
    catch (e) {
      // 凭证被服务器作废（被别的设备踢出 / 改了密码）：清掉登录，通知页面
      if (e && e.status === 401 && s) { store(null); meCache = null; lost(e.revoked ? "revoked" : "expired", e.reason); }
      throw e;
    }
  }
  // 登录失效：发 cc-auth-lost 事件（首页 app.js 会接住，自己处理）；没人接的页面：被踢出就提示并回登录页
  let lostOnce = false;
  function lost(why, reason) {
    if (lostOnce) return; lostOnce = true;
    setTimeout(() => { lostOnce = false; }, 3000);
    let handled = false;
    try { handled = !window.dispatchEvent(new CustomEvent("cc-auth-lost", { detail: { why, reason: reason || "" }, cancelable: true })); } catch {}
    if (handled || why !== "revoked") return;
    try { localStorage.removeItem("cc_device_id_v1"); } catch {}
    if (/login\.html$/.test(location.pathname)) return;   // 已经在登录页：不用再跳
    alert(kickText(reason));
    location.replace("login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() || "index.html"));
  }
  // 6.15 被服务器退出登录时给用户看的话（服务器会说明原因：被踢出 / 账号异常 / 被停用）
  function kickText(reason) {
    const r = String(reason || "");
    if (/停用/.test(r)) return r + "。本机记录仍然保留；如有疑问请联系老师或管理员。";
    if (/异常/.test(r)) return "检测到你的账号登录环境异常（同一个登录突然在别的设备、或在很多不同网络上使用），为了安全已自动退出。本机记录仍然保留，请重新登录；如果不是你本人在用，登录后请立刻修改密码。";
    return "这台设备已在其他设备上被退出登录。本机记录仍然保留，请重新登录；如果不是你本人操作，请登录后立刻修改密码。";
  }
  // 7.17 微信扫码登录：数据库给的是一张续期令牌，换成正式登录凭证（和账号密码登录出来的一样）；换不了就用兜底的 2 小时凭证
  async function adoptSession(r) {
    if (r && r.grant) {   // 一次性登录票：等数据库从登录服务拿到票据，再换成正式凭证
      const t0 = Date.now();
      for (;;) {
        const g = await call(base() + "/rest/v1/rpc/wx_grant_poll", { method: "POST", body: JSON.stringify({ id: r.grant, gk: r.gk }) });
        if (g && g.token_hash) {
          const j = await call(base() + "/auth/v1/verify", { method: "POST", body: JSON.stringify({ type: g.type || "magiclink", token_hash: g.token_hash }) });
          if (!j || !j.access_token) throw new Error("登录没成功，请再试一次");
          meCache = null; return keep(j);
        }
        if (Date.now() - t0 > 20000) throw new Error("登录服务太慢了，请再试一次");
        await new Promise((ok) => setTimeout(ok, Date.now() - t0 < 3000 ? 300 : 800));
      }
    }
    if (r && r.refresh_token) {
      try {
        const j = await call(base() + "/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: r.refresh_token }) });
        meCache = null; return keep(j);
      } catch (e) { if (!r.access_token) throw new Error("扫码登录暂时用不了（" + e.message + "），请先用账号密码登录"); }
    }
    if (r && r.access_token) { meCache = null; return keep({ ...r, refresh_token: "" }); }
    throw new Error("登录没成功，请再试一次");
  }
  async function rpc(fn, args) {
    return rest("rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) });
  }

  let meCache = null, meLoading = null;
  // 打开网页时一次拿齐数据（app_bootstrap），顺便把用户信息存好，后面不用再单独请求
  function primeMe(me, perms) { if (me) { meCache = { ...me, perms: perms || LEGACY_PERMS[me.role] || [] }; } }
  // 同一时间多处要用户信息时只请求一次
  function me() {
    if (meCache) return Promise.resolve(meCache);
    if (!meLoading) meLoading = loadMe().finally(() => { meLoading = null; });
    return meLoading;
  }
  async function loadMe() {
    const s = await session();
    if (!s || !s.user_id) return null;
    try {
      const q = "&id=eq." + encodeURIComponent(s.user_id);
      // 新字段（性别、签名、需要改密码）数据库升级后才有；还没升级时退回老字段
      const rows = await rest("profiles?select=id,account,display_name,role,gender,bio,must_change_pw,org_type,org_name" + q)
        .catch(() => rest("profiles?select=id,account,display_name,role,gender,bio,must_change_pw" + q))
        .catch(() => rest("profiles?select=id,account,display_name,role" + q));
      meCache = rows && rows[0] ? rows[0] : null;
    } catch { meCache = null; }
    if (meCache) {
      try { meCache.perms = (await rpc("my_perms")) || []; }
      catch { meCache.perms = LEGACY_PERMS[meCache.role] || []; }   // 数据库还没升级时按老规则
    }
    return meCache;
  }

  const can = (user, perm) => !!(user && user.perms && user.perms.includes(perm));
  window.CCAuth = { adoptSession, base, routes: () => ROUTES.slice(), route: () => routeI, setRoute, primeMe, signIn, signUp, signOut, session, rest, rpc, me, esc, can, ROLE_NAMES, STAFF, STAFF_PERMS, PERM_NAMES, ACCOUNT_RE };
})();
