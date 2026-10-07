/* ============================================================
   GUIS 义工组织 — 公开内容流（刊物 / 公告 / 过往活动）

   三个首页区块 + 三个详情页共用这一份：
     mountJournal()        首页「刊物」区块
     mountAnnouncements()  首页「公告」区块
     mountArchive()        首页「过往活动」区块
     renderArticlePage()   article.html       单篇文章
     renderAnnouncementPage() announcements.html 公告列表页
     renderActivityPage()  activity.html      单个过往活动

   区块 DOM 写在 index.html 里，这里只负责填数据；
   页面里没有对应容器时全部静默跳过，因此可以在任何页面无脑引入。
   ============================================================ */
(function () {
  "use strict";

  function t(key, fallback) {
    var lang = document.documentElement.lang === "en" ? "en" : "zh";
    var pack = (window.SITE_I18N && window.SITE_I18N[lang]) || {};
    return pack[key] != null ? pack[key] : (fallback == null ? key : fallback);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(iso) { return window.GUISTime.ymdOf(iso); }

  function fmtDT(iso) {
    if (!iso) return "";
    return fmtDate(iso) + " " + window.GUISTime.hmOf(iso);
  }

  function clean(html) {
    if (!html) return "";
    if (window.GUISRich && window.GUISRich.sanitize) return window.GUISRich.sanitize(html);
    return String(html)
      .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  /* 静态镜像（GitHub Pages）拿不到云端数据：与其显示一片空白被读成「没有内容」，
     不如直接说明并给出正式地址。 */
  function originOK() {
    var C = window.GUISCloud;
    if (!C) return false;
    var host = String(location.origin || "").replace(/\/+$/, "");
    var ep = String(C.endpoint || "").replace(/\/+$/, "");
    return !ep || host === ep;
  }

  function mirrorNotice(box, what) {
    if (!box) return;
    var C = window.GUISCloud;
    box.innerHTML = '<div class="origin-banner"><b>' + esc(t("feed.mirrorTitle", "当前站点是静态镜像，读不到云端内容。")) + "</b> " +
      esc(t("feed.mirrorBody", "请前往正式站点查看：")) + ' <a href="' + esc(C.endpoint) + '/index.html">' + esc(C.endpoint) + "/index.html</a></div>";
    box.hidden = false;
    if (what) what.hidden = true;
  }

  function reveal(node) {
    if (!node || node.classList.contains("is-in")) return;
    var E = window.GUISEnter;
    if (E && E.register) E.register(node, function (n) { n.classList.add("is-in"); }, 0.12);
    else node.classList.add("is-in");
  }

  /* ---------- 优先级灯：公告的三档 ----------
     ⚠️ 灯的形状复用活动看板那套（board.js 的三格灯座），但**文案必须换**：
     活动那边红黄绿是「报名状态」（报名中 / 等待通知 / 已通知），
     公告这边是「优先级」（紧急 / 提醒 / 常规）。
     所以一定要把 text 传进去，否则灯旁边会出现报名的文案，两套串在一起。 */
  var PRIORITY = ["red", "yellow", "green"];
  function prioLabel(p) {
    return t("an.p." + p, p === "red" ? "紧急" : p === "yellow" ? "提醒" : "常规");
  }
  /* 带文案的整盏灯（公告条目、后台预览用） */
  function prioLamp(p) {
    var text = prioLabel(p);
    var B = window.GUISBoard;
    if (B && B.lampHTML) return B.lampHTML(p, { short: true, text: text });
    return '<span class="tl tl-compact" role="img" aria-label="' + esc(text) +
      '" title="' + esc(text) + '">' +
      '<i class="tl-lamp tl-' + p + ' is-on"></i>' +
      '<span class="tl-text">' + esc(text) + "</span></span>";
  }
  /* 只有一个圆点（图例里用：旁边还要写数量和名称，再挂一段文案就重复了） */
  function prioDot(p) {
    var text = prioLabel(p);
    var B = window.GUISBoard;
    if (B && B.dotHTML) return B.dotHTML(p, { text: text });
    return '<i class="tl-dot tl-' + p + '" role="img" aria-label="' + esc(text) + '"></i>';
  }
  function prioOf(a) {
    var p = String((a && a.priority) || "green").toLowerCase();
    return PRIORITY.indexOf(p) >= 0 ? p : "green";
  }

  /* ============================================================
     首页 · 刊物
     ============================================================ */
  function mountJournal(limit) {
    var sec = document.getElementById("journal");
    var list = document.getElementById("pub-list");
    var loading = document.getElementById("pub-loading");
    var empty = document.getElementById("pub-empty");
    var box = document.getElementById("pub-origin");
    if (!sec || !list) return;

    var C = window.GUISCloud;
    if (!C || !originOK()) { if (loading) loading.hidden = true; mirrorNotice(box, list); return; }
    if (loading) loading.hidden = false;

    C.listArticles(true).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      if (loading) loading.hidden = true;
      rows = rows.slice(0, limit || 6);
      if (!rows.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      list.innerHTML = rows.map(function (a) {
        var cover = a.cover
          ? '<div class="pub-cover"><img src="' + esc(a.cover) + '" alt="" loading="lazy" /></div>'
          : '<div class="pub-cover pub-cover-blank"><span>' + esc((a.title || "").slice(0, 1)) + "</span></div>";

        var meta = [];
        if (a.author) meta.push(esc(a.author));
        meta.push(fmtDate(a.published_at || a.created_at));

        return '<a class="pub-card" href="article.html?id=' + a.id + '">' +
          cover +
          '<div class="pub-body">' +
            '<h3 class="pub-title">' + esc(a.title) + "</h3>" +
            (a.excerpt ? '<p class="pub-excerpt">' + esc(a.excerpt) + "</p>" : "") +
            '<div class="pub-meta"><span>' + meta.join(" · ") + "</span>" +
              '<span class="pub-more">' + esc(t("pub.read", "阅读全文")) + " →</span>" +
            "</div>" +
          "</div>" +
        "</a>";
      }).join("");
      list.hidden = false;
      reveal(list);
    }).catch(function () {
      if (loading) loading.hidden = true;
      if (empty) { empty.hidden = false; empty.textContent = t("feed.fail", "内容读取失败，请稍后刷新重试。"); }
    });
  }

  /* ============================================================
     首页 · 公告
     ============================================================ */
  function mountAnnouncements(limit) {
    var sec = document.getElementById("news");
    var list = document.getElementById("ann-list");
    var loading = document.getElementById("ann-loading");
    var empty = document.getElementById("ann-empty");
    var box = document.getElementById("ann-origin");
    if (!sec || !list) return;

    var C = window.GUISCloud;
    if (!C || !originOK()) { if (loading) loading.hidden = true; mirrorNotice(box, list); return; }
    if (loading) loading.hidden = false;

    C.listAnnouncements(true).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      if (loading) loading.hidden = true;
      rows = rows.slice(0, limit || 5);
      if (!rows.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      list.innerHTML = rows.map(function (a) {
        var p = prioOf(a);
        var body = clean(a.body_html);
        return '<article class="ann-item ann-' + p + '">' +
          '<div class="ann-head">' +
            prioLamp(p) +
            '<h3 class="ann-title">' + esc(a.title) + "</h3>" +
            '<span class="ann-date">' + fmtDate(a.published_at || a.created_at) + "</span>" +
          "</div>" +
          (body ? '<div class="ann-body prose">' + body + "</div>" : "") +
        "</article>";
      }).join("");
      list.hidden = false;
      reveal(list);
    }).catch(function () {
      if (loading) loading.hidden = true;
      if (empty) { empty.hidden = false; empty.textContent = t("feed.fail", "内容读取失败，请稍后刷新重试。"); }
    });
  }

  /* ============================================================
     首页 · 过往活动
     ============================================================ */
  function mountArchive(limit) {
    var sec = document.getElementById("archive");
    var list = document.getElementById("arc-list");
    var loading = document.getElementById("arc-loading");
    var empty = document.getElementById("arc-empty");
    var box = document.getElementById("arc-origin");
    if (!sec || !list) return;

    var C = window.GUISCloud;
    if (!C || !originOK()) { if (loading) loading.hidden = true; mirrorNotice(box, list); return; }
    if (loading) loading.hidden = false;

    C.listArchivedActivities().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      if (loading) loading.hidden = true;
      rows = rows.slice(0, limit || 3);
      if (!rows.length) { if (empty) empty.hidden = false; return; }
      if (empty) empty.hidden = true;

      list.innerHTML = rows.map(function (a) {
        var when = a.starts_at ? fmtDate(a.starts_at) : t("arc.tbd", "待定");
        var recap = clean(a.recap_html);
        var text = (recap || a.summary || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text.length > 96) text = text.slice(0, 96) + "…";
        var roster = [];
        try { roster = JSON.parse(a.roster_json || "[]") || []; } catch (e) { roster = []; }

        return '<a class="card project arc-card" href="activity.html?id=' + a.id + '">' +
          '<div class="card-tag">' + esc(a.category || t("arc.tag", "过往活动")) + "</div>" +
          "<h3>" + esc(a.title) + "</h3>" +
          "<p>" + (text ? esc(text) : esc(a.summary || "")) + "</p>" +
          '<div class="metrics">' +
            '<div class="metric"><div class="m-label">' + esc(t("ui.when", "时间")) + '</div><div class="m-value">' + esc(when) + "</div></div>" +
            '<div class="metric"><div class="m-label">' + esc(t("arc.scale", "规模")) + '</div><div class="m-value">' + (a.capacity ? a.capacity + " " + esc(t("su.people", "人")) : "—") + "</div></div>" +
            '<div class="metric"><div class="m-label">' + esc(t("arc.joined", "录取")) + '</div><div class="m-value">' + (roster.length ? roster.length + " " + esc(t("su.people", "人")) : "—") + "</div></div>" +
          "</div>" +
        "</a>";
      }).join("");
      list.hidden = false;
      reveal(list);
    }).catch(function () {
      if (loading) loading.hidden = true;
      if (empty) { empty.hidden = false; empty.textContent = t("feed.fail", "内容读取失败，请稍后刷新重试。"); }
    });
  }

  /* ============================================================
     文章详情页 article.html
     ============================================================ */
  function renderArticlePage() {
    var host = document.getElementById("article-page");
    if (!host) return;
    var C = window.GUISCloud;
    var id = new URLSearchParams(location.search).get("id");

    function fail(msg) {
      host.innerHTML = '<div class="empty">' + esc(msg) + "</div>";
    }
    if (!C || !originOK()) { fail(t("feed.mirrorTitle", "当前站点是静态镜像，读不到云端内容。")); return; }
    if (!id) { fail(t("art.missing", "没有指定文章。")); return; }

    host.innerHTML = '<div class="empty"><span class="loading"></span> ' + esc(t("art.loading", "正在读取文章…")) + "</div>";

    C.getArticle(id).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      var a = rows[0];
      /* 未发表的文章匿名读不到（RLS 只放行 published），这里就当不存在 */
      if (!a) { fail(t("art.missing", "这篇文章不存在，或者还没有发表。")); return; }

      document.title = a.title + " | " + t("pub.eyebrow", "刊物");
      var when = fmtDT(a.published_at || a.created_at);
      var linked = "";
      if (a.activity_id) {
        linked = '<p class="art-linked">' + esc(t("art.linked", "相关活动")) +
          '：<a href="activity.html?id=' + a.activity_id + '">' + esc(t("art.openActivity", "查看活动详情")) + "</a></p>";
      }

      host.innerHTML =
        '<article class="article">' +
          '<header class="article-head">' +
            '<p class="eyebrow">' + esc(t("pub.eyebrow", "义工刊物")) + "</p>" +
            '<h1 class="article-title">' + esc(a.title) + "</h1>" +
            '<div class="article-meta">' +
              (a.author ? "<span>" + esc(a.author) + "</span>" : "") +
              (when ? "<span>" + esc(when) + "</span>" : "") +
            "</div>" +
          "</header>" +
          (a.cover ? '<figure class="article-cover"><img src="' + esc(a.cover) + '" alt="" /></figure>' : "") +
          '<div class="article-body prose">' + clean(a.body_html) + "</div>" +
          linked +
          '<p class="article-back"><a href="index.html#journal">← ' + esc(t("art.back", "返回刊物列表")) + "</a></p>" +
        "</article>";
    }).catch(function () {
      fail(t("art.fail", "读取失败，请稍后重试。"));
    });
  }

  /* ============================================================
     公告列表页 announcements.html
     ============================================================ */
  function renderAnnouncementPage() {
    var host = document.getElementById("ann-page");
    if (!host) return;
    var C = window.GUISCloud;
    if (!C || !originOK()) {
      host.innerHTML = '<div class="empty">' + esc(t("feed.mirrorTitle", "当前站点是静态镜像，读不到云端内容。")) + "</div>";
      return;
    }

    host.innerHTML = '<div class="empty"><span class="loading"></span> ' + esc(t("an.loading", "正在读取公告…")) + "</div>";

    C.listAnnouncements(true).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      if (!rows.length) {
        host.innerHTML = '<div class="empty">' + esc(t("an.empty", "目前还没有任何公告。")) + "</div>";
        return;
      }
      var counts = { red: 0, yellow: 0, green: 0 };
      rows.forEach(function (r) { counts[prioOf(r)] += 1; });

      var head = '<div class="ann-summary">' +
        PRIORITY.map(function (p) {
          return '<span class="ann-chip ann-' + p + '">' + prioDot(p) +
            '<b>' + counts[p] + "</b> " + esc(prioLabel(p)) + "</span>";
        }).join("") +
      "</div>";

      host.innerHTML = head + '<div class="ann-list ann-list-full">' + rows.map(function (a) {
        var p = prioOf(a);
        return '<article class="ann-item ann-' + p + '">' +
          '<div class="ann-head">' +
            prioLamp(p) +
            '<h3 class="ann-title">' + esc(a.title) + "</h3>" +
            '<span class="ann-date">' + fmtDT(a.published_at || a.created_at) + "</span>" +
          "</div>" +
          '<div class="ann-body prose">' + clean(a.body_html) + "</div>" +
        "</article>";
      }).join("") + "</div>";
    }).catch(function () {
      host.innerHTML = '<div class="empty">' + esc(t("an.fail", "读取失败，请稍后重试。")) + "</div>";
    });
  }

  /* ============================================================
     活动详情页 activity.html（过往活动）
     ============================================================ */
  function renderActivityPage() {
    var host = document.getElementById("act-page");
    if (!host) return;
    var C = window.GUISCloud;
    var id = new URLSearchParams(location.search).get("id");

    function fail(msg) { host.innerHTML = '<div class="empty">' + esc(msg) + "</div>"; }
    if (!C || !originOK()) { fail(t("feed.mirrorTitle", "当前站点是静态镜像，读不到云端内容。")); return; }
    if (!id) { fail(t("arc.missing", "没有指定活动。")); return; }

    host.innerHTML = '<div class="empty"><span class="loading"></span> ' + esc(t("arc.loading", "正在读取活动…")) + "</div>";

    C.getActivity(id).then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      var a = rows[0];
      if (!a) { fail(t("arc.missing", "这个活动不存在，或者还没有归档公开。")); return; }

      document.title = a.title + " | " + t("arc.title", "过往活动");

      var metrics = [
        [t("ui.when", "时间"), a.starts_at ? (fmtDT(a.starts_at) + (a.ends_at ? " → " + fmtDT(a.ends_at) : "")) : t("arc.tbd", "待定")],
        [t("arc.place", "地点"), a.location || "—"],
        [t("arc.category", "板块"), a.category || "—"],
        [t("arc.scale", "计划招募"), a.capacity ? a.capacity + " " + t("su.people", "人") : "—"]
      ];

      var roster = [];
      try { roster = JSON.parse(a.roster_json || "[]") || []; } catch (e) { roster = []; }

      var rosterHTML = roster.length
        ? '<ol class="roster">' + roster.map(function (r) {
            var bits = [];
            if (r.grade) bits.push(esc(r.grade));
            if (r.programme) bits.push(esc(r.programme));
            if (r.slot) bits.push(esc(r.slot));
            return '<li><b>' + esc(r.name) + "</b>" + (bits.length ? "<span>" + bits.join(" · ") + "</span>" : "") + "</li>";
          }).join("") + "</ol>"
        : '<p class="hint">' + esc(t("arc.noRoster", "这个活动还没有公布录取名单。")) + "</p>";

      host.innerHTML =
        '<article class="article">' +
          '<header class="article-head">' +
            '<p class="eyebrow">' + esc(a.category || t("arc.title", "过往活动")) + "</p>" +
            '<h1 class="article-title">' + esc(a.title) + "</h1>" +
            (a.summary ? '<p class="article-lede">' + esc(a.summary) + "</p>" : "") +
          "</header>" +

          '<div class="arc-metrics">' + metrics.map(function (m) {
            return '<div class="metric"><div class="m-label">' + esc(m[0]) + '</div><div class="m-value">' + esc(m[1]) + "</div></div>";
          }).join("") + "</div>" +

          (a.recap_html
            ? '<h2 class="article-h2">' + esc(t("arc.recap", "活动总结")) + '</h2><div class="article-body prose">' + clean(a.recap_html) + "</div>"
            : "") +

          '<h2 class="article-h2">' + esc(t("arc.roster", "录取名单")) +
            (roster.length ? '<span class="roster-count">' + roster.length + " " + esc(t("su.people", "人")) + "</span>" : "") +
          "</h2>" +
          rosterHTML +
          (a.roster_at ? '<p class="hint">' + esc(t("arc.rosterAt", "名单确定于")) + " " + fmtDT(a.roster_at) + "</p>" : "") +

          '<p class="article-back"><a href="signup.html#archive">← ' + esc(t("arc.back", "返回过往活动")) + "</a></p>" +
        "</article>";
    }).catch(function () {
      fail(t("arc.fail", "读取失败，请稍后重试。"));
    });
  }

  window.GUISFeed = {
    mountJournal: mountJournal,
    mountAnnouncements: mountAnnouncements,
    mountArchive: mountArchive,
    renderArticlePage: renderArticlePage,
    renderAnnouncementPage: renderAnnouncementPage,
    renderActivityPage: renderActivityPage,
    esc: esc,
    clean: clean,
    fmtDate: fmtDate,
    fmtDT: fmtDT,
    prioLabel: prioLabel,
    prioLamp: prioLamp,
    prioDot: prioDot,
    prioOf: prioOf
  };

  /* 各页面按需自行挂载；这里给一个默认入口，省得每个页面都写一遍 */
  document.addEventListener("DOMContentLoaded", function () {
    mountJournal();
    mountAnnouncements();
    mountArchive();
    renderArticlePage();
    renderAnnouncementPage();
    renderActivityPage();
  });
})();
