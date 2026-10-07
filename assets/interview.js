/* ============================================================
   GUIS 义工组织 — 招新面试工作台（interview.html）

   解决什么问题：
     招新面试是一天连着面十几个人、每人 15 分钟。面试官需要的是
     「现在该谁了 / 点一下就把分和评语记下来」，而不是先找表格再找行。
     所以这个页面不叫「管理」，叫**面试台** —— 打开就是当天那条队列。

   三块内容：
     1. 面试台    —— 按天分组的候选人卡片。正在面的那张会亮起来，
                    并显示还剩几分钟；点「记录」弹出打分 / 结论 / 评语。
     2. 时间表管理 —— 只有执委会（owner）看得到。表格里直接改字，
                    也可以整段粘贴导入（从 Excel 复制过来的那种）。
     3. 导出      —— 把当天记录导成 CSV。

   数据在两张表里（见 cloud.js 的「招新面试」一节）：
     · interview_slots   —— 时间表，执委会能改，负责老师可读
     · interview_records —— 记录，一个时段一条，执委会与负责老师都能写
   学生读不到这两张表；学生只看得到 my_interview() 给的那一条安排。

   ⚠️ 页面里所有时间一律按**本地时间**算（new Date("2026-10-07T16:40")）——
      绝不用 toISOString()，那是 UTC，会在晚上 8 点后把日期算到第二天去。
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var C = window.GUISCloud;
  var $ = function (id) { return document.getElementById(id); };

  /* 打分维度 / 部门清单都从 cloud.js 拿 —— 只有一个地方写死，
     改口径（比如以后加一项「英语表达」）不用满页面找。 */
  var CRIT = (C && C.IV_CRITERIA) || ["表达沟通", "责任态度", "团队协作", "岗位匹配"];
  var DEPTS = ["Human Resources", "organization", "publicity"];
  var RESULT_LABEL = { pending: "未定", pass: "通过", hold: "待定", fail: "不通过" };

  var ME = { email: "", role: "teacher" };
  function isOwner() { return ME.role === "owner"; }

  var slots = [];      /* 全部场次（服务端已按 day, slot_start 排好） */
  var recs = {};       /* slot_id -> 记录，只留最新一条（唯一索引保证只有一个） */
  var day = "";        /* 当前选中的日期 YYYY-MM-DD */
  var editing = null;  /* 正在编辑的场次对象 */
  var draft = null;    /* 弹层里的草稿：{ scores, result, offer_dept, note, interviewer_email } */

  /* ---------------- 通用工具 ----------------
     和 checkin.js 同一套写法，几个工作人员页面保持一致。 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function alertIn(el, kind, msg) {
    if (el) el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { if (el) el.innerHTML = ""; }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function num1(v) { return String(Math.round(Number(v) * 10) / 10); }
  function shortEmail(e) { return String(e || "").split("@")[0]; }
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
  function failMsg(err, fallback) {
    var m = (err && err.message) ? err.message : "";
    var code = err && (err.code || (err.raw && err.raw.code));
    if (code === "23505" || /duplicate key/i.test(m)) {
      return "同一时段同一个人已经有一条了 —— 改一改时间或姓名再存。";
    }
    if (code === "42501" || /row-level security|violates row-level/i.test(m)) {
      return "权限不足：服务端拒绝了这次写入。改时间表需要执委会身份，记面试结果需要先加入后台人员名单。";
    }
    if (!m && !code) return (fallback || "操作失败") + "。";
    return (fallback || "操作失败") + "：" + m;
  }

  /* ---------------- 时间 ----------------
     ⚠️ 日期一律本地时间拼。slot_start / slot_end 从 PostgREST 回来是 "16:40:00"，
        显示取前 5 位；比较用 new Date(day + "T" + 时间) 走本地时区。 */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function hm(t) { return String(t || "").slice(0, 5); }
  function dayLabel(ymd) {
    var d = new Date(String(ymd) + "T00:00");
    if (isNaN(d.getTime())) return String(ymd);
    return (d.getMonth() + 1) + "." + d.getDate() + " 周" +
      ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  }
  function at(s, which) {
    return new Date(s.day + "T" + (which === "end" ? s.slot_end : s.slot_start)).getTime();
  }
  function stateOf(s) {
    var n = Date.now();
    if (n >= at(s, "end")) return "past";
    if (n >= at(s, "start")) return "live";
    return "later";
  }
  function addMinutes(hhmm, m) {
    var p = String(hhmm || "16:40").split(":");
    var t = Number(p[0]) * 60 + Number(p[1]) + Number(m || 0);
    t = ((t % 1440) + 1440) % 1440;
    return pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
  }

  /* ---------------- 分组与统计 ---------------- */
  function daysOf() {
    var seen = {}, out = [];
    slots.forEach(function (s) {
      if (!seen[s.day]) { seen[s.day] = 1; out.push(s.day); }
    });
    return out.sort();
  }
  function slotsOf(d) {
    return slots.filter(function (s) { return String(s.day) === String(d); });
  }
  function metricsOf(d) {
    var m = { total: 0, done: 0, pass: 0, hold: 0, fail: 0, pending: 0, miss: 0 };
    slotsOf(d).forEach(function (s) {
      m.total++;
      var r = recs[s.id];
      if (!r) {
        /* 时间过了还没记录 = 漏记，要提醒，不然面试完就忘了 */
        if (stateOf(s) === "past") m.miss++;
        return;
      }
      m.done++;
      if (r.result === "pass") m.pass++;
      else if (r.result === "hold") m.hold++;
      else if (r.result === "fail") m.fail++;
      else m.pending++;
    });
    return m;
  }
  /* 默认选中哪一天：今天有安排就是今天，否则最近的一场；都比过就选最后一场 */
  function pickDay(ds) {
    var t = todayStr();
    if (ds.indexOf(t) >= 0) return t;
    for (var i = 0; i < ds.length; i++) if (ds[i] > t) return ds[i];
    return ds[ds.length - 1];
  }

  /* ---------------- 渲染：日期条 ---------------- */
  function renderDays() {
    var ds = daysOf();
    if (!ds.length) { clear($("iv-days")); return; }
    if (ds.indexOf(day) < 0) day = pickDay(ds);
    $("iv-days").innerHTML = ds.map(function (d) {
      var m = metricsOf(d);
      return '<button type="button" class="iv-day' + (String(d) === String(day) ? " is-on" : "") +
        '" data-day="' + d + '">' +
        "<b>" + dayLabel(d) + "</b>" +
        "<span>" + m.done + " / " + m.total + " 已记录</span>" +
        (m.miss ? '<i class="iv-day-warn">' + m.miss + " 位漏记</i>" : "") +
        "</button>";
    }).join("");
  }

  /* ---------------- 渲染：正在面谁 ---------------- */
  function renderNow() {
    var box = $("iv-now");
    if (!slots.length) { box.hidden = true; return; }
    var live = slots.filter(function (s) { return stateOf(s) === "live"; })[0];
    if (live) {
      var left = Math.max(1, Math.round((at(live, "end") - Date.now()) / 60000));
      box.className = "iv-now is-live";
      box.innerHTML = '<span class="iv-live-dot" aria-hidden="true"></span>正在面试 <b>' +
        esc(live.name) + "</b>（" + esc(live.class_name) + " · " + esc(live.dept) +
        "）· 还剩约 <b>" + left + "</b> 分钟" +
        '<button type="button" class="btn btn-primary btn-sm" data-edit="' + live.id + '" style="margin-left:0.6rem;">现在记录</button>';
      box.hidden = false;
      return;
    }
    /* 「下一位」= 还没到点、**并且还没记过**的最早一场。
       ⚠️ 要跳过已经有记录的：面试官常常提前几分钟先把上一位记完，
          这时候如果还把他算成「下一位」，提示就没用了。 */
    var next = slots.filter(function (s) {
      return stateOf(s) === "later" && !recs[s.id];
    })[0];
    if (next) {
      box.className = "iv-now";
      box.innerHTML = "下一位：<b>" + esc(next.name) + "</b> · " +
        dayLabel(next.day) + " " + hm(next.slot_start) + "-" + hm(next.slot_end) +
        " · " + esc(next.dept);
      box.hidden = false;
      return;
    }
    /* 后面已经全记完了就明说，别留一条会让人误以为还有活干的提示 */
    var left = slots.filter(function (s) { return stateOf(s) !== "past"; }).length;
    if (left) {
      box.className = "iv-now";
      box.innerHTML = "接下来的 " + left + " 场都已经记过了 —— 有要改的，在下面卡片上点「改记录」。";
      box.hidden = false;
      return;
    }
    box.hidden = true;
  }

  /* ---------------- 渲染：当天进度 ---------------- */
  function renderMetrics() {
    var m = metricsOf(day);
    if (!m.total) { clear($("iv-metrics")); return; }
    var one = function (v, l, cls) {
      return '<div class="ci-metric' + (cls ? " " + cls : "") + '">' +
        '<span class="ci-mv">' + v + '</span><span class="ci-ml">' + l + "</span></div>";
    };
    $("iv-metrics").innerHTML =
      one(m.total, "应面") +
      one(m.done, "已记录", "is-brand") +
      one(m.pass, "通过") +
      one(m.hold, "待定") +
      one(m.fail, "不通过") +
      (m.miss ? one(m.miss, "漏记", "is-warn") : "");
  }

  /* ---------------- 渲染：候选人卡片队列 ---------------- */
  function badgeOf(s) {
    var r = recs[s.id];
    if (!r) {
      var st = stateOf(s);
      if (st === "past") return '<span class="badge iv-badge-miss">漏记</span>';
      if (st === "live") return '<span class="badge badge-open">进行中</span>';
      return '<span class="badge badge-closed">未开始</span>';
    }
    var cls = r.result === "pass" ? "iv-badge-pass"
      : r.result === "hold" ? "iv-badge-hold"
      : r.result === "fail" ? "iv-badge-fail" : "badge-draft";
    var avg = r.avg_score != null ? " · " + num1(r.avg_score) + " 分" : "";
    return '<span class="badge ' + cls + '">' + RESULT_LABEL[r.result] + avg + "</span>";
  }

  function cardOf(s) {
    var r = recs[s.id];
    var st = stateOf(s);
    var cls = "iv-card";
    if (st === "live") cls += " is-live";
    if (r) cls += " is-done";
    else if (st === "past") cls += " is-miss";

    var by = r && r.interviewer_email
      ? '<span class="iv-by">面试官 ' + esc(shortEmail(r.interviewer_email)) + "</span>"
      : "";
    var offer = r && r.offer_dept ? '<span class="iv-by">拟录用 ' + esc(r.offer_dept) + "</span>" : "";

    return '<div class="' + cls + '">' +
      '<div class="iv-time"><b>' + hm(s.slot_start) + "</b><span>" + hm(s.slot_end) + "</span></div>" +
      '<div class="iv-who">' +
        '<div class="iv-name">' + esc(s.name) +
          (s.name_en ? '<span class="iv-en">' + esc(s.name_en) + "</span>" : "") +
        "</div>" +
        '<div class="iv-meta">' +
          '<span class="iv-cls">' + esc(s.class_name || "—") + "</span>" +
          '<span class="iv-dept">' + esc(s.dept || "—") + "</span>" +
          by + offer +
        "</div>" +
      "</div>" +
      '<div class="iv-act">' + badgeOf(s) +
        '<button type="button" class="btn ' + (r ? "btn-secondary" : "btn-primary") +
          ' btn-sm" data-edit="' + s.id + '">' + (r ? "改记录" : "记录") + "</button>" +
      "</div>" +
    "</div>";
  }

  function renderList() {
    var list = slotsOf(day);
    $("iv-empty").hidden = slots.length > 0;
    if (!list.length) {
      $("iv-list").hidden = true;
      return;
    }
    $("iv-list").hidden = false;
    $("iv-list").innerHTML = list.map(cardOf).join("");
  }

  /* ---------------- 渲染：时间表管理 ---------------- */
  function inp(s, field, value, type, extra) {
    return '<input class="iv-inp" type="' + (type || "text") + '"' + (extra || "") +
      ' data-id="' + s.id + '" data-f="' + field + '" value="' + esc(value == null ? "" : value) + '" />';
  }
  function renderAdmin() {
    if (!isOwner()) { $("iv-admin").hidden = true; return; }
    $("iv-admin").hidden = false;
    var box = $("iv-admin-body");
    if (!slots.length) {
      box.innerHTML = '<tr><td colspan="9" class="hint">还没有任何场次 —— 点右上角「批量粘贴导入」。</td></tr>';
      return;
    }
    box.innerHTML = slots.map(function (s) {
      var r = recs[s.id];
      return "<tr>" +
        /* 日期用**文本框**而不是 <input type="date">：原生日历控件按浏览器的区域设置
           显示成「07/10/2026」，中文用户第一眼会读成 7 月 10 日 —— 而这个站
           到处都是 2026-10-07 的写法。改日期本来也很少见，格式在 change 里校验。 */
        "<td>" + inp(s, "day", s.day, "text", ' spellcheck="false" placeholder="2026-10-07"') + "</td>" +
        "<td>" + inp(s, "slot_start", hm(s.slot_start), "time") + "</td>" +
        "<td>" + inp(s, "slot_end", hm(s.slot_end), "time") + "</td>" +
        "<td>" + inp(s, "name", s.name) + "</td>" +
        "<td>" + inp(s, "name_en", s.name_en) + "</td>" +
        "<td>" + inp(s, "class_name", s.class_name) + "</td>" +
        "<td>" + inp(s, "dept", s.dept) + "</td>" +
        "<td>" + (r ? '<span class="badge ' +
            (r.result === "pass" ? "iv-badge-pass" : r.result === "fail" ? "iv-badge-fail" :
             r.result === "hold" ? "iv-badge-hold" : "badge-draft") + '">' +
            RESULT_LABEL[r.result] + "</span>" : '<span class="hint">—</span>') + "</td>" +
        '<td><button type="button" class="tbl-btn" data-del="' + s.id + '">删除</button></td>' +
      "</tr>";
    }).join("");
  }

  function renderAll() {
    renderDays();
    renderNow();
    renderMetrics();
    renderList();
    renderQuick();
    renderAdmin();
  }

  /* ---------------- 临时加人 ----------------
     现场有人临时插队时用：默认排在所选这天最后一场之后（空的这天从 16:40 起），
     除了日期之外都不自动重置 —— 连续加好几个人的时候，只有名字那几个格子会清空。 */
  var qDay = "";
  function renderQuick() {
    if (!isOwner()) { $("iv-quick").hidden = true; return; }
    $("iv-quick").hidden = false;
    var d = day || todayStr();
    $("q-day").value = d;
    if (qDay === d) return;                       /* 同一天来回重画时别把正在填的内容冲掉 */
    qDay = d;

    var last = null;
    slotsOf(d).forEach(function (s) { if (!last || String(s.slot_end) > String(last.slot_end)) last = s; });
    /* ⚠️ 跟「在当天末尾加一场」同一个口径：紧接上一场的结束时间，别再空 15 分钟 */
    var st = last ? hm(last.slot_end) : "16:40";
    var en = addMinutes(st, 15);
    $("q-start").value = st;
    $("q-end").value = en;
    $("q-hint").textContent = last
      ? "接在当天最后一场（" + hm(last.slot_end) + " 结束）后面：默认 " + st + "–" + en + "，可以直接改。"
      : "这天还没有安排，默认从 " + st + " 开始。";
  }

  /* ---------------- 读数据 ---------------- */
  function loadAll() {
    $("iv-loading").hidden = false;
    return Promise.all([
      C.listInterviewSlots().then(function (r) { return C.unwrap(r, "读取时间表失败"); }),
      C.listInterviewRecords().then(function (r) { return C.unwrap(r, "读取面试记录失败"); })
    ]).then(function (out) {
      slots = out[0] || [];
      recs = {};
      (out[1] || []).forEach(function (r) { recs[r.slot_id] = r; });
      $("iv-loading").hidden = true;
      if (!slots.length) {
        $("iv-empty").hidden = false;
        $("iv-empty").innerHTML = "还没有面试安排。" +
          (isOwner() ? "往下滚到「时间表管理」，把时间表整段粘贴进去。" : "请让执委会先导入时间表。");
      }
      renderAll();
    }).catch(function (err) {
      $("iv-loading").hidden = true;
      alertIn($("iv-alerts"), "error", failMsg(err, "读取失败"));
    });
  }

  /* ---------------- 登录 ---------------- */
  var loginView = $("login-view"), appView = $("app-view");

  function showSignedIn(email) {
    ME.email = email || "";
    $("who-email").textContent = ME.email + (isOwner() ? " · 执委会" : " · 负责老师");
    loginView.hidden = true;
    appView.hidden = false;
    C.touchLogin();
    loadAll();
  }
  function showLogin() {
    appView.hidden = true;
    loginView.hidden = false;
  }

  function enterOrReject(email) {
    return C.isAllowedAdmin().then(function (r) {
      if (r.error || r.data !== true) {
        C.auth.signOut();
        showLogin();
        alertIn($("auth-alerts"), "error",
          "该邮箱（" + esc(email) + "）还没有加入后台人员名单。请让义工组织执委会先到后台「人员管理」页签把邮箱加进来并开通账号。");
        return false;
      }
      /* 角色只有服务端说了算（my_access 是 SECURITY DEFINER）——
         决定「时间表管理」这一块给不给他看。 */
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

  (function () {
    var host = location.origin;
    if (host && C.endpoint && host.replace(/\/+$/, "") !== C.endpoint.replace(/\/+$/, "")) {
      $("origin-link").textContent = C.endpoint;
      $("origin-link").href = C.endpoint + "/interview.html";
      $("origin-banner").hidden = false;
    }
  })();

  /* ⚠️ 用 C.sessionUser() 拿邮箱：getSession() 自己不带 email（见 cloud.js）。 */
  C.sessionUser().then(function (u) {
    if (u) enterOrReject(u.email || "");
    else showLogin();
  }).catch(showLogin);

  $("logout-btn").addEventListener("click", function () {
    C.auth.signOut().then(showLogin).catch(showLogin);
  });

  /* 登录表单：密码 / 邮箱验证码 两种 */
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
    var btn = $("iv-submit"), email = $("iv-email").value.trim(), pass = $("iv-pass").value;
    if (!email || !pass) { alertIn($("auth-alerts"), "error", "请填写邮箱和密码。"); return; }
    btn.disabled = true; btn.textContent = "登录中…";
    C.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      if (r.error) {
        btn.disabled = false; btn.textContent = "登录";
        alertIn($("auth-alerts"), "error", "邮箱或密码不正确。");
        return;
      }
      enterOrReject(email);
    }).catch(function () {
      btn.disabled = false; btn.textContent = "登录";
      alertIn($("auth-alerts"), "error", "登录失败，请稍后重试。");
    });
  });

  var pendingOtp = null;
  $("iv-otp-send").addEventListener("click", function () {
    var email = $("iv-otp-email").value.trim();
    if (!email) { alertIn($("auth-alerts"), "error", "请先填写邮箱。"); return; }
    busyOn($("iv-otp-send"), "发送中…");
    C.auth.sendOtp({ email: email }).then(function (r) {
      busyOff($("iv-otp-send"));
      if (r.error) { alertIn($("auth-alerts"), "error", "发送失败：" + (r.error.message || "")); return; }
      pendingOtp = r.data;
      alertIn($("auth-alerts"), "ok", "验证码已发到 " + esc(email) + "。");
    }).catch(function () {
      busyOff($("iv-otp-send"));
      alertIn($("auth-alerts"), "error", "发送失败，请稍后重试。");
    });
  });

  $("form-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("iv-otp-email").value.trim(), code = $("iv-otp-code").value.trim();
    if (!pendingOtp) { alertIn($("auth-alerts"), "error", "请先点「获取验证码」。"); return; }
    if (!code) { alertIn($("auth-alerts"), "error", "请填写验证码。"); return; }
    busyOn($("iv-otp-submit"), "登录中…");
    pendingOtp.verify({ nonce: code, email: email }).then(function (r) {
      busyOff($("iv-otp-submit"));
      if (r && r.error) { alertIn($("auth-alerts"), "error", "验证码不正确或已过期。"); return; }
      enterOrReject(email);
    }).catch(function () {
      busyOff($("iv-otp-submit"));
      alertIn($("auth-alerts"), "error", "验证失败，请重新获取验证码。");
    });
  });

  /* ---------------- 记录弹层 ---------------- */
  function normalizeScores(raw) {
    var out = {};
    if (!raw) return out;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (err) { return out; }
    }
    /* ⚠️ 不按 CRIT 过滤 —— 维度名换过之后，老记录里那些「已经不是当前维度」的 key
       照样留着再存回去，不然一改口径就把历史分数抹掉了。 */
    Object.keys(raw || {}).forEach(function (k) {
      var v = Number(raw[k]);
      if (v >= 1 && v <= 5) out[k] = v;
    });
    return out;
  }
  function avgOf(scores) {
    var ks = Object.keys(scores || {});
    if (!ks.length) return null;
    var sum = 0;
    ks.forEach(function (k) { sum += Number(scores[k]); });
    return Math.round((sum / ks.length) * 100) / 100;
  }

  function renderCrit() {
    $("ivm-crit").innerHTML = CRIT.map(function (k) {
      var cur = draft.scores[k] || 0;
      var btns = [1, 2, 3, 4, 5].map(function (v) {
        return '<button type="button" class="iv-dot' + (cur === v ? " is-on" : "") +
          '" data-c="' + esc(k) + '" data-v="' + v + '">' + v + "</button>";
      }).join("");
      return '<div class="iv-crit-row"><span class="iv-crit-name">' + esc(k) +
        '</span><span class="iv-dots">' + btns + "</span></div>";
    }).join("");
    var a = avgOf(draft.scores);
    $("ivm-avg").textContent = a == null ? "—" : num1(a);
  }

  function renderDeptChips() {
    $("ivm-dept").innerHTML = DEPTS.map(function (d) {
      return '<button type="button" class="iv-chip' +
        (draft.offer_dept === d ? " is-on" : "") + '" data-dept="' + esc(d) + '">' + esc(d) + "</button>";
    }).join("");
  }

  function renderResultSeg() {
    Array.prototype.forEach.call($("ivm-result").children, function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-r") === draft.result);
    });
  }

  function openEditor(id) {
    var s = slots.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!s) return;
    var r = recs[s.id] || {};
    editing = s;
    draft = {
      scores: normalizeScores(r.scores),
      result: r.result || "pending",
      offer_dept: r.offer_dept || "",
      note: r.note || "",
      interviewer_email: r.interviewer_email || ME.email
    };

    $("ivm-name").textContent = s.name + (s.name_en ? "（" + s.name_en + "）" : "");
    $("ivm-sub").textContent = [
      s.class_name,
      s.dept,
      dayLabel(s.day) + " " + hm(s.slot_start) + "-" + hm(s.slot_end)
    ].filter(Boolean).join(" · ");
    $("ivm-note").value = draft.note;
    $("ivm-who").value = draft.interviewer_email;
    $("ivm-del").hidden = !r.id;
    clear($("ivm-alerts"));
    renderCrit();
    renderDeptChips();
    renderResultSeg();
    $("iv-mask").hidden = false;
    setTimeout(function () { try { $("ivm-note").focus(); } catch (e) {} }, 30);
  }

  function closeEditor() {
    /* ⚠️ 关之前先把焦点从弹层里踢出来：
       藏起来的元素还会是 document.activeElement（连隐藏的输入框也算「正在打字」），
       不 blur 的话自动同步会一直以为你在写字，从此再也不刷新了。 */
    try {
      /* 弹层容器只有 class 没有 id，按 class 找 */
      var a = document.activeElement;
      if (a && a.blur && a.closest && a.closest(".iv-modal")) a.blur();
    } catch (e) {}
    $("iv-mask").hidden = true;
    editing = null;
    draft = null;
  }

  $("ivm-close").addEventListener("click", closeEditor);
  $("ivm-cancel").addEventListener("click", closeEditor);
  $("iv-mask").addEventListener("click", function (e) {
    if (e.target === $("iv-mask")) closeEditor();
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.key === "Esc") && !$("iv-mask").hidden) closeEditor();
  });

  $("ivm-crit").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".iv-dot") : null;
    if (!b || !draft) return;
    var k = b.getAttribute("data-c"), v = Number(b.getAttribute("data-v"));
    /* 再点一次同一个分数 = 取消这一项（打错了不用找橡皮） */
    if (draft.scores[k] === v) delete draft.scores[k];
    else draft.scores[k] = v;
    renderCrit();
  });

  $("ivm-result").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("button[data-r]") : null;
    if (!b || !draft) return;
    var v = b.getAttribute("data-r");
    draft.result = (draft.result === v) ? "pending" : v;
    renderResultSeg();
  });

  $("ivm-dept").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".iv-chip") : null;
    if (!b || !draft) return;
    var v = b.getAttribute("data-dept");
    draft.offer_dept = (draft.offer_dept === v) ? "" : v;
    renderDeptChips();
  });

  $("ivm-save").addEventListener("click", function () {
    if (!editing || !draft) return;
    var btn = $("ivm-save");
    busyOn(btn, "保存中…");
    draft.note = $("ivm-note").value;
    draft.interviewer_email = $("ivm-who").value.trim();
    var avg = avgOf(draft.scores);
    var payload = {
      slot_id: editing.id,
      result: draft.result || "pending",
      scores: draft.scores,
      avg_score: avg,
      offer_dept: String(draft.offer_dept || ""),
      note: String(draft.note || ""),
      interviewer_email: String(draft.interviewer_email || "").toLowerCase(),
      updated_by: String(ME.email || "").toLowerCase()
    };
    var editedId = editing.id;

    C.saveInterviewRecord(payload).then(function (r) {
      if (r && r.error) throw r.error;
      /* 保存成功不回读 —— 本地先按刚提交的内容画一次，再后台拉一遍对齐。
         ⚠️ 这不是「乐观更新」：能走到这一行就说明服务端已经接受了这次 upsert。 */
      recs[editedId] = {
        id: (recs[editedId] && recs[editedId].id) || null,
        slot_id: editedId,
        result: payload.result,
        scores: payload.scores,
        avg_score: avg,
        offer_dept: payload.offer_dept,
        note: payload.note,
        interviewer_email: payload.interviewer_email
      };
      busyOff(btn);
      closeEditor();
      renderAll();
      alertIn($("iv-alerts"), "ok", "已保存 " + esc(editingName(editedId)) + " 的面试记录。");
      return refreshRecords();
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("ivm-alerts"), "error", failMsg(err, "保存失败"));
    });
  });

  function editingName(slotId) {
    var s = slots.filter(function (x) { return String(x.id) === String(slotId); })[0];
    return s ? s.name : "这位同学";
  }

  /* 只重拉记录（保存完之后对齐一次，防止别人同时在改） */
  function refreshRecords() {
    return C.listInterviewRecords().then(function (r) {
      var rows = C.unwrap(r, "读取失败");
      recs = {};
      (rows || []).forEach(function (x) { recs[x.slot_id] = x; });
      renderAll();
    }).catch(function () { /* 拉失败不影响刚才那次保存，界面已经画过了 */ });
  }

  $("ivm-del").addEventListener("click", function () {
    if (!editing || !recs[editing.id]) return;
    var name = editing.name, id = editing.id;
    if (!window.confirm("删掉 " + name + " 的这条面试记录？删了就没了。")) return;
    busyOn($("ivm-del"), "删除中…");
    C.removeInterviewRecord(recs[id].id).then(function (r) {
      if (r && r.error) throw r.error;
      busyOff($("ivm-del"));
      delete recs[id];
      closeEditor();
      renderAll();
      alertIn($("iv-alerts"), "ok", "已删除 " + esc(name) + " 的面试记录。");
    }).catch(function (err) {
      busyOff($("ivm-del"));
      alertIn($("ivm-alerts"), "error", failMsg(err, "删除失败"));
    });
  });

  /* ---------------- 面试台交互 ---------------- */
  $("iv-days").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".iv-day") : null;
    if (!b) return;
    day = b.getAttribute("data-day");
    renderDays();
    renderMetrics();
    renderList();
  });

  $("iv-list").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-edit]") : null;
    if (b) openEditor(b.getAttribute("data-edit"));
  });
  $("iv-now").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-edit]") : null;
    if (b) openEditor(b.getAttribute("data-edit"));
  });

  $("iv-refresh").addEventListener("click", function () { loadAll(); });
  $("iv-export").addEventListener("click", function () { exportCsv(); });

  /* ---------------- 时间表管理（执委会） ---------------- */
  $("iv-paste-toggle").addEventListener("click", function () {
    var box = $("iv-paste-box");
    box.hidden = !box.hidden;
  });

  /* 表格里改一个字就存一个字。用 change（失焦才触发）而不是 input，
     否则每敲一个字母都发一次请求。 */
  $("iv-admin-body").addEventListener("change", function (e) {
    var el = e.target;
    if (!el || !el.getAttribute || !el.getAttribute("data-id")) return;
    var id = el.getAttribute("data-id"), f = el.getAttribute("data-f");
    var v = el.value;
    if (f === "slot_start" || f === "slot_end") {
      v = String(v || "").slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(v)) { alertIn($("iv-admin-alerts"), "error", "时间要填 HH:MM。"); return; }
      v = v + ":00";
    }
    if (f === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) {
      alertIn($("iv-admin-alerts"), "error", "日期要填 YYYY-MM-DD。");
      return;
    }

    var patch = {};
    patch[f] = v;
    C.updateInterviewSlot(id, patch).then(function (r) {
      if (r && r.error) throw r.error;
      var s = slots.filter(function (x) { return String(x.id) === String(id); })[0];
      if (s) s[f] = v;
      clear($("iv-admin-alerts"));
      /* ⚠️ 不重画整张表：change 是失焦触发的，重画会把光标从下一个格子里赶走。
         只刷新跟着变的日期条和队列。 */
      renderDays();
      renderNow();
      renderMetrics();
      renderList();
    }).catch(function (err) {
      alertIn($("iv-admin-alerts"), "error", failMsg(err, "保存失败"));
    });
  });

  /* ---------------- 临时加人 ---------------- */
  $("q-dept").innerHTML = DEPTS.map(function (d) {
    return '<option value="' + esc(d) + '">' + esc(d) + "</option>";
  }).join("");

  $("iv-quick-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = ($("q-name").value || "").trim();
    if (!name) { alertIn($("iv-quick-alerts"), "error", "中文名不能空着。"); $("q-name").focus(); return; }

    var d = ($("q-day").value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      alertIn($("iv-quick-alerts"), "error", "日期要填 YYYY-MM-DD。"); $("q-day").focus(); return;
    }
    var st = String($("q-start").value || "").slice(0, 5);
    var en = String($("q-end").value || "").slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(st) || !/^\d{2}:\d{2}$/.test(en)) {
      alertIn($("iv-quick-alerts"), "error", "起止时间要填 HH:MM。"); $("q-start").focus(); return;
    }

    busyOn($("q-go"), "添加中…");
    C.importInterviewSlots([{
      day: d, slot_start: st + ":00", slot_end: en + ":00",
      name: name, name_en: ($("q-name-en").value || "").trim(),
      class_name: ($("q-class").value || "").trim(), dept: $("q-dept").value || ""
    }]).then(function (r) {
      if (r && r.error) throw r.error;
      busyOff($("q-go"));
      $("q-name").value = ""; $("q-name-en").value = ""; $("q-class").value = "";
      alertIn($("iv-quick-alerts"), "ok",
        "已把 " + esc(name) + " 加进 " + dayLabel(d) + " " + st + " 的队列。");
      /* 加完把下一位的默认时段往前推一格，连着加几个人不用自己改时间 */
      return loadAll().then(function () {
        qDay = "";
        renderQuick();
        $("q-name").focus();
      });
    }).catch(function (err) {
      busyOff($("q-go"));
      alertIn($("iv-quick-alerts"), "error", failMsg(err, "添加失败"));
    });
  });

  $("iv-admin-body").addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-del]") : null;
    if (!b) return;
    var id = b.getAttribute("data-del");
    var s = slots.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!s) return;
    if (!window.confirm("删掉 " + s.name + "（" + dayLabel(s.day) + " " + hm(s.slot_start) +
      "）这一场？如果他已经有面试记录，记录也会一起删掉。")) return;
    C.removeInterviewSlot(id).then(function (r) {
      if (r && r.error) throw r.error;
      slots = slots.filter(function (x) { return String(x.id) !== String(id); });
      delete recs[id];
      renderAll();
      alertIn($("iv-admin-alerts"), "ok", "已删除 " + esc(s.name) + " 这一场。");
    }).catch(function (err) {
      alertIn($("iv-admin-alerts"), "error", failMsg(err, "删除失败"));
    });
  });

  $("iv-add").addEventListener("click", function () {
    var list = slotsOf(day);
    var last = list[list.length - 1];
    var start = last ? hm(last.slot_end) : "16:40";
    var end = addMinutes(start, 15);
    busyOn($("iv-add"), "添加中…");
    C.importInterviewSlots([{
      day: day, slot_start: start + ":00", slot_end: end + ":00",
      name: "新同学", name_en: "", class_name: "", dept: ""
    }]).then(function (r) {
      if (r && r.error) throw r.error;
      busyOff($("iv-add"));
      alertIn($("iv-admin-alerts"), "ok",
        "已在 " + dayLabel(day) + " " + start + " 加了一场 —— 把「新同学」改成真名。");
      return loadAll();
    }).catch(function (err) {
      busyOff($("iv-add"));
      alertIn($("iv-admin-alerts"), "error", failMsg(err, "添加失败"));
    });
  });

  /* ---------------- 粘贴导入 ----------------
     从 Excel 复制出来的是 tab 分隔；手打的话空格也不一定一样多。
     所以不按「第几列」切，而是**按内容认**：先抠时间，再抠日期、班级、部门，
     剩下的第一个当中文名、第二个当英文名。这样列顺序换了也不会错。 */

  /* 例：10.7 / 2026-10-07 → 2026-10-07。
     ⚠️ 学年的边界是 8 月：8 月之后看到「1.5」一定是明年 1 月 5 日。 */
  function parseDay(txt) {
    var m = String(txt).match(/(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
    if (m) return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
    m = String(txt).match(/(?:^|\D)(\d{1,2})[.\/月](\d{1,2})(?:\D|$)/);
    if (!m) return "";
    var now = new Date();
    var year = now.getFullYear();
    if (Number(m[1]) < 8 && now.getMonth() + 1 >= 8) year += 1;
    return year + "-" + pad2(m[1]) + "-" + pad2(m[2]);
  }

  /* ⚠️ 时段一律按**下午**理解。学校面试全排在放学后，时间表里写的
     「4:40-4:55」指的是下午 4:40 而不是凌晨。
     规则：1~7 点自动 +12，8 点及以上当上午照原样（8:00 还是 08:00）。
     例：4:40 → 16:40、6:10 → 18:10、10:15 → 10:15。
     ⚠️ 别简化成「小于 12 就 +12」—— 那样「10:15」会变成晚上 22:15。 */
  function pmHour(h) {
    var n = Number(h);
    if (n >= 1 && n <= 7) n += 12;
    return n;
  }

  function parseLine(line) {
    var raw = String(line || "").trim();
    if (!raw) return null;
    var out = { name: "", name_en: "", class_name: "", dept: "", day: "", slot_start: "", slot_end: "" };
    var m;

    m = raw.match(/(\d{1,2})[:：](\d{2})\s*[-–—~至到]\s*(\d{1,2})[:：](\d{2})/);
    if (!m) return null;                                  /* 没有时段的行直接跳过（表头、空行） */
    out.slot_start = pad2(pmHour(m[1])) + ":" + m[2];
    out.slot_end = pad2(pmHour(m[3])) + ":" + m[4];
    raw = raw.replace(m[0], " ");

    out.day = parseDay(raw);
    if (out.day) raw = raw.replace(/(20\d{2})[-.\/]\d{1,2}[-.\/]\d{1,2}|\d{1,2}[.\/月]\d{1,2}/, " ");

    m = raw.match(/(?:^|\s)(\d{1,2})\s*([A-Z]{1,2})(?=\s|$)/);
    if (m) { out.class_name = m[1] + m[2]; raw = raw.replace(m[0], " "); }

    m = raw.match(/human\s*resources|organization|publicity/i);
    if (m) { out.dept = m[0].replace(/\s+/g, " "); raw = raw.replace(m[0], " "); }

    var toks = raw.split(/[\t,，;；|]+|\s{1,}/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t && !/^[\d.\/:：-]+$/.test(t); });
    toks.forEach(function (t) {
      if (/[\u4e00-\u9fa5]/.test(t)) { if (!out.name) out.name = t; }
      else if (!out.name_en) out.name_en = t;
    });
    if (!out.name) return null;
    return out;
  }

  $("iv-paste-go").addEventListener("click", function () {
    var txt = $("iv-paste").value || "";
    var lines = txt.split(/\r?\n/);
    var rows = [], bad = 0;
    lines.forEach(function (ln) {
      if (!ln.trim()) return;
      var o = parseLine(ln);
      if (!o || !o.day) { if (ln.trim()) bad++; return; }
      rows.push({
        day: o.day, slot_start: o.slot_start + ":00", slot_end: o.slot_end + ":00",
        name: o.name, name_en: o.name_en, class_name: o.class_name, dept: o.dept
      });
    });

    if (!rows.length) {
      alertIn($("iv-admin-alerts"), "error",
        "一行都没解析出来。每行至少要有一个时段（像 4:40-4:55）和一个日期（像 10.7）。");
      return;
    }

    busyOn($("iv-paste-go"), "导入中…");
    C.importInterviewSlots(rows).then(function (r) {
      if (r && r.error) throw r.error;
      busyOff($("iv-paste-go"));
      var skipped = bad ? "（有 " + bad + " 行没解析出来，已跳过）" : "";
      alertIn($("iv-admin-alerts"), "ok", "已导入 / 更新 " + rows.length + " 行" + skipped + "。");
      return loadAll();
    }).catch(function (err) {
      busyOff($("iv-paste-go"));
      alertIn($("iv-admin-alerts"), "error", failMsg(err, "导入失败"));
    });
  });

  /* ---------------- 导出 CSV ----------------
     ⚠️ 开头写 BOM（\uFEFF），否则 Excel 打开中文会乱码。
     这里不走 assets/export.js —— 那个是给「导出名单」拼 xlsx 的，CSV 不需要那么重。 */
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var list = slotsOf(day);
    if (!list.length) { alertIn($("iv-alerts"), "warn", "这一天没有场次可导出。"); return; }
    var head = ["日期", "开始", "结束", "姓名", "英文名", "班级", "报名部门", "结论",
      "平均分"].concat(CRIT).concat(["拟录用部门", "评语", "面试官", "最后更新"]);
    var lines = [head.map(csvCell).join(",")];
    list.forEach(function (s) {
      var r = recs[s.id] || {};
      var sc = normalizeScores(r.scores);
      var row = [s.day, hm(s.slot_start), hm(s.slot_end), s.name, s.name_en, s.class_name, s.dept,
        RESULT_LABEL[r.result] || "", r.avg_score == null ? "" : num1(r.avg_score)];
      CRIT.forEach(function (k) { row.push(sc[k] == null ? "" : sc[k]); });
      row.push(r.offer_dept || "", r.note || "", r.interviewer_email || "",
        r.updated_at ? String(r.updated_at).slice(0, 16).replace("T", " ") : "");
      lines.push(row.map(csvCell).join(","));
    });

    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "面试记录-" + day + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    alertIn($("iv-alerts"), "ok", "已导出 " + list.length + " 行的 CSV，用 Excel 打开即可。");
  }

  /* ---------------- 自动同步（两个人同时在场时不互相看不见） ----------------
     面试官常常是一整晚开着这一页，不同场次由不同的人各记一段。所以隔一小会儿就静默重拉一次：
     - 静默：不显示 loading、失败也不弹提示（下一轮自然会补上）；
     - 有礼貌：页面不在前台 / 登录框还没过 / 弹层开着 / 光标正在输入框里，一律跳过
       —— 重画会把输入内容和光标位置一起冲掉，现场手快的时候不能来这一下；
     - 同一时刻只跑一个请求（pulling 挡着），弱网也不会攒成一串。 */
  var pulling = false;
  function busyHere() {
    var el = document.activeElement;
    if (el && el.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    return false;
  }
  function pullQuiet() {
    if (pulling) return Promise.resolve();
    if (appView.hidden || document.hidden) return Promise.resolve();
    if (!$("iv-mask").hidden || busyHere()) return Promise.resolve();
    pulling = true;
    return Promise.all([
      C.listInterviewSlots().then(function (r) { return C.unwrap(r, "读取时间表失败"); }),
      C.listInterviewRecords().then(function (r) { return C.unwrap(r, "读取面试记录失败"); })
    ]).then(function (out) {
      slots = out[0] || [];
      recs = {};
      (out[1] || []).forEach(function (x) { recs[x.slot_id] = x; });
      renderAll();
    }).catch(function () { /* 静默，下一次再试 */ })
      .then(function () { pulling = false; });
  }

  /* ---------------- 每分钟刷新一次「现在 / 还剩几分钟」 ----------------
     ⚠️ 只重画跟时间有关的三块，不重拉数据、也不碰输入框 ——
        这个页面常常就开着放在面试官面前。 */
  setInterval(function () {
    if (!appView.hidden && slots.length) {
      renderNow();
      renderMetrics();
      renderList();
    }
  }, 60000);

  /* 20 秒静默同步一次 */
  setInterval(pullQuiet, 20000);
  /* 从别的标签页 / 别的窗口切回来那一刻立刻同步一次（等轮询会让人以为没保存） */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) pullQuiet();
  });
  window.addEventListener("focus", pullQuiet);

  window.GUISInterview = {
    parseLine: parseLine,
    parseDay: parseDay,
    pmHour: pmHour,
    addMinutes: addMinutes,
    avgOf: avgOf,
    normalizeScores: normalizeScores,
    stateOf: stateOf
  };
});
