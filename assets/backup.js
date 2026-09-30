/* ============================================================
   GUIS 义工社 — 全站数据备份（一键导出成 JSON 存到本机）

   为什么要有这个东西：云端再稳，自己手上有一份才是最保险的。
   导出来的 JSON 是全部表的原始内容，哪天要迁移 / 要查旧账 /
   要换托管方式，拿着这个文件就能重建，不用重新录入一遍。

   谁能用：只有执委会（owner）。allowed_admins 与 student_directory
   的读策略是 is_owner()，负责老师本来就读不全，给了也导不出完整备份。

   导出完全在浏览器里完成（Blob + <a download>），不占云端一点空间 ——
   导一万次和导一次，云端账单是一样的。
   ============================================================ */
(function (global) {
  "use strict";

  /* 要导出的表。顺序按「重建时要先建谁」排：
     活动 → 报名 → 刊物 → 公告 → 人员 → 学生名单
     （category_managers「板块默认负责人」2026-09-30 起停用，
       负责老师改成按活动指定，不再导出。） */
  var TABLES = [
    "activities",
    "registrations",
    "articles",
    "announcements",
    "allowed_admins",
    "student_directory"
  ];

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function saveText(text, filename, mime) {
    var blob = new Blob([text], { type: (mime || "application/json") + ";charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    /* 立刻 revoke 会让部分浏览器下载中断，稍微等一下 */
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  /* 逐表读取，串行 —— 并行容易撞上服务端的并发限制，也可能互相拖慢 */
  function dumpAll(C) {
    var out = {
      app: "guis-volunteer",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      counts: {},
      tables: {}
    };

    var i = 0;
    function next() {
      if (i >= TABLES.length) return Promise.resolve(out);
      var t = TABLES[i++];
      return C.db
        .from(t)
        .select("*")
        .then(function (res) {
          if (res && res.error) throw new Error(res.error.message || "读取失败");
          var rows = (res && res.data) || [];
          out.tables[t] = rows;
          out.counts[t] = rows.length;
          return next();
        })
        .catch(function (err) {
          /* 单张表读失败不拖垮整个备份：记下来，其他表照导 */
          out.tables[t] = [];
          out.counts[t] = 0;
          out.errors = out.errors || {};
          out.errors[t] = (err && err.message) || String(err);
          return next();
        });
    }
    return next();
  }

  function summarize(out) {
    var parts = TABLES.map(function (t) {
      return t + " " + (out.counts[t] || 0);
    });
    var bytes = JSON.stringify(out).length;
    return "备份完成 · " + parts.join(" · ") +
      " · 约 " + (bytes / 1024).toFixed(1) + " KB" +
      (out.errors ? "（有 " + Object.keys(out.errors).length + " 张表读取失败：" +
        Object.keys(out.errors).join("、") + "）" : "");
  }

  global.GUISBackup = {
    tables: TABLES,
    run: function (opts) {
      var C = global.GUISCloud;
      if (!C || !C.db) return Promise.reject(new Error("云服务还没初始化"));
      var name = "guis-backup-" + stamp() + ".json";
      return dumpAll(C).then(function (out) {
        out.exported_by = (opts && opts.by) || null;
        saveText(JSON.stringify(out, null, 2), name, "application/json");
        return { filename: name, data: out, summary: summarize(out) };
      });
    }
  };
})(window);
