/* ============================================================
   GUIS 义工组织 — 文件披露「后台」自助上传（assets/disclosure-admin.js）

   仅在 admin.html 的「文件披露」页签里使用，组织成员（owner）可见。
   - 上传 / 删除走云端存储 + disclosure_files 表，owner 角色由数据库 is_owner() 校验。
   - 发布日期默认当天（北京时间 UTC+8），不再让使用者手动选 —— 用户明确要求的简化。
   ============================================================ */
window.GUISDisclosureAdmin = (function () {

  var C = window.GUISCloud;

  /* 直接走 C.db 取，含 sort_order（cloud.js 的 listDisclosure 没摘这一列，手动排序要靠它）。
     disclosure_files 无 PII，SELECT 公开，直接查没问题。 */
  function listDC() {
    return Promise.resolve(C.db.from("disclosure_files").select("id, cat, storage_path, original_name, title_zh, desc_zh, title_en, desc_en, file_date, size, created_at, owner_id, sort_order"));
  }

  /* 分类 key —— 与公开页 disclosure.js 保持一致；要加分类在此加并在 i18n 补文案。 */
  var CATEGORIES = ["charter", "personnel", "report", "notice"];
  var ALLOWED_EXT = ["pdf","doc","docx","xls","xlsx","ppt","pptx","txt","md","csv","png","jpg","jpeg","gif","webp","bmp","svg","json","log"];
  var MAX_BYTES = 20 * 1024 * 1024;   /* 平台单文件上限 20MB */

  var uid = null;
  var myRows = [];
  var busy = false;
  var wired = false;

  function isEn() { return document.documentElement.lang === "en"; }

  function dict() {
    var l = document.documentElement.lang;
    var key = (l && l.indexOf("en") === 0) ? "en" : "zh";
    return (window.SITE_I18N && window.SITE_I18N[key]) || {};
  }
  function t(k, fb) { var d = dict(); return (d && d[k]) || fb || k; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function fmtDate(iso, en) {
    if (!iso) return "";
    var p = String(iso).split("T")[0].split("-");
    if (p.length < 3) return iso;
    var y = +p[0], m = +p[1], d = +p[2];
    if (en) {
      var M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return M[m - 1] + " " + d + ", " + y;
    }
    return y + "年" + m + "月" + d + "日";
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    var b = +bytes;
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  }

  /* 发布日期：北京时间（UTC+8），不读访客设备时区。 */
  function todayISO() {
    var d = new Date();
    var bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
    var y = bj.getFullYear(), m = bj.getMonth() + 1, day = bj.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function refreshAuth() {
    return Promise.resolve(C.sessionUser()).then(function (u) {
      uid = (u && u.id) || null;
      return u;
    });
  }

  function setMsg(el, kind, text) {
    if (!el) return;
    el.className = "da-msg" + (kind ? " " + kind : "");
    el.textContent = text || "";
  }

  function validateFile(file) {
    if (!file) return t("dc.fChoose", "请选择文件");
    if (file.size > MAX_BYTES) return t("dc.fileTooBig", "文件过大（上限 20 MB）");
    var ext = String(file.name || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ALLOWED_EXT.indexOf(ext) < 0) return t("dc.badType", "不支持的文件格式");
    return null;
  }

  function wireForm() {
    var form = document.getElementById("da-form");
    if (!form) return;
    var fileInput = document.getElementById("da-file");
    var nameEl = document.getElementById("da-file-name");
    var msg = document.getElementById("da-upload-msg");
    var submit = document.getElementById("da-submit");

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        nameEl.textContent = (fileInput.files && fileInput.files[0]) ? fileInput.files[0].name : "";
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      if (!uid) { setMsg(msg, "err", t("dc.needLoginUpload", "请登录组织成员账号后上传")); return; }

      var file = fileInput && fileInput.files && fileInput.files[0];
      var verr = validateFile(file);
      if (verr) { setMsg(msg, "err", verr); return; }

      var cat = document.getElementById("da-cat").value;
      var titleZh = document.getElementById("da-title-zh").value.trim();
      var titleEn = document.getElementById("da-title-en").value.trim();
      var descZh = document.getElementById("da-desc-zh").value.trim();
      var descEn = document.getElementById("da-desc-en").value.trim();
      if (!titleZh) { setMsg(msg, "err", t("dc.needTitleZh", "请填写中文标题")); return; }

      busy = true; submit.disabled = true; setMsg(msg, "ok", t("dc.uploading", "上传中…"));

      /* 兜底：云端存储请求在某些情况下既不 resolve 也不 reject（静默挂起），
         必须靠超时把 UI 救回来，否则会永久停在「上传中」。 */
      var timer = setTimeout(function () {
        if (busy) {
          busy = false; submit.disabled = false;
          setMsg(msg, "err", t("dc.uploadTimeout", "上传超时（约 40 秒无响应）。请检查网络后重试；若反复失败，按 F12 打开 Console 把红色报错发我。"));
        }
      }, 40000);

      function reset() {
        clearTimeout(timer);
        busy = false; submit.disabled = false;
      }

      function run() {
        if (!uid) throw new Error(t("dc.needLoginUpload", "登录状态已失效，请重新登录后再上传"));
        var base = {
          cat: cat,
          original_name: file.name,
          title_zh: titleZh,
          desc_zh: descZh,
          title_en: titleEn,
          desc_en: descEn,
          file_date: (function () { var v = (document.getElementById("da-date") || {}).value; return (v && v.trim()) ? v.trim() : todayISO(); })(), /* 默认当天，可选其他日期 */
          size: fmtSize(file.size)
        };
        return C.uploadDisclosure(file, uid)
          .then(function (res) {
            if (!res || res.error) throw (res && res.error) || new Error("upload failed");
            var path = res.data && res.data.path;
            if (!path) throw new Error("no path");
            return C.insertDisclosure(Object.assign({ storage_path: path }, base));
          })
          .then(function () {
            setMsg(msg, "ok", t("dc.uploadOk", "上传成功，已加入公开清单"));
            form.reset();
            if (nameEl) nameEl.textContent = "";
            return refreshMy();
          });
      }

      var chain;
      try {
        /* 提交前重新拉一次会话，确保 uid 有效；
           用 try/catch + Promise.reject 把 uploadDisclosure 的「同步异常」转成 rejected，
           否则同步抛错会绕过下面的 .catch，导致 busy 永远不复位、「上传中」卡死。 */
        chain = refreshAuth().then(function () { return run(); });
      } catch (e) {
        chain = Promise.reject(e);
      }

      chain
        .catch(function (err) {
          console.error("[disclosure-admin] upload failed", err);
          var code = err && (err.code || err.status);
          setMsg(msg, "err",
            t("dc.uploadFail", "上传失败，请重试") + "：" +
            (err && err.message ? err.message : err) + (code ? "（code " + code + "）" : ""));
        })
        .then(reset);
    });
  }

  function renderMy() {
    var box = document.getElementById("da-myuploads");
    if (!box) return;
    if (!myRows.length) {
      box.innerHTML = '<div class="dc-empty">' + esc(t("dc.noMyYet", "你还没有上传过文件。")) + "</div>";
      return;
    }
    var en = isEn();
    var html = "";
    myRows.forEach(function (f) {
      var lbl = en ? (f.title_en || f.title_zh) : (f.title_zh || f.title_en);
      var mine = uid && f.owner_id === uid;
      html += '<div class="dc-my-item" data-id="' + esc(String(f.id)) + '" data-path="' + esc(f.storage_path || "") + '">'
        +   '<span class="dc-my-name">' + esc(lbl || f.original_name || C.disclosureExt(f.storage_path)) + "</span>"
        +   '<span class="dc-my-cat">' + esc(t("dc.cat." + f.cat, f.cat)) + "</span>"
        +   '<span class="dc-my-date">' + esc(fmtDate(f.file_date, en)) + "</span>"
        +   (mine ? '<button type="button" class="dc-my-del" data-id="' + esc(String(f.id)) + '">' + esc(t("dc.delete", "删除")) + "</button>" : "")
        + "</div>";
    });
    box.innerHTML = html;
  }

  function refreshMy() {
    if (!uid) { myRows = []; renderMy(); return Promise.resolve(); }
    return Promise.resolve(listDC()).then(function (res) {
      var rows = (res && res.data) || [];
      myRows = rows.filter(function (f) { return f.owner_id === uid; });
      renderMy();
    }, function () {
      myRows = []; renderMy();
    });
  }

  function wireMy() {
    var box = document.getElementById("da-myuploads");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var del = e.target.closest ? e.target.closest(".dc-my-del") : null;
      if (!del) return;
      var id = del.getAttribute("data-id");
      if (!id) return;
      if (!confirm(t("dc.confirmDelete", "确定删除这份披露文件？此操作不可撤销。"))) return;
      del.disabled = true;
      Promise.resolve(C.deleteDisclosureRow(id))
        .then(function (res) {
          if (res && res.error) throw res.error;
          var rowEl = box.querySelector('.dc-my-item[data-id="' + id + '"]');
          var path = rowEl ? rowEl.getAttribute("data-path") : null;
          return C.deleteDisclosureStorage(path);
        })
        .then(function () { return refreshMy(); })
        .catch(function (err) {
          console.error("[disclosure-admin] delete failed", err);
          alert(t("dc.deleteFail", "删除失败：") + (err && err.message ? err.message : err));
          del.disabled = false;
        });
    });
  }

  /* ============ 手动排序（owner 专用；走 SECURITY DEFINER 的 reorder_disclosure RPC，绕过逐行 owner 限制） ============ */
  var sortRows = [];

  function sortCmp(a, b) {
    var sa = (a.sort_order == null ? 0 : a.sort_order), sb = (b.sort_order == null ? 0 : b.sort_order);
    if (sa !== sb) return sa - sb;
    var da = a.file_date || "", db = b.file_date || "";
    if (da !== db) return da < db ? 1 : -1;
    var ca = a.created_at || "", cb = b.created_at || "";
    return ca < cb ? 1 : -1;
  }

  function renderSort() {
    var box = document.getElementById("da-sort-list");
    if (!box) return;
    if (!sortRows.length) {
      box.innerHTML = '<div class="dc-empty">' + esc(t("dc.noMyYet", "暂无披露文件。")) + "</div>";
      return;
    }
    var en = isEn();
    var html = "";
    sortRows.forEach(function (f, i) {
      var lbl = en ? (f.title_en || f.title_zh) : (f.title_zh || f.title_en);
      html += '<div class="dc-sort-item" data-id="' + esc(String(f.id)) + '">'
        +   '<span class="dc-sort-idx">' + (i + 1) + "</span>"
        +   '<span class="dc-sort-name">' + esc(lbl || f.original_name || C.disclosureExt(f.storage_path)) + "</span>"
        +   '<span class="dc-sort-cat">' + esc(t("dc.cat." + f.cat, f.cat)) + "</span>"
        +   '<span class="dc-sort-actions">'
        +     '<button type="button" class="dc-sort-up"' + (i === 0 ? " disabled" : "") + ' data-id="' + esc(String(f.id)) + '">&#8593;</button>'
        +     '<button type="button" class="dc-sort-down"' + (i === sortRows.length - 1 ? " disabled" : "") + ' data-id="' + esc(String(f.id)) + '">&#8595;</button>'
        +   "</span>"
        + "</div>";
    });
    box.innerHTML = html;
  }

  function refreshSort() {
    return Promise.resolve(listDC()).then(function (res) {
      sortRows = (res && res.data) || [];
      sortRows.sort(sortCmp);
      renderSort();
    }, function () {
      sortRows = []; renderSort();
    });
  }

  function wireSort() {
    var box = document.getElementById("da-sort-list");
    if (!box) return;
    box.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".dc-sort-up, .dc-sort-down") : null;
      if (!btn || btn.disabled) return;
      var id = btn.getAttribute("data-id");
      var idx = -1;
      for (var i = 0; i < sortRows.length; i++) { if (String(sortRows[i].id) === id) { idx = i; break; } }
      if (idx < 0) return;
      var dir = btn.classList.contains("dc-sort-up") ? -1 : 1;
      var j = idx + dir;
      if (j < 0 || j >= sortRows.length) return;
      var tmp = sortRows[idx]; sortRows[idx] = sortRows[j]; sortRows[j] = tmp;
      var ids = sortRows.map(function (r) { return r.id; });
      btn.disabled = true;
      Promise.resolve(C.db.rpc("reorder_disclosure", { p_ids: ids })).then(function () {
        return refreshSort();
      }).catch(function (err) {
        console.error("[disclosure-admin] reorder failed", err);
        alert(t("dc.sortFail", "排序保存失败：") + (err && err.message ? err.message : err));
        refreshSort();
      });
    });
  }

  function init() {
    if (!wired) {
      wireForm();
      wireMy();
      wireSort();
      var rb = document.getElementById("da-refresh");
      if (rb) rb.addEventListener("click", function () { refreshMy(); });
      wired = true;
    }
    var di = document.getElementById("da-date");
    if (di && !di.value) di.value = todayISO();   /* 默认当天（北京时间） */
    refreshAuth().then(function () { refreshMy(); refreshSort(); });
  }

  return { init: init, refreshMy: refreshMy };
})();
