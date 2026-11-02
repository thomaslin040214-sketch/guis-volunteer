/* ============================================================
   GUIS 义工组织 — 文件披露页渲染逻辑（assets/disclosure.js）

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
    return i >= 0 ? file.slice(i + 1).toUpperCase() : "FILE";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
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

    var html = "";
    rows.forEach(function (f) {
      var lbl = f[en ? "en" : "zh"] || {};
      var catLbl = t("dc.cat." + f.cat, f.cat);
      html +=
        '<a class="dc-row" href="' + esc(f.file) + '" download>' +
          '<span class="dc-icon">' + esc(ext(f.file)) + "</span>" +
          '<span class="dc-main">' +
            '<span class="dc-title">' + esc(lbl.title || f.file) + "</span>" +
            (lbl.desc ? '<span class="dc-desc">' + esc(lbl.desc) + "</span>" : "") +
          "</span>" +
          '<span class="dc-meta">' +
            '<span class="dc-cat">' + esc(catLbl) + "</span>" +
            '<span class="dc-date">' + esc(t("dc.date", "发布")) + "：" + esc(fmtDate(f.date, en)) + "</span>" +
            (f.size ? '<span class="dc-size">' + esc(f.size) + "</span>" : "") +
          "</span>" +
          '<span class="dc-dl">' + esc(t("dc.download", "下载")) + " ↓</span>" +
        "</a>";
    });
    list.innerHTML = html;
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
    /* 语言切换钩子：跟踪 document.documentElement.lang，变了就重渲染
       （沿用 assets/team-render.js 的写法，main.js 的 applyLang 会改 lang） */
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

  return { init: init, render: render };
})();
