/* ============================================================
   GUIS 义工组织 — 文件披露页渲染逻辑（assets/disclosure.js，2026-11-03 改云端驱动）

   数据来源：云端 PostgreSQL 表 disclosure_files（元数据）+ 云存储（文件本体）。
   - 清单（标题/分类/日期）公开：匿名也能拉。
   - 文件内容（预览/下载）需登录：平台云存储不暴露公开 URL，预览/下载都走签名 URL，
     获取 URL 需登录，URL 本身是短时效密钥。
   - 上传 / 删除：已迁到后台（admin.html 的「文件披露」页签），本页只负责公开的清单与
     登录后的预览、下载。这样公开页不会被上传表单干扰，预览也更干净。

   注：上传能力在 assets/disclosure-admin.js（仅组织成员可见的后台页签）。
   ============================================================ */
window.GUISDisclosure = (function () {

  var C = window.GUISCloud;

  /* 分类 key —— 顺序即筛选条从左到右的顺序；要加分类就在此加 key，
     并在 assets/i18n.js 的 zh / en 里补 dc.cat.<key> 文案。 */
  var CATEGORIES = ["charter", "personnel", "report", "notice"];

  /* 直接走 C.db 取，含 sort_order（cloud.js 的 listDisclosure 没摘这一列，手动排序要靠它）。
     disclosure_files 没有 PII，SELECT 公开，直接查没问题。 */
  var DC_COLS = "id, cat, storage_path, original_name, title_zh, desc_zh, title_en, desc_en, file_date, size, created_at, owner_id, sort_order";

  var openId = null;            /* 当前就地展开的行 id */
  var isAuthed = false;

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
    if (!iso) return "";
    var p = String(iso).split("T")[0].split("-");
    if (p.length < 3) return iso;
    var y = +p[0], m = +p[1], d = +p[2];
    if (en) {
      var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return M[m - 1] + " " + d + ", " + y;
    }
    return y + "年" + m + "月" + d + "日";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function previewKindFromPath(path) {
    var e = C.disclosureExt(path);
    if (e === "pdf") return "pdf";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].indexOf(e) >= 0) return "image";
    if (["txt", "md", "csv", "json", "log", "text"].indexOf(e) >= 0) return "text";
    return "none";
  }

  /* 确认登录态。无会话 → 未登录；拿不到角色按 student 处理（不踢人）。
     公开页只需要 isAuthed（决定预览/下载要不要先弹登录提示）。 */
  function refreshAuth() {
    if (!C || typeof C.sessionUser !== "function") {
      isAuthed = false;
      return Promise.resolve(null);
    }
    return Promise.resolve(C.sessionUser()).then(function (u) {
      isAuthed = !!u;
      return u;
    }, function () {
      isAuthed = false;
      return null;
    });
  }

  function rowHTML(f, en) {
    var lbl = en ? (f.title_en || f.title_zh) : (f.title_zh || f.title_en);
    var desc = en ? (f.desc_en || f.desc_zh) : (f.desc_zh || f.desc_en);
    var catLbl = t("dc.cat." + f.cat, f.cat);
    var name = f.original_name || C.disclosureExt(f.storage_path);
    return ""
      + '<div class="dc-row" data-id="' + esc(String(f.id)) + '" data-path="' + esc(f.storage_path) + '" data-name="' + esc(name) + '">'
      +   '<span class="dc-icon">' + esc(C.disclosureExt(f.storage_path).toUpperCase()) + "</span>"
      +   '<span class="dc-main">'
      +     '<span class="dc-title">' + esc(lbl || name) + "</span>"
      +     (desc ? '<span class="dc-desc">' + esc(desc) + "</span>" : "")
      +   "</span>"
      +   '<span class="dc-meta">'
      +     '<span class="dc-cat">' + esc(catLbl) + "</span>"
      +     '<span class="dc-date">' + esc(t("dc.date", "发布")) + "：" + esc(fmtDate(f.file_date, en)) + "</span>"
      +     ""
      +   "</span>"
      +   '<span class="dc-actions">'
      +     '<span class="dc-dl">' + esc(t("dc.preview", "预览")) + " ↗</span>"
      +     '<button type="button" class="dc-download">' + esc(t("dc.download", "下载")) + " ↓</button>"
      +   "</span>"
      + "</div>";
  }

  function render() {
    var list = document.getElementById("dc-list");
    if (!list) return;
    var en = isEn();
    openId = null;
    var active = list.getAttribute("data-cat") || "all";
    Promise.resolve(C.db.from("disclosure_files").select(DC_COLS)).then(function (res) {
      var rows = (res && res.data) || [];
      rows = rows.filter(function (f) { return active === "all" || f.cat === active; });
      /* 手动排序：sort_order 升序优先；并列时按发布日期倒序、再按入库时间倒序。 */
      rows.sort(function (a, b) {
        var sa = (a.sort_order == null ? 0 : a.sort_order), sb = (b.sort_order == null ? 0 : b.sort_order);
        if (sa !== sb) return sa - sb;
        var da = a.file_date || "", db = b.file_date || "";
        if (da !== db) return da < db ? 1 : -1;
        var ca = a.created_at || "", cb = b.created_at || "";
        return ca < cb ? 1 : -1;
      });
      if (!rows.length) {
        list.innerHTML = '<div class="dc-empty">' + esc(t("dc.empty", "暂无披露文件。")) + "</div>";
        return;
      }
      var html = "";
      rows.forEach(function (f) { html += rowHTML(f, en); });
      list.innerHTML = html;
    }, function () {
      list.innerHTML = '<div class="dc-empty">' + esc(t("dc.loadFail", "加载失败，请刷新。")) + "</div>";
    });
  }

  /* ===== 就地（行内）展开预览（需登录） ===== */
  function setRowLabel(row, open) {
    var el = row.querySelector(".dc-dl");
    if (el) el.textContent = (open ? t("dc.collapse", "收起") : t("dc.preview", "预览")) + (open ? " ↡" : " ↗");
  }

  function buildPreviewEl(path, url) {
    var kind = previewKindFromPath(path);
    var wrap = document.createElement("div");
    wrap.className = "dc-preview";
    if (kind === "pdf") {
      var ifr = document.createElement("iframe");
      ifr.className = "dc-preview-frame";
      ifr.src = url + "#toolbar=0&navpanes=0&view=FitH&zoom=page-fit";
      ifr.loading = "lazy";
      wrap.appendChild(ifr);
    } else if (kind === "image") {
      var img = document.createElement("img");
      img.className = "dc-preview-frame";
      img.src = url;
      wrap.appendChild(img);
    } else if (kind === "text") {
      var txt = document.createElement("iframe");
      txt.className = "dc-preview-frame";
      txt.src = url;
      txt.loading = "lazy";
      wrap.appendChild(txt);
    } else {
      var nop = document.createElement("div");
      nop.className = "dc-preview-nopreview";
      nop.innerHTML = '<div class="big">' + esc(t("dc.noPreview", "该格式暂不支持在线预览。")) + "</div>"
        + '<div class="small">' + esc(C.disclosureExt(path).toUpperCase()) + "</div>";
      wrap.appendChild(nop);
    }
    return wrap;
  }

  function collapse() {
    if (!openId) return;
    var list = document.getElementById("dc-list");
    if (list) {
      var cur = list.querySelector(".dc-row.is-open");
      if (cur) { cur.classList.remove("is-open"); setRowLabel(cur, false); }
      var p = list.querySelector(".dc-preview");
      if (p) p.parentNode.removeChild(p);
    }
    openId = null;
  }

  /* ===== 同窗口内嵌「小窗」预览（灯箱，绝不开新标签页） ===== */
  function modalEl() { return document.getElementById("dc-modal"); }

  function closeModal() {
    var m = modalEl();
    if (m) m.hidden = true;
    var body = document.getElementById("dc-modal-body");
    if (body) body.innerHTML = "";
    if (openId) {
      var list = document.getElementById("dc-list");
      var cur = list && list.querySelector(".dc-row.is-open");
      if (cur) { cur.classList.remove("is-open"); setRowLabel(cur, false); }
      openId = null;
    }
  }

  function showModal(path, url, name, btn) {
    var m = modalEl();
    if (!m) return;
    var body = document.getElementById("dc-modal-body");
    var nameEl = m.querySelector(".dc-modal-name");
    if (nameEl) nameEl.textContent = name || "";
    var dl = document.getElementById("dc-modal-dl");
    if (dl) { dl.href = url; dl.download = name || "file"; }   /* 同窗口下载，不新开标签 */
    if (body) {
      body.innerHTML = "";
      body.appendChild(buildPreviewEl(path, url));
    }
    m.hidden = false;
    if (btn) btn.textContent = t("dc.preview", "预览") + " ↗";
  }

  function toggle(row) {
    var id = row.getAttribute("data-id");
    if (openId === id) { closeModal(); return; }
    if (!isAuthed) { showLoginHint(); return; }
    var path = row.getAttribute("data-path");
    var name = row.getAttribute("data-name") || "file";
    var btn = row.querySelector(".dc-dl");
    if (btn) btn.textContent = t("dc.previewing", "正在打开…");
    /* 同窗口灯箱：拿到签名 URL 后把文件塞进页面里的预览层，不开新标签页。
       之前「打不开」的真正原因是 SDK 返回的是 signedUrl 而非 url（字段名读错），
       现已在 cloud.js 的 disclosureUrl 里归一化。 */
    Promise.resolve(C.disclosureUrl(path, 900)).then(function (res) {
      if (!res || res.error) throw (res && res.error) || new Error("url failed");
      var url = res.data && (res.data.url || res.data.signedUrl);
      if (!url) throw new Error("no url");
      row.classList.add("is-open");
      setRowLabel(row, true);
      openId = id;
      showModal(path, url, name, btn);
    }).catch(function (err) {
      console.error("[disclosure] preview failed", err);
      if (btn) btn.textContent = t("dc.preview", "预览") + " ↗";
      alert(t("dc.previewFail", "预览打开失败：请确认已登录。若仍失败，按 F12 把 Console 红色报错发我。") + (err && err.message ? "\n" + err.message : ""));
    });
  }

  function doDownload(row) {
    if (!row) return;
    if (!isAuthed) { showLoginHint(); return; }
    var path = row.getAttribute("data-path");
    var name = row.getAttribute("data-name") || "file";
    Promise.resolve(C.disclosureUrl(path, 900)).then(function (res) {
      if (!res || res.error) throw (res && res.error) || new Error("url failed");
      var url = res.data && (res.data.url || res.data.signedUrl);
      if (!url) throw new Error("no url");
      var a = document.createElement("a");
      a.href = url; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }).catch(function (err) { console.error("[disclosure] download failed", err); });
  }

  function showLoginHint() {
    var el = document.getElementById("dc-login-hint");
    if (el) { el.hidden = false; try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }
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
    /* 登录态只影响预览/下载要不要先弹登录提示；清单本身公开，所以无论登录与否都先渲染列表。 */
    refreshAuth().then(render, render);

    var list = document.getElementById("dc-list");
    if (list) {
      list.addEventListener("click", function (e) {
        var dlBtn = e.target.closest ? e.target.closest(".dc-download") : null;
        if (dlBtn) { doDownload(dlBtn.closest(".dc-row")); return; }
        var row = e.target.closest ? e.target.closest(".dc-row") : null;
        if (!row) return;
        toggle(row);
      });
    }

    /* 预览灯箱关闭：点遮罩 / × / Esc（用 _wired 标记只挂一次） */
    var m = document.getElementById("dc-modal");
    if (m && !m._wired) {
      m._wired = true;
      m.addEventListener("click", function (e) {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-close")) closeModal();
      });
      document.addEventListener("keydown", function (e) {
        if (e && e.key === "Escape" && m && !m.hidden) closeModal();
      });
    }

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

  return { init: init, render: render, toggle: toggle, collapse: closeModal };
})();
