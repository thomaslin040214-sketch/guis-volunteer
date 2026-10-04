/* ============================================================
   GUIS 义工组织 — 登录态（全站共用）：右上角头像 + 会话续期

   要解决的问题：
     1. 登录之后回到首页，右上角要能看出「是我」，并且一点就能去自己该去的页面。
     2. 不要动不动就要重新登录 —— 只要会话还有效就一直保持，
        页面开着的时候定期续一次，只有服务端明确说「没这个人」才退出登录态。

   会话到底能撑多久，由云服务决定，我们改不了：
     · access_token 有效 2 小时（expires_in = 7199）
     · SDK 自己存在 workbuddy-cloud.session.* 里，token 快到期时（剩 90 秒内）
       会自动拿 refresh_token 换一个新的 —— 所以我们只要按时调 getSession()，
       它就一直续下去；refresh_token 本身什么时候失效是平台侧的事。
   我们能做的是三件事：
     · 头像先从 localStorage 秒画（回来就有，不等网络往返）
     · 后台静默复核一次，有变化再改画
     · 页面开着时每 10 分钟续一次，切回标签页 / 前进后退回来也续一次
       → 「不要用一会儿就被踢出去」

   ⚠️ 缓存只用来画头像，**不当作登录凭证**：任何写操作仍然以服务端为准，
      服务端说没有会话就立刻清掉缓存并把「登录」按钮放回去。
   ============================================================ */
