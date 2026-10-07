/* ============================================================
   志愿服务记录证明 · 学生端（2026-10-02 重写）

   流程：勾记录 → 补证件（唯一能填的两项）→ 提交 → 指定审核人通过 → 下载 PDF。

   改之前先看这四条：

   1) **不准自己给自己开证明。** 学生插进 certificate_requests 的只能是 status='pending'，
      而且「通过 / 驳回」在数据库里**没有** UPDATE 策略 —— 只有 review_certificate_request()
      （SECURITY DEFINER）能改，它只认 cert_reviewers 名单里的人。
      谁审的、什么时候、写了什么意见，全部落库。
   2) **下载用的是通过那条的快照**，不是当前表单。点「下载 PDF」之后，姓名 / 时长 /
      内容 / 证件号 / 出具日期都取自那一行记录 —— 之后再改勾选、改表单不会篡改已通过的那份。
   3) **页面上学生只能填证件类型 + 号码。** 姓名和英文名来自在册名单
      （check_student_email → student_directory 的 name / name_en），时长和服务内容按勾选
      自动算，出具日期是今天，经办人 / 电话写死 —— 这五项一律不给改。
      ⚠️ 英文名没登记就不会显示。要改请找组织成员改名单，**不要**为此开一个输入框让学生填。
   4) **PDF 是浏览器打印出来的**（window.print() + @media print 只留证明那一块），不拼 docx、
      不引第三方库。本机 Word 自动化被 macOS 权限拦着、也没装 LibreOffice，所以这条路是一次选定：
      好处是离线可用、版式就是预览那版；代价是学生要在打印框里选「另存为 PDF」。

   ⚠️ 版式方面的知识（页边距 720 twips / 表格缩进 1086 / 打印前的克隆 portal 等）
      有一部分在 app.css 的 .cert-sheet 那段注释里 —— 改预览的同时要改打印，
      两边本来就是同一个 DOM。
   ============================================================ */
