/* ============================================================
   GUIS 义工组织 — 统一登录（login.html）

   一个入口，登录后自动分流：
     组织成员 owner   → admin.html    后台（能改活动/刊物/公告）
     负责老师 teacher → checkin.html  签到页（只能给自己负责的活动签到）
     学生 student   → me.html       我的义工账户

   身份从哪来：登录成功之后调 my_access()（SECURITY DEFINER），
   它返回 role —— 不在人员名单里的人默认就是 'student'。
   ⚠️ 判定必须在「登录成功之后」：先验证密码再告知身份，
      免得任何人拿一个邮箱就能试探出他是什么角色。

   首次开通只对学生开放：@guiscn.com + 在后台「学生名单」里登记过，
   走 check_student_email()（匿名可调的 SECURITY DEFINER 函数）核对。
   老师和组织成员没有自助开通入口 —— 由组织成员在后台加进名单。
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var C = window.GUISCloud;
  var $ = function (id) { return document.getElementById(id); };
  var SUFFIX = "@guiscn.com";

  /* 登录后的落脚页由 roles.js 统一管（owner→后台、teacher→签到、member→后台、student→我的账户），
     免得这里和 session.js 各写一份、以后改一处忘一处。 */
  function destFor(role) { return window.GUISRoles.home(role); }

  /* ?next=xxx.html —— 从别的页面被弹过来登录时，登完回到那一页。
     （校外时长认定页、后台、签到页、面试台都是这么跳过来的。）
     ⚠️ 只认本站的 .html 相对路径，别的什么都不认 —— 否则这就是一个开放重定向，
        把 ?next= 换成外站链接就能把人骗出去。
     落地页自己会再查一次服务端权限（is_allowed_admin / my_access），
     所以就算有人拿 ?next=admin.html 把自己塞进后台，服务端也会按真实角色挡住。 */
  function nextDest(role) {
    try {
      var n = new URLSearchParams(location.search).get("next") || "";
      if (!/^[a-zA-Z0-9_-]+\.html$/.test(n)) return destFor(role);
      return n;
    } catch (e) { return destFor(role); }
  }

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
      /* 归一化在 roles.js：库里出现前端不认识的 role 时宁可当学生，
         也不要因为二选一的 else 支把人当成能改小时的老师。 */
      var role = window.GUISRoles.norm(row.role);
      var dest = nextDest(role);
      var who = window.GUISRoles.labelOf(role);
      var msg = window.GUISRoles.isMember(role)
        ? "识别到你是" + who + "，正在进入后台…"
        : "进入「我的义工账户」…";

      /* ⚠️ 2026-10-12 死循环修复（真实故障：陈颂茵今天 14:22 改了密码却再也进不去）。
         成因链条：
           后台「开通账号」→ signUp 成功 → 写 must_change_password = true
           → 她改了自己的密码
           → 但**只有 me.html 会清这个标记**（me.js 的 paintForceChange 里那一行）
           → 而 role=owner/teacher 登录后 nextDest() 直接送后台，根本不经 me.html
           → 标记永远留着，于是每次回来都被判定「还必须改密码」，反复改、永远进不去。
         所以这里在**登录成功这一刻**清掉：能走到 go() 说明密码已经验证通过了，
         标记的唯一作用就是「提醒首次登录者改掉初始密码」，
         它没被清本身就是上一次流程漏了步，不是现在还需要拦的事。
         ⚠️ 静默失败：清不掉也不能挡住跳转 —— 否则这条线会把人卡死在登录页。 */
      var pending = !!row.must_change_password;
      if (pending) {
        box.innerHTML = '<div class="alert alert-ok">' + esc(msg) + "</div>";
        setTimeout(function () { location.href = dest; }, 650);
        Promise.resolve(C.updateMember(row.email || email, { must_change_password: false }))
          .catch(function () { /* 清理失败不阻断登录 */ });
        return role;
      }

      box.innerHTML = '<div class="alert alert-ok">' + esc(msg) + "</div>";
      setTimeout(function () { location.href = dest; }, 650);
      return role;
    }).catch(function () {
      /* 拿不到角色也别卡死：按学生处理，学生页自己会再判一次 */
      box.innerHTML = '<div class="alert alert-warn">' +
        esc(t("lg.detecting", "正在识别你的身份…")) + "</div>";
      setTimeout(function () { location.href = nextDest("student"); }, 800);
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

  /* ---------------- 已经登录过就直接走 ----------------
     ⚠️ 邮箱必须走 C.sessionUser()：getSession() 的返回里没有 email，
        以前在这里判 s.user.email 永远不成立，登录完还会被弹回表单。 */
  C.sessionUser().then(function (u) {
    if (!u || !u.email) return;
    $("lg-email-known").textContent = u.email;
    $("lg-known").hidden = false;
    go(u.email);
  }).catch(function () {});

  /* ---------------- 两种方式切换 ----------------
     曾经还有「验证码登录」这一档：它和「首次开通」的第二半步完全重复
     （都是「发 6 位码到邮箱 → 填码」），多一个入口只是多一种走错的可能，
     2026-09-30 由用户决定删掉。要找回就看 git 历史里的 mode:"otp"。 */
  /* ---------------- 自动判断该走哪一步（2026-10-12） ----------------
     原来是 .seg 两个 tab（密码登录 / 首次开通）让用户自己选，
     现在按用户要求合并成一个表单：填了邮箱就自动判断。
     ⚠️ 结构没变，showForm 这个函数名和签名都留着，只是去掉了切换 tab 那部分 ——
        后面几处有has_account 分支会调它来「把人导去密码登录」。

     mode: "pass" 已有账号 → 只出密码那一格
           "new"  还没开通 → 出验证码 + 设密码两格
           null   还不知道 / 没填邮箱 → 两个都不出，给一句提示
     ⚠️ 别一上来就 showForm("pass")：那等于又变回「默认密码登录」，
        没开通的同学又会撞上「没有拿到开通凭证」。默认应该是「等你填邮箱」。 */
  /* 🚨🚨 这里曾经有一个极隐蔽的 bug，务必看懂：
     键名叫 `neu`，而 detect() 里调的是 showForm("new") —— **不匹配**。
     于是 forms["new"] 是 undefined，`forms["new"].hidden = ...` 抛 TypeError，
     异常又被 detect().catch 吞掉。结果：
       · 提示文字是对的（「这个邮箱还没开通过……」）
       · 但 form-new 始终 hidden，用户只看到一句话、没有输入框
     看起来像「判定对了但界面没反应」，极难定位。
     现在两个动作：(1) 键名与调用统一用 new；(2) showForm 对未知键直接抛，
     让这类拼写错误立刻炸出来，而不是被 catch 悄悄吃掉。 */
  var forms = { pass: $("form-pass"), "new": $("form-new") };
  function showForm(name) {
    if (name && !forms[name]) {
      /* 键名写错时立刻炸，别让它变成「界面没反应」这种疑难杂症 */
      throw new Error("showForm: 未知分支 '" + name + "'（可用：" + Object.keys(forms).join("/") + "）");
    }
    Object.keys(forms).forEach(function (k) { forms[k].hidden = k !== name; });
    /* 「下一步」按钮：**未判定时反而要显示**（用户填完邮箱得有个可点的目标），
       判定出结果后就没用了，藏起来免得点它又重新查一遍。
       ⚠️ 逻辑别写反：showForm(null) 是「还没判定」，不是「什么都不给」。 */
    var step = $("lg-step-row");
    if (step) step.hidden = !!name;
    if (!name) clear($("lg-alerts"));
  }
  showForm(null);

  /* 邮箱输入框：失焦时自动判断。
     ⚠️ 现在只有一个邮箱框了（常驻在所有 form 之外，见 login.html）。
        🚨 第一版把邮箱框放在两个分支 form 里面、初始又 showForm(null) ——
        结果两个 form 都藏着，**邮箱框也跟着消失**，用户拿到的是一个空白页
        （靠用户发截图才发现）。这个坑写进 login.html 的注释里了，别再犯。 */
  function detect() {
    var email = fullEmail($("lg-email").value);
    if (!email) { showForm(null); return Promise.resolve(null); }

    return C.checkStudentSignup(email).then(function (res) {
      var row = (C.unwrap(res, "核对失败") || [])[0] || {};
      /* 组织成员 / 老师不在学生名单里（known=false）但有账号 ——
         他们只能走密码登录，所以不能因为 known 为false 就说「不在名单」。
         这也顺带覆盖了 linjtom@gmail.com 这类非学校邮箱的开通者。 */
      if (!row.known && !row.has_account) {
        showForm(null);
        alertIn($("lg-alerts"), "error",
          "这个邮箱（" + esc(email) + "）不在学校登记的学生名单里，也还没有账号。" +
          "请确认前缀有没有打错，或联系义工组织把它加进名单。");
        return null;
      }
      if (row.has_account || row.activated) {
        showForm("pass");
        alertIn($("lg-alerts"), "ok", "这个邮箱已经有账号了 —— 填密码就能登录。");
      } else {
        showForm("new");
        alertIn($("lg-alerts"), "ok",
          "这个邮箱还没开通过 —— 点「获取验证码」，收信里的 6 位数字，设一个密码就好。");
      }
      return row;
    }).catch(function (err) {
      /* ⚠️ 查不到就退回「问用户要密码」，但别卡死 ——
         网络抖动不该让人连表单都填不了。 */
      showForm("pass");
      alertIn($("lg-alerts"), "warn",
        "没能自动判断（" + ((err && err.message) || "网络问题") + "），请直接用密码登录。");
      return null;
    });
  }
  /* 邮箱框只有一个（常驻在两个 form 之外，见 login.html），失焦时自动判断。
     ⚠️ 原来这里挂两个框（lg-email / lg-new-email）互相复制前缀，
        现在 lg-new-email 已随分支一起删掉 —— 复制逻辑一并去掉。 */
  var emailBox = $("lg-email");
  if (emailBox) emailBox.addEventListener("blur", detect);

  /* 「下一步」按钮：填了邮箱但没触发失焦（比如直接点按钮）也能往下走。
     没有它的话，用户填完只能干等着自己点走。 */
  var stepBtn = $("lg-step");
  if (stepBtn) stepBtn.addEventListener("click", detect);

  /* 「我已经有账号了」：手动覆盖自动判断的结果（自动判断万一查错了还能救）。 */
  var sw = $("lg-switch");
  if (sw) sw.addEventListener("click", function () {
    showForm("pass");
    alertIn($("lg-alerts"), "ok", "已切到密码登录。填邮箱后如果又跳回来，点下面那个链接就行。");
    var e = $("lg-pass");
    if (e) e.focus();
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

  /* ---------------- 首次开通（仅学生） ----------------
     「获取验证码」按钮就摆在验证码输入框右边（.inp-row），
     所以这一步会先拿 student_directory 核对名单，通过了才发码。 */
  var pendingNew = null;
  $("lg-new-send").addEventListener("click", function () {
    /* ⚠️ 邮箱框已合并成一个（常驻在两个 form 之外），原来这里读的是
       lg-new-email，那个框随分支一起删掉了 —— 改成读同一个 lg-email。 */
    var email = fullEmail($("lg-email").value);
    if (!email) { alertIn($("lg-alerts"), "error", "请先填写学校邮箱前缀。"); return; }
    if (!/@guiscn\.com$/.test(email)) {
      alertIn($("lg-alerts"), "error", "自助开通只对学校邮箱（@guiscn.com）开放。负责老师和组织成员请让组织成员先在后台「人员管理」里加你的邮箱。");
      return;
    }
    busyOn(this, "核对中…");
    C.checkStudentSignup(email).then(function (res) {
      var row = (C.unwrap(res, "核对失败") || [])[0] || {};
      /* ⚠️ 判定条件与上面的 detect() 必须一致：不光看 known，还要看 has_account。
         组织成员 / 老师的邮箱往往不在学生名单里（known=false）但**有账号** ——
         他们该走密码登录，而不是被一句「不在学生名单」拦在这里。 */
      if (!row.known && !row.has_account) {
        busyOff($("lg-new-send"));
        alertIn($("lg-alerts"), "error",
          "这个邮箱（" + esc(email) + "）不在学校登记的学生名单里，暂时不能自助开通。" +
          "请确认前缀有没有打错，或联系义工组织把你的邮箱加进名单。");
        return;
      }
      /* ⚠️ 2026-10-12 修的真故障（yeewu2742 等人卡在这里，报「没有拿到开通凭证」）。
         判断「能不能走首次开通」必须看 has_account（服务端查 auth.users），
         **不能只看 student_directory.activated** —— 那两个状态会不一致：
         后台开通了账号但人没走过首次开通时，activated 还是 false。
         继续走下去的话 verifyOtp 对已存在的账号不返回 verificationToken，
         用户只看到一句「没有拿到开通凭证，请重试」，完全不知道该干嘛。

         有账号就直接把人送到密码登录，并把提示说清楚 ——
         「你已经有账号了」这件事本身就是要传达的核心信息。 */
      if (row.has_account || row.activated) {
        busyOff($("lg-new-send"));
        alertIn($("lg-alerts"), "warn",
          "这个邮箱**已经有账号了**，用「密码登录」直接进就行。" +
          "（忘了密码 → 点下面的「忘记密码」。）");
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
      if (!vt) {
        busyOff($("lg-new-go"));
        /* ⚠️ 这里几乎可以断定是「这个邮箱已经有账号了」——
           verifyOtp 对已存在的账号会正常返回但不带 verificationToken。
           所以别再丢一句「请重试」（用户会反复点，永远还是这个结果），
           直接告诉他下一步该做什么。 */
        alertIn($("lg-alerts"), "warn",
          "这个邮箱**已经有账号了**，所以不能再走「首次开通」。" +
          "请点下面的「密码登录」直接进；若密码忘了，点「忘记密码」重置。");
        showForm("pass");
        $("lg-email").value = String(pendingNew.email).replace(/@.*$/, "");
        return;
      }
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
