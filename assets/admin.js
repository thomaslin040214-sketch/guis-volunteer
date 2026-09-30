/* ============================================================
   GUIS 义工社 — 后台管理
   登录 / 活动管理 / 报名名单（含勾选录取与导出）/ 实时报名 /
   刊物 / 公告 / 过往活动 / 白名单

   这个文件原先是 admin.html 里的内联 <script>，因为要新增四个页签，
   内联脚本已经长到没法维护，所以整体搬到这里，admin.html 只留一行引用。
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var C = window.GUISCloud;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 域名提示 ---------------- */
  (function () {
    var host = location.origin;
    if (host && C.endpoint && host.replace(/\/+$/, "") !== C.endpoint.replace(/\/+$/, "")) {
      var b = $("origin-banner");
      $("origin-link").textContent = C.endpoint;
      $("origin-link").href = C.endpoint + "/admin.html";
      b.hidden = false;
    }
  })();

  /* ---------------- 通用工具 ---------------- */
  function alertIn(el, kind, msg) {
    el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { el.innerHTML = ""; }

  /* 行内按钮的忙碌态：禁用 + 换文案。
     以前点了没任何视觉变化，用户会以为没反应。then / catch 两条路都必须调 busyOff(btn)。 */
  function busyOn(btn, label) {
    if (!btn) return;
    btn.setAttribute("data-busy-label", btn.textContent);
    btn.disabled = true;
    btn.classList.add("is-busy");
    if (label) btn.textContent = label;
  }
  function busyOff(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove("is-busy");
    var old = btn.getAttribute("data-busy-label");
    if (old != null) { btn.textContent = old; btn.removeAttribute("data-busy-label"); }
  }
  /* 把 Postgres / PostgREST 的错误翻成人话，并指出排查方向。 */
  function failMsg(err, fallback) {
    var m = (err && err.message) ? err.message : "";
    var code = err && (err.code || (err.raw && err.raw.code));
    if (code === "42501" || /row-level security|violates row-level/i.test(m)) {
      return "权限不足：服务端拒绝了这次写入。请确认当前登录邮箱已在「白名单」页签里。";
    }
    if (code === "23503") return "删除失败：还有其它数据关联着它。";
    if (code === "23505") return "已经存在重复记录了。";
    if (!m && !code) return (fallback || "操作失败") + "。";
    return (fallback || "操作失败") + "：" + m;
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDT(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fromLocalInput(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function statusLabel(s) {
    return s === "approved" ? "已通过" : s === "rejected" ? "未通过" : "待确认";
  }
  function statusClass(s) {
    return s === "approved" ? "st-approved" : s === "rejected" ? "st-rejected" : "st-pending";
  }

  /* ---------------- 登录态 ---------------- */
  var loginView = $("login-view"), appView = $("app-view");

  /* ---------------- 角色 ----------------
     两套权限，服务端才是边界（activities / articles / announcements / allowed_admins
     的写入策略全部只认 is_owner()）。前端这里只是把不该点的入口藏掉，
     免得老师点了之后收到一句看不懂的报错。 */
  var ME = { email: "", role: "teacher", isStudent: false, mustChange: false };
  function isOwner() { return ME.role === "owner"; }

  /* 只有执委会能进的页签；负责老师一律看不到。
     「活动日历」也在里面 —— 它能改活动的开始 / 结束 / 报名截止，属于写操作。 */
  var OWNER_ONLY_TABS = ["acts", "calendar", "journal", "announce", "people", "students"];

  function applyRoleUI() {
    var owner = isOwner();
    Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (b) {
      var t = b.getAttribute("data-tab");
      if (OWNER_ONLY_TABS.indexOf(t) >= 0) b.hidden = !owner;
    });

    var note = $("role-note");
    if (note) {
      note.hidden = owner;
      if (!owner) {
        note.innerHTML = '<div class="alert alert-info">' +
          "你是<b>负责老师</b>：可以看全校活动的报名名单、给分配给自己的活动签到并录入义工小时；" +
          "活动、刊物、公告的编辑只有执委会能操作。要开通更多权限，请让执委会在「人员管理」里把你的角色改成执委会。" +
          "</div>";
      }
    }

    /* 活动表单里只有执委会能改的东西：新建/编辑活动整块表单对老师隐藏 */
    var formPanel = $("act-form-panel");
    if (formPanel) formPanel.hidden = !owner;
    var managerSel = $("a-manager");
    if (managerSel) managerSel.disabled = !owner;
    var hoursIn = $("a-hours");
    if (hoursIn) hoursIn.disabled = !owner;

    /* 报名名单里的写操作：老师只保留「签到码」和删除之外…实际上老师一律只读，
       通过/不通过/删除都不给；义工小时只有自己负责的活动才让改（在 renderRegs 里判断）。 */
    var peoForm = $("peo-form");
    if (peoForm) peoForm.hidden = !owner;

    /* 全站备份只有执委会能导完整（allowed_admins / student_directory 老师读不到） */
    var bk = $("backup-btn");
    if (bk) bk.hidden = !owner;
  }

  /* ---------------- 一键备份 ----------------
     导出的 JSON 落在自己电脑里，不占云端空间。
     万一哪天要换托管方式，拿着这个文件就能重建，不用重新录入。 */
  function runBackup() {
    var btn = $("backup-btn");
    if (!window.GUISBackup) {
      alertIn($("act-alerts"), "error", "备份模块没加载出来，刷新页面再试一次。");
      return;
    }
    busyOn(btn, "导出中…");
    window.GUISBackup.run({ by: ME.email }).then(function (r) {
      busyOff(btn);
      alertIn($("act-alerts"), "ok",
        "已保存到下载目录：<b>" + r.filename + "</b> · " + r.summary +
        "。建议顺手复制到网盘或U盘里 —— 这是目前唯一一份自留底。");
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("act-alerts"), "error", "备份失败：" + ((err && err.message) || "请稍后重试"));
    });
  }
  var bkBtn = $("backup-btn");
  if (bkBtn) bkBtn.addEventListener("click", runBackup);

  function showSignedIn(email) {
    ME.email = email || "";
    $("who-email").textContent = ME.email + (isOwner() ? " · 执委会" : " · 负责老师");
    loginView.hidden = true;
    appView.hidden = false;
    applyRoleUI();
    C.touchLogin();
    loadActivities();
    loadActivityOptions();
    loadManagerOptions();
    /* 板块默认负责人要先拿到，「我管不管这个活动」的判断要用它 */
    loadCatMgrMap().then(function () {
      if (isOwner()) loadCategoryManagers();
    });
  }

  function showLogin() {
    appView.hidden = true;
    loginView.hidden = false;
  }

  /* 白名单校验：邮箱不在 allowed_admins 里就立刻退出登录。
     这是服务端判断（is_allowed_admin() 是 SECURITY DEFINER 函数），
     前端拦只是为了让用户马上看到原因，真正的权限在数据库策略里。 */
  function enterOrReject(email) {
    return C.isAllowedAdmin().then(function (r) {
      var ok = !r.error && r.data === true;
      if (!ok) {
        C.auth.signOut();
        showLogin();
        alertIn($("auth-alerts"), "error",
          "该邮箱（" + esc(email) + "）还没有加入后台人员名单，请联系义工社执委会先把邮箱加进来。");
        return false;
      }
      /* 拿到角色再决定界面。my_access() 是 SECURITY DEFINER，
         普通老师也能读到自己的角色（allowed_admins 表的读策略只有执委会）。 */
      return C.myAccess().then(function (ar) {
        var row = (ar && ar.data && ar.data[0]) || {};
        ME.email = row.email || email || "";
        ME.role = row.role === "owner" ? "owner" : "teacher";
        ME.isStudent = !!row.is_student;
        ME.mustChange = !!row.must_change_password;
        showSignedIn(ME.email);
        return true;
      });
    }).catch(function () {
      C.auth.signOut();
      showLogin();
      alertIn($("auth-alerts"), "error", "权限校验失败，请重试。");
      return false;
    });
  }

  C.getSession().then(function (res) {
    var s = res && res.data;
    if (s && s.user && s.user.email) enterOrReject(s.user.email);
    else if (s && s.user) enterOrReject("");
    else showLogin();
  }).catch(showLogin);

  $("logout-btn").addEventListener("click", function () {
    C.auth.signOut().then(showLogin).catch(showLogin);
  });

  /* ---------------- 登录表单切换 ---------------- */
  /* ?setup=1 才会露出「开通账号」—— 白名单邮箱首次开通用，平时入口不存在 */
  var SETUP = new URLSearchParams(window.location.search).get("setup") === "1";
  if (SETUP) $("seg-setup").hidden = false;

  var forms = {
    password: $("form-password"),
    otp: $("form-otp"),
    setup: $("form-signup"),
    reset: $("form-reset")
  };
  function showForm(name) {
    Object.keys(forms).forEach(function (k) { forms[k].hidden = k !== name; });
    Array.prototype.forEach.call($("auth-seg").children, function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-mode") === name);
    });
    clear($("auth-alerts"));
  }
  Array.prototype.forEach.call($("auth-seg").children, function (b) {
    b.addEventListener("click", function () { showForm(b.getAttribute("data-mode")); });
  });
  $("goto-reset").addEventListener("click", function () { showForm("reset"); });
  $("back-login").addEventListener("click", function () { showForm("password"); });

  /* ---------------- 密码登录 ---------------- */
  $("form-password").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("pw-submit"), email = $("pw-email").value.trim(), pass = $("pw-pass").value;
    if (!email || !pass) { alertIn($("auth-alerts"), "error", "请填写邮箱和密码。"); return; }
    btn.disabled = true; btn.textContent = "登录中…";
    C.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      if (r.error) { btn.disabled = false; btn.textContent = "登录"; alertIn($("auth-alerts"), "error", "邮箱或密码不正确。"); return; }
      enterOrReject(email);
    }).catch(function () {
      btn.disabled = false; btn.textContent = "登录";
      alertIn($("auth-alerts"), "error", "登录失败，请稍后重试。");
    });
  });

  /* ---------------- OTP 登录 ---------------- */
  var pendingOtp = null;

  function sendCode(email, onDone) {
    if (!email) { alertIn($("auth-alerts"), "error", "请先填写邮箱。"); return; }
    C.auth.sendOtp({ email: email }).then(function (r) {
      if (r.error) { alertIn($("auth-alerts"), "error", "验证码发送失败：" + (r.error.message || "请稍后重试")); return; }
      pendingOtp = { email: email, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
      onDone();
    }).catch(function () {
      alertIn($("auth-alerts"), "error", "验证码发送失败，请稍后重试。");
    });
  }

  $("otp-send").addEventListener("click", function () {
    sendCode($("otp-email").value.trim(), function () {
      alertIn($("auth-alerts"), "ok", "验证码已发送，请查收邮箱（含垃圾邮件）。");
    });
  });

  $("form-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("otp-email").value.trim(), code = $("otp-code").value.trim();
    if (!pendingOtp || pendingOtp.email !== email) {
      alertIn($("auth-alerts"), "error", "请先为当前邮箱获取验证码。");
      return;
    }
    if (!code) { alertIn($("auth-alerts"), "error", "请填写验证码。"); return; }
    $("otp-submit").disabled = true; $("otp-submit").textContent = "验证中…";
    C.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    }).then(function (r) {
      $("otp-submit").disabled = false; $("otp-submit").textContent = "登录";
      if (r.error) { alertIn($("auth-alerts"), "error", "验证码不正确或已过期。"); return; }
      pendingOtp = null;
      enterOrReject(email);
    }).catch(function () {
      $("otp-submit").disabled = false; $("otp-submit").textContent = "登录";
      alertIn($("auth-alerts"), "error", "验证失败，请重试。");
    });
  });

  /* ---------------- 注册 ---------------- */
  $("su-send").addEventListener("click", function () {
    sendCode($("su-email").value.trim(), function () {
      alertIn($("auth-alerts"), "ok", "验证码已发送，请查收邮箱后再设置密码。");
    });
  });

  $("form-signup").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("su-email").value.trim(), pass = $("su-pass").value, code = $("su-code").value.trim();
    if (!pendingOtp || pendingOtp.email !== email) {
      alertIn($("auth-alerts"), "error", "请先为当前邮箱获取验证码。"); return;
    }
    if (!pass) { alertIn($("auth-alerts"), "error", "请设置密码。"); return; }
    if (!code) { alertIn($("auth-alerts"), "error", "请填写验证码。"); return; }

    $("su-submit").disabled = true; $("su-submit").textContent = "注册中…";
    C.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code,
      password: pendingOtp.isExistingUser ? undefined : pass
    }).then(function (r) {
      $("su-submit").disabled = false; $("su-submit").textContent = "开通账号并登录";
      if (r.error) { alertIn($("auth-alerts"), "error", "开通失败：" + (r.error.message || "请重试")); return; }
      pendingOtp = null;
      enterOrReject(email);
    }).catch(function () {
      $("su-submit").disabled = false; $("su-submit").textContent = "开通账号并登录";
      alertIn($("auth-alerts"), "error", "注册失败，请重试。");
    });
  });

  /* ---------------- 忘记密码 ---------------- */
  var pendingReset = null;
  $("rs-send").addEventListener("click", function () {
    var email = $("rs-email").value.trim();
    if (!email) { alertIn($("auth-alerts"), "error", "请先填写邮箱。"); return; }
    C.auth.resetPasswordForEmail(email).then(function (r) {
      if (r.error) { alertIn($("auth-alerts"), "error", "发送失败：" + (r.error.message || "请稍后重试")); return; }
      pendingReset = { email: email, handle: r.data };
      alertIn($("auth-alerts"), "ok", "验证码已发送，请查收邮箱。");
    }).catch(function () {
      alertIn($("auth-alerts"), "error", "发送失败，请稍后重试。");
    });
  });

  $("form-reset").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!pendingReset) { alertIn($("auth-alerts"), "error", "请先获取验证码。"); return; }
    var code = $("rs-code").value.trim(), pass = $("rs-pass").value;
    if (!code || !pass) { alertIn($("auth-alerts"), "error", "请填写验证码和新密码。"); return; }
    pendingReset.handle.updateUser({ nonce: code, password: pass }).then(function (r) {
      if (r.error) { alertIn($("auth-alerts"), "error", "重置失败：" + (r.error.message || "请重试")); return; }
      alertIn($("auth-alerts"), "ok", "密码已重置，正在为你登录…");
      setTimeout(function () { enterOrReject($("rs-email").value.trim()); }, 600);
    }).catch(function () {
      alertIn($("auth-alerts"), "error", "重置失败，请重试。");
    });
  });

  /* ---------------- Tab 切换 ----------------
     每个页签进场时要做的第一件事写在 onEnter 里（拉数据、启动轮询等），
     离开实时报名时要停掉定时器，否则它会一直在后台刷新。 */
  var TAB_IDS = ["acts", "calendar", "regs", "live", "archive", "journal", "announce", "people", "students"];
  var TAB_ENTER = {
    calendar: function () { if (isOwner()) loadAdminCalendar(true); },
    people: function () { if (isOwner()) { loadPeople(); loadCategoryManagers(); } },
    students: function () { if (isOwner()) loadStudents(); },
    live: function () { loadLive(true); },
    archive: function () {
      if ($("arc-activity").options.length <= 1) loadArchiveOptions();
      if ($("arc-activity").value) loadArchiveDetail();
    },
    journal: function () { loadJournalOptions(); },
    announce: function () { loadAnnouncements(); }
  };
  var TAB_LEAVE = {
    live: function () { stopLiveTimer(); }
  };
  var currentTab = "acts";

  function showTab(which) {
    if (!which) return;
    if (TAB_LEAVE[currentTab]) TAB_LEAVE[currentTab]();
    currentTab = which;
    TAB_IDS.forEach(function (id) {
      var el = $("tab-" + id);
      if (el) el.hidden = id !== which;
    });
    if (TAB_ENTER[which]) TAB_ENTER[which]();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (b) {
    b.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      showTab(b.getAttribute("data-tab"));
    });
  });

  /* ================= 活动管理 ================= */
  var editingId = null;
  var myActivities = [];

  function loadActivities() {
    $("act-list-loading").hidden = false;
    $("act-list").hidden = true;
    $("act-list").innerHTML = "";   /* 不清的话，活动被删光后旧的 DOM 还留在隐藏容器里 */
    $("act-list-empty").hidden = true;

    /* 返回这个 Promise：归档 / 取消归档之后要等列表重读完再重画详情，
       否则徽章和按钮文案会停在旧状态。 */
    return C.listMyActivities().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      myActivities = rows;
      /* 报名名单的下拉框要等这里读完才有内容 —— 以前只在 showSignedIn 里调一次，
         那时 myActivities 还是空的，下拉框就一直是空的（得点刷新才有）。 */
      loadActivityOptions();
      $("act-list-loading").hidden = true;

      if (!rows.length) { $("act-list-empty").hidden = false; return; }

      var html = "";
      rows.forEach(function (a) {
        /* 看板灯色：绿 = 报名中｜黄 = 已截止、待通知｜红 = 已邮件通知（人工标记） */
        var B = window.GUISBoard;
        var light = B ? B.lightOf(a) : "green";
        var badgeCls = a.status === "open" ? "badge-open" : a.status === "closed" ? "badge-closed" : "badge-draft";
        var badgeTxt = a.status === "open" ? "开放报名" : a.status === "closed" ? "停止报名" : "草稿";
        var when = a.starts_at ? fmtDT(a.starts_at) : "待定";
        var meta = [];
        if (a.category) meta.push(esc(a.category));
        if (a.location) meta.push(esc(a.location));
        if (a.capacity) meta.push("计划 " + a.capacity + " 人");
        if (a.signup_deadline) meta.push("截止 " + fmtDT(a.signup_deadline));

        html += '<div class="act-item">' +
          '<div class="act-main">' +
            '<div class="act-title">' + esc(a.title) +
              ' <span class="badge ' + badgeCls + '">' + badgeTxt + '</span>' +
              (B ? ' ' + B.lampHTML(light, { short: true }) : '') +
            '</div>' +
            (a.summary ? '<div class="act-summary">' + esc(a.summary) + '</div>' : '') +
            '<div class="act-meta"><span>' + when + '</span>' +
              meta.map(function (m) { return '<span>' + m + '</span>'; }).join("") +
            '</div>' +
          '</div>' +
          '<div class="act-side">' +
            '<div class="row-actions">' +
              '<button type="button" class="tbl-btn" data-edit="' + a.id + '">编辑</button>' +
              '<button type="button" class="tbl-btn" data-toggle="' + a.id + '">' + (a.status === "open" ? "停止报名" : "开放报名") + '</button>' +
              /* 红灯由后台人工点出来；再点一次撤销，回到按截止时间自动判定的绿 / 黄 */
              '<button type="button" class="tbl-btn" data-notify="' + a.id + '">' +
                (light === "red" ? "撤销邮件通知" : "标记已邮件通知") + '</button>' +
              '<button type="button" class="tbl-btn danger" data-del="' + a.id + '">删除</button>' +
            '</div>' +
            '<a class="tbl-btn" style="text-align:center;" href="signup.html?activity=' + a.id + '">查看报名页</a>' +
          '</div>' +
        '</div>';
      });
      $("act-list").innerHTML = html;
      $("act-list").hidden = false;
    }).catch(function (err) {
      $("act-list-loading").hidden = true;
      $("act-list-empty").hidden = false;
      $("act-list-empty").textContent = "读取失败：" + (err && err.message ? err.message : "");
    });
  }

  $("act-refresh").addEventListener("click", loadActivities);

  $("act-list").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;
    var editId = t.getAttribute("data-edit");
    var toggleId = t.getAttribute("data-toggle");
    var notifyId = t.getAttribute("data-notify");
    var delId = t.getAttribute("data-del");

    if (editId) {
      var a = myActivities.filter(function (x) { return String(x.id) === String(editId); })[0];
      if (!a) return;
      editingId = a.id;
      $("act-form-title").textContent = "编辑活动";
      $("act-submit").textContent = "保存修改";
      $("act-reset").hidden = false;
      $("a-title").value = a.title || "";
      $("a-summary").value = a.summary || "";
      $("a-category").value = a.category || "社区关怀";
      $("a-location").value = a.location || "";
      $("a-starts").value = toLocalInput(a.starts_at);
      $("a-ends").value = toLocalInput(a.ends_at);
      $("a-deadline").value = toLocalInput(a.signup_deadline);
      $("a-capacity").value = a.capacity || 30;
      $("a-contact").value = a.contact || "";
      $("a-status").value = a.status || "open";
      $("a-notes").value = a.notes || "";
      $("a-manager").value = a.manager_email || "";
      $("a-hours").value = (a.hours == null ? 2 : a.hours);
      clear($("act-alerts"));
      $("act-form").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (toggleId) {
      var cur = myActivities.filter(function (x) { return String(x.id) === String(toggleId); })[0];
      if (!cur) return;
      var next = cur.status === "open" ? "closed" : "open";
      clear($("act-list-alerts"));
      busyOn(t, "处理中…");
      C.updateActivity(toggleId, { status: next }).then(function (res) {
        var affected = C.unwrap(res, "更新失败") || [];
        busyOff(t);
        if (!affected.length) { alertIn($("act-list-alerts"), "error", "没有改动 —— 服务端没有更新任何一行，请刷新列表后重试。"); return; }
        alertIn($("act-list-alerts"), "ok", next === "closed" ? "已停止报名，前台报名页不再显示该活动。" : "已重新开放报名。");
        loadActivities();
        loadActivityOptions();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("act-list-alerts"), "error", failMsg(err, "更新失败"));
      });
    }

    /* 标记 / 撤销「已邮件通知」—— 即看板上的红灯，只由后台手动操作 */
    if (notifyId) {
      var na = myActivities.filter(function (x) { return String(x.id) === String(notifyId); })[0];
      if (!na) return;
      var goingRed = !(window.GUISBoard && window.GUISBoard.lightOf(na) === "red");
      clear($("act-list-alerts"));
      busyOn(t, goingRed ? "标记中…" : "撤销中…");
      C.setActivityNotified(notifyId, goingRed).then(function (res) {
        var affected = C.unwrap(res, "更新失败") || [];
        busyOff(t);
        if (!affected.length) { alertIn($("act-list-alerts"), "error", "没有改动 —— 服务端没有更新任何一行，请刷新列表后重试。"); return; }
        alertIn($("act-list-alerts"), "ok", goingRed ? "已标记为「已邮件通知」，前台看板会亮红灯。" : "已撤销，前台恢复到按截止时间判定的状态。");
        loadActivities();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("act-list-alerts"), "error", failMsg(err, "更新失败"));
      });
    }

    if (delId) {
      var target = myActivities.filter(function (x) { return String(x.id) === String(delId); })[0];
      if (!target) return;
      if (!window.confirm("确定删除活动「" + target.title + "」吗？\n该活动下的所有报名记录也会一并删除，且无法恢复。")) return;
      clear($("act-list-alerts"));
      busyOn(t, "删除中…");
      C.deleteActivity(delId).then(function (res) {
        var removed = C.unwrap(res, "删除失败") || [];
        busyOff(t);
        if (!removed.length) { alertIn($("act-list-alerts"), "error", "删除失败 —— 服务端没有删除任何一行，请刷新列表后重试。"); return; }
        alertIn($("act-list-alerts"), "ok", "已删除「" + esc(target.title) + "」。");
        if (editingId === Number(delId)) resetForm();
        loadActivities();
        loadActivityOptions();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("act-list-alerts"), "error", failMsg(err, "删除失败"));
      });
    }
  });

  function resetForm() {
    editingId = null;
    $("act-form-title").textContent = "新建义工活动";
    $("act-submit").textContent = "创建活动";
    $("act-reset").hidden = true;
    $("act-form").reset();
    $("a-capacity").value = 30;
    $("a-status").value = "open";
    $("a-manager").value = "";
    $("a-hours").value = 2;
    clear($("act-alerts"));
  }
  $("act-reset").addEventListener("click", resetForm);

  $("act-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("a-title").value.trim();
    if (!title) { alertIn($("act-alerts"), "error", "活动名称是必填的。"); return; }

    var payload = {
      title: title,
      summary: $("a-summary").value.trim() || null,
      category: $("a-category").value,
      location: $("a-location").value.trim() || null,
      starts_at: fromLocalInput($("a-starts").value),
      ends_at: fromLocalInput($("a-ends").value),
      signup_deadline: fromLocalInput($("a-deadline").value),
      capacity: parseInt($("a-capacity").value, 10) || null,
      contact: $("a-contact").value.trim() || null,
      notes: $("a-notes").value.trim() || null,
      status: $("a-status").value,
      manager_email: $("a-manager").value || null,
      hours: parseFloat($("a-hours").value)
    };
    if (isNaN(payload.hours)) payload.hours = 2;

    var btn = $("act-submit");
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = "保存中…";

    var req = editingId ? C.updateActivity(editingId, payload) : C.createActivity(payload);

    req.then(function (res) {
      var out = C.unwrap(res, "保存失败") || [];
      btn.disabled = false; btn.textContent = label;
      if (!out.length) { alertIn($("act-alerts"), "error", "没有改动 —— 服务端没有写入任何一行。只有执委会能新建或修改活动，请到「人员管理」确认你的角色。"); return; }
      alertIn($("act-alerts"), "ok", editingId ? "已保存修改。" : "活动已创建，学生现在可以在报名页看到它。");
      resetForm();
      loadActivities();
      loadActivityOptions();
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = label;
      alertIn($("act-alerts"), "error", failMsg(err, "保存失败"));
    });
  });

  /* ================= 活动日历（只有执委会能改） =================
     日历本身由 assets/calendar.js 画；这里只负责「选中某天后把那一天的活动
     列出来，让你改开始 / 结束 / 报名截止」，以及「在这一天新建活动」。
     写操作仍然走 C.updateActivity()，服务端用 is_owner() 兜底，前端藏按钮只是 UX。 */
  var adminCal = null;
  var adminCalRows = [];

  function loadAdminCalendar(force) {
    var root = $("cal-admin-root");
    if (!root) return;
    if (!isOwner()) return;
    if (adminCal && !force) { adminCal.refresh(); return; }

    $("cal-admin-loading").hidden = false;
    root.hidden = true;

    C.listMyActivities().then(function (res) {
      adminCalRows = C.unwrap(res, "读取失败") || [];
      $("cal-admin-loading").hidden = true;

      adminCal = window.GUISCalendar.create(root, {
        /* 后台不要「去报名」按钮，改成渲染可编辑的时间表单 */
        renderDay: function (list, ymd) { renderAdminDay(list, ymd); return ""; }
      });
      adminCal.setData(adminCalRows);
      root.hidden = false;
    }).catch(function (err) {
      $("cal-admin-loading").hidden = true;
      alertIn($("cal-admin-alerts"), "error", failMsg(err, "读取活动失败"));
    });
  }

  /* 选中某天后的编辑区：每条活动给三个 datetime-local 输入 + 保存 */
  function renderAdminDay(list, ymd) {
    var host = $("cal-admin-day");
    if (!host) return;
    host.hidden = false;

    if (!list.length) {
      host.innerHTML =
        '<div class="cal-day-head">' + esc(ymd) + "</div>" +
        '<div class="empty">这一天没有活动。</div>' +
        '<button type="button" class="btn btn-secondary" id="cal-admin-new" data-day="' + esc(ymd) + '">' +
          "在这一天新建活动</button>";
      wireAdminDayButtons();
      return;
    }

    host.innerHTML =
      '<div class="cal-day-head">' + esc(ymd) + " · " + list.length + " 个活动</div>" +
      '<div class="cal-day-list">' + list.map(function (a) {
        return '<div class="cal-item" data-id="' + a.id + '">' +
          '<div class="cal-item-top">' +
            '<span class="cal-item-title">' + esc(a.title || "") + "</span>" +
            (window.GUISBoard ? window.GUISBoard.lampOf(a) : "") +
          "</div>" +
          '<div class="cal-edit-grid">' +
            "<label>开始<input type=\"datetime-local\" data-f=\"starts_at\" value=\"" + esc(toLocalInput(a.starts_at)) + "\" /></label>" +
            "<label>结束<input type=\"datetime-local\" data-f=\"ends_at\" value=\"" + esc(toLocalInput(a.ends_at)) + "\" /></label>" +
            "<label>报名截止<input type=\"datetime-local\" data-f=\"signup_deadline\" value=\"" + esc(toLocalInput(a.signup_deadline)) + "\" /></label>" +
          "</div>" +
          '<div class="cal-item-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-save="' + a.id + '">保存</button>' +
          "</div>" +
        "</div>";
      }).join("") + "</div>" +
      '<button type="button" class="btn btn-secondary" id="cal-admin-new" data-day="' + esc(ymd) + '">' +
        "在这一天新建活动</button>";

    wireAdminDayButtons();
  }

  function wireAdminDayButtons() {
    var host = $("cal-admin-day");
    if (!host || host.dataset.bound) return;
    host.dataset.bound = "1";

    host.addEventListener("click", function (e) {
      var saveBtn = e.target.closest ? e.target.closest("[data-save]") : null;
      if (saveBtn) { saveActivityDates(saveBtn); return; }

      var newBtn = e.target.closest ? e.target.closest("#cal-admin-new") : null;
      if (newBtn) { newActivityOn(newBtn.getAttribute("data-day")); return; }
    });
  }

  function saveActivityDates(btn) {
    var id = btn.getAttribute("data-save");
    var item = btn.closest(".cal-item");
    if (!item) return;

    var patch = {};
    ["starts_at", "ends_at", "signup_deadline"].forEach(function (f) {
      var input = item.querySelector('[data-f="' + f + '"]');
      patch[f] = fromLocalInput(input ? input.value : "");
    });

    clear($("cal-admin-alerts"));
    busyOn(btn, "保存中…");
    C.updateActivity(id, patch).then(function (res) {
      var rows = C.unwrap(res, "保存失败") || [];
      busyOff(btn);
      if (!rows.length) {
        alertIn($("cal-admin-alerts"), "error", "没有改动 —— 服务端没有更新任何一行，请刷新后重试。");
        return;
      }
      alertIn($("cal-admin-alerts"), "ok", "已保存。");
      /* 活动列表和活动下拉也要跟着变 */
      loadActivities();
      loadActivityOptions();
      loadAdminCalendar(true);
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("cal-admin-alerts"), "error", failMsg(err, "保存失败"));
    });
  }

  /* 在选中的这天新建活动：把开始时间填进「活动管理」的表单并切过去 */
  function newActivityOn(ymd) {
    if (!isOwner()) return;
    showTab("acts");
    Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (x) {
      x.classList.toggle("is-on", x.getAttribute("data-tab") === "acts");
    });
    var starts = $("a-starts");
    if (starts) {
      starts.value = ymd ? ymd + "T09:00" : "";
      var ends = $("a-ends");
      if (ends) ends.value = ymd ? ymd + "T11:00" : "";
      var formPanel = $("act-form-panel");
      if (formPanel) formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      starts.focus();
    }
  }

  $("cal-refresh").addEventListener("click", function () { loadAdminCalendar(true); });

  /* ================= 报名名单 ================= */
  var regRows = [];

  function loadActivityOptions() {
    var sel = $("reg-activity");
    var keep = sel.value;
    sel.innerHTML = '<option value="">选择活动…</option>';
    myActivities.forEach(function (a) {
      var o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.title + (a.status === "open" ? "" : "（" + (a.status === "draft" ? "草稿" : "已停止报名") + "）");
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  }

  function currentFilter() {
    var q = $("reg-search").value.trim().toLowerCase();
    var st = $("reg-status-filter").value;
    return regRows.filter(function (r) {
      if (st && r.status !== st) return false;
      if (!q) return true;
      return [r.name, r.email, r.student_id, r.phone].join(" ").toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ---------- 这个活动归谁管 ----------
     单个活动上指定的 manager_email 优先，没有就用板块默认负责人。
     执委会管所有活动；负责老师只能动分配给自己的活动。 */
  var catMgrs = {};

  function loadCatMgrMap() {
    return C.listCategoryManagers().then(function (res) {
      catMgrs = {};
      (C.unwrap(res, "读取失败") || []).forEach(function (c) {
        if (c.email) catMgrs[c.category] = c.email;
      });
    }).catch(function () { catMgrs = {}; });
  }

  function effectiveManager(a) {
    if (!a) return "";
    return a.manager_email || catMgrs[a.category] || "";
  }
  function iManage(a) {
    if (isOwner()) return true;
    var m = effectiveManager(a);
    return !!m && String(m).toLowerCase() === String(ME.email || "").toLowerCase();
  }
  function currentActivity() {
    var id = $("reg-activity").value;
    return myActivities.filter(function (x) { return String(x.id) === String(id); })[0] || null;
  }
  function canManageCurrent() { return iManage(currentActivity()); }

  function fmtH(n) {
    if (n == null || isNaN(Number(n))) return "0";
    return String(Math.round(Number(n) * 100) / 100);
  }

  /* 小时格子：能管的给输入框（留空 = 用活动默认时长），不能管的显示只读文本。 */
  function hoursCell(r) {
    var act = currentActivity();
    var def = act && act.hours != null ? Number(act.hours) : 0;
    var val = r.hours != null ? Number(r.hours) : null;
    if (!canManageCurrent()) {
      return '<span class="ci-no">' + fmtH(val != null ? val : def) + " 小时" +
        (val == null ? "（默认）" : "") + "</span>";
    }
    return '<input type="number" class="hours-in" min="0" step="0.5" value="' +
      (val != null ? val : "") + '" placeholder="' + fmtH(def) + '" title="留空 = 用活动默认时长" data-hours="' + r.id + '" />';
  }

  /* ---------- 勾选录取 ----------
     picked 是「当前勾中了谁」的一份临时状态（id → true）。
     每次重新读取报名时用它自己记的 selected 字段回填，
     所以上次保存过的录取结果会显示成已勾选，可以直接在此基础上增删。 */
  var picked = {};

  function pickedIds() {
    return Object.keys(picked).filter(function (k) { return picked[k]; }).map(Number);
  }
  /* 导出用的行：勾选 ∩ 当前筛选（搜索框 / 状态筛选依然生效） */
  function pickedRows() {
    var set = {};
    pickedIds().forEach(function (id) { set[id] = true; });
    return currentFilter().filter(function (r) { return set[r.id]; });
  }

  function syncPickBar() {
    var bar = $("pick-bar");
    if (!bar) return;
    var total = currentFilter().length;
    var n = pickedRows().length;
    bar.hidden = !regRows.length;
    $("pick-count").textContent = String(n);
    $("pick-total").textContent = String(total);

    var cap = currentActivityCapacity();
    var capEl = $("pick-capacity");
    if (capEl) {
      capEl.textContent = cap ? "（计划招募 " + cap + " 人" + (n > cap ? " · 已超出 " + (n - cap) + " 人" : "") + "）" : "";
      /* 超出名额是「警告」语义，用和 .alert-error 同一支的 --danger，不跟品牌色走 */
      capEl.style.color = (cap && n > cap) ? "var(--danger, #C0392B)" : "";
    }
    /* 表头的全选框：全选打勾、部分选中打横杠 */
    var all = $("pick-all");
    if (all) {
      all.checked = total > 0 && n === total;
      all.indeterminate = n > 0 && n < total;
    }
  }

  function currentActivityCapacity() {
    var id = $("reg-activity").value;
    var a = myActivities.filter(function (x) { return String(x.id) === String(id); })[0];
    return a && a.capacity ? a.capacity : 0;
  }

  function renderRegs() {
    var rows = currentFilter();
    var body = $("reg-body");
    if (!rows.length) {
      $("reg-table-wrap").hidden = true;
      $("reg-empty").hidden = false;
      $("reg-empty").textContent = regRows.length ? "没有符合筛选条件的报名记录。" : "这个活动还没有人报名。";
      $("reg-count").textContent = regRows.length ? "共 " + regRows.length + " 条记录" : "";
      syncPickBar();
      return;
    }
    $("reg-empty").hidden = true;
    $("reg-table-wrap").hidden = false;

    body.innerHTML = rows.map(function (r, i) {
      var on = !!picked[r.id];
      return '<tr class="' + (on ? "is-picked" : "") + '" data-row="' + r.id + '">' +
        '<td class="pick-cell"><input type="checkbox" data-pick="' + r.id + '"' + (on ? " checked" : "") + " /></td>" +
        '<td class="num">' + (i + 1) + "</td>" +
        "<td>" + esc(r.name) + (r.selected ? '<span class="roster-flag">已录取</span>' : "") + "</td>" +
        "<td>" + esc(r.email) + "</td>" +
        "<td>" + esc(r.phone) + "</td>" +
        "<td>" + esc(r.grade) + "</td>" +
        "<td>" + esc(r.programme) + "</td>" +
        "<td>" + esc(r.student_id) + "</td>" +
        "<td>" + esc(r.slot) + "</td>" +
        "<td>" + esc(r.experience) + "</td>" +
        "<td>" + esc(r.note) + "</td>" +
        '<td><span class="badge ' + statusClass(r.status) + '">' + statusLabel(r.status) + "</span></td>" +
        "<td>" + (r.checked_in
          ? '<span class="ci-yes">已签到</span><span class="ci-when">' + fmtDT(r.checked_in_at) + "</span>"
          : '<span class="ci-no">未签到</span>') + "</td>" +
        "<td>" + hoursCell(r) + "</td>" +
        "<td>" + fmtDT(r.created_at) + "</td>" +
        '<td><div class="row-actions">' +
          /* 录取与删除只有执委会能操作；老师一律只读。 */
          (isOwner()
            ? '<button type="button" class="tbl-btn ok" data-approve="' + r.id + '">通过</button>' +
              '<button type="button" class="tbl-btn" data-reject="' + r.id + '">不通过</button>'
            : "") +
          '<button type="button" class="tbl-btn" data-qr="' + r.id + '">签到码</button>' +
          (isOwner()
            ? '<button type="button" class="tbl-btn danger" data-delreg="' + r.id + '">删除</button>'
            : "") +
        "</div></td>" +
      "</tr>";
    }).join("");

    var n = { pending: 0, approved: 0, rejected: 0 };
    var sel = 0;
    regRows.forEach(function (r) {
      n[r.status] = (n[r.status] || 0) + 1;
      if (r.selected) sel += 1;
    });
    $("reg-count").textContent = "共 " + regRows.length + " 条记录 · 待确认 " + n.pending +
      " · 已通过 " + n.approved + " · 未通过 " + n.rejected + (sel ? " · 已录取 " + sel : "");
    syncPickBar();
  }

  function loadRegs() {
    var id = $("reg-activity").value;
    regRows = [];
    picked = {};
    $("reg-table-wrap").hidden = true;
    $("reg-empty").hidden = true;
    clear($("reg-alerts"));
    syncPickBar();

    if (!id) {
      $("reg-empty").hidden = false;
      $("reg-empty").textContent = "请先在上方选择一个活动。";
      $("reg-count").textContent = "";
      return;
    }

    $("reg-loading").hidden = false;
    C.listRegistrations(id).then(function (res) {
      regRows = C.unwrap(res, "读取失败") || [];
      /* 用库里已存的 selected 回填勾选状态：上次保存过的录取结果直接显示成已勾选 */
      regRows.forEach(function (r) { if (r.selected) picked[r.id] = true; });
      $("reg-loading").hidden = true;
      renderRegs();
    }).catch(function (err) {
      $("reg-loading").hidden = true;
      $("reg-empty").hidden = false;
      $("reg-empty").textContent = "读取失败：" + (err && err.message ? err.message : "");
    });
  }

  $("reg-activity").addEventListener("change", loadRegs);
  $("reg-search").addEventListener("input", renderRegs);
  $("reg-status-filter").addEventListener("change", renderRegs);

  $("reg-body").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;

    var approve = t.getAttribute("data-approve");
    var reject = t.getAttribute("data-reject");
    var del = t.getAttribute("data-delreg");

    function setStatus(id, st) {
      clear($("reg-alerts"));
      busyOn(t, "处理中…");
      C.setRegistrationStatus(id, st).then(function (res) {
        var out = C.unwrap(res, "更新失败") || [];
        busyOff(t);
        if (!out.length) { alertIn($("reg-alerts"), "error", "没有改动 —— 服务端没有更新任何一行，请确认登录邮箱已在「白名单」页签里。"); return; }
        loadRegs();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("reg-alerts"), "error", failMsg(err, "更新失败"));
      });
    }

    if (approve) setStatus(approve, "approved");
    if (reject) setStatus(reject, "rejected");

    /* 看这个人的签到码。老数据可能还没生成过码，这里顺手补一个。 */
    var qr = t.getAttribute("data-qr");
    if (qr) {
      var qrow = regRows.filter(function (r) { return String(r.id) === String(qr); })[0];
      if (qrow) {
        busyOn(t, "…");
        clear($("reg-alerts"));
        var ready = qrow.check_token
          ? Promise.resolve(qrow.check_token)
          : C.ensureCheckToken(qrow.id).then(function (tok) { qrow.check_token = tok; return tok; });
        ready.then(function (tok) {
          busyOff(t);
          window.GUISQR.showOne({
            title: qrow.name + " 的签到码",
            sub: "活动现场出示这张码给老师扫即可签到；也可以打印出来发下去。",
            name: qrow.name,
            sub2: [qrow.grade, qrow.student_id].filter(Boolean).join(" · "),
            token: tok,
            size: 240
          });
        }).catch(function (err) {
          busyOff(t);
          alertIn($("reg-alerts"), "error", failMsg(err, "取签到码失败"));
        });
      }
    }

    if (del) {
      if (!window.confirm("确定删除这条报名记录吗？该操作无法撤销。")) return;
      clear($("reg-alerts"));
      busyOn(t, "删除中…");
      C.deleteRegistration(del).then(function (res) {
        var out = C.unwrap(res, "删除失败") || [];
        busyOff(t);
        if (!out.length) { alertIn($("reg-alerts"), "error", "删除失败 —— 服务端没有删除任何一行，请确认登录邮箱已在「白名单」页签里。"); return; }
        loadRegs();
        /* loadRegs 开头会 clear(reg-alerts)，所以成功提示必须在它之后再写 */
        alertIn($("reg-alerts"), "ok", "已删除该条报名记录。");
      }).catch(function (err) {
        busyOff(t);
        alertIn($("reg-alerts"), "error", failMsg(err, "删除失败"));
      });
    }
  });

  /* ================= 人员管理 =================
     role：owner = 执委会（能改活动 / 刊物 / 公告 / 人员）
           teacher = 负责老师（能看名单、给分配给自己的活动签到、录小时）
     is_student：这个人同时也是义工社学生成员（既是后台所有者又是学生）。 */
  var CATEGORIES = ["学生事务处活动(SAO)", "教务处活动(AO)", "升学指导办公室活动(CAS)", "公益募捐", "未被框定(NTCLASSIFIED)"];

  function roleLabel(r) { return r === "owner" ? "执委会" : "负责老师"; }
  function roleClass(r) { return r === "owner" ? "st-approved" : "st-pending"; }

  function loadPeople() {
    var body = $("peo-body");
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-subtle);"><span class="loading"></span> 读取中…</td></tr>';
    clear($("peo-alerts"));

    C.listMembers().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-subtle);">还没有任何成员。</td></tr>';
        $("peo-stats").innerHTML = "";
        $("peo-count").textContent = "";
        return;
      }
      var me = String(ME.email || "").toLowerCase();
      var nOwner = rows.filter(function (r) { return r.role === "owner"; }).length;
      var nTeacher = rows.filter(function (r) { return r.role !== "owner"; }).length;
      var nStudent = rows.filter(function (r) { return r.is_student; }).length;
      var nBoth = rows.filter(function (r) { return r.is_student && r.role === "owner"; }).length;

      $("peo-stats").innerHTML =
        stat("共 " + rows.length + " 人", "", "is-plain") +
        stat(nOwner, "执委会（可编辑）") +
        stat(nTeacher, "负责老师（只读 + 签到）") +
        stat(nStudent, "同时是学生") +
        stat(nBoth, "既是学生又是执委会");

      body.innerHTML = rows.map(function (r) {
        var isMe = String(r.email).toLowerCase() === me;
        var tags = ['<span class="badge ' + roleClass(r.role) + '">' + roleLabel(r.role) + "</span>"];
        if (r.is_student) tags.push('<span class="badge st-pending">学生</span>');
        if (r.must_change_password) tags.push('<span class="badge badge-draft">待改密码</span>');
        return "<tr>" +
          "<td>" + esc(r.email) + (isMe ? '<span class="roster-flag">我</span>' : "") + "</td>" +
          "<td>" + roleLabel(r.role) + "</td>" +
          "<td>" + tags.join(" ") + "</td>" +
          "<td>" + esc(r.note) + "</td>" +
          "<td>" + fmtDT(r.last_login_at) + "</td>" +
          '<td><div class="row-actions">' +
            '<button type="button" class="tbl-btn" data-role-toggle="' + esc(r.email) + '" data-now="' + esc(r.role) + '">' +
              (r.role === "owner" ? "改为老师" : "提为执委会") + "</button>" +
            '<button type="button" class="tbl-btn" data-open-acct="' + esc(r.email) + '">开通账号</button>' +
            (isMe ? "" : '<button type="button" class="tbl-btn danger" data-delmember="' + esc(r.email) + '">移除</button>') +
          "</div></td>" +
        "</tr>";
      }).join("");

      $("peo-count").textContent = "共 " + rows.length + " 人 · 执委会 " + nOwner +
        " · 负责老师 " + nTeacher + " · 同时是学生 " + nStudent +
        (nBoth ? "（其中 " + nBoth + " 人既是学生又是执委会）" : "");
    }).catch(function (err) {
      body.innerHTML = "";
      alertIn($("peo-alerts"), "error", "读取失败：" + failMsg(err));
    });
  }

  function stat(n, label, cls) {
    return '<div class="peo-stat ' + (cls || "") + '">' +
      '<span class="peo-sv">' + esc(n) + "</span>" +
      '<span class="peo-sl">' + esc(label) + "</span></div>";
  }

  $("peo-refresh").addEventListener("click", loadPeople);

  $("peo-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("peo-email").value.trim().toLowerCase();
    if (!email) { alertIn($("peo-alerts"), "error", "请填写邮箱。"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alertIn($("peo-alerts"), "error", "邮箱格式看起来不对。"); return; }

    var initial = $("peo-initial").value.trim();
    var btn = $("peo-submit");
    btn.disabled = true;

    C.addMember({
      email: email,
      note: $("peo-note").value.trim() || null,
      role: $("peo-role").value === "owner" ? "owner" : "teacher",
      is_student: $("peo-is-student").checked,
      must_change_password: !!initial
    }).then(function (res) {
      C.unwrap(res, "添加失败");
      btn.disabled = false;
      $("peo-email").value = "";
      $("peo-note").value = "";
      $("peo-initial").value = "";
      $("peo-is-student").checked = false;
      alertIn($("peo-alerts"), "ok", "已加入人员名单：" + esc(email) +
        "。下一步点列表里的「开通账号」给 TA 开一个能登录的账号。");
      loadPeople();
    }).catch(function (err) {
      btn.disabled = false;
      if (err && err.code === "23505") alertIn($("peo-alerts"), "warn", "这个邮箱已经在名单里了。");
      else alertIn($("peo-alerts"), "error", "添加失败：" + failMsg(err));
    });
  });

  /* ---------------- 开通账号 / 设初始密码 ----------------
     云服务没有「后台建号」的接口，只能：发验证码到对方邮箱 → 验码 → signUp(密码)。
     所以填了初始密码就得让对方把收到的 6 位验证码告诉我们（当面或电话都行）。
     ⚠️ signUp() 会把当前会话切到新账号上，所以开通完必须退出、让执委会重新登录。 */
  var openAcct = { email: "", verificationId: "", isExistingUser: false };

  function paintOpenBox(html) { $("peo-alerts").innerHTML = html; }

  function startOpenAcct(email, btn) {
    openAcct = { email: email, verificationId: "", isExistingUser: false };
    busyOn(btn, "发送中…");
    C.auth.sendOtp({ email: email }).then(function (r) {
      busyOff(btn);
      if (r.error) { alertIn($("peo-alerts"), "error", "验证码发送失败：" + (r.error.message || "请稍后重试")); return; }
      openAcct.verificationId = r.data.verificationId;
      openAcct.isExistingUser = r.data.isExistingUser;
      paintOpenBox(
        '<div class="alert alert-info">' +
        "<b>为 " + esc(email) + " 开通账号</b><br />" +
        "验证码已发到这个邮箱。请让对方把收到的 6 位验证码告诉你，填在下面。" +
        '<div class="peo-open-row">' +
        '<input id="peo-code" type="text" inputmode="numeric" placeholder="对方邮箱里的 6 位验证码" />' +
        '<input id="peo-pw" type="text" placeholder="给 TA 设的初始密码" />' +
        '<button type="button" class="btn btn-primary" id="peo-open-go" style="padding:0.42rem 0.9rem;font-size:0.82rem;">开通并设密码</button>' +
        "</div></div>");
      $("peo-open-go").addEventListener("click", function () { doOpenAcct(this); });
    }).catch(function () {
      busyOff(btn);
      alertIn($("peo-alerts"), "error", "验证码发送失败，请稍后重试。");
    });
  }

  function doOpenAcct(btn) {
    var code = String($("peo-code").value || "").trim();
    var pw = String($("peo-pw").value || "").trim();
    if (!code || !pw) { paintOpenBox('<div class="alert alert-error">验证码和初始密码都要填。</div>'); return; }
    busyOn(btn, "开通中…");
    C.auth.verifyOtp({
      email: openAcct.email,
      verificationId: openAcct.verificationId,
      isExistingUser: openAcct.isExistingUser,
      token: code
    }).then(function (r) {
      if (r.error) { busyOff(btn); paintOpenBox('<div class="alert alert-error">验证码不正确或已过期。</div>'); return; }
      var vt = r.data && r.data.verificationToken;
      if (!vt) { busyOff(btn); paintOpenBox('<div class="alert alert-error">没有拿到开通凭证，请重试。</div>'); return; }
      return C.auth.signUp({ email: openAcct.email, password: pw, verificationToken: vt }).then(function (s) {
        if (s.error) { busyOff(btn); paintOpenBox('<div class="alert alert-error">开通失败：' + esc(s.error.message || "") + "</div>"); return; }
        C.updateMember(openAcct.email, { must_change_password: true }).catch(function () {});
        /* signUp 已经把会话切成对方了，必须退出，否则接下来所有操作都是 TA 的身份 */
        return C.auth.signOut().then(function () {
          showLogin();
          alertIn($("auth-alerts"), "ok",
            "已为 " + esc(openAcct.email) + " 开通账号，初始密码：" + esc(pw) +
            "。出于安全，刚才已自动退出，请用你自己的账号重新登录。对方首次登录会被要求改密码。");
        });
      });
    }).catch(function (err) {
      busyOff(btn);
      paintOpenBox('<div class="alert alert-error">开通失败：' + esc(err && err.message) + "</div>");
    });
  }

  $("peo-body").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;

    var toggle = t.getAttribute("data-role-toggle");
    if (toggle) {
      var now = t.getAttribute("data-now");
      var next = now === "owner" ? "teacher" : "owner";
      if (String(toggle).toLowerCase() === String(ME.email || "").toLowerCase() && next === "teacher") {
        alertIn($("peo-alerts"), "warn", "不能把自己的角色降成负责老师 —— 否则你会立刻失去这个页面的权限。");
        return;
      }
      busyOn(t, "…");
      C.updateMember(toggle, { role: next }).then(function (res) {
        busyOff(t);
        var out = C.unwrap(res, "修改失败") || [];
        if (!out.length) { alertIn($("peo-alerts"), "error", "没有改动 —— 只有执委会能改角色。"); return; }
        loadPeople();
        alertIn($("peo-alerts"), "ok", esc(toggle) + " 已改为" + roleLabel(next) + "。");
      }).catch(function (err) { busyOff(t); alertIn($("peo-alerts"), "error", "修改失败：" + failMsg(err)); });
      return;
    }

    var openMail = t.getAttribute("data-open-acct");
    if (openMail) { startOpenAcct(openMail, t); return; }

    var delMail = t.getAttribute("data-delmember");
    if (delMail) {
      if (!window.confirm("确定把 " + delMail + " 移出人员名单吗？\n\n移除后对方会立刻失去后台访问权限（其已创建的活动与报名数据不会被删除）。")) return;
      C.removeMember(delMail).then(function () {
        alertIn($("peo-alerts"), "ok", "已移出人员名单。");
        loadPeople();
      }).catch(function (err) {
        alertIn($("peo-alerts"), "error", "移除失败：" + failMsg(err));
      });
    }
  });

  /* ---------------- 板块默认负责老师 ---------------- */
  function loadManagerOptions() {
    var sel = $("a-manager");
    if (!sel) return;
    C.listMembers().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      var cur = sel.value;
      sel.innerHTML = '<option value="">（用板块默认负责人）</option>' +
        rows.map(function (r) {
          return '<option value="' + esc(r.email) + '">' + esc(r.email) +
            "（" + roleLabel(r.role) + "）</option>";
        }).join("");
      sel.value = cur;
    }).catch(function () { /* 老师读不到成员表，下拉保持空即可 */ });
  }

  function loadCategoryManagers() {
    var box = $("cat-rows");
    if (!box) return;
    C.listMembers().then(function (mr) {
      var people = C.unwrap(mr, "读取失败") || [];
      return C.listCategoryManagers().then(function (cr) {
        var map = {};
        (C.unwrap(cr, "读取失败") || []).forEach(function (c) {
          map[c.category] = c.email || "";
          if (c.email) catMgrs[c.category] = c.email;
        });
        box.innerHTML = CATEGORIES.map(function (c) {
          return '<div class="field"><label>' + esc(c) + "</label>" +
            '<select data-cat="' + esc(c) + '">' +
            '<option value="">（未指定）</option>' +
            people.map(function (p) {
              var on = String(p.email).toLowerCase() === String(map[c] || "").toLowerCase();
              return '<option value="' + esc(p.email) + '"' + (on ? " selected" : "") + ">" +
                esc(p.email) + "</option>";
            }).join("") +
            "</select></div>";
        }).join("");
      });
    }).catch(function (err) {
      alertIn($("cat-alerts"), "error", "读取失败：" + failMsg(err));
    });
  }

  $("cat-save").addEventListener("click", function () {
    var btn = this;
    var jobs = [];
    Array.prototype.forEach.call(document.querySelectorAll("#cat-rows select"), function (s) {
      jobs.push(C.setCategoryManager(s.getAttribute("data-cat"), s.value || null));
    });
    busyOn(btn, "保存中…");
    Promise.all(jobs.map(function (p) {
      return p.then(function (r) { C.unwrap(r, "保存失败"); return true; },
                    function (e) { return e; });
    })).then(function (outs) {
      busyOff(btn);
      var bad = outs.filter(function (o) { return o !== true; });
      if (bad.length) alertIn($("cat-alerts"), "error", "有 " + bad.length + " 项没保存成功（只有执委会能改）。");
      else alertIn($("cat-alerts"), "ok", "板块默认负责人已保存。");
    });
  });

  /* ================= 学生名单 ================= */
  var studentRows = [];

  function loadStudents() {
    var body = $("stu-body");
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-subtle);"><span class="loading"></span> 读取中…</td></tr>';
    C.listStudents().then(function (res) {
      studentRows = C.unwrap(res, "读取失败") || [];
      renderStudents();
    }).catch(function (err) {
      body.innerHTML = "";
      alertIn($("stu-alerts"), "error", "读取失败：" + failMsg(err));
    });
  }

  function renderStudents() {
    var body = $("stu-body");
    var q = String($("stu-search").value || "").trim().toLowerCase();
    var list = studentRows.filter(function (r) {
      if (!q) return true;
      return [r.email, r.name, r.student_id, r.grade].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-subtle);">' +
        (studentRows.length ? "没有匹配的人。" : "名单还是空的 —— 用上面的框批量导入。") + "</td></tr>";
      $("stu-count").textContent = "";
      return;
    }
    body.innerHTML = list.slice(0, 400).map(function (r) {
      return "<tr>" +
        "<td>" + esc(r.email) + "</td>" +
        "<td>" + esc(r.name) + "</td>" +
        "<td>" + esc(r.grade) + "</td>" +
        "<td>" + esc(r.student_id) + "</td>" +
        "<td>" + (r.activated ? '<span class="ci-yes">已开通</span>' : '<span class="ci-no">未开通</span>') + "</td>" +
        '<td><div class="row-actions">' +
          '<button type="button" class="tbl-btn danger" data-delstudent="' + esc(r.email) + '">移除</button>' +
        "</div></td>" +
      "</tr>";
    }).join("");
    var nOn = studentRows.filter(function (r) { return r.activated; }).length;
    $("stu-count").textContent = "共 " + studentRows.length + " 个邮箱 · 已开通 " + nOn +
      " · 未开通 " + (studentRows.length - nOn) +
      (list.length > 400 ? "（只显示前 400 条，用搜索缩小范围）" : "");
  }

  $("stu-refresh").addEventListener("click", loadStudents);
  $("stu-search").addEventListener("input", renderStudents);

  $("stu-import").addEventListener("click", function () {
    var raw = $("stu-paste").value || "";
    var lines = raw.split(/\r?\n/);
    var rows = [];
    var bad = 0;
    lines.forEach(function (ln) {
      var parts = ln.split(/[,\t，]/).map(function (s) { return s.trim(); });
      var email = (parts[0] || "").toLowerCase();
      if (!email) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { bad++; return; }
      rows.push({
        email: email,
        name: parts[1] || null,
        grade: parts[2] || null,
        student_id: parts[3] || null
      });
    });
    if (!rows.length) {
      alertIn($("stu-alerts"), "error", "没解析出任何有效邮箱。每行一条：邮箱, 姓名, 年级, 学号");
      return;
    }
    var btn = this;
    busyOn(btn, "导入中…");
    C.importStudents(rows).then(function (res) {
      busyOff(btn);
      C.unwrap(res, "导入失败");
      $("stu-paste").value = "";
      alertIn($("stu-alerts"), "ok", "已导入 " + rows.length + " 个邮箱" +
        (bad ? "（另 " + bad + " 行格式不对，已跳过）" : "") + "。");
      loadStudents();
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("stu-alerts"), "error", "导入失败：" + failMsg(err));
    });
  });

  $("stu-body").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;
    var mail = t.getAttribute("data-delstudent");
    if (!mail) return;
    if (!window.confirm("把 " + mail + " 从学生名单里移除？\n\n移除后这个邮箱将无法再开通学生账号（已开通的账号不受影响）。")) return;
    C.deleteStudent(mail).then(function () {
      alertIn($("stu-alerts"), "ok", "已移除。");
      loadStudents();
    }).catch(function (err) {
      alertIn($("stu-alerts"), "error", "移除失败：" + failMsg(err));
    });
  });

  /* ================= 导出 Excel ================= */
  function safeName(s) {
    return String(s || "报名名单").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  }
  function currentActivityTitle() {
    var id = $("reg-activity").value;
    var a = myActivities.filter(function (x) { return String(x.id) === String(id); })[0];
    return a ? a.title : "";
  }
  function toRows(list) {
    var rows = list || currentFilter();
    return rows.map(function (r, i) {
      return {
        "序号": i + 1,
        "姓名": r.name || "",
        "邮箱": r.email || "",
        "手机号": r.phone || "",
        "年级": r.grade || "",
        "课程体系": r.programme || "",
        "学号": r.student_id || "",
        "岗位/时段": r.slot || "",
        "相关经验": r.experience || "",
        "备注": r.note || "",
        "状态": statusLabel(r.status),
        "是否录取": r.selected ? "是" : "",
        "签到": r.checked_in ? "是" : "",
        "签到时间": fmtDT(r.checked_in_at),
        "报名时间": fmtDT(r.created_at)
      };
    });
  }

  /* 名额有限时先在这里勾选要录取的人，再点「导出所选」。
     两条导出路径（全部 / 所选）共用同一个导出流程，只差 rows 的来源。 */
  function doExport(rows, btn) {
    if (!rows.length) { alertIn($("reg-alerts"), "warn", "当前没有可导出的记录。"); return; }
    busyOn(btn, "导出中…");

    /* 模板（抬头 logo / 标题 / 落款）全在 assets/export.js 里，
       它会依次尝试 ExcelJS（完整模板）→ SheetJS（纯数据）→ CSV，回调用的哪种方式。 */
    window.GUISExport.run({
      rows: rows,
      activityTitle: currentActivityTitle(),
      signer: String($("who-email").textContent || "").trim(),   /* 经手人 = 当前登录账号 */
      fileName: safeName("报名名单_" + currentActivityTitle() + "_" +
        fmtDT(new Date().toISOString()).replace(/[: ]/g, "-"))
    }).then(function (mode) {
      busyOff(btn);
      if (mode === "template") {
        alertIn($("reg-alerts"), "ok", "已导出 " + rows.length + " 条记录到 Excel（含抬头与落款）。");
      } else if (mode === "template-nologo") {
        alertIn($("reg-alerts"), "warn", "已导出 " + rows.length + " 条记录，但 logo 没能嵌入（图片可能缺失），表格格式正常。");
      } else if (mode === "plain") {
        alertIn($("reg-alerts"), "warn", "Excel 模板组件未加载，已导出为不带抬头的纯数据表。");
      } else {
        alertIn($("reg-alerts"), "warn", "Excel 组件未加载，已改用 CSV 导出（Excel 可直接打开）。");
      }
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("reg-alerts"), "error", failMsg(err, "导出失败"));
    });
  }

  $("export-btn").addEventListener("click", function () {
    doExport(toRows(), this);
  });

  /* ---------- 全部签到码 ----------
     同学自己看不到自己的码（报名页是匿名的），所以后台一次性把录取名单的码
     全打出来：打印、截图、或者发到年级群里都行。
     缺码的老数据会在这里顺手补上，补完写回 regRows，下次打开就不用再补。 */
  $("qr-all-btn").addEventListener("click", function () {
    clear($("reg-alerts"));
    var sel = regRows.filter(function (r) { return r.selected; });
    var list = sel.length ? sel : currentFilter();
    if (!list.length) {
      alertIn($("reg-alerts"), "warn", "当前没有可生成签到码的人 —— 先选一个活动。");
      return;
    }
    var actTitle = currentActivityTitle();

    window.GUISQR.showSheet({
      title: actTitle ? actTitle + " · 签到码" : "签到码",
      sub: (sel.length ? "录取名单 " : "全部报名 ") + list.length + " 人 · 可打印或存成 PDF 发给同学",
      items: list.map(function (r) {
        return {
          id: r.id,
          name: r.name || "",
          sub: [r.grade, r.student_id].filter(Boolean).join(" · "),
          token: r.check_token || ""
        };
      }),
      ensure: function (item) {
        return C.ensureCheckToken(item.id).then(function (tok) {
          var row = regRows.filter(function (r) { return String(r.id) === String(item.id); })[0];
          if (row) row.check_token = tok;
          return tok;
        });
      }
    });
  });

  /* 跳到签到页时把当前活动带过去，老师不用再选一遍 */
  $("goto-checkin").addEventListener("click", function () {
    var id = $("reg-activity").value;
    this.href = id ? "checkin.html?a=" + encodeURIComponent(id) : "checkin.html";
  });

  $("export-picked").addEventListener("click", function () {
    var rows = pickedRows();
    if (!rows.length) { alertIn($("reg-alerts"), "warn", "还没有勾选任何人 —— 先在左边的方框里打勾。"); return; }
    doExport(toRows(rows), this);
  });

  /* ---------- 勾选交互 ---------- */
  $("pick-all").addEventListener("change", function () {
    var on = this.checked;
    currentFilter().forEach(function (r) { if (on) picked[r.id] = true; else delete picked[r.id]; });
    renderRegs();
  });

  $("pick-invert").addEventListener("click", function () {
    currentFilter().forEach(function (r) {
      if (picked[r.id]) delete picked[r.id]; else picked[r.id] = true;
    });
    renderRegs();
  });

  $("pick-none").addEventListener("click", function () {
    currentFilter().forEach(function (r) { delete picked[r.id]; });
    renderRegs();
  });

  $("reg-body").addEventListener("change", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT") return;

    /* 义工小时：留空 = 用活动默认时长。只有负责这个活动的人（或执委会）能改。 */
    var hid = t.getAttribute("data-hours");
    if (hid != null) {
      setHours(hid, t.value, t);
      return;
    }

    var id = t.getAttribute("data-pick");
    if (id == null) return;
    id = Number(id);
    if (t.checked) picked[id] = true; else delete picked[id];
    var tr = t.closest ? t.closest("tr") : null;
    if (tr) tr.classList.toggle("is-picked", t.checked);
    syncPickBar();
  });

  function setHours(id, val, input) {
    clear($("reg-alerts"));
    if (input) input.disabled = true;
    C.setHours(id, val).then(function (res) {
      C.unwrap(res, "保存失败");
      var row = regRows.filter(function (r) { return String(r.id) === String(id); })[0];
      if (row) row.hours = (val === "" || val == null) ? null : Number(val);
      if (input) input.disabled = false;
      alertIn($("reg-alerts"), "ok", val === "" ? "已恢复为活动默认时长。" : "已记为 " + Number(val) + " 小时。");
    }).catch(function (err) {
      if (input) input.disabled = false;
      alertIn($("reg-alerts"), "error", failMsg(err, "保存失败"));
    });
  }

  /* 把勾选结果写成「报名成功名单」：
     1) 清掉这个活动下所有人的录取标记
     2) 给勾中的人打上标记，并记下经手人
     3) 同时把名单快照写进 activities.roster_json —— 公开的活动详情页读的是这一份
        （匿名访客读不到 registrations，RLS 不放行，所以必须另存一份快照） */
  $("pick-save").addEventListener("click", function () {
    var id = $("reg-activity").value;
    if (!id) { alertIn($("reg-alerts"), "warn", "请先选择一个活动。"); return; }
    var ids = pickedIds();
    if (!ids.length && !window.confirm("没有勾选任何人 —— 确定要把这个活动的录取名单清空吗？")) return;

    var btn = this;
    var who = String($("who-email").textContent || "").trim();
    busyOn(btn, "保存中…");
    clear($("reg-alerts"));

    C.clearSelection(id).then(function () {
      return C.markSelected(ids, who);
    }).then(function () {
      /* 快照只放公开场合能展示的字段，手机号与邮箱不进公开页面 */
      var snapshot = regRows.filter(function (r) { return ids.indexOf(Number(r.id)) >= 0; })
        .map(function (r) {
          return { name: r.name, grade: r.grade || "", programme: r.programme || "", slot: r.slot || "" };
        });
      return C.updateActivity(id, {
        roster_json: JSON.stringify(snapshot),
        roster_at: new Date().toISOString(),
        roster_by: who || null
      });
    }).then(function () {
      loadRegs();
      /* loadRegs 开头会 clear(reg-alerts)，所以成功提示必须在它之后再写 */
      busyOff(btn);
      alertIn($("reg-alerts"), "ok", "已保存：录取 " + ids.length + " 人。活动详情页会公开显示这份名单。");
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("reg-alerts"), "error", failMsg(err, "保存失败"));
    });
  });

  /* ================= 实时报名（只读） =================
     每 30 秒拉一次所有报名，按活动分组显示。
     这一页刻意不放导出按钮 —— 它是给执委会随时瞄一眼「现在报了多少人」用的。 */
  var liveTimer = 0;
  var liveSeen = {};      /* 已经见过的人，用来给新报名的行做一次高亮 */
  var liveFirst = true;   /* 第一次进来不要整屏闪，只有之后新增的才闪 */

  function stopLiveTimer() {
    if (liveTimer) { window.clearInterval(liveTimer); liveTimer = 0; }
  }

  function loadLive(startTimer) {
    var box = $("live-body");
    if (!box) return;
    if (startTimer) {
      stopLiveTimer();
      liveTimer = window.setInterval(function () { loadLive(false); }, 30000);
    }
    $("live-status").textContent = "正在读取…";
    $("live-dot").classList.remove("is-off");

    C.listRegistrations().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      var byAct = {};
      rows.forEach(function (r) {
        var k = String(r.activity_id);
        (byAct[k] = byAct[k] || []).push(r);
      });

      var order = myActivities.slice().sort(function (a, b) {
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
      var ids = order.map(function (a) { return String(a.id); });
      /* 报名里出现了但活动列表没有的（比如已被删除）也要显示，别把数据藏起来 */
      Object.keys(byAct).forEach(function (k) { if (ids.indexOf(k) < 0) ids.push(k); });

      var html = "";
      var total = 0;
      ids.forEach(function (k) {
        var list = byAct[k];
        if (!list || !list.length) return;
        total += list.length;
        var act = myActivities.filter(function (a) { return String(a.id) === k; })[0];
        var title = act ? act.title : ("活动 #" + k);
        var cap = act && act.capacity ? " / 计划 " + act.capacity + " 人" : "";
        var sel = list.filter(function (r) { return r.selected; }).length;

        html += '<div class="live-group">' +
          '<div class="live-group-head"><h3>' + esc(title) + "</h3>" +
            '<span class="n">报名 ' + list.length + " 人" + cap + (sel ? " · 已录取 " + sel + " 人" : "") + "</span>" +
          "</div>" +
          '<div class="live-people">' +
            list.map(function (r) {
              var isNew = !liveFirst && !liveSeen[r.id];
              liveSeen[r.id] = true;
              var bits = [];
              if (r.grade) bits.push(r.grade);
              if (r.programme) bits.push(r.programme);
              if (r.slot) bits.push(r.slot);
              return '<div class="live-person' + (isNew ? " is-new" : "") + '">' +
                '<div style="min-width:0;">' +
                  '<div class="lp-name">' + esc(r.name) + (r.selected ? '<span class="roster-flag">已录取</span>' : "") + "</div>" +
                  '<div class="lp-sub">' + esc(bits.join(" · ") || r.email) + "</div>" +
                "</div>" +
              "</div>";
            }).join("") +
          "</div>" +
        "</div>";
      });

      liveFirst = false;
      if (!html) {
        box.innerHTML = '<div class="empty">还没有任何报名记录。</div>';
      } else {
        box.innerHTML = html;
      }
      $("live-status").textContent = "共 " + total + " 条报名记录";
      $("live-dot").classList.remove("is-off");
      $("live-updated").textContent = "更新于 " + fmtDT(new Date().toISOString());
    }).catch(function (err) {
      $("live-dot").classList.add("is-off");
      $("live-status").textContent = "读取失败：" + (err && err.message ? err.message : "");
      if (box && !box.innerHTML) box.innerHTML = '<div class="empty">读取失败。</div>';
    });
  }

  $("live-refresh").addEventListener("click", function () { loadLive(false); });
  $("live-auto").addEventListener("change", function () {
    if (this.checked) loadLive(true); else stopLiveTimer();
    $("live-updated").textContent = this.checked ? "" : "自动刷新已关闭";
  });

  /* ================= 过往活动 ================= */
  function loadArchiveOptions() {
    var sel = $("arc-activity");
    var keep = sel.value;
    sel.innerHTML = '<option value="">选择活动…</option>';
    myActivities.forEach(function (a) {
      var o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.title + (a.archived ? "（已归档）" : "");
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  }

  function renderArchiveDetail() {
    var id = $("arc-activity").value;
    var box = $("arc-detail");
    if (!id) { box.hidden = true; return; }
    var a = myActivities.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a) { box.hidden = true; return; }
    box.hidden = false;

    var state = $("arc-state");
    state.textContent = a.archived ? "已归档 · 公开可见" : "未归档";
    state.className = "badge " + (a.archived ? "badge-open" : "badge-draft");
    $("arc-toggle").textContent = a.archived ? "取消归档" : "归档并公开";
    $("arc-view").href = "activity.html?id=" + a.id;

    var when = a.starts_at ? fmtDT(a.starts_at) + (a.ends_at ? " → " + fmtDT(a.ends_at) : "") : "待定";
    $("arc-metrics").innerHTML = [
      ["时间", when], ["地点", a.location || "—"], ["板块", a.category || "—"],
      ["计划招募", a.capacity ? a.capacity + " 人" : "—"], ["报名人数", String(archiveRegs.length)],
      ["录取人数", String(archiveRegs.filter(function (r) { return r.selected; }).length)]
    ].map(function (m) {
      return '<div class="metric"><div class="m-label">' + esc(m[0]) + '</div><div class="m-value">' + esc(m[1]) + "</div></div>";
    }).join("");

    $("arc-reg-body").innerHTML = archiveRegs.length
      ? archiveRegs.map(function (r, i) {
          return "<tr>" +
            '<td class="num">' + (i + 1) + "</td>" +
            "<td>" + esc(r.name) + "</td>" +
            "<td>" + esc(r.email) + "</td>" +
            "<td>" + esc(r.phone) + "</td>" +
            "<td>" + esc(r.grade) + "</td>" +
            "<td>" + esc(r.programme) + "</td>" +
            "<td>" + esc(r.student_id) + "</td>" +
            "<td>" + esc(r.slot) + "</td>" +
            "<td>" + esc(r.experience) + "</td>" +
            "<td>" + esc(r.note) + "</td>" +
            '<td><span class="badge ' + statusClass(r.status) + '">' + statusLabel(r.status) + "</span></td>" +
            "<td>" + (r.selected ? '<span class="roster-flag">已录取</span>' : "—") + "</td>" +
            "<td>" + fmtDT(r.created_at) + "</td>" +
          "</tr>";
        }).join("")
      : '<tr><td colspan="13" style="text-align:center;color:var(--text-subtle);">这个活动还没有人报名。</td></tr>';

    $("arc-reg-count").textContent = String(archiveRegs.length);
    var sel = archiveRegs.filter(function (r) { return r.selected; }).length;
    $("arc-reg-hint").textContent = sel
      ? "已录取 " + sel + " 人（去「报名名单」页签可以调整）。"
      : "还没有确定录取名单 —— 在「报名名单」页签勾选后点「保存为报名成功名单」。";
  }

  var archiveRegs = [];
  var archiveEditor = null;

  function loadArchiveDetail() {
    var id = $("arc-activity").value;
    if (!id) { $("arc-detail").hidden = true; return; }
    clear($("arc-alerts"));

    if (!archiveEditor && window.GUISRich) {
      archiveEditor = window.GUISRich.create($("arc-recap-box"), { placeholder: "活动总结：做了什么、多少人参加、下次可以改进的地方…" });
    }

    C.getActivity(id).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      var a = rows[0];
      if (a && archiveEditor) archiveEditor.setHTML(a.recap_html || "");
      return C.listRegistrations(id);
    }).then(function (res) {
      archiveRegs = C.unwrap(res, "读取失败") || [];
      renderArchiveDetail();
    }).catch(function (err) {
      alertIn($("arc-alerts"), "error", "读取失败：" + (err && err.message ? err.message : ""));
    });
  }

  $("arc-activity").addEventListener("change", loadArchiveDetail);
  $("arc-refresh").addEventListener("click", function () {
    loadActivities();
    loadArchiveOptions();
    if ($("arc-activity").value) loadArchiveDetail();
  });

  $("arc-toggle").addEventListener("click", function () {
    var id = $("arc-activity").value;
    if (!id) { alertIn($("arc-alerts"), "warn", "请先选择一个活动。"); return; }
    var a = myActivities.filter(function (x) { return String(x.id) === String(id); })[0];
    var going = !(a && a.archived);
    if (going && !window.confirm("归档后这个活动会出现在主页「过往活动」区块，所有人都能看到它的详情与录取名单。确定吗？")) return;

    var btn = this;
    busyOn(btn, "处理中…");
    clear($("arc-alerts"));
    C.setArchived(id, going).then(function (res) {
      var out = C.unwrap(res, "更新失败") || [];
      busyOff(btn);
      if (!out.length) { alertIn($("arc-alerts"), "error", "没有改动 —— 服务端没有更新任何一行。"); return; }
      alertIn($("arc-alerts"), "ok", going ? "已归档，现在主页「过往活动」可以看到它了。" : "已取消归档。");
      loadActivities().then(function () {
        loadArchiveOptions();
        renderArchiveDetail();
      });
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("arc-alerts"), "error", failMsg(err, "更新失败"));
    });
  });

  $("arc-save").addEventListener("click", function () {
    var id = $("arc-activity").value;
    if (!id) { alertIn($("arc-alerts"), "warn", "请先选择一个活动。"); return; }
    var btn = this;
    busyOn(btn, "保存中…");
    clear($("arc-alerts"));
    C.setRecap(id, archiveEditor ? archiveEditor.getHTML() : "").then(function (res) {
      var out = C.unwrap(res, "保存失败") || [];
      busyOff(btn);
      if (!out.length) { alertIn($("arc-alerts"), "error", "没有改动 —— 服务端没有写入任何一行。"); return; }
      alertIn($("arc-alerts"), "ok", "总结已保存。归档后它会显示在公开的活动详情页上。");
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("arc-alerts"), "error", failMsg(err, "保存失败"));
    });
  });

  /* ================= 刊物（文章） ================= */
  var journalEditor = null;
  var editingArticleId = null;
  var journalCover = "";
  /* 编辑草稿后发表时，发布时间要记成「现在」而不是空着；
     已经发表过的文章则保留原时间，别因为改了个错别字就把发布日期重置。 */
  var editingPublishedAt = null;
  var editingWasPublished = false;

  function ensureJournalEditor() {
    if (journalEditor || !window.GUISRich) return;
    journalEditor = window.GUISRich.create($("j-body-box"), { placeholder: "正文：可以直接粘贴截图，也可以点工具栏的「图片」上传…" });
  }

  function loadJournalOptions() {
    ensureJournalEditor();
    var sel = $("j-activity");
    var keep = sel.value;
    sel.innerHTML = '<option value="">不关联</option>';
    myActivities.forEach(function (a) {
      var o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.title;
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    loadArticles();
  }

  function paintCover() {
    var box = $("j-cover-preview");
    if (!box) return;
    box.innerHTML = journalCover
      ? '<img src="' + journalCover + '" alt="" />'
      : "还没有封面";
  }

  function resetJournalForm() {
    editingArticleId = null;
    journalCover = "";
    editingPublishedAt = null;
    editingWasPublished = false;
    $("jrn-form-title").textContent = "写一篇新刊物";
    $("jrn-reset").hidden = true;
    $("j-title").value = "";
    $("j-author").value = "";
    if ($("j-activity").options.length) $("j-activity").value = "";
    if (journalEditor) journalEditor.clear();
    paintCover();
    clear($("jrn-alerts"));
  }

  function loadArticles() {
    $("jrn-list-loading").hidden = false;
    $("jrn-list").hidden = true;
    $("jrn-list-empty").hidden = true;

    C.listArticles(false).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      $("jrn-list-loading").hidden = true;
      if (!rows.length) { $("jrn-list-empty").hidden = false; return; }

      $("jrn-list").innerHTML = rows.map(function (a) {
        var when = fmtDT(a.published_at || a.created_at);
        var isPub = a.status === "published";
        return '<div class="act-item">' +
          '<div class="act-main">' +
            '<div class="act-title">' + esc(a.title) +
              ' <span class="badge ' + (isPub ? "badge-open" : "badge-draft") + '">' + (isPub ? "已发表" : "草稿") + "</span>" +
            "</div>" +
            '<div class="act-meta">' +
              (a.author ? "<span>" + esc(a.author) + "</span>" : "") +
              "<span>" + esc(when) + "</span>" +
              (a.activity_id ? "<span>关联活动 #" + a.activity_id + "</span>" : "") +
              (a.cover ? "<span>有封面</span>" : "") +
            "</div>" +
          "</div>" +
          '<div class="act-side"><div class="row-actions">' +
            '<button type="button" class="tbl-btn" data-jedit="' + a.id + '">编辑</button>' +
            (isPub
              ? '<button type="button" class="tbl-btn" data-junpub="' + a.id + '">撤回为草稿</button>'
              : '<button type="button" class="tbl-btn ok" data-jpub="' + a.id + '">发表</button>') +
            (isPub ? '<a class="tbl-btn" style="text-align:center;" href="article.html?id=' + a.id + '" target="_blank" rel="noopener">查看</a>' : "") +
            '<button type="button" class="tbl-btn danger" data-jdel="' + a.id + '">删除</button>' +
          "</div></div>" +
        "</div>";
      }).join("");
      $("jrn-list").hidden = false;
    }).catch(function (err) {
      $("jrn-list-loading").hidden = true;
      $("jrn-list-empty").hidden = false;
      $("jrn-list-empty").textContent = "读取失败：" + (err && err.message ? err.message : "");
    });
  }

  $("jrn-refresh").addEventListener("click", loadArticles);
  $("jrn-reset").addEventListener("click", resetJournalForm);

  function saveArticle(publish) {
    var title = $("j-title").value.trim();
    if (!title) { alertIn($("jrn-alerts"), "error", "标题是必填的。"); return; }
    var body = journalEditor ? journalEditor.getHTML() : "";
    if (!body.replace(/<[^>]+>/g, "").trim() && !journalCover) {
      alertIn($("jrn-alerts"), "error", "正文是空的 —— 至少写点什么再发表。");
      return;
    }

    var payload = {
      title: title,
      author: $("j-author").value.trim() || null,
      cover: journalCover || null,
      excerpt: journalEditor ? journalEditor.getText(110) : "",
      body_html: body,
      activity_id: $("j-activity").value ? Number($("j-activity").value) : null,
      status: publish ? "published" : "draft",
      updated_at: new Date().toISOString()
    };
    if (publish) {
      payload.published_at = (editingWasPublished && editingPublishedAt)
        ? editingPublishedAt
        : new Date().toISOString();
    }

    var btn = publish ? $("j-publish") : $("j-save-draft");
    busyOn(btn, publish ? "发表中…" : "保存中…");
    clear($("jrn-alerts"));

    var req = editingArticleId ? C.updateArticle(editingArticleId, payload) : C.createArticle(payload);
    req.then(function (res) {
      var out = C.unwrap(res, "保存失败") || [];
      busyOff(btn);
      if (!out.length) { alertIn($("jrn-alerts"), "error", "没有改动 —— 服务端没有写入任何一行，请确认登录邮箱已在「白名单」页签里。"); return; }
      alertIn($("jrn-alerts"), "ok",
        publish ? "已发表，现在主页「刊物」区块可以看到它了。" : "草稿已保存，只有后台看得到。");
      resetJournalForm();
      loadArticles();
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("jrn-alerts"), "error", failMsg(err, "保存失败"));
    });
  }

  $("j-publish").addEventListener("click", function () { saveArticle(true); });
  $("j-save-draft").addEventListener("click", function () { saveArticle(false); });

  $("j-cover-file").addEventListener("change", function () {
    var f = this.files && this.files[0];
    if (!f) return;
    clear($("jrn-alerts"));
    $("j-cover-preview").textContent = "处理中…";
    window.GUISRich.compressImage(f).then(function (url) {
      journalCover = url;
      paintCover();
    }).catch(function (err) {
      paintCover();
      alertIn($("jrn-alerts"), "error", "封面处理失败：" + (err && err.message ? err.message : ""));
    });
  });

  $("j-cover-from-body").addEventListener("click", function () {
    var src = journalEditor ? journalEditor.firstImage() : "";
    if (!src) { alertIn($("jrn-alerts"), "warn", "正文里还没有图片。"); return; }
    journalCover = src;
    paintCover();
  });

  $("j-cover-clear").addEventListener("click", function () {
    journalCover = "";
    paintCover();
  });

  $("jrn-list").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;
    clear($("jrn-list-alerts"));

    var editId = t.getAttribute("data-jedit");
    var pubId = t.getAttribute("data-jpub");
    var unpubId = t.getAttribute("data-junpub");
    var delId = t.getAttribute("data-jdel");

    if (editId) {
      busyOn(t, "读取中…");
      C.getArticle(editId).then(function (res) {
        var row = (C.unwrap(res, "读取失败") || [])[0];
        busyOff(t);
        if (!row) { alertIn($("jrn-list-alerts"), "error", "读取失败。"); return; }
        editingArticleId = row.id;
        journalCover = row.cover || "";
        editingPublishedAt = row.published_at || null;
        editingWasPublished = row.status === "published";
        $("jrn-form-title").textContent = "编辑刊物";
        $("jrn-reset").hidden = false;
        $("j-title").value = row.title || "";
        $("j-author").value = row.author || "";
        $("j-activity").value = row.activity_id ? String(row.activity_id) : "";
        if (journalEditor) journalEditor.setHTML(row.body_html || "");
        paintCover();
        clear($("jrn-alerts"));
        window.scrollTo(0, 0);
      }).catch(function (err) {
        busyOff(t);
        alertIn($("jrn-list-alerts"), "error", "读取失败：" + (err && err.message ? err.message : ""));
      });
      return;
    }

    function setState(id, publish) {
      busyOn(t, publish ? "发表中…" : "撤回中…");
      C.updateArticle(id, {
        status: publish ? "published" : "draft",
        published_at: publish ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      }).then(function (res) {
        var out = C.unwrap(res, "更新失败") || [];
        busyOff(t);
        if (!out.length) { alertIn($("jrn-list-alerts"), "error", "没有改动 —— 服务端没有更新任何一行。"); return; }
        alertIn($("jrn-list-alerts"), "ok", publish ? "已发表。" : "已撤回为草稿，前台不再显示。");
        loadArticles();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("jrn-list-alerts"), "error", failMsg(err, "更新失败"));
      });
    }
    if (pubId) setState(pubId, true);
    if (unpubId) setState(unpubId, false);

    if (delId) {
      if (!window.confirm("确定删除这篇刊物吗？该操作无法撤销。")) return;
      busyOn(t, "删除中…");
      C.deleteArticle(delId).then(function (res) {
        var out = C.unwrap(res, "删除失败") || [];
        busyOff(t);
        if (!out.length) { alertIn($("jrn-list-alerts"), "error", "删除失败 —— 服务端没有删除任何一行。"); return; }
        alertIn($("jrn-list-alerts"), "ok", "已删除。");
        if (String(editingArticleId) === String(delId)) resetJournalForm();
        loadArticles();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("jrn-list-alerts"), "error", failMsg(err, "删除失败"));
      });
    }
  });

  /* ================= 公告 ================= */
  var announceEditor = null;
  var editingAnnounceId = null;
  var editingAnnoPublishedAt = null;
  var editingAnnoWasPublished = false;

  function ensureAnnounceEditor() {
    if (announceEditor || !window.GUISRich) return;
    announceEditor = window.GUISRich.create($("n-body-box"), { placeholder: "公告正文：写清楚要做什么、什么时候、找谁…" });
  }

  function paintPriorityPreview() {
    var box = $("n-preview");
    if (!box) return;
    var F = window.GUISFeed;
    var p = $("n-priority").value;
    box.innerHTML = F
      ? '<div class="ann-item ann-' + p + '" style="padding:0.5rem 0.8rem;">' +
          '<div class="ann-head">' + F.prioLamp(p) + '<span class="ann-title">' + esc($("n-title").value || "公告标题") + "</span></div>" +
        "</div>"
      : '<span class="badge">' + p + "</span>";
  }

  function resetAnnounceForm() {
    editingAnnounceId = null;
    editingAnnoPublishedAt = null;
    editingAnnoWasPublished = false;
    $("ano-form-title").textContent = "发布一条公告";
    $("ano-reset").hidden = true;
    $("n-title").value = "";
    $("n-priority").value = "green";
    if (announceEditor) announceEditor.clear();
    paintPriorityPreview();
    clear($("ano-alerts"));
  }

  function loadAnnouncements() {
    ensureAnnounceEditor();
    $("ano-list-loading").hidden = false;
    $("ano-list").hidden = true;
    $("ano-list-empty").hidden = true;

    C.listAnnouncements(false).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      $("ano-list-loading").hidden = true;
      if (!rows.length) { $("ano-list-empty").hidden = false; return; }

      /* 后台列表按「红 → 黄 → 绿」再按时间排，跟前台口径一致 */
      var order = { red: 0, yellow: 1, green: 2 };
      rows.sort(function (a, b) {
        var d = (order[a.priority] || 2) - (order[b.priority] || 2);
        if (d) return d;
        return String(b.published_at || b.created_at || "").localeCompare(String(a.published_at || a.created_at || ""));
      });

      var F = window.GUISFeed;
      $("ano-list").innerHTML = rows.map(function (a) {
        var isPub = a.status === "published";
        return '<div class="act-item">' +
          '<div class="act-main">' +
            '<div class="act-title">' + esc(a.title) +
              ' <span class="badge ' + (isPub ? "badge-open" : "badge-draft") + '">' + (isPub ? "已发表" : "草稿") + "</span>" +
            "</div>" +
            '<div class="act-meta">' +
              (F ? "<span>" + F.prioLamp(a.priority) + " " + esc(F.prioLabel(a.priority)) + "</span>" : "") +
              "<span>" + esc(fmtDT(a.published_at || a.created_at)) + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="act-side"><div class="row-actions">' +
            '<button type="button" class="tbl-btn" data-nedit="' + a.id + '">编辑</button>' +
            (isPub
              ? '<button type="button" class="tbl-btn" data-nunpub="' + a.id + '">撤回为草稿</button>'
              : '<button type="button" class="tbl-btn ok" data-npub="' + a.id + '">发表</button>') +
            '<button type="button" class="tbl-btn danger" data-ndel="' + a.id + '">删除</button>' +
          "</div></div>" +
        "</div>";
      }).join("");
      $("ano-list").hidden = false;
    }).catch(function (err) {
      $("ano-list-loading").hidden = true;
      $("ano-list-empty").hidden = false;
      $("ano-list-empty").textContent = "读取失败：" + (err && err.message ? err.message : "");
    });
  }

  $("ano-refresh").addEventListener("click", loadAnnouncements);
  $("ano-reset").addEventListener("click", resetAnnounceForm);
  $("n-priority").addEventListener("change", paintPriorityPreview);
  $("n-title").addEventListener("input", paintPriorityPreview);

  function saveAnnouncement(publish) {
    var title = $("n-title").value.trim();
    if (!title) { alertIn($("ano-alerts"), "error", "标题是必填的。"); return; }

    var payload = {
      title: title,
      body_html: announceEditor ? announceEditor.getHTML() : "",
      priority: $("n-priority").value,
      status: publish ? "published" : "draft",
      updated_at: new Date().toISOString()
    };
    if (publish) {
      payload.published_at = (editingAnnoWasPublished && editingAnnoPublishedAt)
        ? editingAnnoPublishedAt
        : new Date().toISOString();
    }

    var btn = publish ? $("n-publish") : $("n-save-draft");
    busyOn(btn, publish ? "发表中…" : "保存中…");
    clear($("ano-alerts"));

    var req = editingAnnounceId ? C.updateAnnouncement(editingAnnounceId, payload) : C.createAnnouncement(payload);
    req.then(function (res) {
      var out = C.unwrap(res, "保存失败") || [];
      busyOff(btn);
      if (!out.length) { alertIn($("ano-alerts"), "error", "没有改动 —— 服务端没有写入任何一行，请确认登录邮箱已在「白名单」页签里。"); return; }
      alertIn($("ano-alerts"), "ok", publish ? "已发表，主页公告栏与公告页面都会显示。" : "草稿已保存。");
      resetAnnounceForm();
      loadAnnouncements();
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("ano-alerts"), "error", failMsg(err, "保存失败"));
    });
  }

  $("n-publish").addEventListener("click", function () { saveAnnouncement(true); });
  $("n-save-draft").addEventListener("click", function () { saveAnnouncement(false); });

  $("ano-list").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;
    clear($("ano-list-alerts"));

    var editId = t.getAttribute("data-nedit");
    var pubId = t.getAttribute("data-npub");
    var unpubId = t.getAttribute("data-nunpub");
    var delId = t.getAttribute("data-ndel");

    if (editId) {
      busyOn(t, "读取中…");
      /* 列表接口没带正文，这里单独取一次完整行 */
      C.listAnnouncements(false).then(function (res) {
        var rows = C.unwrap(res, "读取失败") || [];
        busyOff(t);
        var row = rows.filter(function (x) { return String(x.id) === String(editId); })[0];
        if (!row) { alertIn($("ano-list-alerts"), "error", "读取失败。"); return; }
        editingAnnounceId = row.id;
        editingAnnoPublishedAt = row.published_at || null;
        editingAnnoWasPublished = row.status === "published";
        $("ano-form-title").textContent = "编辑公告";
        $("ano-reset").hidden = false;
        $("n-title").value = row.title || "";
        $("n-priority").value = row.priority || "green";
        if (announceEditor) announceEditor.setHTML(row.body_html || "");
        paintPriorityPreview();
        clear($("ano-alerts"));
        window.scrollTo(0, 0);
      }).catch(function (err) {
        busyOff(t);
        alertIn($("ano-list-alerts"), "error", "读取失败：" + (err && err.message ? err.message : ""));
      });
      return;
    }

    function setState(id, publish) {
      busyOn(t, publish ? "发表中…" : "撤回中…");
      C.updateAnnouncement(id, {
        status: publish ? "published" : "draft",
        published_at: publish ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      }).then(function (res) {
        var out = C.unwrap(res, "更新失败") || [];
        busyOff(t);
        if (!out.length) { alertIn($("ano-list-alerts"), "error", "没有改动 —— 服务端没有更新任何一行。"); return; }
        alertIn($("ano-list-alerts"), "ok", publish ? "已发表。" : "已撤回为草稿，前台不再显示。");
        loadAnnouncements();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("ano-list-alerts"), "error", failMsg(err, "更新失败"));
      });
    }
    if (pubId) setState(pubId, true);
    if (unpubId) setState(unpubId, false);

    if (delId) {
      if (!window.confirm("确定删除这条公告吗？该操作无法撤销。")) return;
      busyOn(t, "删除中…");
      C.deleteAnnouncement(delId).then(function (res) {
        var out = C.unwrap(res, "删除失败") || [];
        busyOff(t);
        if (!out.length) { alertIn($("ano-list-alerts"), "error", "删除失败 —— 服务端没有删除任何一行。"); return; }
        alertIn($("ano-list-alerts"), "ok", "已删除。");
        if (String(editingAnnounceId) === String(delId)) resetAnnounceForm();
        loadAnnouncements();
      }).catch(function (err) {
        busyOff(t);
        alertIn($("ano-list-alerts"), "error", failMsg(err, "删除失败"));
      });
    }
  });

  /* 页面被隐藏时停掉实时轮询，回到页面再接上，省掉无谓请求 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopLiveTimer();
    else if (currentTab === "live" && $("live-auto") && $("live-auto").checked) loadLive(true);
  });

  paintPriorityPreview();
});