(function () {
  "use strict";

  /* ⚠️ 整段只跑一次：脚本被重复引入时第二份直接退出，免得事件绑两遍
     （校外认定页踩过这个坑：一次点击提交两条）。 */
  if (window.__GUIS_CERT_BOOTED) return;
  window.__GUIS_CERT_BOOTED = true;

  var C = window.GUISCloud;

  /* 经办人 / 联系电话 —— 学校那张证明上就这两个值，学生既不该填也不该改 */
  var HANDLER = "Thomas Lin 林骏玮";
  var PHONE = "020-39090100-16720";
  /* 证明上时长那一栏的单位，跟原件一致 */
  var HOURS_UNIT = "小时 (Hours)";

  /* ⚠️ 证件类型 / 号码**不参与提交**，也不参与任何网络请求。
     它们只活在 `printIds` 这一个变量里：点打印 → 浮层里填 → 画进预览 → 打印 → 立刻清空。
     别为了方便又把它塞回表单或缓存 —— 那就等于把号码送上云端了。 */
  var printIds = { idtype: "", idno: "" };

  function $(id) { return document.getElementById(id); }
  function htmlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function alertIn(el, kind, msg) {
    if (el) el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { if (el) el.innerHTML = ""; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  /* 本地时间拼日期 —— ⚠️ 别用 toISOString().slice(0,10)：那是 UTC，
     东八区在 00:00–08:00 之间会算成昨天，证明上的日期就错了。 */
  function ymd(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function ymdOf(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return ymd(d);
  }
  function cnDate(y4) {                      /* "2026-10-02" → "2026 年 10 月 2 日" */
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(y4 || ""));
    if (!m) return "";
    return m[1] + " 年 " + Number(m[2]) + " 月 " + Number(m[3]) + " 日";
  }
  function fmtWhen(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return ymd(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  /* 3.50 → 3.5 ；12.00 → 12 */
  function fmtHours(n) {
    var v = Math.round(Number(n || 0) * 100) / 100;
    return String(v);
  }

  var ME = { email: "" };
  var NAME = { cn: "", en: "" };
  var rows = [];        /* my_service() 的原始行 */
  var picked = {};      /* id → true，只在内存里 */
  var reqs = [];        /* 我提交过的证明申请 */
  var submitting = false;

  /* ---------- 未绑定云服务的域名提示（跟 me / external 一致） ---------- */
  (function originCheck() {
    var banner = $("origin-banner"), link = $("origin-link");
    if (!banner || !C || !C.endpoint) return;
    try {
      var host = new URL(C.endpoint).host;
      if (location.host && host && location.host !== host) {
        link.href = "https://" + host + "/certificate.html";
        link.textContent = "https://" + host;
        banner.hidden = false;
      }
    } catch (e) { /* URL 解析不出来就算了，别拦着页面 */ }
  })();

  /* ================= 启动 ================= */
  function boot() {
    if (!C || typeof C.sessionUser !== "function") {
      $("ct-boot").hidden = true;
      $("ct-gate").hidden = false;
      return;
    }
    C.sessionUser().then(function (u) {
      $("ct-boot").hidden = true;
      if (!u || !u.email) { $("ct-gate").hidden = false; return; }
      ME.email = u.email;
      $("ct-app").hidden = false;
      prefillStudent();
      loadRows();
      loadReqs();
    }).catch(function () {
      $("ct-boot").hidden = true;
      $("ct-gate").hidden = false;
    });
  }

  /* 姓名 / 英文名全部取自在册名单 —— 页面上不给这两个框，
     所以名单里没有（或没登记英文名）就只能显示已有的那部分，
     要补请让组织成员去「学生名单」页补 —— 不是在这里开一个输入框。 */
  function prefillStudent() {
    if (typeof C.checkStudentEmail !== "function") return;
    C.checkStudentEmail(ME.email).then(function (res) {
      var row = (C.unwrap(res, "") || [])[0] || {};
      NAME.cn = String(row.full_name || "").trim();
      NAME.en = String(row.full_name_en || "").trim();
      if (!NAME.cn) {
        alertIn($("ct-alerts"), "warn",
          "在册名单里还没有你登记的姓名 —— 证明开不出来。" +
          "请联系组织成员在「学生名单」里把姓名补上，再来提交。");
      }
      sync();
    }).catch(function () { /* 查不到不算错，后面 sync 会提示 */ });
  }

  function displayName() {
    /* 英文名写在中文名前面 —— 跟学校材料上的习惯一致（Thomas Lin 林骏玮） */
    return (NAME.en ? NAME.en + " " + NAME.cn : NAME.cn).trim();
  }

  /* ================= 记录列表 ================= */
  function isCounted(r) {
    /* 已核定 = 签到过，或校外认定已通过审核。报了名还没签到的先不算。 */
    return r.source === "external" || !!r.checked_in;
  }
  function hoursOf(r) {
    var h = (r.hours != null ? Number(r.hours) : Number(r.default_hours || 0));
    return isNaN(h) ? 0 : h;
  }
  function rowDate(r) { return ymdOf(r.starts_at) || ""; }
  function pickedHours() {
    var t = 0;
    rows.forEach(function (r) { if (picked[r.id]) t += hoursOf(r); });
    return t;
  }

  function loadRows() {
    $("ct-picks-loading").hidden = false;
    $("ct-picks").hidden = true;

    C.myService().then(function (res) {
      rows = C.unwrap(res, "读取失败") || [];
      $("ct-picks-loading").hidden = true;

      picked = {};
      rows.forEach(function (r) { if (isCounted(r)) picked[r.id] = true; });
      renderPicks();
      sync();
    }).catch(function (err) {
      $("ct-picks-loading").hidden = true;
      alertIn($("ct-alerts"), "error",
        "读取义工记录失败：" + htmlEsc((err && err.message) || "请稍后重试"));
    });
  }

  function renderPicks() {
    var box = $("ct-picks");
    if (!rows.length) {
      box.hidden = true;
      $("ct-picks-empty").hidden = false;
      paintSum();
      return;
    }
    $("ct-picks-empty").hidden = true;

    var sorted = rows.slice().sort(function (a, b) {
      return String(rowDate(a) || "9999").localeCompare(String(rowDate(b) || "9999"));
    });
    box.innerHTML = sorted.map(function (r) {
      var ext = r.source === "external";
      var sub = ext
        ? (r.org_name ? htmlEsc(r.org_name) : "校外机构") + " · 校外认定"
        : (rowDate(r) || "日期待定") + (r.location ? " · " + htmlEsc(r.location) : "");
      var state = ext ? "已通过审核"
        : (r.checked_in ? "已签到" : (r.selected ? "已录取 · 未签到" : "已报名 · 等结果"));
      return '<label class="ct-pick' + (isCounted(r) ? " is-counted" : "") + '">' +
        '<input type="checkbox" data-pick="' + htmlEsc(r.id) + '"' + (picked[r.id] ? " checked" : "") + " />" +
        '<span class="ct-pick-main">' +
          '<b>' + htmlEsc(r.title || "（无标题）") + "</b>" +
          '<span>' + sub + " · " + state + "</span>" +
        "</span>" +
        '<span class="ct-pick-h">' + fmtHours(hoursOf(r)) + " h</span>" +
      "</label>";
    }).join("");
    box.hidden = false;
    paintSum();
  }

  function paintSum() {
    var n = 0, h = 0;
    rows.forEach(function (r) {
      if (!picked[r.id]) return;
      n++; h += hoursOf(r);
    });
    $("ct-pick-count").textContent = String(n);
    $("ct-pick-hours").textContent = fmtHours(h);
  }

  /* 按勾选生成「志愿服务内容」那段文字 —— 学生的 PDF 上就是它 */
  function buildContent() {
    var list = rows.filter(function (r) { return picked[r.id]; })
      .sort(function (a, b) {
        return String(rowDate(a) || "9999").localeCompare(String(rowDate(b) || "9999"));
      });
    if (!list.length) return "";
    return list.map(function (r, i) {
      var h = fmtHours(hoursOf(r));
      var who = r.source === "external"
        ? (r.org_name ? r.org_name + " · " : "")
        : (r.location ? r.location + " · " : "");
      return (i + 1) + ". " + (rowDate(r) || "日期待定") + "　" + who + (r.title || "") + "　" + h + " 小时";
    }).join("\n");
  }

  /* 勾选明细 —— 存进申请的 picks 里，审核人一眼能看到「这几条是怎么凑出来的」 */
  function picksPayload() {
    return rows.filter(function (r) { return picked[r.id]; }).map(function (r) {
      return {
        source: r.source || "activity",
        title: r.title || "",
        date: rowDate(r) || "",
        hours: hoursOf(r),
        place: r.location || r.org_name || ""
      };
    });
  }

  /* ================= 表单 → 预览 / 提交 ================= */
  function liveData() {
    /* ⚠️ 证件两项直接读浮层里的输入框 —— 这样在浮层里敲字时右边预览跟着变，
       学生能先核对一遍再按打印。它们只是预览的来源，不参与任何请求。 */
    return {
      name: displayName(),
      idtype: ($("ct-idtype") && $("ct-idtype").value) || "",
      idno: ($("ct-idno") && $("ct-idno").value || "").trim(),
      hours: fmtHours(pickedHours()),
      content: buildContent(),
      /* 出具日期永远是今天，不给选 */
      date: ymd()
    };
  }

  /* 申请记录 → 版式数据。⚠️ 打印已通过的 PDF 一定从这里取，不从当前表单取；
     证件号码同样来自 printIds（库里本来就没有它）。 */
  function reqData(r) {
    var cn = String(r.student_name || "").trim();
    var en = String(r.student_name_en || "").trim();
    return {
      name: (en ? en + " " + cn : cn).trim(),
      idtype: printIds.idtype,
      idno: printIds.idno,
      hours: fmtHours(r.hours),
      content: r.content || "",
      date: String(r.issue_date || "").slice(0, 10)
    };
  }

  function sync() {
    var d = liveData();

    /* 只读四项：学生核对用 */
    $("ro-name").textContent = d.name || "（名单里没有你的姓名）";
    $("ro-hours").textContent = d.hours + " 小时";
    $("ro-date").textContent = cnDate(d.date);
    $("ro-content").textContent =
      d.content || "还没有勾选记录 —— 上去勾几条，这里会自动写出来。";

    paintSheet(d);
    setGoState();
  }

  /* ---------- 预览 / 打印共用：把数据画到那张 A4 上 ---------- */
  function paintSheet(d) {
    $("pv-name").textContent = d.name;
    $("pv-idno").textContent = d.idno;
    $("pv-idtype").textContent = d.idtype;
    $("pv-hours").textContent = d.hours ? d.hours + " " + HOURS_UNIT : "";
    /* 预览里的换行要变成真的换行 */
    $("pv-content").innerHTML = htmlEsc(d.content || "").replace(/\n/g, "<br />");

    /* 经办人 / 电话是固定值，HTML 里只留了空 span，这里填一次就够 */
    $("pv-handler").textContent = HANDLER;
    $("pv-phone").textContent = PHONE;

    /* 落款日期单独一格：Word 原件里它跟前面几行靠缩进分开，这里交给 CSS */
    $("pv-sign-date").textContent = cnDate(d.date) || cnDate(ymd());

    fitSheet();
  }

  /* ---------- 预览按容器宽度等比缩放（A4 是 21cm，手机上必然放不下） ---------- */
  function fitSheet() {
    var stage = $("ct-stage"), sheet = $("cert-sheet");
    if (!stage || !sheet) return;
    sheet.style.transform = "none";
    stage.style.height = "auto";
    var w = sheet.offsetWidth || 794;
    var avail = stage.clientWidth || w;
    var s = Math.min(1, avail / w);
    sheet.style.transform = "scale(" + s + ")";
    stage.style.height = Math.ceil(sheet.offsetHeight * s) + "px";
  }
  window.addEventListener("resize", fitSheet);

  /* ================= 提交 ================= */
  function collect() {
    /* ⚠️ 这里刻意**没有** id_type / id_no —— 证件号码不上传云端。
       数据库那两列还在（兼容旧备份的结构），但永远是空串。 */
    return {
      student_email: ME.email,
      student_name: NAME.cn,
      student_name_en: NAME.en,
      hours: fmtHours(pickedHours()),
      content: buildContent(),
      issue_date: ymd(),
      picks: picksPayload()
    };
  }

  function check(d) {
    /* ⚠️ 姓名要看 d.student_name 本身 —— 证明上没名字不能用。
       证件号码不在这里查：它是打印那一刻的事，跟提交无关。 */
    if (!d.student_name) return "在册名单里还没有你登记的姓名，先请组织成员补上再来提交。";
    if (!Number(d.hours)) return "时长是 0 —— 至少在上一步勾一条已核定的记录。";
    return "";
  }

  function setGoState() {
    var btn = $("ct-go");
    if (!btn) return;
    btn.disabled = true;
    if (submitting) { btn.textContent = "提交中…"; return; }
    var pend = reqs.filter(function (r) { return r.status === "pending"; })[0];
    if (pend) { btn.textContent = "有一条正在审核中"; return; }
    btn.textContent = "提交证明申请";
    btn.disabled = check(collect()) !== "";
  }

  function submit() {
    var d = collect();
    var bad = check(d);
    if (bad) { alertIn($("ct-alerts"), "error", htmlEsc(bad)); return; }

    submitting = true;
    setGoState();
    C.submitCertRequest(d).then(function (res) {
      submitting = false;
      if (res && res.error) {
        /* ⚠️ PostgREST 不总带 error.code —— code 和文本一起认 */
        var code = String((res.error && res.error.code) || "");
        var msg = String((res.error && res.error.message) || "");
        if (code === "23505" || /certreq_pending/.test(msg)) {
          throw new Error("你还有一条没审核完的申请 —— 先撤回那条，或者等结果出来再提交新的。");
        }
        if (/certreq_hours_chk|certreq_idno_chk/.test(msg)) {
          throw new Error("这张申请的时长或证件号码没通过校验，请回到上面重新选一遍记录。");
        }
        throw new Error(msg || "提交失败");
      }
      clear($("ct-alerts"));
      loadReqs();
      setGoState();
      alertIn($("ct-alerts"), "ok",
        "已经提交给老师审核了 —— 结果会显示在下面「我的申请」里，" +
        "通过之后那里才会出现「下载 PDF 证明」。");
    }).catch(function (err) {
      submitting = false;
      setGoState();
      alertIn($("ct-alerts"), "error",
        "提交失败：" + htmlEsc((err && err.message) || "请稍后重试"));
    });
  }

  /* ================= 我的申请 ================= */
  var ST = {
    pending:   { label: "审核中", cls: "pending" },
    approved:  { label: "已通过", cls: "approved" },
    rejected:  { label: "已驳回", cls: "rejected" },
    withdrawn: { label: "已撤回", cls: "withdrawn" }
  };

  function loadReqs() {
    var box = $("ct-reqs"), loading = $("ct-reqs-loading"), empty = $("ct-reqs-empty");
    loading.hidden = false; box.hidden = true; empty.hidden = true;
    C.myCertRequests().then(function (res) {
      reqs = C.unwrap(res, "读取失败") || [];
      loading.hidden = true;
      renderReqs();
    }).catch(function (err) {
      loading.hidden = true;
      empty.hidden = false;
      empty.textContent = "申请列表读取失败：" + ((err && err.message) || "请刷新重试");
    });
  }

  function renderReqs() {
    var box = $("ct-reqs"), empty = $("ct-reqs-empty");
    if (!reqs.length) {
      box.hidden = true;
      empty.hidden = false;
      empty.textContent = "还没有提交过证明申请 —— 上面勾好记录、填完证件就能提交。";
      setGoState();
      return;
    }
    empty.hidden = true;
    box.innerHTML = reqs.map(reqHTML).join("");
    box.hidden = false;
    setGoState();
  }

  function reqHTML(r) {
    var st = ST[r.status] || ST.pending;
    var acts = "";
    if (r.status === "pending") {
      acts = '<button type="button" class="btn btn-secondary ct-wd" data-wd="' + r.id + '">撤回</button>' +
        '<span class="hint">审核中。撤回之后你可以改了资料重新提交。</span>';
    } else if (r.status === "approved") {
      acts = '<button type="button" class="btn btn-primary ct-dl" data-dl="' + r.id + '">下载 PDF 证明</button>' +
        '<span class="hint">点了会弹打印框 —— 在里面选「另存为 PDF」就是文件。</span>';
    } else if (r.status === "rejected") {
      acts = '<button type="button" class="btn btn-secondary ct-reuse" data-ru="' + r.id + '">回去改记录再提交</button>';
    }

    var note = "";
    if (r.status === "rejected" && r.review_note) {
      note = '<div class="ct-req-note is-bad">驳回原因：' + htmlEsc(r.review_note) + "</div>";
    } else if (r.review_note) {
      note = '<div class="ct-req-note">审核意见：' + htmlEsc(r.review_note) + "</div>";
    }
    if (r.reviewer_email || r.reviewed_at) {
      note += '<div class="ct-req-sub">' +
        (r.reviewer_email ? htmlEsc(r.reviewer_email) : "审核人未知") +
        " · " + fmtWhen(r.reviewed_at) + "</div>";
    }

    return '<div class="ct-req is-' + st.cls + '">' +
      '<div class="ct-req-head">' +
        '<div>' +
          '<div class="ct-req-title">' + fmtHours(r.hours) + " 小时 · " +
            (cnDate(String(r.issue_date || "").slice(0, 10)) || "日期未记") + " 出具</div>" +
          '<div class="ct-req-sub">提交于 ' + fmtWhen(r.created_at) + "</div>" +
        "</div>" +
        '<span class="ct-st ct-st-' + st.cls + '">' + st.label + "</span>" +
      "</div>" +
      note +
      (acts ? '<div class="ct-req-acts">' + acts + "</div>" : "") +
    "</div>";
  }

  function findReq(id) {
    return reqs.filter(function (r) { return String(r.id) === String(id); })[0] || null;
  }

  function withdraw(id) {
    if (!window.confirm("撤回这条申请？老师那边就看不到了 —— 你可以改完资料重新提交。")) return;
    var btn = document.querySelector('.ct-wd[data-wd="' + id + '"]');
    if (btn) btn.disabled = true;
    C.withdrawCertRequest(id).then(function (res) {
      if (res && res.error) throw new Error(res.error.message || "撤回失败");
      clear($("ct-alerts"));
      loadReqs();
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      alertIn($("ct-alerts"), "error", "撤回失败：" + htmlEsc((err && err.message) || "请重试"));
    });
  }

  function reuse(id) {
    var r = findReq(id);
    if (!r) return;
    /* 那条被驳回的东西里本来就没有证件信息（号码压根没上传过），
       所以「重提」能做的只是把他带回第一步重新选记录。 */
    alertIn($("ct-alerts"), "warn",
      "这条被驳回了 —— 回到第 1 步改一改勾的记录，再点「提交证明申请」。" +
      (r.review_note ? "<br />审核意见：" + htmlEsc(r.review_note) : ""));
    if (window.scrollTo) window.scrollTo(0, 0);
    var picks = $("ct-picks");
    if (picks && picks.firstChild) picks.setAttribute("data-flash", "1");
  }

  /* ================= 打印：证件号码在这一刻才出现，用完即弃 =================
     两条路进到这里：
       · approved —— 「我的申请」里那条已通过的（内容取快照）
       · draft    —— 应急离线打印（内容取当前勾选，整张纸铺未审核水印）
     ⚠️ 号码只经过 printIds 这一个内存变量：不进 fetch、不进 storage。 */
  var pendingPrint = null;       /* {mode:"approved"|"draft", id:reqId|null} */

  function openIdBox(mode, reqId) {
    pendingPrint = { mode: mode, id: reqId };
    $("ct-idbox-sub").textContent = mode === "draft"
      ? "应急打印：这张纸会带上「未审核 · 草稿」水印，学校不一定收。"
      : "审核已经通过 —— 这一版就是你交给学校的那份。";
    $("ct-idbox").hidden = false;
    var box = $("ct-idno");
    if (box) box.focus();
  }

  function closeIdBox() {
    pendingPrint = null;
    /* 输入框里的东西立刻丢掉 —— 它唯一的用处是刚才那次打印 */
    $("ct-idtype").value = "";
    $("ct-idno").value = "";
    printIds = { idtype: "", idno: "" };
    $("ct-idbox").hidden = true;
  }

  /* ⚠️ 打印前必须走这一步：@media print 里 `body > *` 全被藏掉，只有
     #cert-print-portal 会输出 —— 不把 sheet 克隆进去，按下去就是一张白纸。
     克隆的是**刚画好的那一版**（含水印状态），所以顺序不能放到 paintSheet 之前。 */
  function stageSheet() {
    var portal = $("cert-print-portal"), sheet = $("cert-sheet");
    if (!portal || !sheet) return;
    portal.innerHTML = sheet.outerHTML.replace(/ style="transform:[^"]*"/, "");
  }
  function unstageSheet() {
    var portal = $("cert-print-portal");
    if (portal) portal.innerHTML = "";       /* 免得留下重复 id */
  }

  function doPrint() {
    if (!pendingPrint) return;
    printIds.idtype = $("ct-idtype").value || "";
    printIds.idno = ($("ct-idno").value || "").trim();
    if (!printIds.idno) {
      alertIn($("ct-alerts"), "error", "证件号码是空的 —— 照证件原样填一遍再打印。");
      return;
    }

    var mode = pendingPrint.mode;
    var req = mode === "approved" ? findReq(pendingPrint.id) : null;
    if (mode === "approved" && (!req || req.status !== "approved")) {
      alertIn($("ct-alerts"), "error", "这一条已经不是「已通过」了 —— 刷新看看最新结果。");
      closeIdBox();
      loadReqs();
      return;
    }

    /* ⚠️ 先把「该印的那版」画进预览：approved 用快照、draft 用当前勾选 */
    var d = req ? reqData(req) : liveData();
    $("cert-draft").hidden = (mode !== "draft");
    paintSheet(d);

    var title = "志愿服务证明-" +
      String(d.name || "同学").replace(/[\\/:*?"<>|\s]/g, "") + "-" + d.date +
      (mode === "draft" ? "-未审核草稿" : "");

    var old = document.title;
    document.title = title;        /* Chrome / Safari 拿它当存档时的默认文件名 */
    stageSheet();                  /* ⚠️ 必须在 print 之前：走的是 #cert-print-portal */
    window.print();

    /* 对话框关掉之后：标题还原、水印收起、号码从内存抹掉、预览恢复常态 */
    window.setTimeout(function () {
      document.title = old;
      $("cert-draft").hidden = true;
      unstageSheet();
      closeIdBox();
      sync();
    }, 0);

    clear($("ct-alerts"));
    if (mode === "draft") {
      alertIn($("ct-alerts"), "warn",
        "已经打出去了 —— 这张带「未审核 · 草稿」水印，学校不一定收，" +
        "事后还是要走正常那条路：提交 → 老师审核 → 下载无水印的正式版。");
    } else {
      alertIn($("ct-alerts"), "ok",
        "已经交给浏览器去打印了 —— 在打印框里把「目标打印机」选成「另存为 PDF」" +
        "（Safari 是右下角 PDF 菜单里的「存储为 PDF」），存下来就是「" + htmlEsc(title) + ".pdf」。");
    }
  }

  function download(id) {
    var r = findReq(id);
    if (!r) return;
    if (r.status !== "approved") {
      alertIn($("ct-alerts"), "error", "这一条还没通过审核，不能下载。");
      return;
    }
    openIdBox("approved", id);
  }

  /* ---------- 应急离线打印： emergencies 用，带水印，不走审核 ---------- */
  function offlinePrint() {
    if (!NAME.cn) {
      alertIn($("ct-alerts"), "error", "在册名单里还没有你登记的姓名，先请组织成员补上。");
      return;
    }
    if (!Number(pickedHours())) {
      alertIn($("ct-alerts"), "error", "还没有勾任何记录 —— 至少要勾一条已核定的，才打得出东西来。");
      return;
    }
    if (!window.confirm(
      "应急打印出来的纸上会带「未审核 · 草稿」水印，学校不一定承认。\n\n" +
      "正常流程是：提交 → 老师审核 → 下载无水印的正式版。\n\n" +
      "确定先打一张带水印的草稿吗？")) return;
    openIdBox("draft", null);
  }

  /* ================= 事件绑定 ================= */
  $("ct-refresh").addEventListener("click", loadRows);
  $("ct-req-refresh").addEventListener("click", loadReqs);

  $("ct-picks").addEventListener("change", function (e) {
    var cb = e.target;
    if (!cb || !cb.getAttribute) return;
    var id = cb.getAttribute("data-pick");
    if (id == null) return;
    if (cb.checked) picked[id] = true; else delete picked[id];
    paintSum();
    sync();
  });

  $("ct-pick-all").addEventListener("click", function () {
    picked = {};
    rows.forEach(function (r) { if (isCounted(r)) picked[r.id] = true; });
    renderPicks();
    sync();
  });

  /* ⚠️ 这两个 input 现在住在「打印前填证件」那个浮层里 —— 它们只用来实时更新预览，
     值绝不参与任何请求（见 collect() 的注释）。 */
  ["ct-idtype", "ct-idno"].forEach(function (id) {
    $(id).addEventListener("input", sync);
    $(id).addEventListener("change", sync);
  });

  $("ct-go").addEventListener("click", submit);
  $("ct-offline").addEventListener("click", offlinePrint);
  $("ct-id-ok").addEventListener("click", doPrint);
  $("ct-id-no").addEventListener("click", closeIdBox);
  /* 按 Esc 关浮层：跟「消失就消失」的承诺一致，别留残余状态 */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("ct-idbox").hidden) closeIdBox();
  });

  $("ct-reqs").addEventListener("click", function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || !t.closest) return;

    var wd = t.closest(".ct-wd");
    if (wd) { withdraw(wd.getAttribute("data-wd")); return; }

    var dl = t.closest(".ct-dl");
    if (dl) { download(dl.getAttribute("data-dl")); return; }

    var ru = t.closest(".ct-reuse");
    if (ru) { reuse(ru.getAttribute("data-ru")); return; }
  });

  /* ---------- 初始值 ---------- */
  $("ro-date").textContent = cnDate(ymd());
  setGoState();
  boot();
})();