(function () {
  "use strict";

  var C = window.GUISCloud;
  /* 没有云服务（静态镜像 / SDK 没加载 / 测试桩）就什么都不做。
     ⚠️ 不能只判 C 是否存在 —— 桩对象可能有 endpoint 却没有 getSession。 */
  if (!C || typeof C.getSession !== "function") return;

  var CACHE_KEY = "guis-session-card";       /* { email, role, at } */
  var CACHE_MS = 7 * 24 * 60 * 60 * 1000;   /* 缓存 7 天只为「秒出头像」 */
  var KEEPALIVE_MS = 10 * 60 * 1000;        /* 页面开着时每 10 分钟续一次 */
  var RETRY_MS = 2 * 60 * 1000;             /* 网络抖了，2 分钟后再试一次 */

  /* ---------------- 文案 ----------------
     和 login.js 同一套口径：?lang= > localStorage > 中文；
     页面没挂 i18n.js 时（后台 / 签到页 / 我的账户）就用内置中文兜底。 */
  function t(key, fallback) {
    try {
      var lang = new URLSearchParams(location.search).get("lang") ||
        localStorage.getItem("guis-volunteer-lang") || "zh";
      var pack = (window.SITE_I18N || {})[lang] || (window.SITE_I18N || {}).zh || {};
      if (pack[key] != null) return pack[key];
    } catch (e) { /* localStorage 可能不可用 */ }
    return fallback;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 缓存（只画头像用） ---------------- */
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.email) return null;
      if (Date.now() - (o.at || 0) > CACHE_MS) { localStorage.removeItem(CACHE_KEY); return null; }
      return o;
    } catch (e) { return null; }
  }
  function writeCache(info) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(info)); } catch (e) {}
  }
  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  /* ---------------- 跟服务端对一次 ----------------
     三种结果：
       ok        → 会话还在，返回 { email, role }
       transient → 网络 / 服务端临时出错，**不清登录态**，等下再试
       none      → 服务端明确说没有会话，清缓存、恢复「登录」按钮 */
  function revalidate() {
    /* 邮箱统一走 C.sessionUser()（cloud.js）—— getSession() 自己不带邮箱，
       以前在这里读 s.user.email 读出来永远是 undefined，头像就永远画不出来。 */
    var p;
    try {
      p = (typeof C.sessionUser === "function") ? C.sessionUser() : Promise.resolve(null);
    } catch (e) { return Promise.resolve({ state: "transient" }); }

    return Promise.resolve(p).then(function (u) {
      if (!u) return { state: "none" };
      var email = u.email || "";
      if (typeof C.myAccess !== "function") return { state: "ok", email: email, role: "student" };

      /* 角色只有服务端说了算（my_access 是 SECURITY DEFINER）。
         拿不到角色时不把人踢出去 —— 按缓存里的角色，没有就当学生。 */
      return C.myAccess().then(function (ar) {
        var row = (ar && ar.data && ar.data[0]) || {};
        var role = row.role === "owner" ? "owner"
          : row.role === "teacher" ? "teacher" : "student";
        return { state: "ok", email: email, role: role };
      }, function () {
        var c = readCache();
        var role = (c && String(c.email).toLowerCase() === email.toLowerCase() && c.role) || "student";
        return { state: "ok", email: email, role: role };
      });
    }, function () { return { state: "transient" }; });
  }

  /* ---------------- 右上角账户按钮 ---------------- */
  var el = null, btn = null, outBtn = null, wired = false;

  /* 2026-10-03：这里原来是头像用的「邮箱前缀缩写」（initials）—— 头像形态取消之后
     没人再调它，一并删掉，免得留一段死代码让人以为是头像还在。 */

  function roleLabelOf(role) {
    return role === "owner" ? t("navme.owner", "执委会")
      : role === "teacher" ? t("navme.teacher", "负责老师")
      : t("navme.student", "义工学生");
  }
  function destOf(role) {
    return role === "owner" ? { href: "admin.html", label: t("lg.footAdmin", "执委会后台") }
      : role === "teacher" ? { href: "checkin.html", label: t("lg.footTeacher", "老师签到页") }
      : { href: "me.html", label: t("lg.footStudent", "我的义工账户") };
  }

  /* 头像插在哪儿：优先 .nav-right（右半区，跟语言开关 / 登录按钮同一组），
     老结构（没有 .nav-right 的页面）退回 .nav-links。
     两种情况都插在「登录」按钮前面，登录成功后那个按钮会隐藏，位置就顶上了。 */
  function host() {
    var right = document.querySelector(".nav-right");
    if (right) return { parent: right, before: right.querySelector(".nav-login") };
    var links = document.querySelector(".nav-links");
    if (!links) return null;
    return { parent: links, before: links.querySelector(".nav-login") };
  }

  function setOpen(on) {
    if (!el) return;
    el.classList.toggle("is-open", !!on);
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function wire() {
    if (wired || !el) return;
    wired = true;
    if (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        setOpen(!el.classList.contains("is-open"));
      });
    }
    document.addEventListener("click", function (e) {
      if (el && !el.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") setOpen(false);
    });
    Array.prototype.forEach.call(el.querySelectorAll("a"), function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
  }

  function paint(info) {
    var h = host();
    if (!h) return;

    if (!el) {
      el = document.createElement("div");
      el.className = "nav-me";
      el.id = "nav-me";
      if (h.before) h.parent.insertBefore(el, h.before);
      else h.parent.appendChild(el);
    }

    var dest = destOf(info.role);
    var label = roleLabelOf(info.role);
    /* 2026-10-03：原来这里是一枚圆形字母头像（nav-avatar），换成正式的「账户」按钮 ——
       小人图标 + 角色名 + 小箭头（nav-caret），外观在 site.css 的 .nav-account。
       ⚠️ 中间显示**角色名**而不是邮箱前缀：学生的邮箱前缀是学号，显示出来像串乱码数字；
       ⚠️ 完整邮箱在展开的菜单头部（nav-me-head）里。
       ⚠️ 拼进 innerHTML 的一律先过 esc() —— 角色名 / 邮箱都不是我能控制的内容。 */
    el.innerHTML =
      '<button type="button" class="nav-account" aria-haspopup="true" aria-expanded="false" ' +
      'title="' + esc(info.email) + ' · ' + esc(label) + '">' +
      '<svg class="nav-account-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>' +
      "</svg>" +
      '<span class="nav-account-name">' + esc(label) + "</span>" +
      '<span class="nav-caret" aria-hidden="true"></span>' +
      "</button>" +
      '<div class="nav-drop-menu nav-me-menu">' +
      '<div class="nav-me-head"><b>' + esc(info.email) + "</b><span>" + esc(label) + "</span></div>" +
      '<a href="' + dest.href + '">' + esc(dest.label) + "</a>" +
      '<a href="index.html">' + esc(t("nav.home", "回到主页")) + "</a>" +
      '<button type="button" class="nav-me-out">' + esc(t("navme.out", "退出登录")) + "</button>" +
      "</div>";
    el.hidden = false;

    btn = el.querySelector(".nav-account");
    outBtn = el.querySelector(".nav-me-out");
    wired = false;
    wire();
    if (outBtn) {
      outBtn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        signOut();
      });
    }

    /* 已经登录了，导航里那颗「登录」按钮就该让位 */
    if (h.before) h.before.hidden = true;
  }

  function unpaint() {
    clearCache();
    if (el) { el.hidden = true; setOpen(false); }
    var a = document.querySelector(".nav-login");
    if (a) a.hidden = false;
  }

  function signOut() {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      unpaint();
      try { localStorage.removeItem("guis-doc-ver"); } catch (e) {}
      location.href = "index.html";
    }
    try {
      Promise.resolve(C.auth && C.auth.signOut ? C.auth.signOut() : null).then(finish, finish);
    } catch (e) { finish(); }
    setTimeout(finish, 1500);          /* 网络卡住也别把人晾在这儿 */
  }

  /* ---------------- 边画边续 ---------------- */
  var retryTimer = null, aliveTimer = null;

  function sync() {
    revalidate().then(function (r) {
      if (r.state === "ok") {
        writeCache({ email: r.email, role: r.role, at: Date.now() });
        paint(r);
      } else if (r.state === "none") {
        unpaint();
      } else {
        /* 只是网络抖了一下：保持现在的样子，等下再试 */
        if (!retryTimer) retryTimer = setTimeout(function () { retryTimer = null; sync(); }, RETRY_MS);
      }
    });
  }

  function start() {
    /* 1) 先拿缓存秒画，回来就有头像，不等网络 */
    var cached = readCache();
    if (cached) paint(cached);
    /* 2) 后台静默复核一次 */
    sync();
    /* 3) 页面开着就定期续；切回标签页 / 前进后退也续一次 */
    if (!aliveTimer) aliveTimer = setInterval(sync, KEEPALIVE_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) sync();
    });
    window.addEventListener("pageshow", function () { sync(); });
  }

  /* 这个脚本贴在 </body> 前，导航已经解析完了就直接画（不等 DOMContentLoaded，
     这样「回到首页」的瞬间就能看到头像）；万一被挪到 <head> 就退回监听。 */
  if (document.querySelector(".nav-links")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.GUISSession = {
    sync: sync,
    unpaint: unpaint,
    signOut: signOut,
    cache: readCache
  };
})();
