/* ============================================================
   GUIS 义工组织 — 文件披露页渲染逻辑（assets/disclosure.js，2026-11-03 改云端驱动）

   数据来源：云端 PostgreSQL 表 disclosure_files（元数据）+ 云存储（文件本体）。
   - 清单（标题/分类/日期）公开：匿名也能拉。
   - 文件内容（预览/下载）需登录：平台云存储不暴露公开 URL，预览/下载都走签名 URL，
     获取 URL 需登录，URL 本身是短时效密钥。
   - 上传：仅组织成员（owner）可见自助上传面板，自己传、无需改代码。
   - 删除：仅上传者本人（owner）可删自己的文件（行 + 存储对象一并删）。

   新增一份披露文件：组织成员登录后，在页内上传面板填好信息提交即可，无需找开发者。
   ============================================================ */
window.GUISDisclosure = (function () {

  var C = window.GUISCloud;

  /* 分类 key —— 顺序即筛选条从左到右的顺序；要加分类就在此加 key，
     并在 assets/i18n.js 的 zh / en 里补 dc.cat.<key> 文案。 */
  var CATEGORIES = ["charter", "regulation", "finance", "report", "notice"];

  /* 允许上传的格式与大小上限（前端校验，服务端存储不限） */
  var ALLOWED_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "json", "log"];
  var MAX_BYTES = 20 * 1024 * 1024;

  var openId = null;            /* 当前就地展开的行 id */
  var currentUser = null;       /* { id, email, role } */
  var isAuthed = false;
  var isOwnerUser = false;

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

  function todayStr() {
    var n = new Date();
    function p(x) { return (x < 10 ? "0" : "") + x; }
    return n.getFullYear() + "-" + p(n.getMonth() + 1) + "-" + p(n.getDate());
  }

  function bytesToSize(b) {
    if (b == null) return "";
    var u = ["B", "KB", "MB", "GB"], i = 0, n = Number(b);
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
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

  /* 确认登录态与角色。无会话 → 未登录；拿不到角色按 student 处理（不踢人）。 */
  function refreshAuth() {
    if (!C || typeof C.sessionUser !== "function") {
      currentUser = null; isAuthed = false; isOwnerUser = false;
      return Promise.resolve(null);
    }
    return Promise.resolve(C.sessionUser()).then(function (u) {
      if (!u) { currentUser = null; isAuthed = false; isOwnerUser = false; return null; }
      if (typeof C.myAccess !== "function") {
        currentUser = { id: u.id, email: u.email, role: "student" };
        isAuthed = true; isOwnerUser = false; return currentUser;
      }
      return Promise.resolve(C.myAccess()).then(function (ar) {
        var role = (ar && ar.data && ar.data[0] && ar.data[0].role) || "student";
        currentUser = { id: u.id, email: u.email, role: role };
        isAuthed = true;
        isOwnerUser = (role === "owner");
        return currentUser;
      }, function () {
        currentUser = { id: u.id, email: u.email, role: "student" };
        isAuthed = true; isOwnerUser = false; return currentUser;
      });
    }, function () {
      currentUser = null; isAuthed = false; isOwnerUser = false; return null;
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
      +     (f.size ? '<span class="dc-size">' + esc(f.size) + "</span>" : "")
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
    Promise.resolve(C.listDisclosure()).then(function (res) {
      var rows = (res && res.data) || [];
      rows = rows.filter(function (f) { return active === "all" || f.cat === active; });
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

  function toggle(row) {
    var id = row.getAttribute("data-id");
    if (openId === id) { collapse(); return; }
    if (!isAuthed) { showLoginHint(); return; }
    var path = row.getAttribute("data-path");
    var list = document.getElementById("dc-list");
    Promise.resolve(C.disclosureUrl(path, 900)).then(function (res) {
      if (!res || res.error) throw (res && res.error) || new Error("url failed");
      var url = res.data && res.data.url;
      if (!url) throw new Error("no url");
      collapse();
      var panel = buildPreviewEl(path, url);
      if (row.nextSibling) list.insertBefore(panel, row.nextSibling);
      else list.appendChild(panel);
      row.classList.add("is-open");
      setRowLabel(row, true);
      openId = id;
    }).catch(function (err) { console.error("[disclosure] preview failed", err); });
  }

  function doDownload(row) {
    if (!row) return;
    if (!isAuthed) { showLoginHint(); return; }
    var path = row.getAttribute("data-path");
    var name = row.getAttribute("data-name") || "file";
    Promise.resolve(C.disclosureUrl(path, 900)).then(function (res) {
      if (!res || res.error) throw (res && res.error) || new Error("url failed");
      var url = res.data && res.data.url;
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

  /* ===== 组织成员自助上传 ===== */
  function wireUpload() {
    var form = document.getElementById("dc-upload-form");
    if (!form) return;
    var fileInput = document.getElementById("dc-file");
    var nameEl = document.getElementById("dc-file-name");
    var msg = document.getElementById("dc-upload-msg");
    var submit = document.getElementById("dc-submit");

    function validate(f) {
      if (!f) return "";
      var ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ALLOWED_EXT.indexOf(ext) < 0) return t("dc.badType", "不支持的格式");
      if (f.size > MAX_BYTES) return t("dc.fileTooBig", "文件过大");
      return "";
    }

    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      var err = validate(f);
      nameEl.textContent = err ? err : (f ? f.name + " · " + bytesToSize(f.size) : "");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!isOwnerUser || !currentUser) { msg.textContent = t("dc.needLoginUpload", "请登录组织成员账号后上传"); return; }
      var f = fileInput.files && fileInput.files[0];
      var err = validate(f);
      if (err) { msg.textContent = err; return; }
      var titleZh = document.getElementById("dc-title-zh").value.trim();
      if (!titleZh) { msg.textContent = t("dc.fTitleZh", "中文标题") + " *"; return; }
      var cat = document.getElementById("dc-cat").value;
      var dateVal = document.getElementById("dc-date").value || todayStr();

      submit.disabled = true; submit.textContent = t("dc.uploading", "上传中…"); msg.textContent = "";
      Promise.resolve(C.uploadDisclosure(f, currentUser.id))
        .then(function (up) {
          if (!up || up.error) throw (up && up.error) || new Error("upload failed");
          return C.insertDisclosure({
            cat: cat,
            storage_path: up.data.path,
            original_name: f.name,
            title_zh: titleZh,
            desc_zh: document.getElementById("dc-desc-zh").value.trim(),
            title_en: document.getElementById("dc-title-en").value.trim(),
            desc_en: document.getElementById("dc-desc-en").value.trim(),
            file_date: dateVal,
            size: bytesToSize(f.size)
          });
        })
        .then(function () {
          msg.textContent = t("dc.uploadOk", "上传成功");
          form.reset(); nameEl.textContent = "";
          render(); renderMyUploads();
        })
        .catch(function (err) {
          console.error("[disclosure] upload failed", err);
          msg.textContent = t("dc.uploadFail", "上传失败，请重试");
        })
        .then(function () {
          submit.disabled = false; submit.textContent = t("dc.submit", "上传");
        });
    });
  }

  function renderMyUploads() {
    var box = document.getElementById("dc-myuploads");
    if (!box) return;
    if (!isOwnerUser) { box.innerHTML = ""; return; }
    Promise.resolve(C.listDisclosure()).then(function (res) {
      var rows = (res && res.data) || [];
      rows = rows.filter(function (r) { return r.owner_id === currentUser.id; });
      if (!rows.length) { box.innerHTML = '<div class="dc-empty small">' + esc(t("dc.empty", "暂无披露文件。")) + "</div>"; return; }
      var en = isEn();
      var html = "";
      rows.forEach(function (r) {
        var lbl = en ? (r.title_en || r.title_zh) : (r.title_zh || r.title_en);
        html += '<div class="dc-my-item" data-id="' + esc(String(r.id)) + '" data-path="' + esc(r.storage_path) + '">'
          + '<span class="dc-my-name">' + esc(lbl || r.original_name) + "</span>"
          + '<button type="button" class="dc-my-del">' + esc(t("dc.delete", "删除")) + "</button>"
          + "</div>";
      });
      box.innerHTML = html;
    }, function () { box.innerHTML = ""; });
  }

  function wireMyUploads() {
    var box = document.getElementById("dc-myuploads");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".dc-my-del") : null;
      if (!btn) return;
      if (!window.confirm(t("dc.confirmDelete", "确定删除这份披露文件？此操作不可撤销。"))) return;
      var item = btn.closest(".dc-my-item");
      var id = item.getAttribute("data-id");
      var path = item.getAttribute("data-path");
      Promise.resolve(C.deleteDisclosureRow(id))
        .then(function () { return C.deleteDisclosureStorage(path); })
        .then(function () { renderMyUploads(); render(); })
        .catch(function (err) { console.error("[disclosure] delete failed", err); window.alert(t("dc.uploadFail", "删除失败")); });
    });
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
    refreshAuth().then(function () {
      render();
      var up = document.getElementById("dc-upload");
      if (isOwnerUser) {
        if (up) up.hidden = false;
        wireUpload();
        wireMyUploads();
        renderMyUploads();
      } else if (up) {
        up.hidden = true;
      }
    });

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

    /* 语言切换钩子：跟踪 document.documentElement.lang，变了就重渲染 */
    var last = document.documentElement.lang;
    Array.prototype.forEach.call(document.querySelectorAll(".lang-btn"), function (b) {
      b.addEventListener("click", function () {
        if (document.documentElement.lang !== last) {
          last = document.documentElement.lang;
          renderFilters();
          render();
          if (isOwnerUser) renderMyUploads();
        }
      });
    });
  }

  return { init: init, render: render, toggle: toggle, collapse: collapse };
})();
