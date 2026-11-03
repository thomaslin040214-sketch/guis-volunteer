/* ============================================================
   GUIS 义工组织 — 文件披露「后台」自助上传（assets/disclosure-admin.js）

   仅在 admin.html 的「文件披露」页签里使用，组织成员（owner）可见。
   - 上传 / 删除走云端存储 + disclosure_files 表，owner 角色由数据库 is_owner() 校验。
   - 发布日期默认当天（北京时间 UTC+8），不再让使用者手动选 —— 用户明确要求的简化。
   ============================================================ */
window.GUISDisclosureAdmin = (function () {

  var C = window.GUISCloud;

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

      var base = {
        cat: cat,
        original_name: file.name,
        title_zh: titleZh,
        desc_zh: descZh,
        title_en: titleEn,
        desc_en: descEn,
        file_date: todayISO(),          /* 默认当天，不再让选 */
        size: fmtSize(file.size)
      };

      C.uploadDisclosure(file, uid)
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
        })
        .catch(function (err) {
          console.error("[disclosure-admin] upload failed", err);
          setMsg(msg, "err", t("dc.uploadFail", "上传失败，请重试") + "：" + (err && err.message ? err.message : err));
        })
        .then(function () {
          busy = false; submit.disabled = false;
        });
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
    return Promise.resolve(C.listDisclosure()).then(function (res) {
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

  function init() {
    if (!wired) {
      wireForm();
      wireMy();
      var rb = document.getElementById("da-refresh");
      if (rb) rb.addEventListener("click", function () { refreshMy(); });
      wired = true;
    }
    refreshAuth().then(refreshMy);
  }

  return { init: init, refreshMy: refreshMy };
})();
