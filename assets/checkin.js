/* ============================================================
   GUIS 义工组织 — 活动签到（给带活动的老师用）

   两种签到方式，本质都是写 registrations.checked_in：
     1. 扫同学手机上的二维码 → 用 check_token 反查到人 → 打钩
     2. 在下面的名单里直接打钩（同学忘带手机 / 摄像头不能用时的兜底）

   谁能进这个页面：和后台同一套白名单（is_allowed_admin()）。
   名单里有同学的手机号和邮箱，所以不能做成匿名页面 ——
   要把某位老师加进来，先去后台「人员管理」页签加他的邮箱并开通账号。

   权限分两档（和后台一致，服务端才是边界）：
     · owner   执委会：所有活动都能签到、都能改义工小时
     · teacher 负责老师：全部活动的名单都能看（只读），
                       只有「分配给自己的活动」才能扫码 / 打钩 / 改小时
   活动归属 = 每个活动单独指定的 manager_email（activities 表上的一列）。
   2026-09-30 之前还有一层「板块默认负责人」（category_managers）兜底，已删除；
   判断规则和后台 admin.js 里那套必须保持一致。

   义工小时：活动自带默认时长（activities.hours），逐人可覆盖
   （registrations.hours 留空 = 用默认）。老师只对自己负责的活动能改。

   签到码 check_token 是数据库建行时自动生成的，报名成功（selected）
   之后这个码就生效，不需要额外「生成」动作。
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var C = window.GUISCloud;
  var $ = function (id) { return document.getElementById(id); };

  var me = "";                 /* 当前登录邮箱，签到时记进 checked_in_by */
  var acts = [];               /* 全部活动（含已截止的，签到常常在活动当天才做） */
  var rows = [];               /* 当前活动的全部报名 */
  var curId = "";

  /* 我是谁：owner = 执委会（什么都能改），teacher = 负责老师（只改自己负责的）。
     和后台同一个 my_access()（SECURITY DEFINER），角色只有服务端说了算。 */
  var ME = { email: "", role: "teacher" };
  function isOwner() { return ME.role === "owner"; }

  /* 2026-09-30 起取消「板块默认负责人」，改成单一口径：
     一个活动归谁管，只看它自己身上写的 activities.manager_email。
     （同一个判断在后台 admin.js 里还有一份，改规则两边都要改。） */
  function effectiveManager(a) {
    return a && a.manager_email ? String(a.manager_email) : "";
  }
  function iManage(a) {
    if (isOwner()) return true;
    var m = effectiveManager(a);
    return !!m && String(m).toLowerCase() === String(ME.email || "").toLowerCase();
  }
  function currentActivity() {
    return acts.filter(function (a) { return String(a.id) === String(curId); })[0] || null;
  }
  function canManageCurrent() { return iManage(currentActivity()); }

  function fmtH(n) {
    if (n == null || isNaN(Number(n))) return "0";
    return String(Math.round(Number(n) * 100) / 100);
  }
  /* 这个人最终记多少小时：自己覆盖过就用覆盖值，否则用活动默认时长 */
  function hoursOf(r) {
    var act = currentActivity();
    if (r && r.hours != null) return Number(r.hours);
    return act && act.hours != null ? Number(act.hours) : 0;
  }

  /* ---------------- 通用工具 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function alertIn(el, kind, msg) {
    if (!el) return;
    el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { if (el) el.innerHTML = ""; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDT(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function failMsg(err, fallback) {
    var m = (err && err.message) ? err.message : "";
    var code = err && (err.code || (err.raw && err.raw.code));
    if (code === "42501" || /row-level security|violates row-level/i.test(m)) {
      return "权限不足：服务端拒绝了这次写入。请确认当前登录邮箱已在后台「白名单」页签里。";
    }
    if (!m && !code) return (fallback || "操作失败") + "。";
    return (fallback || "操作失败") + "：" + m;
  }
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

  /* ---------------- 域名提示 ----------------
     这个页面只在正式域名上能用（GitHub Pages 那份读不到报名数据）。 */
  (function () {
    var host = location.origin;
    if (host && C.endpoint && host.replace(/\/+$/, "") !== C.endpoint.replace(/\/+$/, "")) {
      $("origin-link").textContent = C.endpoint;
      $("origin-link").href = C.endpoint + "/checkin.html";
      $("origin-banner").hidden = false;
    }
  })();

  /* ---------------- 登录 ---------------- */
  var loginView = $("login-view"), appView = $("app-view");

  function showSignedIn(email) {
    me = email || "";
    $("who-email").textContent = me + (isOwner() ? " · 执委会" : " · 负责老师");
    loginView.hidden = true;
    appView.hidden = false;
    C.touchLogin();
    loadActivities();
  }
  function showLogin() {
    appView.hidden = true;
    loginView.hidden = false;
  }

  /* 白名单校验放服务端（is_allowed_admin 是 SECURITY DEFINER），
     前端这一下只是为了不在名单里的人立刻看到原因。 */
  function enterOrReject(email) {
    return C.isAllowedAdmin().then(function (r) {
      var ok = !r.error && r.data === true;
      if (!ok) {
        C.auth.signOut();
        showLogin();
        alertIn($("auth-alerts"), "error",
          "该邮箱（" + esc(email) + "）还没有加入后台人员名单。请让义工组织执委会先到后台「人员管理」页签把邮箱加进来并开通账号。");
        return false;
      }
      /* 拿到角色再决定能改哪些活动。my_access() 是 SECURITY DEFINER，
         负责老师也能读到自己的角色（allowed_admins 表的读策略只有执委会）。 */
      return C.myAccess().then(function (ar) {
        var row = (ar && ar.data && ar.data[0]) || {};
        ME.email = row.email || email || "";
        ME.role = row.role === "owner" ? "owner" : "teacher";
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

  /* ⚠️ 用 C.sessionUser() 拿邮箱：getSession() 自己不带 email
     （详见 cloud.js 的注释），读 s.user.email 会永远判成没登录。 */
  C.sessionUser().then(function (u) {
    if (u) enterOrReject(u.email || "");
    else showLogin();
  }).catch(showLogin);

  $("logout-btn").addEventListener("click", function () {
    stopScan();
    C.auth.signOut().then(showLogin).catch(showLogin);
  });

  /* 密码 / 邮箱验证码 两种登录方式切换 */
  var forms = { password: $("form-password"), otp: $("form-otp") };
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

  $("form-password").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("ci-submit"), email = $("ci-email").value.trim(), pass = $("ci-pass").value;
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

  var pendingOtp = null;
  $("ci-otp-send").addEventListener("click", function () {
    var email = $("ci-otp-email").value.trim();
    if (!email) { alertIn($("auth-alerts"), "error", "请先填写邮箱。"); return; }
    busyOn(this, "发送中…");
    C.auth.sendOtp({ email: email }).then(function (r) {
      busyOff(this);
      if (r.error) { alertIn($("auth-alerts"), "error", "验证码发送失败：" + (r.error.message || "请稍后重试")); return; }
      pendingOtp = { email: email, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
      alertIn($("auth-alerts"), "ok", "验证码已发送，请查收邮箱（含垃圾邮件）。");
    }.bind(this)).catch(function () {
      busyOff($("ci-otp-send"));
      alertIn($("auth-alerts"), "error", "验证码发送失败，请稍后重试。");
    });
  });

  $("form-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("ci-otp-email").value.trim(), code = $("ci-otp-code").value.trim();
    if (!pendingOtp || pendingOtp.email !== email) { alertIn($("auth-alerts"), "error", "请先为当前邮箱获取验证码。"); return; }
    if (!code) { alertIn($("auth-alerts"), "error", "请填写验证码。"); return; }
    busyOn($("ci-otp-submit"), "验证中…");
    C.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    }).then(function (r) {
      busyOff($("ci-otp-submit"));
      if (r.error) { alertIn($("auth-alerts"), "error", "验证码不正确或已过期。"); return; }
      pendingOtp = null;
      enterOrReject(email);
    }).catch(function () {
      busyOff($("ci-otp-submit"));
      alertIn($("auth-alerts"), "error", "验证失败，请重试。");
    });
  });

  /* ---------------- 活动下拉 ---------------- */
  function loadActivities() {
    C.listMyActivities().then(function (res) {
      acts = C.unwrap(res, "读取活动失败") || [];
      var sel = $("ci-activity");
      sel.innerHTML = '<option value="">选择活动…</option>' +
        acts.map(function (a) {
          /* 我负责的活动前面加个 ★，老师一眼能找到自己的活儿 */
          return '<option value="' + a.id + '">' +
            (iManage(a) ? "★ " : "") + esc(a.title) +
            (a.starts_at ? " · " + fmtDT(a.starts_at) : "") +
            "</option>";
        }).join("");

      var target = "";
      /* ?a=123 直接定位到某个活动（后台那边跳转过来时用） */
      var q = new URLSearchParams(location.search).get("a");
      if (q && acts.some(function (a) { return String(a.id) === String(q); })) target = q;
      if (!target) {
        /* 「打开就能开始签到」：默认落在第一个我负责的活动上 */
        var mine = acts.filter(iManage);
        if (mine.length) target = String(mine[0].id);
      }

      if (target) {
        sel.value = target;
        loadRoster();
      } else if (!acts.length) {
        alertIn($("ci-alerts"), "warn", "目前还没有任何活动。请先在后台「活动」页签创建。");
      } else if (!isOwner()) {
        alertIn($("ci-alerts"), "warn",
          "还没有活动分配给你。可以在上面任选一个活动<b>查看名单（只读）</b>；" +
          "要获得签到权限，请让执委会在后台「活动」里把这个活动的负责老师选成你。");
      }
    }).catch(function (err) {
      alertIn($("ci-alerts"), "error", failMsg(err, "读取活动失败"));
    });
  }

  /* ---------- 这个活动我能不能动 ----------
     看名单是所有人都可以（服务端 registrations 的读策略是 is_allowed_admin）；
     签到 / 改小时只有负责人能操作。执委会一视同仁全都能改。 */
  function applyGate() {
    var box = $("ci-gate");
    var act = currentActivity();
    if (!act) {
      if (box) { box.hidden = true; box.innerHTML = ""; }
      var noBar = $("ci-hours-bar");
      if (noBar) noBar.hidden = true;
      return;
    }
    var can = canManageCurrent();
    var mgr = effectiveManager(act);

    if (box) {
      box.hidden = false;
      box.innerHTML = can
        ? '<div class="alert alert-info">这个活动由你负责 —— 可以扫码、打钩、填写义工小时。' +
          "默认时长 <b>" + fmtH(act.hours) + "</b> 小时/人。</div>"
        : '<div class="alert alert-warn">这个活动由 <b>' + esc(mgr || "（还没指定负责老师）") +
          "</b> 负责，你只能<b>查看名单</b>，不能扫码签到或修改义工小时。</div>";
    }

    /* 本次义工时长：只有能管这个活动的人可以改（负责人或执委会） */
    var hoursBar = $("ci-hours-bar");
    var hoursIn = $("ci-hours-all");
    var hoursBtn = $("ci-hours-save");
    if (hoursBar) hoursBar.hidden = !act;
    if (hoursIn) {
      hoursIn.value = fmtH(act.hours);
      hoursIn.disabled = !can;
    }
    if (hoursBtn) hoursBtn.disabled = !can;

    /* 不是自己的活动：扫码入口和手输入口直接关掉，别让老师扫半天才发现写不进去 */
    var scan = $("ci-scan-toggle");
    if (scan) {
      scan.disabled = !can;
      scan.title = can ? "" : "只有负责这个活动的老师才能签到";
    }
    var man = $("ci-manual"), manGo = $("ci-manual-go");
    if (man) man.disabled = !can;
    if (manGo) manGo.disabled = !can;
    if (!can && scanning) stopScan();
  }

  $("ci-activity").addEventListener("change", loadRoster);
  $("ci-search").addEventListener("input", renderRoster);
  $("ci-filter").addEventListener("change", renderRoster);
  $("ci-refresh").addEventListener("click", loadRoster);

  /* ---------------- 本次义工时长（活动默认值） ----------------
     后台「活动」表单里那个「本次义工时长」在签到现场改不了 —— 老师临时发现活动多干了
     半小时，还得回后台绕一圈。这里直接给一个输入框，走 set_activity_hours()，
     服务端用 i_manage_activity() 再判一次：只有负责老师本人和执委会能写进去。
     ⚠️ 已经单独填过小时的同学不会被覆盖（registrations.hours 优先级更高）。 */
  var hoursBtnEl = $("ci-hours-save");
  if (hoursBtnEl) {
    hoursBtnEl.addEventListener("click", function () {
      var act = currentActivity();
      if (!act) return;
      if (!canManageCurrent()) {
        alertIn($("ci-alerts"), "error", "这个活动不是你负责的，不能改它的义工时长。");
        return;
      }
      var raw = $("ci-hours-all").value.trim();
      var n = raw === "" ? null : Number(raw);
      if (raw !== "" && (isNaN(n) || n < 0)) {
        alertIn($("ci-alerts"), "error", "义工时长要是 0 或正数；留空表示不填。");
        return;
      }
      clear($("ci-alerts"));
      busyOn(hoursBtnEl, "保存中…");
      C.setActivityHours(act.id, n).then(function (res) {
        var out = (res && res.data) || null;
        busyOff(hoursBtnEl);
        /* 服务端返回的是 jsonb 对象，不是行 —— 不能按 rows.length 判断 */
        if (!out || out.ok !== true) {
          alertIn($("ci-alerts"), "error",
            "没有改成功：" + (out && out.error === "forbidden"
              ? "这个活动不是你负责的。" : "请刷新后重试。"));
          return;
        }
        act.hours = out.hours;
        alertIn($("ci-alerts"), "ok", "本次义工时长已改成 <b>" + fmtH(out.hours) + "</b> 小时/人。");
        renderRoster();
        applyGate();
      }).catch(function (err) {
        busyOff(hoursBtnEl);
        alertIn($("ci-alerts"), "error", failMsg(err, "保存失败"));
      });
    });
  }

  /* ---------------- 名单 ---------------- */
  /* 应到人数：以「已录取」的人为准；这个活动还没保存录取名单时，退回全部报名。 */
  function baseRows() {
    var sel = rows.filter(function (r) { return r.selected; });
    return sel.length ? sel : rows;
  }

  function viewRows() {
    var f = $("ci-filter").value;
    var q = String($("ci-search").value || "").trim().toLowerCase();
    var base = baseRows();
    var list = base.filter(function (r) {
      if (f === "todo") return !r.checked_in;
      if (f === "done") return !!r.checked_in;
      if (f === "all") return true;
      return true;                       /* selected：base 本身已经是录取名单 */
    });
    if (!q) return list;
    return list.filter(function (r) {
      return [r.name, r.email, r.student_id, r.grade, r.programme, r.slot, r.phone]
        .join(" ").toLowerCase().indexOf(q) >= 0;
    });
  }

  function updateMetrics() {
    var base = baseRows();
    var done = base.filter(function (r) { return r.checked_in; }).length;
    $("m-total").textContent = String(base.length);
    $("m-done").textContent = String(done);
    $("m-todo").textContent = String(base.length - done);

    /* 已产生的义工小时 = 已签到的人各自记多少小时的和（逐人覆盖优先于活动默认） */
    var hours = base.reduce(function (s, r) { return s + (r.checked_in ? hoursOf(r) : 0); }, 0);
    $("m-hours").textContent = fmtH(hours);

    var pct = base.length ? Math.round(done / base.length * 100) : 0;
    $("m-bar-fill").style.width = pct + "%";
    $("m-pct").textContent = pct + "%";
  }

  /* 义工小时格子：能管的给输入框（留空 = 用活动默认时长），不能管的显示只读文本。 */
  function hoursCell(r) {
    var act = currentActivity();
    var def = act && act.hours != null ? Number(act.hours) : 0;
    var val = r.hours != null ? Number(r.hours) : null;
    if (!canManageCurrent()) {
      return '<span class="ci-no">' + fmtH(val != null ? val : def) + " 小时" +
        (val == null ? "（默认）" : "") + "</span>";
    }
    return '<input type="number" class="hours-in" min="0" step="0.5" value="' +
      (val != null ? val : "") + '" placeholder="' + fmtH(def) +
      '" title="留空 = 用活动默认时长" data-hours="' + r.id + '" />';
  }

  function renderRoster() {
    var list = viewRows();
    var body = $("ci-body");
    var act = acts.filter(function (a) { return String(a.id) === String(curId); })[0];

    if (!curId) {
      $("ci-table-wrap").hidden = true;
      $("ci-empty").hidden = false;
      $("ci-empty").textContent = "请先在上方选择要签到的活动。";
      $("ci-count").textContent = "";
      updateMetrics();
      return;
    }
    if (!rows.length) {
      $("ci-table-wrap").hidden = true;
      $("ci-empty").hidden = false;
      $("ci-empty").textContent = "这个活动还没有报名记录。";
      $("ci-count").textContent = "";
      updateMetrics();
      return;
    }
    if (!list.length) {
      $("ci-table-wrap").hidden = true;
      $("ci-empty").hidden = false;
      $("ci-empty").textContent = "没有符合当前筛选条件的人。";
      $("ci-count").textContent = "";
      updateMetrics();
      return;
    }

    $("ci-empty").hidden = true;
    $("ci-table-wrap").hidden = false;

    var can = canManageCurrent();

    body.innerHTML = list.map(function (r, i) {
      return '<tr class="' + (r.checked_in ? "is-done" : "") + '" data-row="' + r.id + '">' +
        '<td class="tick-cell"><input type="checkbox" data-check="' + r.id + '"' +
          (r.checked_in ? " checked" : "") + (can ? "" : " disabled") +
          ' title="' + (can ? "打钩 = 已签到" : "只有负责这个活动的老师才能签到") + '" /></td>' +
        '<td class="num">' + (i + 1) + "</td>" +
        "<td><b>" + esc(r.name) + "</b>" + (r.selected ? '<span class="roster-flag">已录取</span>' : "") + absFlag(r) + "</td>" +
        "<td>" + esc(r.grade) + "</td>" +
        "<td>" + esc(r.programme) + "</td>" +
        "<td>" + esc(r.student_id) + "</td>" +
        "<td>" + esc(r.slot) + "</td>" +
        "<td>" + (r.checked_in
          ? '<span class="ci-yes">已签到</span> <span class="ci-when">' + fmtDT(r.checked_in_at) + "</span>"
          : '<span class="ci-no">未签到</span>') + "</td>" +
        "<td>" + hoursCell(r) + "</td>" +
        '<td><div class="row-actions">' +
          '<button type="button" class="tbl-btn" data-qr="' + r.id + '">二维码</button>' +
          (can && r.checked_in ? '<button type="button" class="tbl-btn danger" data-uncheck="' + r.id + '">撤销</button>' : "") +
        "</div></td>" +
      "</tr>";
    }).join("");

    var done = baseRows().filter(function (r) { return r.checked_in; }).length;
    var hrs = baseRows().reduce(function (s, r) { return s + (r.checked_in ? hoursOf(r) : 0); }, 0);
    $("ci-count").textContent = (act ? "活动：" + act.title + " · " : "") +
      "应到 " + baseRows().length + " 人 · 已签到 " + done + " 人 · 义工小时 " + fmtH(hrs);
    updateMetrics();
  }

  /* ==========================================================================
     缺席（2026-10-05）
     --------------------------------------------------------------------------
     活动一结束，没签到的人就应该记一次缺席。这里做两件事：
     1) 打开一个「已结束」的活动时静默结算一次 —— 免得有人忘了点按钮，纪律就落空；
        结算是幂等的（数据库唯一索引挡重复），反复调用不会把一次缺席记成两次。
     2) 给「结算缺席」按钮一个明确出口，并显示这次结算的结果。
     ⚠️ 只有这场活动的负责人（i_manage_activity）才结算得动，服务端会再判一次。
     ========================================================================== */
  var absRows = [];

  function activityEnded() {
    var a = currentActivity();
    if (!a) return false;
    var end = a.ends_at || a.starts_at;
    if (!end) return false;
    return new Date(end).getTime() < Date.now();
  }
  /* 这一场活动里这个人的缺席记录（没有就是 null） */
  function absHere(email) {
    var k = String(email || "").toLowerCase();
    var hit = null;
    (absRows || []).forEach(function (a) {
      if (String(a.activity_id) === String(curId) && String(a.email || "").toLowerCase() === k) hit = a;
    });
    return hit;
  }
  function absFlag(r) {
    var a = absHere(r.email);
    if (!a) return "";
    return a.status === "excused"
      ? '<span class="reg-excused" title="已请假并有说明，不计入缺席次数">已请假</span>'
      : '<span class="reg-absent is-hot" title="本场已记为缺席">缺席</span>';
  }
  function loadAbs() {
    if (typeof C.listAbsences !== "function") return Promise.resolve(null);
    return C.listAbsences({ activityId: curId }).then(function (res) {
      absRows = C.unwrap(res, "读取失败") || [];
      syncAbsBar();
      if ($("ci-table-wrap") && !$("ci-table-wrap").hidden) renderRoster();
    }).catch(function () { absRows = []; syncAbsBar(); });
  }
  /* 结算条：只有活动结束 + 自己能管这场活动才出现 */
  function syncAbsBar() {
    var bar = $("ci-abs-bar");
    if (!bar) return;
    var on = !!curId && canManageCurrent() && activityEnded();
    bar.hidden = !on;
    if (!on) return;
    var done = baseRows().filter(function (r) { return !r.checked_in; }).length;
    var got = (absRows || []).filter(function (a) { return a.status === "absent"; }).length;
    $("ci-abs-hint").textContent = "未签到 " + done + " 人 · 本场已记缺席 " + got + " 条" +
      (got ? "（再点一次不会重复计数）" : "");
  }
  function settleAbsences(silent) {
    if (!curId || !canManageCurrent() || !activityEnded()) return Promise.resolve(null);
    var btn = $("ci-abs-settle");
    if (!silent && btn) busyOn(btn, "结算中…");
    return C.settleAbsences(Number(curId)).then(function (res) {
      var out = C.unwrap(res, "结算失败");
      if (!silent && btn) busyOff(btn);
      if (!out || out.ok === false) {
        if (!silent) {
          var why = (out && out.error === "not_manager") ? "只有这场活动的负责人能结算缺席。"
            : (out && out.error === "not_ended") ? "活动还没结束。"
            : "结算失败。";
          alertIn($("ci-alerts"), "error", why);
        }
        return null;
      }
      return loadAbs().then(function () {
        if (!silent) {
          alertIn($("ci-alerts"), (out.inserted ? "ok" : "info"),
            out.inserted
              ? "已把 " + out.inserted + " 位未签到的同学记为缺席" +
                (out.by_selection ? "（按录取名单判定）。" : "（这场没有录取记录，按报名成功的人判定）。")
              : "这场已经结算过了，没有新增记录。");
        }
        return out;
      });
    }).catch(function (err) {
      if (!silent && btn) busyOff(btn);
      if (!silent) alertIn($("ci-alerts"), "error", failMsg(err, "结算失败"));
      return null;
    });
  }

  function loadRoster() {
    curId = $("ci-activity").value;
    rows = [];
    clear($("ci-alerts"));
    applyGate();                       /* 换活动 = 换权限，先把门控刷一遍 */
    $("ci-table-wrap").hidden = true;
    $("ci-empty").hidden = true;

    if (!curId) {
      $("ci-empty").hidden = false;
      $("ci-empty").textContent = "请先在上方选择要签到的活动。";
      $("ci-count").textContent = "";
      updateMetrics();
      return;
    }

    $("ci-loading").hidden = false;
    C.listRegistrations(curId).then(function (res) {
      rows = C.unwrap(res, "读取失败") || [];
      $("ci-loading").hidden = true;
      applyGate();

      /* 还没保存过录取名单时，名单口径退回「全部报名」，并明确告诉老师一声，
         免得他以为名单少了一半。 */
      if (!rows.some(function (r) { return r.selected; })) {
        $("ci-filter").value = "all";
        alertIn($("ci-alerts"), "warn",
          "这个活动还没有保存「报名成功名单」，当前显示的是<b>全部报名</b>同学。要只显示录取的同学，请先到后台「报名名单」页签勾选并保存。");
      }
      renderRoster();
      /* 缺席：活动已经结束就静默结算一次，再带上这份活动的缺席记录刷新名单。
         ⚠️ 静默（silent = true）：活动结束后每次打开都会试一次，成功不弹提示，
            免得老师一进页面就看到一堆「已结算」。 */
      loadAbs().then(function () {
        if (canManageCurrent() && activityEnded()) return settleAbsences(true);
        return null;
      });
    }).catch(function (err) {
      $("ci-loading").hidden = true;
      $("ci-empty").hidden = false;
      $("ci-empty").textContent = "读取失败：" + (err && err.message ? err.message : "");
    });
  }

  if ($("ci-abs-settle")) {
    $("ci-abs-settle").addEventListener("click", function () { settleAbsences(false); });
  }

  /* ---------------- 手动打钩 ---------------- */
  function setChecked(rowId, on, btn) {
    clear($("ci-alerts"));
    /* 不是自己负责的活动：名单能看，但不给写。 */
    if (!canManageCurrent()) {
      alertIn($("ci-alerts"), "error", "这个活动不是你负责的，只能查看名单，不能签到。");
      return Promise.resolve(null);
    }
    if (btn) busyOn(btn, "…");
    return C.setCheckedIn(rowId, on, me).then(function (res) {
      if (btn) busyOff(btn);
      var out = C.unwrap(res, "更新失败") || [];
      if (!out.length) {
        alertIn($("ci-alerts"), "error",
          "没有改动 —— 服务端没有更新任何一行。请确认登录邮箱已在后台「人员管理」里，并且是这个活动的负责老师。");
        return null;
      }
      var row = rows.filter(function (r) { return String(r.id) === String(rowId); })[0];
      if (row) {
        row.checked_in = !!on;
        row.checked_in_at = on ? new Date().toISOString() : null;
        row.checked_in_by = on ? me : null;
      }
      renderRoster();
      return row || null;
    }).catch(function (err) {
      if (btn) busyOff(btn);
      alertIn($("ci-alerts"), "error", failMsg(err, "更新失败"));
      return null;
    });
  }

  /* ---------------- 逐人改义工小时 ----------------
     输入框留空 = 用活动默认时长（库里 hours 存 null）。 */
  function applyHours(rowId, input) {
    clear($("ci-alerts"));
    if (!canManageCurrent()) {
      alertIn($("ci-alerts"), "error", "这个活动不是你负责的，只能查看名单，不能改义工小时。");
      return;
    }
    var raw = String(input.value).trim();
    var num = raw === "" ? null : Number(raw);
    if (raw !== "" && (num == null || isNaN(num) || num < 0)) {
      alertIn($("ci-alerts"), "error", "义工小时要填 0 或正数；留空表示用活动默认时长。");
      return;
    }
    var oldVal = input.value;
    input.disabled = true;
    C.setHours(rowId, raw).then(function (res) {
      input.disabled = false;
      var out = C.unwrap(res, "保存失败") || [];
      if (!out.length) {
        alertIn($("ci-alerts"), "error", "没有改动 —— 服务端没有更新任何一行，请确认你是这个活动的负责老师。");
        return;
      }
      var row = rows.filter(function (r) { return String(r.id) === String(rowId); })[0];
      if (row) row.hours = out[0].hours;      /* null = 回落到活动默认时长 */
      /* 不整表重画 —— 会打断老师继续输入，只刷上面的汇总数字 */
      updateMetrics();
      var done = baseRows().filter(function (r) { return r.checked_in; }).length;
      var act = currentActivity();
      $("ci-count").textContent = (act ? "活动：" + act.title + " · " : "") +
        "应到 " + baseRows().length + " 人 · 已签到 " + done + " 人 · 义工小时 " +
        fmtH(baseRows().reduce(function (s, r) { return s + (r.checked_in ? hoursOf(r) : 0); }, 0));
    }).catch(function (err) {
      input.disabled = false;
      input.value = oldVal;
      alertIn($("ci-alerts"), "error", failMsg(err, "保存失败"));
    });
  }

  $("ci-body").addEventListener("change", function (e) {
    var t = e.target;
    if (t.tagName !== "INPUT") return;

    var hid = t.getAttribute("data-hours");
    if (hid != null) { applyHours(hid, t); return; }

    var id = t.getAttribute("data-check");
    if (!id) return;
    var on = t.checked;
    t.disabled = true;
    setChecked(id, on).then(function (row) {
      /* 失败要把勾拨回去，否则界面上显示的状态和库里不一致 */
      if (!row) t.checked = !on;
      t.disabled = false;
    });
  });

  $("ci-body").addEventListener("click", function (e) {
    var t = e.target;
    if (t.tagName !== "BUTTON") return;

    var uncheck = t.getAttribute("data-uncheck");
    if (uncheck) {
      if (!window.confirm("确定撤销这个人的签到吗？")) return;
      setChecked(uncheck, false, t);
      return;
    }

    var qrId = t.getAttribute("data-qr");
    if (qrId) {
      var row = rows.filter(function (r) { return String(r.id) === String(qrId); })[0];
      if (!row) return;
      /* 只读老师：补码是一次写操作，不是自己的活动就不给补 */
      if (!row.check_token && !canManageCurrent()) {
        alertIn($("ci-alerts"), "warn", "这条记录还没有签到码，请联系这个活动的负责老师先打开一次。");
        return;
      }
      busyOn(t, "…");
      /* 万一这条记录是老数据、没有签到码，先补一个再画 */
      var ready = row.check_token
        ? Promise.resolve(row.check_token)
        : C.ensureCheckToken(row.id).then(function (tok) { row.check_token = tok; return tok; });
      ready.then(function (tok) {
        busyOff(t);
        window.GUISQR.showOne({
          title: row.name + " 的签到码",
          sub: "让同学把这张码出示给老师扫；也可以直接手动打钩。",
          name: row.name,
          sub2: [row.grade, row.student_id].filter(Boolean).join(" · "),
          token: tok,
          size: 240
        });
      }).catch(function (err) {
        busyOff(t);
        alertIn($("ci-alerts"), "error", failMsg(err, "取签到码失败"));
      });
    }
  });

  /* ---------------- 扫码签到 ---------------- */
  var video = $("ci-video"), canvas = $("ci-canvas"), ctx = canvas.getContext("2d");
  var stream = null, rafId = null, scanning = false;
  var pauseUntil = 0;          /* 刚扫到过就歇一下，不然一秒会命中几十次 */
  var lastAt = 0;
  var recent = null;           /* { token, at, id } —— 6 秒内重复扫同一张码不重复查库 */

  function scanAlerts() { return $("ci-scan-alerts"); }

  function paintHit(kind, title, sub) {
    var box = $("ci-scan-result");
    box.hidden = false;
    box.className = "scan-hit is-" + kind;
    box.innerHTML = '<div class="scan-mark">' + (kind === "ok" ? "✓" : kind === "warn" ? "!" : "×") + "</div>" +
      "<div><div class=\"scan-name\">" + esc(title) + "</div>" +
      '<div class="scan-note">' + sub + "</div></div>";
    /* 闪一下，让老师在人群里也能确认扫到了 */
    box.classList.remove("is-flash");
    void box.offsetWidth;
    box.classList.add("is-flash");
  }

  function startScan() {
    if (!curId) { alertIn(scanAlerts(), "warn", "先在上方选择要签到的活动，再开始扫描。"); return; }
    if (!canManageCurrent()) {
      alertIn(scanAlerts(), "warn", "这个活动不是你负责的，只能查看名单，不能扫码签到。");
      return;
    }
    if (!ctx) { alertIn(scanAlerts(), "error", "这个浏览器取不到图像上下文，请改用下面的名单手动打钩。"); return; }
    if (!window.isSecureContext) {
      alertIn(scanAlerts(), "error", "调用摄像头需要 HTTPS 页面。当前不是安全上下文，请改用下面的名单手动打钩。");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alertIn(scanAlerts(), "error", "这个浏览器不支持调用摄像头，请改用下面的名单手动打钩。");
      return;
    }
    clear(scanAlerts());
    var btn = $("ci-scan-toggle");
    busyOn(btn, "正在打开摄像头…");

    window.GUISQR.loadScan().then(function () {
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false
      });
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      return video.play();
    }).then(function () {
      scanning = true;
      $("ci-scan-box").hidden = false;
      btn.textContent = "停止扫描";
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.classList.add("is-on");
      loop();
    }).catch(function (err) {
      busyOff(btn);
      var name = err && err.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        alertIn(scanAlerts(), "error", "摄像头权限被拒绝。请在浏览器地址栏的权限设置里允许摄像头，或改用下面的名单手动打钩。");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        alertIn(scanAlerts(), "error", "没有找到可用的摄像头。请改用下面的名单手动打钩。");
      } else {
        alertIn(scanAlerts(), "error", "打开摄像头失败：" + (err && err.message ? err.message : "未知原因"));
      }
    });
  }

  function stopScan() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.srcObject = null;
    var btn = $("ci-scan-toggle");
    if (btn) {
      btn.textContent = "开始扫描";
      btn.disabled = false;
      btn.classList.remove("is-busy", "is-on");
    }
    var box = $("ci-scan-box");
    if (box) box.hidden = true;
  }

  function loop() {
    if (!scanning) return;
    var now = Date.now();
    if (video.readyState >= 2 && now > pauseUntil && now - lastAt > 120) {
      lastAt = now;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        /* 缩到 640 宽以内再解码：够清楚，又不至于每帧都烧 CPU */
        var w = Math.min(vw, 640);
        var h = Math.round(vh * (w / vw));
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        var img = ctx.getImageData(0, 0, w, h);
        var hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (hit && hit.data) onToken(window.GUISQR.extractToken(hit.data));
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  function onToken(token) {
    if (!token) return;
    pauseUntil = Date.now() + 1600;

    if (recent && recent.token === token && Date.now() - recent.at < 6000) {
      var old = rows.filter(function (r) { return String(r.id) === String(recent.id); })[0];
      if (old) paintHit("warn", old.name, "刚才已经扫过这张码了。");
      return;
    }

    C.findByCheckToken(token).then(function (res) {
      var found = C.unwrap(res, "查询失败") || [];
      if (!found.length) {
        paintHit("err", "这个码不认识", "没在报名库里找到对应的同学。请确认是本站生成的签到码。");
        return;
      }
      var r = found[0];
      recent = { token: token, at: Date.now(), id: r.id };

      if (String(r.activity_id) !== String(curId)) {
        var other = acts.filter(function (a) { return String(a.id) === String(r.activity_id); })[0];
        /* 注意：paintHit 的 title 会自己转义，sub 是当 HTML 拼的，含变量必须手转 */
        paintHit("err", r.name, "这位同学报的是另一个活动" +
          (other ? "（" + esc(other.title) + "）" : "") + "，不是当前签到的活动。");
        return;
      }
      if (r.checked_in) {
        paintHit("warn", r.name, "已经签到过了 · " + fmtDT(r.checked_in_at));
        return;
      }
      return C.setCheckedIn(r.id, true, me).then(function () {
        var row = rows.filter(function (x) { return String(x.id) === String(r.id); })[0];
        if (row) {
          row.checked_in = true;
          row.checked_in_at = new Date().toISOString();
          row.checked_in_by = me;
        }
        renderRoster();
        paintHit("ok", r.name + " 已签到",
          [r.grade, r.student_id].filter(Boolean).map(esc).join(" · ") || "签到成功");
      });
    }).catch(function (err) {
      paintHit("err", "查询失败", esc(failMsg(err, "查不到这个人")));
    });
  }

  $("ci-scan-toggle").addEventListener("click", function () {
    if (scanning) stopScan();
    else startScan();
  });

  /* 手输签到码兜底：摄像头坏了、或者同学把码发在微信里时用 */
  $("ci-manual-go").addEventListener("click", function () {
    var raw = $("ci-manual").value;
    var token = window.GUISQR.extractToken(raw);
    if (!token) { alertIn(scanAlerts(), "warn", "请先输入签到码。"); return; }
    if (!curId) { alertIn(scanAlerts(), "warn", "先在上方选择要签到的活动。"); return; }
    if (!canManageCurrent()) {
      alertIn(scanAlerts(), "warn", "这个活动不是你负责的，只能查看名单，不能签到。");
      return;
    }
    recent = null;
    onToken(token);
  });
  $("ci-manual").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("ci-manual-go").click(); }
  });

  window.addEventListener("pagehide", stopScan);
});
