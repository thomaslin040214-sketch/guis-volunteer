/* ============================================================
   GUIS 义工社 — 我的义工账户（学生端，me.html）

   谁能进：学校邮箱（@guiscn.com）且已在后台「学生名单」里登记过的人。
   邮箱后缀不用学生自己填 —— 页面上只让填 @ 前面的部分，我们拼上后缀。

   为什么开通要过一遍邮箱验证码：云服务没有「后台批量建号并预设密码」的接口，
   只能让本人拿邮箱验证码来开。这一步同时也证明了这个邮箱确实是他本人的，
   比统一发一个初始密码更安全。
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var C = window.GUISCloud;
  var $ = function (id) { return document.getElementById(id); };
  var SUFFIX = "@guiscn.com";

  var me = { email: "", name: "", grade: "", student_id: "", mustChange: false, token: "" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function alertIn(el, kind, msg) { if (el) el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>"; }
  function clear(el) { if (el) el.innerHTML = ""; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDT(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtDay(iso) {
    if (!iso) return "时间待定";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "时间待定";
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
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
  /* 前缀 → 完整邮箱：去掉学生可能多打进来的后缀，也去空格 */
  function fullEmail(prefix) {
    var p = String(prefix || "").trim().toLowerCase();
    if (!p) return "";
    if (p.indexOf("@") >= 0) return p;                 /* 他还是填了全邮箱，直接用 */
    return p + SUFFIX;
  }

  /* ---------------- 域名提示 ---------------- */
  (function () {
    var host = location.origin;
    if (host && C.endpoint && host.replace(/\/+$/, "") !== C.endpoint.replace(/\/+$/, "")) {
      $("origin-link").textContent = C.endpoint;
      $("origin-link").href = C.endpoint + "/me.html";
      $("origin-banner").hidden = false;
    }
  })();

  /* ---------------- 登录态 ---------------- */
  var loginView = $("login-view"), appView = $("app-view");

  function showLogin() { appView.hidden = true; loginView.hidden = false; }
  function showApp() { loginView.hidden = true; appView.hidden = false; }

  C.getSession().then(function (res) {
    var s = res && res.data;
    if (s && s.user && s.user.email) enter(s.user.email);
    else showLogin();
  }).catch(showLogin);

  $("me-logout").addEventListener("click", function () {
    C.auth.signOut().then(showLogin).catch(showLogin);
  });

  /* ---------------- 登录 ---------------- */
  $("me-login").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = fullEmail($("me-user").value);
    var pass = $("me-pass").value;
    if (!email) { alertIn($("me-alerts"), "error", "请填写学校邮箱前缀。"); return; }
    if (!/@guiscn\.com$/.test(email)) {
      alertIn($("me-alerts"), "error", "请用学校邮箱（@" + "guiscn.com" + "）登录。");
      return;
    }
    if (!pass) { alertIn($("me-alerts"), "error", "请填写密码。"); return; }

    var btn = $("me-login-go");
    busyOn(btn, "登录中…");
    C.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      busyOff(btn);
      if (r.error) { alertIn($("me-alerts"), "error", "邮箱或密码不正确。"); return; }
      enter(email);
    }).catch(function () {
      busyOff(btn);
      alertIn($("me-alerts"), "error", "登录失败，请稍后重试。");
    });
  });

  /* ---------------- 登录 / 开通 两个表单切换 ---------------- */
  var forms = { login: $("me-login"), activate: $("me-activate") };
  function showForm(name) {
    Object.keys(forms).forEach(function (k) { forms[k].hidden = k !== name; });
    Array.prototype.forEach.call($("me-seg").children, function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-mode") === name);
    });
    clear($("me-alerts"));
  }
  Array.prototype.forEach.call($("me-seg").children, function (b) {
    b.addEventListener("click", function () { showForm(b.getAttribute("data-mode")); });
  });

  /* ---------------- 首次开通 ----------------
     流程：核对名单 → 发验证码到学校邮箱 → 验码 → 设密码建号。
     名单核对走 check_student_email()（SECURITY DEFINER）：
     这时候他还没账号，是匿名调用，直接查表会被 RLS 挡掉。 */
  var pending = null;

  $("me-send").addEventListener("click", function () {
    var email = fullEmail($("me-new-user").value);
    if (!email) { alertIn($("me-alerts"), "error", "请先填写学校邮箱前缀。"); return; }
    var btn = this;
    busyOn(btn, "核对中…");

    C.checkStudentEmail(email).then(function (res) {
      var row = (C.unwrap(res, "核对失败") || [])[0] || {};
      if (!row.known) {
        busyOff(btn);
        alertIn($("me-alerts"), "error",
          "这个邮箱（" + esc(email) + "）不在学校登记的学生名单里，暂时不能开通。" +
          "请确认前缀有没有打错，或联系义工社执委会把你的邮箱加进名单。");
        return;
      }
      if (row.activated) {
        busyOff(btn);
        alertIn($("me-alerts"), "warn", "这个邮箱已经开通过了，直接用「登录」进去就行。");
        showForm("login");
        $("me-user").value = String(email).replace(/@.*$/, "");
        return;
      }
      return C.auth.sendOtp({ email: email }).then(function (r) {
        busyOff(btn);
        if (r.error) { alertIn($("me-alerts"), "error", "验证码发送失败：" + (r.error.message || "请稍后重试")); return; }
        pending = { email: email, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
        alertIn($("me-alerts"), "ok", "验证码已发到 " + esc(email) + "，请查收邮箱（含垃圾邮件）。");
      });
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("me-alerts"), "error", "核对失败：" + (err && err.message ? err.message : ""));
    });
  });

  $("me-activate").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!pending) { alertIn($("me-alerts"), "error", "请先点「获取验证码」。"); return; }
    var code = $("me-code").value.trim();
    var pass = $("me-new-pass").value;
    if (!code) { alertIn($("me-alerts"), "error", "请填写邮箱里的验证码。"); return; }
    if (!pass || pass.length < 6) { alertIn($("me-alerts"), "error", "密码至少 6 位。"); return; }

    var btn = $("me-activate-go");
    busyOn(btn, "开通中…");

    C.auth.verifyOtp({
      email: pending.email,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code
    }).then(function (r) {
      if (r.error) { busyOff(btn); alertIn($("me-alerts"), "error", "验证码不正确或已过期。"); return; }
      var vt = r.data && r.data.verificationToken;
      if (!vt) { busyOff(btn); alertIn($("me-alerts"), "error", "没有拿到开通凭证，请重试。"); return; }
      return C.auth.signUp({ email: pending.email, password: pass, verificationToken: vt }).then(function (s) {
        if (s.error) { busyOff(btn); alertIn($("me-alerts"), "error", "开通失败：" + (s.error.message || "请重试")); return; }
        return C.markStudentActivated().catch(function () {}).then(function () {
          enter(pending.email);
        });
      });
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("me-alerts"), "error", "开通失败：" + (err && err.message ? err.message : ""));
    });
  });

  /* ---------------- 忘记密码 ---------------- */
  var resetHandle = null;
  $("me-goto-reset").addEventListener("click", function () {
    var email = fullEmail($("me-user").value);
    if (!email) { alertIn($("me-alerts"), "warn", "先填好学校邮箱前缀，再点这里。"); return; }
    busyOn(this, "发送中…");
    C.auth.resetPasswordForEmail(email).then(function (r) {
      busyOff($("me-goto-reset"));
      if (r.error) { alertIn($("me-alerts"), "error", "发送失败：" + (r.error.message || "请稍后重试")); return; }
      resetHandle = r.data;
      alertIn($("me-alerts"), "ok", "重置验证码已发到 " + esc(email) +
        "。把验证码和新密码填进下面，点「确认重置」。");
      $("me-alerts").insertAdjacentHTML("beforeend",
        '<div class="peo-open-row">' +
        '<input id="me-rs-code" type="text" inputmode="numeric" placeholder="邮箱里的验证码" />' +
        '<input id="me-rs-pass" type="password" placeholder="新密码" />' +
        '<button type="button" class="btn btn-primary" id="me-rs-go" style="padding:0.42rem 0.9rem;font-size:0.82rem;">确认重置</button>' +
        "</div>");
      $("me-rs-go").addEventListener("click", function () {
        var c = $("me-rs-code").value.trim(), p = $("me-rs-pass").value;
        if (!c || !p) { alertIn($("me-alerts"), "error", "验证码和新密码都要填。"); return; }
        busyOn(this, "重置中…");
        resetHandle.updateUser({ nonce: c, password: p }).then(function (rr) {
          busyOff($("me-rs-go"));
          if (rr.error) { alertIn($("me-alerts"), "error", "重置失败：" + (rr.error.message || "验证码可能不对")); return; }
          alertIn($("me-alerts"), "ok", "密码已重置，用新密码登录吧。");
        }).catch(function () {
          busyOff($("me-rs-go"));
          alertIn($("me-alerts"), "error", "重置失败，请重试。");
        });
      });
    }).catch(function () {
      busyOff($("me-goto-reset"));
      alertIn($("me-alerts"), "error", "发送失败，请稍后重试。");
    });
  });

  /* ---------------- 进入账户 ---------------- */
  function enter(email) {
    me.email = String(email || "").toLowerCase();
    $("me-email").textContent = me.email;
    showApp();

    /* 姓名 / 年级：先在学生名单里找，找不到就用报名记录里的 */
    return C.checkStudentEmail(me.email).then(function (res) {
      var row = (C.unwrap(res, "读取失败") || [])[0] || {};
      me.name = row.full_name || "";
      me.grade = row.grade || "";
      me.student_id = row.student_id || "";
      return C.myAccess();
    }).then(function (ar) {
      var a = (ar && ar.data && ar.data[0]) || {};
      me.mustChange = !!a.must_change_password;
      paintHero();
      if (me.mustChange) paintForceChange();
      return loadService();
    }).catch(function (err) {
      alertIn($("me-alerts2"), "error", "读取失败：" + (err && err.message ? err.message : ""));
    });
  }

  function paintHero() {
    var nm = me.name || String(me.email).split("@")[0] || "同学";
    $("me-name").textContent = nm;
    $("me-avatar").textContent = nm.slice(0, 1);
    var bits = [];
    if (me.email) bits.push(me.email);
    if (me.grade) bits.push(me.grade);
    if (me.student_id) bits.push("学号 " + me.student_id);
    $("me-sub").textContent = bits.join(" · ");
  }

  /* 执委会给设了初始密码的人，第一次进来必须先改掉 */
  function paintForceChange() {
    $("me-force").innerHTML =
      '<div class="alert alert-warn" style="margin-bottom:1.25rem;">' +
      "<b>请先改掉初始密码。</b>这个账号是执委会帮你开通的，初始密码只有你自己知道才安全。" +
      '<div class="peo-open-row">' +
      '<input id="me-fc-code" type="text" inputmode="numeric" placeholder="邮箱里的验证码" />' +
      '<input id="me-fc-pass" type="password" placeholder="新密码（至少 6 位）" />' +
      '<button type="button" class="btn btn-secondary" id="me-fc-send" style="padding:0.42rem 0.9rem;font-size:0.82rem;">获取验证码</button>' +
      '<button type="button" class="btn btn-primary" id="me-fc-go" style="padding:0.42rem 0.9rem;font-size:0.82rem;">确认修改</button>' +
      "</div></div>";

    var handle = null;
    $("me-fc-send").addEventListener("click", function () {
      busyOn(this, "发送中…");
      C.auth.resetPasswordForEmail(me.email).then(function (r) {
        busyOff($("me-fc-send"));
        if (r.error) { alertIn($("me-alerts2"), "error", "发送失败：" + (r.error.message || "")); return; }
        handle = r.data;
        alertIn($("me-alerts2"), "ok", "验证码已发到 " + esc(me.email) + "。");
      }).catch(function () { busyOff($("me-fc-send")); });
    });

    $("me-fc-go").addEventListener("click", function () {
      if (!handle) { alertIn($("me-alerts2"), "warn", "先点「获取验证码」。"); return; }
      var c = $("me-fc-code").value.trim(), p = $("me-fc-pass").value;
      if (!c || p.length < 6) { alertIn($("me-alerts2"), "error", "验证码要填，新密码至少 6 位。"); return; }
      busyOn(this, "修改中…");
      handle.updateUser({ nonce: c, password: p }).then(function (r) {
        busyOff($("me-fc-go"));
        if (r.error) { alertIn($("me-alerts2"), "error", "修改失败：" + (r.error.message || "")); return; }
        return C.updateMember(me.email, { must_change_password: false }).catch(function () {});
      }).then(function () {
        me.mustChange = false;
        clear($("me-force"));
        alertIn($("me-alerts2"), "ok", "密码已改好，下次用新密码登录。");
      }).catch(function () { busyOff($("me-fc-go")); });
    });
  }

  /* ---------------- 义工记录 ---------------- */
  function loadService() {
    $("me-loading").hidden = false;
    $("me-list").hidden = true;
    $("me-empty").hidden = true;

    return C.myService().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      $("me-loading").hidden = true;

      if (!rows.length) {
        $("me-empty").hidden = false;
        $("me-total").textContent = "0";
        return;
      }

      var total = 0;
      rows.forEach(function (r) {
        var h = (r.hours != null ? Number(r.hours) : Number(r.default_hours || 0));
        total += h;
      });
      $("me-total").textContent = String(Math.round(total * 100) / 100);

      /* 二维码：优先用已经录取的那条记录的码 —— 那就是老师会扫的码 */
      var tokRow = rows.filter(function (r) { return r.selected && r.check_token; })[0] ||
                   rows.filter(function (r) { return r.check_token; })[0];
      me.token = tokRow ? tokRow.check_token : "";
      paintQrBox(tokRow);

      $("me-list").hidden = false;
      $("me-list").innerHTML = rows.map(function (r) {
        var h = (r.hours != null ? Number(r.hours) : Number(r.default_hours || 0));
        var state = r.checked_in
          ? "已签到 · " + fmtDT(r.checked_in_at)
          : (r.selected ? "已录取 · 未签到" : "已报名 · 等录取结果");
        return '<div class="svc' + (r.checked_in ? " is-in" : "") + '">' +
          '<div class="svc-main">' +
            '<div class="svc-title">' + esc(r.title) + "</div>" +
            '<div class="svc-sub">' + fmtDay(r.starts_at) +
              (r.location ? " · " + esc(r.location) : "") +
              (r.category ? " · " + esc(r.category) : "") + "</div>" +
            '<div class="svc-sub">' + state + "</div>" +
          "</div>" +
          '<div class="svc-right">' +
            '<div class="svc-hours">' + (Math.round(h * 100) / 100) + " 小时</div>" +
            '<div class="svc-state">' + (r.hours != null ? "单独核定" : "按活动时长") + "</div>" +
          "</div>" +
        "</div>";
      }).join("");
    }).catch(function (err) {
      $("me-loading").hidden = true;
      alertIn($("me-alerts2"), "error", "读取失败：" + (err && err.message ? err.message : ""));
    });
  }

  function paintQrBox(row) {
    var box = $("me-qr-box");
    if (!row || !row.check_token) {
      box.innerHTML = '<p class="hint" style="margin:0;">你现在还没有可签到的二维码 —— ' +
        "报名并且被录取之后，这里会自动出现属于你的码。</p>";
      return;
    }
    box.innerHTML = '<div class="qr-loading"><span class="loading"></span> 正在生成…</div>';
    window.GUISQR.loadGen().then(function () {
      box.innerHTML = "";
      var holder = document.createElement("div");
      holder.style.cssText = "width:220px;margin:0 auto;padding:.55rem;border:1px solid var(--hairline);border-radius:var(--radius-sm);background:#fff;";
      box.appendChild(holder);
      window.GUISQR.render(holder, row.check_token, 208);
      var note = document.createElement("p");
      note.className = "hint";
      note.style.cssText = "margin:.85rem 0 0;text-align:center;";
      note.innerHTML = "这是「<b>" + esc(row.title) + "</b>」的签到码 · 码：" + esc(row.check_token);
      box.appendChild(note);
    }).catch(function (err) {
      box.innerHTML = '<div class="alert alert-error">生成失败：' + esc(err && err.message) + "</div>";
    });
  }

  $("me-qr").addEventListener("click", function () {
    if (!me.token) { alertIn($("me-alerts2"), "warn", "还没有属于你的签到码 —— 先报名并被录取。"); return; }
    window.GUISQR.showOne({
      title: "我的签到二维码",
      sub: "现场出示给负责老师扫；也可以截图保存。",
      name: me.name || String(me.email).split("@")[0],
      sub2: [me.grade, me.student_id].filter(Boolean).join(" · "),
      token: me.token,
      size: 240
    });
  });

  $("me-refresh").addEventListener("click", function () { loadService(); });
});
