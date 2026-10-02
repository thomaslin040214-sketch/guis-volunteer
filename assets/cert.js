/* ============================================================
   志愿服务记录证明 · 生成端（2026-10-02 加）
   学生挑出自己的义工记录 → 补齐证件信息 → 一键生成 .docx。

   三件事是这里的核心，改之前先看：

   1) **版式对着学校那份模板抄的。** 原模板是
      《广州优联国际学校ULC学部-志愿服务记录证明.docx》：
      校徽 + 中英文校名 + 标题 + 7 行 3 列表格 + 经办人栏。
      字体（楷体 / 等线）、字号、A4 页边距、列宽（2735/2843/2713 twips）
      都是从原始 document.xml 里量出来的，改动前先回去对一遍。
   2) **不留存。** 证件号码这类信息只在内存里过一遍，绝不写 localStorage /
      sessionStorage，也不往云端传一个字 —— 页面上那句「本页不留存」是承诺，
      不要为了「记住上次填的」偷偷加缓存。
   3) **docx 是自己拼的**（assets/docx.js，STORE 压缩的 zip），
      不引 JSZip、不依赖 DecompressionStream。
   ============================================================ */
(function () {
  "use strict";

  /* ⚠️ 整段只跑一次：脚本被重复引入时第二份直接退出，免得事件绑两遍
     （校外认定页踩过这个坑：一次点击提交两条）。 */
  if (window.__GUIS_CERT_BOOTED) return;
  window.__GUIS_CERT_BOOTED = true;

  var C = window.GUISCloud;
  var D = window.GUISDocx;

  function $(id) { return document.getElementById(id); }
  function htmlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* XML 里 &apos; 是合法的，不用 &#39; */
  function xmlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }
  function alertIn(el, kind, msg) {
    if (el) el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { if (el) el.innerHTML = ""; }
  function busyOn(btn, label) {
    if (!btn) return;
    btn.setAttribute("data-busy-label", btn.textContent);
    btn.disabled = true;
    if (label) btn.textContent = label;
  }
  function busyOff(btn) {
    if (!btn) return;
    btn.disabled = false;
    var old = btn.getAttribute("data-busy-label");
    if (old != null) btn.textContent = old;
  }
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
  /* 3.50 → 3.5 ；12.00 → 12 */
  function fmtHours(n) {
    var v = Math.round(Number(n || 0) * 100) / 100;
    return String(v);
  }

  var ME = { email: "" };
  var rows = [];        /* my_service() 的原始行 */
  var picked = {};      /* id → true，只在内存里 */

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
    }).catch(function () {
      $("ct-boot").hidden = true;
      $("ct-gate").hidden = false;
    });
  }

  /* 姓名 / 学号能在学生名单里查到就先填上，省得手打 —— 学生自己还能改 */
  function prefillStudent() {
    if (typeof C.checkStudentEmail !== "function") return;
    C.checkStudentEmail(ME.email).then(function (res) {
      var row = (C.unwrap(res, "") || [])[0] || {};
      if (row.full_name && !$("ct-name").value) $("ct-name").value = row.full_name;
      sync();
    }).catch(function () { /* 查不到不算错，接着让他自己填 */ });
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

  /* 按勾选生成「志愿服务内容」那段文字 */
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

  /* ================= 表单 → 预览 ================= */
  /* contentTouched：用户手动改过内容之后，就不再被勾选动作覆盖 */
  var contentTouched = false;

  function sync() {
    if (!contentTouched) $("ct-content").value = buildContent();
    if (!$("ct-hours").value || !$("ct-hours").dataset || $("ct-hours").dataset.auto !== "0") {
      var t = 0;
      rows.forEach(function (r) { if (picked[r.id]) t += hoursOf(r); });
      $("ct-hours").value = t ? fmtHours(t) : "";
      $("ct-hours").dataset.auto = "1";
    }
    paintSum();
    paintPreview();
  }

  function paintPreview() {
    var nameCn = ($("ct-name").value || "").trim();
    var nameEn = ($("ct-name-en").value || "").trim();
    var name = nameEn ? nameEn + " " + nameCn : nameCn;

    $("pv-name").textContent = name;
    $("pv-idno").textContent = ($("ct-idno").value || "").trim();
    $("pv-idtype").textContent = $("ct-idtype").value || "";
    var hv = ($("ct-hours").value || "").trim();
    $("pv-hours").textContent = hv ? hv + " 小时 (Hours)" : "";
    /* 预览里的换行要变成真的换行 */
    $("pv-content").innerHTML = htmlEsc($("ct-content").value || "").replace(/\n/g, "<br />");
    $("pv-other").innerHTML = htmlEsc($("ct-other").value || "").replace(/\n/g, "<br />");

    var handler = ($("ct-handler").value || "").trim();
    var phone = ($("ct-phone").value || "").trim();
    $("pv-handler").textContent = handler;
    $("pv-phone").textContent = phone;

    /* 落款日期单独一格：Word 里它跟前面几行靠缩进分开，这里交给 CSS */
    $("pv-sign-date").textContent = cnDate($("ct-date").value) || cnDate(ymd());

    $("ct-hours-hint").textContent = "按勾选自动算的；跟实际不符就自己改，改完点右边「按勾选重算」可以还原。";
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

  /* ================= 打包成 .docx =================
     ⚠️ 下面每个数字都是从学校那份原件《广州优联国际学校ULC学部-志愿服务记录证明.docx》
     的 word/document.xml 里直接量出来的，不是估的：

       页边距       四边 720 twips（1.27cm）—— 不是 Word 默认的 1440 / 1800
       表格         缩进 1086 twips，总宽 8548（所以表格不贴左边，右边留白）
       列宽         2735 / 2128 / 3685（跨两列 5813，跨三列 8548）
       行高         第 3 行 501、第 6 行 782、第 7 行 425，其余按内容撑
       默认制表位   420 twips —— 在 word/settings.xml 里；底下那几条对齐线全靠它，
                    漏了这个文件，制表符落点全变，就会「挤在一起」
       正文         等线 10.5pt（sz 21），行距靠 docGrid 的 linePitch 312 撑开，
                    ⚠️ 不要在 styles 里再写 spacing —— 写平了行会挤
       校名 / 标题  楷体 26pt（sz 52）/ 28pt（sz 56）/ 英文 Calibri 14pt、12pt

     改版式要回去量原件；只改一半会变成「预览对了、Word 里错位」。 */

  /* ---- OOXML 小工具 ---- */
  function rpr(o) {
    o = o || {};
    var s = "<w:rPr>";
    if (o.font) {
      s += '<w:rFonts w:ascii="' + o.font + '" w:eastAsia="' + (o.eaFont || o.font) +
        '" w:hAnsi="' + o.font + '" w:cs="' + o.font + '"' +
        (o.hint === false ? "" : ' w:hint="eastAsia"') + "/>";
    }
    if (o.noProof) s += "<w:noProof/>";
    if (o.bold) s += "<w:b/><w:bCs/>";
    /* szCs 只影响复杂文种，但模板里楷体 26pt / 28pt 写的是 72 / 96，照抄 */
    if (o.sz) s += '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + (o.szCs || o.sz) + '"/>';
    s += "</w:rPr>";
    return s;
  }
  function run(text, o) {
    if (text == null || text === "") return "<w:r>" + rpr(o) + "</w:r>";
    return "<w:r>" + rpr(o) + '<w:t xml:space="preserve">' + xmlEsc(text) + "</w:t></w:r>";
  }
  function tabRun(o) { return "<w:r>" + rpr(o) + "<w:tab/></w:r>"; }
  function tabs(n, o) { var s = ""; for (var i = 0; i < n; i++) s += tabRun(o); return s; }
  function para(inner, o) {
    o = o || {};
    var p = "<w:p><w:pPr>";
    if (o.jc) p += '<w:jc w:val="' + o.jc + '"/>';
    if (o.ind) p += "<w:ind " + o.ind + "/>";
    if (o.spacing) p += "<w:spacing " + o.spacing + "/>";
    if (o.rpr) p += rpr(o.rpr);
    p += "</w:pPr>" + (inner || "") + "</w:p>";
    return p;
  }
  /* 一行文字里 \n 要拆成多个 <w:br/>，不能塞进 <w:t> */
  function runLines(text, o) {
    var lines = String(text == null ? "" : text).split("\n");
    var s = "<w:r>" + rpr(o);
    lines.forEach(function (ln, i) {
      if (i) s += "<w:br/>";
      if (ln !== "") s += '<w:t xml:space="preserve">' + xmlEsc(ln) + "</w:t>";
    });
    s += "</w:r>";
    return s;
  }

  /* 边框走表格级的 <w:tblBorders>（等价于模板引用的 Table Grid 样式），
     ⚠️ 不要逐格写 tcBorders —— 原件里没有，多写了会让某些渲染器画出双线。 */
  function cell(o) {
    var tc = "<w:tc><w:tcPr><w:tcW w:w=\"" + o.w + '" w:type="dxa"/>';
    if (o.span > 1) tc += '<w:gridSpan w:val="' + o.span + '"/>';
    if (o.vmerge === "restart") tc += '<w:vMerge w:val="restart"/>';
    else if (o.vmerge === "continue") tc += "<w:vMerge/>";
    if (o.valign) tc += '<w:vAlign w:val="' + o.valign + '"/>';
    tc += "</w:tcPr>" + (o.inner || para("", { jc: "center" })) + "</w:tc>";
    return tc;
  }

  /* 列宽 / 合并宽度 / 缩进，全部照原件 tblGrid 与 tcW 量出来 */
  var COL_W = [2735, 2128, 3685];
  var SPAN2 = 5813;      /* 2128 + 3685 */
  var SPAN3 = 8548;      /* 2735 + 2128 + 3685 */
  var TBL_IND = 1086;    /* 表格缩进：原件里表格不贴左边距 */
  var TAB_STOP = 420;    /* 默认制表位，写进 word/settings.xml */
  var PG_MAR = 720;      /* 页边距四边都是 720（1.27cm） */

  /* 标签格是「中文一行 + 英文一行」两段（原件就是这么分的，不是「姓名(Name)」一句） */
  function labelCell(lines, o) {
    o = o || {};
    var inner = "";
    if (o.padTop) inner += para("", { jc: "center", rpr: { bold: true } });
    lines.forEach(function (ln) {
      inner += para(run(ln, { bold: true }), { jc: "center", rpr: { bold: true } });
    });
    if (o.padBottom) inner += para("", { jc: "center", rpr: { bold: true } });
    return cell({ w: o.w, span: o.span, vmerge: o.vmerge, valign: o.valign, inner: inner });
  }

  function blankCell(o) {
    o = o || {};
    return cell({
      w: o.w, span: o.span, vmerge: o.vmerge, valign: o.valign,
      inner: para("", { jc: "center", rpr: { bold: true } })
    });
  }

  /* 值格：多行内容用 <w:br/>，别塞进单个 <w:t> */
  function valueCell(text, o) {
    o = o || {};
    var s = String(text == null ? "" : text);
    var inner = s.indexOf("\n") >= 0
      ? para(runLines(s, {}), { jc: o.jc || "left" })
      : para(run(s, {}), { jc: o.jc || "center" });
    return cell({ w: o.w, span: o.span, valign: o.valign, inner: inner });
  }

  /* 校徽尺寸：原件的 wp:extent 是 4058285×752475 EMU（4.44in × 0.82in），
     而图片自身 spPr 的 a:ext 略大一点（4313083×799680）—— 两个值不一样是原件就
     这样，照抄，别「顺手统一」成同一个数。 */
  var IMG_EXTENT = { cx: 4058285, cy: 752475 };
  var IMG_SHAPE = { cx: 4313083, cy: 799680 };
  var KAI_LOGO = { font: "楷体", noProof: true, sz: 56, szCs: 96 };

  function imageParagraph() {
    var drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + IMG_EXTENT.cx + '" cy="' + IMG_EXTENT.cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="1" name="GUIS | ULC"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      "<pic:nvPicPr><pic:cNvPr id=\"1\" name=\"GUIS | ULC\"/>" +
      '<pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + IMG_SHAPE.cx + '" cy="' + IMG_SHAPE.cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>";
    return para("<w:r>" + rpr(KAI_LOGO) + drawing + "</w:r>",
      { jc: "center", rpr: { font: "楷体", sz: 56, szCs: 96 } });
  }

  function documentXml(d) {
    /* ⚠️ 段落数量、对齐、合并宽度、行高全部照原件量出来（见本节开头的参数表）。
       表下那几行不在表格里，靠制表符对齐 —— 不是空格：空格宽度随字体变，换台机器就错位。 */
    function tr(inner, h) {
      return "<w:tr>" + (h ? '<w:trPr><w:trHeight w:val="' + h + '"/></w:trPr>' : "") + inner + "</w:tr>";
    }

    var B = { bold: true };
    var B9 = { bold: true, sz: 18, szCs: 21 };

    var rowsXml =
      tr(
        /* 第 1 行：原件在这里多放了首尾两个空段，行才够高、「学生信息」竖排居中才对 */
        labelCell(["学生信息", "(Student Information)"],
          { w: COL_W[0], vmerge: "restart", valign: "center", padTop: true, padBottom: true }) +
        labelCell(["姓名", "(Name)"], { w: COL_W[1] }) +
        valueCell(d.name, { w: COL_W[2] })
      ) +
      tr(
        blankCell({ w: COL_W[0], vmerge: "continue" }) +
        labelCell(["证件号码", "(Proof of ID No.)"], { w: COL_W[1] }) +
        valueCell(d.idno, { w: COL_W[2], valign: "center" })
      ) +
      tr(
        blankCell({ w: COL_W[0], vmerge: "continue" }) +
        labelCell(["证件类型", "（Type of ID）"], { w: COL_W[1] }) +
        valueCell(d.idtype, { w: COL_W[2], valign: "center" }),
        501
      ) +
      tr(
        /* ⚠️ 这一格原件里**没有** vAlign，别顺手补上（虽然内容刚好两行、看不出来） */
        labelCell(["志愿服务时长", "(Volunteer Service Time)"], { w: COL_W[0] }) +
        valueCell(d.hours, { w: SPAN2, span: 2 })
      ) +
      tr(
        labelCell(["志愿服务内容", "(Volunteer Service Content)"], { w: COL_W[0], valign: "center" }) +
        valueCell(d.content, { w: SPAN2, span: 2, jc: "left" })
      ) +
      tr(
        labelCell(["其他需要说明的事项", "(Other information)"], { w: COL_W[0], valign: "center" }) +
        valueCell(d.other, { w: SPAN2, span: 2, jc: d.other.indexOf("\n") >= 0 ? "left" : "center" }),
        782
      ) +
      /* 第 7 行：签字 / 盖章 / 落款日期。原件是 5 段（中间夹两段空行），照抄；
         日期那段的 left / hanging 是量出来的，改了日期就跑到别处去 */
      tr(
        cell({
          w: SPAN3, span: 3,
          inner:
            para("", { jc: "left", rpr: B }) +
            para(run("学生事务副校长签字:" + " ".repeat(15), B) +
                 run(" ".repeat(32) + "(印章Seal)", B), { jc: "left", rpr: B }) +
            para(run("(Signed by Deputy Principal of Pastoral)", B), { jc: "left", rpr: B }) +
            para("", { jc: "left", ind: 'w:firstLineChars="150" w:firstLine="315"', rpr: B }) +
            para(run(" ".repeat(31), B) + run(" ".repeat(43) + d.dateCn, B),
              { jc: "left", ind: 'w:leftChars="150" w:left="5355" w:hangingChars="2400" w:hanging="5040"', rpr: B })
        }),
        425
      );

    var body =
      /* —— 页头：校徽 / 中文校名 / 英文校名 / 标题，五行全部居中 —— */
      imageParagraph() +
      para(run("广州优联国际学校ULC学部", { font: "楷体", sz: 52, szCs: 72 }),
        { jc: "center", rpr: { font: "楷体", sz: 52, szCs: 72 } }) +
      para(run("Guangzhou ULink International School – ULC Division",
        { font: "Calibri", eaFont: "楷体", hint: false, sz: 28, szCs: 36 }),
        { jc: "center", rpr: { font: "Calibri", sz: 28, szCs: 36 } }) +
      para(run("志愿服务记录证明", { font: "楷体", sz: 56, szCs: 96 }),
        { jc: "center", rpr: { font: "楷体", sz: 56, szCs: 96 } }) +
      para(run("(Certificate of Voluntary Service)",
        { font: "Calibri", eaFont: "楷体", hint: false, sz: 24, szCs: 32 }),
        { jc: "center", rpr: { font: "Calibri", sz: 24, szCs: 32 } }) +
      para("", { jc: "center" }) +
      "<w:tbl>" +
        "<w:tblPr>" +
          '<w:tblW w:w="0" w:type="auto"/>' +
          "<w:tblBorders>" +
            ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (side) {
              return "<w:" + side + ' w:val="single" w:sz="4" w:space="0" w:color="auto"/>';
            }).join("") +
          "</w:tblBorders>" +
          '<w:tblInd w:w="' + TBL_IND + '" w:type="dxa"/>' +
          '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
        "</w:tblPr>" +
        "<w:tblGrid>" + COL_W.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>" +
        rowsXml +
      "</w:tbl>" +
      /* —— 表下（这几行在表格外面）：经办人 / 联系电话 → 两条横线 → 两个标签 ——
         ⚠️ 横线是两段独立的「——」用 8 个制表符隔开：一条在左、一条在右。
            合成一条长横线就不是原件的样子；制表符个数也是照原件数的，别随手改。 */
      para("", { jc: "left" }) +
      para(run(d.handler, B) + tabs(9, B) + run("  ", B) + run(" ", B) + run(d.phone, B),
        { jc: "left", ind: 'w:firstLineChars="250" w:firstLine="525"', rpr: B }) +
      para(run("——————————", B) + tabs(8, B) + run(" ", B) + run("————————————", B),
        { jc: "left", ind: 'w:firstLineChars="250" w:firstLine="525"', rpr: B }) +
      para(run("经办人(Handled By)", B9) + tabs(9, B9) + run("     ", B9) +
           run("联系电话 (Contact No.)", B9),
        { jc: "left", ind: 'w:firstLineChars="350" w:firstLine="630"', rpr: B9 }) +
      para("", { jc: "left", rpr: B9 }) +
      /* ⚠️ 这句话原件里就没写完（「…会使用」后面是空的）。照抄 —— 生成的证明要交给
         学校的，别自己补全；真要补，先跟老师确认原文。 */
      para(run("请注意GUIS-ULC学生处办公室会使用", B9), { jc: "left", rpr: B9 }) +
      /* A4：11906 × 16838 twips，四边 720（1.27cm），跟原件一致 */
      "<w:sectPr>" +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="' + PG_MAR + '" w:right="' + PG_MAR + '" w:bottom="' + PG_MAR +
          '" w:left="' + PG_MAR + '" w:header="851" w:footer="992" w:gutter="0"/>' +
        '<w:cols w:space="425"/>' +
        '<w:docGrid w:type="lines" w:linePitch="312"/>' +
      "</w:sectPr>";

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      "<w:body>" + body + "</w:body></w:document>";
  }

  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    "</Types>";

  var ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  var DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    "</Relationships>";

  /* word/settings.xml —— 只有一行，但很关键：
     defaultTabStop 420 决定了表下那几行 <w:tab/> 的落点（420 twips = 2 个 10.5pt 汉字）。
     少了这个文件，Word 用默认 720，电话/横线/标签就会全挤到中间去。 */
  var SETTINGS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:defaultTabStop w:val="' + TAB_STOP + '"/>' +
    "</w:settings>";

  /* 只留 docDefaults + Normal：版式全靠 document.xml 里的直接格式。
     ⚠️ 默认字体必须写 等线 10.5pt —— 原件里标签/横线那些 run 不写 rFonts，
        全靠继承；这里写错，行宽和制表符落点就跟着错。
     ⚠️ 这里**不要**写 <w:spacing>：原件靠 docGrid 的 linePitch 312 撑行距，
        自己写一个 line=259 会把行压扁 —— 「全都挤在一起」就是这么来的。 */
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:docDefaults>" +
      "<w:rPrDefault><w:rPr>" +
        '<w:rFonts w:ascii="等线" w:eastAsia="等线" w:hAnsi="等线" w:cs="等线"/>' +
        '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>' +
        '<w:sz w:val="21"/><w:szCs w:val="24"/>' +
      "</w:rPr></w:rPrDefault>" +
      "<w:pPrDefault/>" +
    "</w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
      '<w:name w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:widowControl w:val="0"/><w:jc w:val="both"/></w:pPr>' +
      "<w:rPr>" +
        '<w:rFonts w:ascii="等线" w:eastAsia="等线" w:hAnsi="等线" w:cs="等线"/>' +
        '<w:kern w:val="2"/><w:sz w:val="21"/><w:szCs w:val="24"/>' +
      "</w:rPr>" +
    "</w:style>" +
    "</w:styles>";

  var crestCache = null;
  function crestBytes() {
    if (crestCache) return Promise.resolve(crestCache);
    return fetch("assets/logo/cert-crest.png").then(function (r) {
      if (!r.ok) throw new Error("校徽图读取失败（" + r.status + "）");
      return r.arrayBuffer();
    }).then(function (buf) {
      crestCache = new Uint8Array(buf);
      return crestCache;
    });
  }

  function collect() {
    var nameCn = ($("ct-name").value || "").trim();
    var nameEn = ($("ct-name-en").value || "").trim();
    var hours = ($("ct-hours").value || "").trim();
    return {
      nameCn: nameCn,
      nameEn: nameEn,
      /* 英文名写在中文名前面 —— 跟学校材料上的习惯一致（Thomas Lin 林骏玮） */
      name: (nameEn ? nameEn + " " + nameCn : nameCn).trim(),
      idno: ($("ct-idno").value || "").trim(),
      idtype: $("ct-idtype").value || "",
      hours: hours ? hours + " 小时 (Hours)" : "",
      content: ($("ct-content").value || "").trim(),
      other: ($("ct-other").value || "").trim(),
      dateCn: cnDate($("ct-date").value) || cnDate(ymd()),
      dateYmd: $("ct-date").value || ymd(),
      handler: ($("ct-handler").value || "").trim(),
      phone: ($("ct-phone").value || "").trim()
    };
  }

  function check(d) {
    /* ⚠️ 判「姓名」要看 d.nameCn 而不是 d.name —— 只填了英文名时 d.name 非空，
       会被放过去，生成出来的证明姓名一栏是空的。 */
    if (!d.nameCn) return "先把姓名填上 —— 证明上没名字不能用。英文名请填在它右边那格。";
    if (!d.hours) return "志愿服务时长是空的：勾几条记录，或者自己手填小时数。";
    if (!d.idno) return "证件号码是空的。如果确实不想印在证明上，填「——」也可以，但要先确认学校收不收。";
    return "";
  }

  function fileName(d) {
    var safe = (d.name || "同学").replace(/[\\/:*?"<>|\s]/g, "");
    return "志愿服务证明-" + safe + "-" + d.dateYmd + ".docx";
  }

  function build() {
    var d = collect();
    var bad = check(d);
    if (bad) { alertIn($("ct-alerts"), "error", htmlEsc(bad)); return; }

    var btn = $("ct-go");
    busyOn(btn, "正在生成…");
    clear($("ct-alerts"));

    crestBytes().then(function (png) {
      var blob = D.zip([
        { name: "[Content_Types].xml", data: CONTENT_TYPES },
        { name: "_rels/.rels", data: ROOT_RELS },
        { name: "word/document.xml", data: documentXml(d) },
        { name: "word/_rels/document.xml.rels", data: DOC_RELS },
        { name: "word/styles.xml", data: STYLES },
        { name: "word/settings.xml", data: SETTINGS },
        { name: "word/media/image1.png", data: png }
      ]);
      D.save(blob, fileName(d));
      busyOff(btn);
      alertIn($("ct-alerts"), "ok",
        "证明已生成：<b>" + htmlEsc(fileName(d)) + "</b> —— 去「下载」里打开看看，" +
        "确认姓名、时长、落款都对得上再交给学校。");
    }).catch(function (err) {
      busyOff(btn);
      alertIn($("ct-alerts"), "error", "生成失败：" + htmlEsc((err && err.message) || "请重试"));
    });
  }

  /* ---------- 打印 / 另存 PDF ----------
     打印时整页只剩证明那一块：把 sheet 克隆进 #cert-print-portal，
     其余顶层元素用 @media print 隐藏（见 app.css）。 */
  function printCert() {
    var portal = $("cert-print-portal");
    var sheet = $("cert-sheet");
    if (!portal || !sheet) return;
    portal.innerHTML = sheet.outerHTML.replace(/ style="transform:[^"]*"/, "");
    portal.className = "cert-print-on";
    window.print();
  }

  /* ================= 事件绑定 ================= */
  $("ct-refresh").addEventListener("click", loadRows);

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

  /* 手改过时长之后就别再被勾选覆盖，直到他点「按勾选重算」 */
  $("ct-hours").addEventListener("input", function () {
    $("ct-hours").dataset.auto = "0";
    paintPreview();
  });
  $("ct-recalc").addEventListener("click", function () {
    $("ct-hours").dataset.auto = "1";
    sync();
  });

  /* 手改过内容之后也别再被覆盖 */
  $("ct-content").addEventListener("input", function () {
    contentTouched = true;
    paintPreview();
  });
  $("ct-content").addEventListener("blur", function () {
    /* 清空 = 回到自动生成 */
    if (!($("ct-content").value || "").trim()) { contentTouched = false; sync(); }
  });

  ["ct-name", "ct-name-en", "ct-idno", "ct-idtype", "ct-other", "ct-handler", "ct-phone", "ct-date"]
    .forEach(function (id) {
      $(id).addEventListener("input", paintPreview);
      $(id).addEventListener("change", paintPreview);
    });

  $("ct-go").addEventListener("click", build);
  $("ct-print").addEventListener("click", printCert);

  /* ---------- 初始值 ---------- */
  $("ct-date").value = ymd();
  boot();
})();
