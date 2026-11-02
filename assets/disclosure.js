/* ============================================================
   GUIS 义工组织 — 文件披露页渲染逻辑（assets/disclosure.js）

   交互：列表项点击 → 弹出预览窗口，在站内预览文件（不提供下载）。
   - PDF / 图片 / 纯文本：浏览器内嵌预览（PDF 隐藏原生工具栏，减少下载入口）
   - 其它格式（docx / xlsx / pptx 等）：提示“暂不支持在线预览”

   如何新增一份披露文件（纯静态，无需后端）：
   1) 把文件放进 assets/disclosure/ （支持 pdf / docx / xlsx / pptx / txt / jpg …）
   2) 在下面 FILES 数组里加一行对象（见示例）
      - cat：必须是 CATEGORIES 里存在的 key
      - file：相对站点根的路径，如 "assets/disclosure/xxx.pdf"
      - date：ISO 日期 YYYY-MM-DD（列表里会按中/英本地化显示）
      - size：人类可读体积，如 "1.2 MB"（可留空）
      - zh / en：标题与一句话说明，两种语言都要给
   3) 提交 + 部署即可，无需改数据库、不耗云配额。
   ============================================================ */
window.GUISDisclosure = (function () {

  /* 分类 key —— 顺序即筛选条从左到右的顺序；要加分类就在此加 key，
     并在 assets/i18n.js 的 zh / en 里补 dc.cat.<key> 文案。 */
  var CATEGORIES = ["charter", "regulation", "finance", "report", "notice"];

  /* ===== 披露文件数据（示例为占位文件，上线前替换为真实文档） ===== */
  var FILES = [
    {
      id: "charter-2026",
      cat: "charter",
      file: "assets/disclosure/sample-charter.pdf",
      date: "2026-09-01",
      size: "0.8 MB",
      zh: { title: "义工组织章程（示例）", desc: "组织宗旨、架构与运作规则。" },
      en: { title: "Volunteer Charter (Sample)", desc: "Mission, structure and operating rules." }
    },
    {
      id: "finance-2026h1",
      cat: "finance",
      file: "assets/disclosure/sample-financial-disclosure.txt",
      date: "2026-07-15",
      size: "4 KB",
      zh: { title: "2026 上半年财务披露（示例）", desc: "善款收支与物资使用明细。" },
      en: { title: "H1 2026 Financial Disclosure (Sample)", desc: "Breakdown of donations, spend and supplies." }
    }
  ];

  function isEn() { return document.documentElement.lang === "en"; }

  function dict() {
    var l = document.documentElement.lang;
    var key = (l && l.indexOf("en") === 0) ? "en" : "zh";
    return (window.SITE_I18N && window.SITE_I18N[key]) || {};
  }

  function t(key, fallback) {
    var d = dict();
    return (d && d[key]) || fallback || key;
  }

  function fmtDate(iso, en) {
    var p = String(iso).split("-");
    if (p.length < 3) return iso;
    var y = +p[0], m = +p[1], d = +p[2];
    if (en) {
      var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return M[m - 1] + " " + d + ", " + y;
    }
    return y + "年" + m + "月" + d + "日";
  }

  function ext(file) {
    var i = file.lastIndexOf(".");
    return i >= 0 ? file.slice(i + 1).toLowerCase() : "file";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* 浏览器能否直接内嵌预览 */
  function previewKind(file) {
    var e = ext(file);
    if (e === "pdf") return "pdf";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].indexOf(e) >= 0) return "image";
    if (["txt", "md", "csv", "json", "log", "text"].indexOf(e) >= 0) return "text";
    return "none";
  }

  function rowHTML(f, en) {
    var lbl = f[en ? "en" : "zh"] || {};
    var catLbl = t("dc.cat." + f.cat, f.cat);
    return ""
      + '<span class="dc-icon">' + esc(ext(f.file).toUpperCase()) + "</span>"
      + '<span class="dc-main">'
      +   '<span class="dc-title">' + esc(lbl.title || f.file) + "</span>"
      +   (lbl.desc ? '<span class="dc-desc">' + esc(lbl.desc) + "</span>" : "")
      + "</span>"
      + '<span class="dc-meta">'
      +   '<span class="dc-cat">' + esc(catLbl) + "</span>"
      +   '<span class="dc-date">' + esc(t("dc.date", "发布")) + "：" + esc(fmtDate(f.date, en)) + "</span>"
      +   (f.size ? '<span class="dc-size">' + esc(f.size) + "</span>" : "")
      + "</span>"
      + '<span class="dc-dl">' + esc(t("dc.preview", "预览")) + " ↗</span>";
  }

  function render() {
    var list = document.getElementById("dc-list");
    if (!list) return;
    var en = isEn();
    var active = list.getAttribute("data-cat") || "all";
    var rows = FILES.filter(function (f) { return active === "all" || f.cat === active; });

    if (!rows.length) {
      list.innerHTML = '<div class="dc-empty">' + esc(t("dc.empty", "暂无披露文件。")) + "</div>";
      return;
    }

    /* 行改为 <button>，点击由事件委托打开预览弹窗（不再有下载链接） */
    var html = "";
    rows.forEach(function (f) {
      html += '<button type="button" class="dc-row" data-preview="' + esc(f.id) + '">' + rowHTML(f, en) + "</button>";
    });
    list.innerHTML = html;
  }

  /* ===== 预览弹窗 ===== */
  function openPreview(f) {
    var modal = document.getElementById("dc-modal");
    var titleEl = document.getElementById("dc-modal-title");
    var subEl = document.getElementById("dc-modal-sub");
    var body = document.getElementById("dc-modal-body");
    if (!modal || !body || !titleEl || !subEl) return;

    var en = isEn();
    var lbl = f[en ? "en" : "zh"] || {};
    var catLbl = t("dc.cat." + f.cat, f.cat);
    titleEl.textContent = lbl.title || f.file;
    subEl.textContent = catLbl + " · " + fmtDate(f.date, en) + (f.size ? " · " + f.size : "");

    var kind = previewKind(f.file);
    if (kind === "pdf") {
      /* #toolbar=0 隐藏 PDF 原生工具栏（含下载按钮），view=FitH 整页宽度自适应 */
      body.innerHTML = '<iframe src="' + esc(f.file) + "#toolbar=0&navpanes=0&view=FitH&zoom=page-fit"
        + '" title="' + esc(lbl.title || f.file) + '" loading="lazy"></iframe>';
    } else if (kind === "image") {
      body.innerHTML = '<img src="' + esc(f.file) + '" alt="' + esc(lbl.title || f.file) + '" />';
    } else if (kind === "text") {
      body.innerHTML = '<iframe src="' + esc(f.file) + '" title="' + esc(lbl.title || f.file) + '" loading="lazy"></iframe>';
    } else {
      body.innerHTML = '<div class="dc-modal-nopreview">'
        + '<div class="big">' + esc(t("dc.noPreview", "该格式暂不支持在线预览。")) + "</div>"
        + '<div class="small">' + esc(ext(f.file).toUpperCase()) + "</div>"
        + "</div>";
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-lock");
    var c = document.getElementById("dc-modal-close");
    if (c) c.focus();
  }

  function closeModal() {
    var modal = document.getElementById("dc-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-lock");
    var body = document.getElementById("dc-modal-body");
    if (body) body.innerHTML = ""; /* 释放 iframe，停止加载 */
  }

  function renderFilters() {
    var bar = document.getElementById("dc-filters");
    if (!bar) return;
    var html = '<button type="button" class="dc-chip is-active" data-cat="all">' + esc(t("dc.all", "全部")) + "</button>";
    CATEGORIES.forEach(function (c) {
      html += '<button type="button" class="dc-chip" data-cat="' + c + '">' + esc(t("dc.cat." + c, c)) + "</button>";
    });
    bar.innerHTML = html;
    Array.prototype.forEach.call(bar.querySelectorAll(".dc-chip"), function (b) {
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(bar.querySelectorAll(".dc-chip"), function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active");
        var list = document.getElementById("dc-list");
        if (list) list.setAttribute("data-cat", b.getAttribute("data-cat"));
        render();
      });
    });
  }

  function init() {
    renderFilters();
    render();

    /* 列表项点击 → 打开预览（事件委托，兼容分类切换后重渲染的行） */
    var list = document.getElementById("dc-list");
    if (list) {
      list.addEventListener("click", function (e) {
        var row = e.target.closest ? e.target.closest(".dc-row") : null;
        if (!row) return;
        var id = row.getAttribute("data-preview");
        var f = null;
        for (var i = 0; i < FILES.length; i++) { if (FILES[i].id === id) { f = FILES[i]; break; } }
        if (f) openPreview(f);
      });
    }

    /* 关闭：点遮罩 / 点关闭按钮 / Esc */
    var modal = document.getElementById("dc-modal");
    if (modal) {
      Array.prototype.forEach.call(modal.querySelectorAll("[data-close]"), function (el) {
        el.addEventListener("click", closeModal);
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") closeModal();
    });

    /* 语言切换钩子：跟踪 document.documentElement.lang，变了就重渲染 */
    var last = document.documentElement.lang;
    Array.prototype.forEach.call(document.querySelectorAll(".lang-btn"), function (b) {
      b.addEventListener("click", function () {
        if (document.documentElement.lang !== last) {
          last = document.documentElement.lang;
          renderFilters();
          render();
        }
      });
    });
  }

  return { init: init, render: render, openPreview: openPreview, closeModal: closeModal };
})();
