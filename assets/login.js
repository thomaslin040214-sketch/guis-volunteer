/* ============================================================
   GUIS 义工社 — 统一登录（login.html）

   一个入口，登录后自动分流：
     执委会 owner   → admin.html    后台（能改活动/刊物/公告）
     负责老师 teacher → checkin.html  签到页（只能给自己负责的活动签到）
     学生 student   → me.html       我的义工账户

   身份从哪来：登录成功之后调 my_access()（SECURITY DEFINER），
   它返回 role —— 不在人员名单里的人默认就是 'student'。
   ⚠️ 判定必须在「登录成功之后」：先验证密码再告知身份，
      免得任何人拿一个邮箱就能试探出他是什么角色。

   首次开通只对学生开放：@guiscn.com + 在后台「学生名单」里登记过，
   走 check_student_email()（匿名可调的 SECURITY DEFINER 函数）核对。
   老师和执委会没有自助开通入口 —— 由执委会在后台加进名单。
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var C = window.GUISCloud;
  var $ = function (id) { return document.getElementById(id); };
  var SUFFIX = "@guiscn.com";

  var DEST = {
    owner: "admin.html",
    teacher: "checkin.html",
    student: "me.html"
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function alertIn(el, kind, msg) {
    if (el) el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { if (el) el.innerHTML = ""; }
  function busyOn(btn, label) {
    if (!btn) return;
    btn.setAttribute("data-busy-label", btn.textContent);
    btn.disabled = true; btn.classList.add("is-busy");
    if (label) btn.textContent = label;
  }
  function busyOff(btn) {
    if (!btn) return;
    btn.disabled = false; btn.classList.remove("is-busy");
    var old = btn.getAttribute("data-busy-label");
    if (old != null) { btn.textContent = old; btn.removeAttribute("data-busy-label"); }
  }
  /* 学生只填前缀也认：没有 @ 就补上学校邮箱后缀 */
  function fullEmail(v) {
    var s = String(v || "").trim().toLowerCase();
    if (!s) return "";
    return s.indexOf("@") >= 0 ? s : s + SUFFIX;
  }

  /* ---------------- 域名提示 ----------------
     GitHub Pages 那份读不到云端数据，登录一定会失败，先说清楚。 */
  (function () {
    var host = location.origin;
    if (host && C.endpoint && host.replace(/\/+$/, "") !== C.endpoint.replace(/\/+$/, "")) {
      $("origin-link").textContent = C.endpoint;
      $("origin-link").href = C.endpoint + "/login.html";
      $("origin-banner").hidden = false;
    }
  })();

  /* ---------------- 识别身份并跳转 ---------------- */
  function go(email) {
    var box = $("lg-status");
    box.hidden = false;
    box.innerHTML = '<div class="alert alert-info"><span class="loading"></span> ' +
      esc(t("lg.detecting", "正在识别你的身份…")) + "</div>";

    return C.myAccess().then(function (ar) {
      var row = (ar && ar.data && ar.data[0]) || {};
      var role = row.role === "owner" ? "owner" : row.role === "teacher" ? "teacher" : "student";
      var dest = DEST[role];
      var msg = role === "owner" ? t("lg.goOwner", "识别到你是指委会成员，正在进入后台…")
        : role === "teacher" ? t("lg.goTeacher", "识别到你是负责老师，正在进入签到页…")
        : t("lg.goStudent", "进入「我的义工账户」…");
      box.innerHTML = '<div class="alert alert-ok">' + esc(msg) + "</div>";
      setTimeout(function () { location.href = dest; }, 650);
      return role;
    }).catch(function () {
      /* 拿不到角色也别卡死：按学生处理，学生页自己会再判一次 */
      box.innerHTML = '<div class="alert alert-warn">' +
        esc(t("lg.detecting", "正在识别你的身份…")) + "</div>";
      setTimeout(function () { location.href = DEST.student; }, 800);
      return "student";
    });
  }

  /* 运行时取文案（提示语是动态拼的，等不到 applyLang 去刷 DOM）。
     口径和 main.js 一致：?lang= > localStorage > 中文；取不到就用内置兜底。 */
  function t(key, fallback) {
    try {
      var lang = new URLSearchParams(location.search).get("lang") ||
        localStorage.getItem("guis-volunteer-lang") || "zh";
      var dict = window.SITE_I18N || {};
      var pack = dict[lang] || dict.zh || {};
      if (pack[key] != null) return pack[key];
    } catch (e) { /* localStorage 可能不可用 */ }
    return fallback;
  }

  /* ---------------- 已经登录过就直接走 ---------------- */
  C.getSession().then(function (res) {
    var s = res && res.data;
    if (s && s.user && s.user.email) {
      $("lg-email-known").textContent = s.user.email;
      $("lg-known").hidden = false;
      go(s.user.email);
    }
  }).catch(function () {});

  /* ---------------- 三种方式切换 ---------------- */
  var forms = { pass: $("form-pass"), otp: $("form-otp"), neu: $("form-new") };
  function showForm(name) {
    Object.keys(forms).forEach(function (k) { forms[k].hidden = k !== name; });
    Array.prototype.forEach.call($("lg-seg").children, function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-mode") === name);
    });
    clear($("lg-alerts"));
  }
  Array.prototype.forEach.call($("lg-seg").children, function (b) {
    b.addEventListener("click", function () { showForm(b.getAttribute("data-mode")); });
  });

  /* ---------------- 密码登录 ---------------- */
  $("form-pass").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = fullEmail($("lg-email").value), pass = $("lg-pass").value;
    if (!email) { alertIn($("lg-alerts"), "error", t("lg.email", "邮箱")); return; }
    if (!pass) { alertIn($("lg-alerts"), "error", t("lg.pass", "密码")); return; }
    busyOn($("lg-submit"), "…");
    C.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      if (r.error) { busyOff($("lg-submit")); alertIn($("lg-alerts"), "error", t("lg.errBad", "邮箱或密码不正确。")); return; }
      go(email);
    }).catch(function () {
      busyOff($("lg-submit"));
      alertIn($("lg-alerts"), "error", t("lg.errBad", "邮箱或密码不正确。"));
    });
  });

  /* ---------------- 验证码登录 ---------------- */
  var pendingOtp = null;
  $("lg-otp-send").addEventListener("click", function () {
    var email = fullEmail($("lg-otp-email").value);
    if (!email) { alertIn($("lg-alerts"), "error", t("lg.email", "邮箱")); return; }
    busyOn(this, "…");
    C.auth.sendOtp({ email: email }).then(function (r) {
      busyOff($("lg-otp-send"));
      if (r.error) { alertIn($("lg-alerts"), "error", "验证码发送失败：" + (r.error.message || "请稍后重试")); return; }
      pendingOtp = { email: email, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
      alertIn($("lg-alerts"), "ok", "验证码已发到 " + esc(email) + "，请查收邮箱（含垃圾邮件）。");
    }).catch(function () {
      busyOff($("lg-otp-send"));
      alertIn($("lg-alerts"), "error", "验证码发送失败，请稍后重试。");
    });
  });

  $("form-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("lg-otp-code").value.trim();
    if (!pendingOtp) { alertIn($("lg-alerts"), "error", "请先点「获取验证码」。"); return; }
    if (!code) { alertIn($("lg-alerts"), "error", "请填写邮箱里的验证码。"); return; }
    busyOn($("lg-otp-go"), "…");
    C.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    }).then(function (r) {
      if (r.error) { busyOff($("lg-otp-go")); alertIn($("lg-alerts"), "error", "验证码不正确或已过期。"); return; }
      go(pendingOtp.email);
    }).catch(function () {
      busyOff($("lg-otp-go"));
      alertIn($("lg-alerts"), "error", "验证失败，请重试。");
    });
  });

  /* ---------------- 首次开通（仅学生） ---------------- */
  var pendingNew = null;
  $("lg-new-send").addEventListener("click", function () {
    var email = fullEmail($("lg-new-email").value);
    if (!email) { alertIn($("lg-alerts"), "error", "请先填写学校邮箱前缀。"); return; }
    if (!/@guiscn\.com$/.test(email)) {
      alertIn($("lg-alerts"), "error", "自助开通只对学校邮箱（@guiscn.com）开放。负责老师和执委会请让执委会先在后台「人员管理」里加你的邮箱。");
      return;
    }
    busyOn(this, "核对中…");
    C.checkStudentEmail(email).then(function (res) {
      var row = (C.unwrap(res, "核对失败") || [])[0] || {};
      if (!row.known) {
        busyOff($("lg-new-send"));
        alertIn($("lg-alerts"), "error",
          "这个邮箱（" + esc(email) + "）不在学校登记的学生名单里，暂时不能自助开通。" +
          "请确认前缀有没有打错，或联系义工社执委会把你的邮箱加进名单。");
        return;
      }
      if (row.activated) {
        busyOff($("lg-new-send"));
        alertIn($("lg-alerts"), "warn", "这个邮箱已经开通过了 —— 切到「密码登录」直接进就行。");
        showForm("pass");
        $("lg-email").value = String(email).replace(/@.*$/, "");
        return;
      }
      return C.auth.sendOtp({ email: email }).then(function (r) {
        busyOff($("lg-new-send"));
        if (r.error) { alertIn($("lg-alerts"), "error", "验证码发送失败：" + (r.error.message || "请稍后重试")); return; }
        pendingNew = { email: email, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
        alertIn($("lg-alerts"), "ok", "验证码已发到 " + esc(email) + "，填进下面再设一个密码就开好了。");
      });
    }).catch(function (err) {
      busyOff($("lg-new-send"));
      alertIn($("lg-alerts"), "error", "核对失败：" + (err && err.message ? err.message : ""));
    });
  });

  $("form-new").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!pendingNew) { alertIn($("lg-alerts"), "error", "请先点「核对并发送验证码」。"); return; }
    var code = $("lg-new-code").value.trim(), pass = $("lg-new-pass").value;
    if (!code) { alertIn($("lg-alerts"), "error", "请填写邮箱里的验证码。"); return; }
    if (!pass || pass.length < 6) { alertIn($("lg-alerts"), "error", "密码至少 6 位。"); return; }

    busyOn($("lg-new-go"), "开通中…");
    C.auth.verifyOtp({
      email: pendingNew.email,
      verificationId: pendingNew.verificationId,
      isExistingUser: pendingNew.isExistingUser,
      token: code
    }).then(function (r) {
      if (r.error) { busyOff($("lg-new-go")); alertIn($("lg-alerts"), "error", "验证码不正确或已过期。"); return; }
      var vt = r.data && r.data.verificationToken;
      if (!vt) { busyOff($("lg-new-go")); alertIn($("lg-alerts"), "error", "没有拿到开通凭证，请重试。"); return; }
      return C.auth.signUp({ email: pendingNew.email, password: pass, verificationToken: vt })
        .then(function (s) {
          if (s.error) { busyOff($("lg-new-go")); alertIn($("lg-alerts"), "error", "开通失败：" + (s.error.message || "请重试")); return; }
          return C.markStudentActivated().catch(function () {}).then(function () {
            go(pendingNew.email);
          });
        });
    }).catch(function (err) {
      busyOff($("lg-new-go"));
      alertIn($("lg-alerts"), "error", "开通失败：" + (err && err.message ? err.message : "请重试"));
    });
  });

  /* ---------------- 忘记密码 ---------------- */
  var resetHandle = null;
  $("lg-forget").addEventListener("click", function () {
    var email = fullEmail($("lg-email").value);
    if (!email) { alertIn($("lg-alerts"), "warn", "先填好邮箱，再点这里。"); return; }
    busyOn(this, "发送中…");
    C.auth.resetPasswordForEmail(email).then(function (r) {
      busyOff($("lg-forget"));
      if (r.error) { alertIn($("lg-alerts"), "error", "发送失败：" + (r.error.message || "请稍后重试")); return; }
      resetHandle = r.data;
      alertIn($("lg-alerts"), "ok", "重置验证码已发到 " + esc(email) + "。把验证码和新密码填进下面，点「确认重置」。");
      $("lg-alerts").insertAdjacentHTML("beforeend",
        '<div class="peo-open-row">' +
        '<input id="lg-rs-code" type="text" inputmode="numeric" placeholder="邮箱里的验证码" />' +
        '<input id="lg-rs-pass" type="password" placeholder="新密码" />' +
        '<button type="button" class="btn btn-primary" id="lg-rs-go" style="padding:0.42rem 0.9rem;font-size:0.82rem;">确认重置</button>' +
        "</div>");
      $("lg-rs-go").addEventListener("click", function () {
        var c = $("lg-rs-code").value.trim(), p = $("lg-rs-pass").value;
        if (!c || !p) { alertIn($("lg-alerts"), "error", "验证码和新密码都要填。"); return; }
        busyOn(this, "重置中…");
        resetHandle.updateUser({ nonce: c, password: p }).then(function (rr) {
          busyOff($("lg-rs-go"));
          if (rr.error) { alertIn($("lg-alerts"), "error", "重置失败：" + (rr.error.message || "验证码可能不对")); return; }
          alertIn($("lg-alerts"), "ok", "密码已重置，用新密码登录吧。");
        }).catch(function () {
          busyOff($("lg-rs-go"));
          alertIn($("lg-alerts"), "error", "重置失败，请重试。");
        });
      });
    }).catch(function () {
      busyOff($("lg-forget"));
      alertIn($("lg-alerts"), "error", "发送失败，请稍后重试。");
    });
  });
});
