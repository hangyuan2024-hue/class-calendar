// 班级群日历 · 登录与数据接口（index.html / login.html / dev.html 共用）
// 账号在后台对应一个内部邮箱：<账号>@<AUTH_EMAIL_DOMAIN>，用户不需要真实邮箱。
(function () {
  const CFG = window.APP_CONFIG || {};
  const BASE = CFG.SUPABASE_URL || "";
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

  async function call(url, opts, token) {
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { apikey: KEY, Authorization: "Bearer " + (token || KEY), "Content-Type": "application/json", ...(opts.headers || {}) },
      });
    } catch (e) { throw new Error("网络连接失败，请检查网络后重试"); }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    if (!res.ok) throw new Error(humanError(body || {}, res.status));
    return body;
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
      refreshing = call(BASE + "/auth/v1/token?grant_type=refresh_token",
        { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then(keep)
        .catch(() => { store(null); return null; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function signIn(account, password) {
    account = normAccount(account);
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    const j = await call(BASE + "/auth/v1/token?grant_type=password",
      { method: "POST", body: JSON.stringify({ email: account + "@" + DOMAIN, password }) });
    meCache = null;
    return keep(j);
  }

  async function signUp(account, password, name, role) {
    account = normAccount(account);
    name = String(name || "").trim();
    if (!ACCOUNT_RE.test(account)) throw new Error("账号只能用 3~20 位小写字母、数字或下划线");
    if (!name) throw new Error("请填写姓名（会显示为插件作者）");
    if (String(password).length < 8) throw new Error("密码至少 8 位");
    const j = await call(BASE + "/auth/v1/signup",
      { method: "POST", body: JSON.stringify({ email: account + "@" + DOMAIN, password, data: { name, role: role === "teacher" ? "teacher" : "student" } }) });
    meCache = null;
    if (j && j.access_token) return keep(j);
    // 部分配置下注册不直接返回登录状态，再登录一次
    return signIn(account, password);
  }

  // 退出：先让服务器作废这次登录（包括刷新令牌），再清掉本机的登录信息
  async function signOut() {
    let s = null;
    try { s = await session(); } catch {}
    s = s || load();
    if (s) { try { await call(BASE + "/auth/v1/logout?scope=local", { method: "POST" }, s.access_token); } catch {} }
    store(null); meCache = null;
  }

  // PostgREST 查询：path 如 "plugins?select=id,name"
  async function rest(path, opts = {}) {
    const s = await session();
    return call(BASE + "/rest/v1/" + path, opts, s && s.access_token);
  }
  async function rpc(fn, args) {
    return rest("rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) });
  }

  let meCache = null;
  async function me() {
    if (meCache) return meCache;
    const s = await session();
    if (!s || !s.user_id) return null;
    try {
      const rows = await rest("profiles?select=id,account,display_name,role&id=eq." + encodeURIComponent(s.user_id));
      meCache = rows && rows[0] ? rows[0] : null;
    } catch { meCache = null; }
    if (meCache) {
      try { meCache.perms = (await rpc("my_perms")) || []; }
      catch { meCache.perms = LEGACY_PERMS[meCache.role] || []; }   // 数据库还没升级时按老规则
    }
    return meCache;
  }

  const can = (user, perm) => !!(user && user.perms && user.perms.includes(perm));
  window.CCAuth = { signIn, signUp, signOut, session, rest, rpc, me, esc, can, ROLE_NAMES, STAFF, STAFF_PERMS, PERM_NAMES, ACCOUNT_RE };
})();
