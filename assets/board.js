/* ============================================================
   GUIS 义工组织 — 活动状态看板（红绿灯）

   三态：
     绿灯  正在开放报名（名额还有）
     黄灯  名额已满 / 还没到报名开始时间 / 已满只剩备选位（总之不能按正常方式报）
     红灯  已邮件通知，请查收邮箱（后台在 admin.html 手动置 notified_at）

   ⚠️ 2026-10-01 起**不再有报名截止时间**。报名什么时候停，只看名额：
     · 已占名额 < capacity          → 正常报名（pending）
     · 已满，但 waitlist_capacity 还有位子 → 报进去是「备选名单」（waiting）
     · 两个都满了                    → 不能再报，报名页显示「报名人数已满」
   名额由服务端 register_signup() 一次性算准，前端这份只用来显示。

   判定优先级：红灯（人工标记）> 黄灯 > 绿灯。

   首页、报名页、后台三处共用这一份，避免各写一套判定。
   ============================================================ */
(function () {
  "use strict";

  var ORDER = ["green", "yellow", "red"];

  /* 默认文案（i18n.js 里没有对应键时的兜底） */
  var FALLBACK = {
    green: "正在开放报名",
    yellow: "名额已满",
    red: "已邮件通知，请查收邮箱"
  };
  var SHORT = {
    green: "报名中",
    yellow: "名额已满",
    red: "已通知"
  };
  /* 黄灯有好几种原因，文案要分开说，不然「还没开始」会被读成「已经满了」 */
  var REASON = {
    green: "正在开放报名",
    full: "报名人数已满",
    wait: "名额已满，可以继续报进备选名单",
    notyet: "还没到报名开始时间",
    notified: "已邮件通知，请查收邮箱"
  };

  function t(key, fallback) {
    var lang = document.documentElement.lang === "en" ? "en" : "zh";
    var pack = (window.SITE_I18N && window.SITE_I18N[lang]) || {};
    return pack[key] != null ? pack[key] : fallback;
  }

  /* ---------- 名额（_taken / _waiting 由 withCounts() 填进来） ---------- */
  function taken(a) { return (a && a._taken) || 0; }
  function waiting(a) { return (a && a._waiting) || 0; }

  /* 名额满了没。没填 capacity（null / 0）当不限人数 */
  function isFull(a) {
    if (!a || !a.capacity || a.capacity <= 0) return false;
    return taken(a) >= a.capacity;
  }
  /* 满了，但备选名单还有位子 —— 这时候还能报，只是进去是 waiting */
  function waitlistOpen(a) {
    if (!isFull(a)) return false;
    var w = (a && a.waitlist_capacity) || 0;
    return w > 0 && waiting(a) < w;
  }
  /* 还没到报名开始时间 */
  function notStarted(a) {
    if (!a || !a.signup_opens_at) return false;
    var ms = new Date(a.signup_opens_at).getTime();
    return !isNaN(ms) && ms > Date.now();
  }

  /* 完全不能报：已通知 / 状态不是 open / 没开始 / 名额与备选都满了 */
  function isClosed(a) {
    if (!a) return true;
    if (a.notified_at) return true;
    if (a.status && a.status !== "open") return true;
    if (notStarted(a)) return true;
    if (isFull(a) && !waitlistOpen(a)) return true;
    return false;
  }

  /* 还能提交（正常报名，或者进备选名单） */
  function isOpen(a) { return !isClosed(a); }

  /* 这一场现在到底什么情况 —— 用来给灯配文案，别让「还没开始」说成「已满」 */
  function reasonOf(a) {
    if (!a) return "green";
    if (a.notified_at) return "notified";
    if (notStarted(a)) return "notyet";
    if (isFull(a)) return waitlistOpen(a) ? "wait" : "full";
    return "green";
  }
  function reasonText(a) {
    return t("lt." + reasonOf(a), REASON[reasonOf(a)] || REASON.green);
  }

  /* ---------- 判定 ---------- */
  function lightOf(a) {
    if (!a) return "green";
    /* 后台已标记「已邮件通知」→ 红灯，优先级最高 */
    if (a.notified_at) return "red";
    if (isClosed(a)) return "yellow";
    /* 满了但备选还有位：还能报，用黄灯提醒 */
    if (waitlistOpen(a)) return "yellow";
    return "green";
  }

  function labelOf(light) {
    return t("lt." + light, FALLBACK[light] || light);
  }
  function shortLabelOf(light) {
    return t("lt." + light + ".short", SHORT[light] || light);
  }

  /* 把每个活动的已占名额 / 备选人数并进活动对象（`_taken` / `_waiting`）。
     匿名也能读（activity_counts 是 SECURITY DEFINER）。读失败就当 0，
     绝不因为拿不到数字而把活动判成「已满」。 */
  function withCounts(C, list) {
    var arr = list || [];
    if (!C || typeof C.counts !== "function") return Promise.resolve(arr);
    return C.counts().then(function (res) {
      var rows = (res && res.data) || [];
      var map = {};
      rows.forEach(function (r) { map[String(r.activity_id)] = r; });
      arr.forEach(function (a) {
        var m = map[String(a.id)];
        a._taken = m ? Number(m.taken || 0) : 0;
        a._waiting = m ? Number(m.waiting || 0) : 0;
      });
      return arr;
    }, function () {
      arr.forEach(function (a) {
        if (a._taken == null) a._taken = 0;
        if (a._waiting == null) a._waiting = 0;
      });
      return arr;
    });
  }

  /* ---------- 渲染 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 信号灯本体：三格灯座，只有当前状态那一格点亮。
     ⚠️ opts.text：调用方可以自己指定灯旁边的文案。
     公告栏就是这么用的 —— 它的红黄绿是「优先级」，要说「紧急/提醒/常规」，
     不能沿用本文件里活动状态的「报名中/等待通知/已通知」。两套灯长得一样、文案不同。 */
  function lampHTML(light, opts) {
    opts = opts || {};
    var lamps = ORDER.map(function (k) {
      var on = k === light;
      return '<i class="tl-lamp tl-' + k + (on ? " is-on" : "") + '"></i>';
    }).join("");
    var text = opts.text != null ? opts.text
      : (opts.short ? shortLabelOf(light) : labelOf(light));
    return (
      '<span class="tl' + (opts.big ? " tl-big" : "") + '" role="img" ' +
        'aria-label="' + esc(text) + '" title="' + esc(text) + '">' +
        lamps +
        '<span class="tl-text">' + esc(text) + "</span>" +
      "</span>"
    );
  }

  function lampOf(a, opts) {
    return lampHTML(lightOf(a), opts);
  }

  /* 只画一个圆点（用在紧凑排版里）。同样支持 opts.text 覆盖文案。 */
  function dotHTML(light, opts) {
    opts = opts || {};
    var text = opts.text != null ? opts.text : labelOf(light);
    return '<i class="tl-dot tl-' + light + '" role="img" aria-label="' +
      esc(text) + '"></i>';
  }

  /* ---------- 统计 ---------- */
  function countLights(list) {
    var out = { green: 0, yellow: 0, red: 0 };
    (list || []).forEach(function (a) { out[lightOf(a)] += 1; });
    return out;
  }

  /* 看板图例：三行「灯 + 数量 + 说明」 */
  function legendHTML(counts) {
    counts = counts || { green: 0, yellow: 0, red: 0 };
    return '<div class="tl-legend">' +
      ORDER.map(function (k) {
        return '<div class="tl-legend-row">' +
          '<span class="tl tl-compact">' +
            '<i class="tl-lamp tl-' + k + ' is-on"></i>' +
          "</span>" +
          '<span class="tl-legend-num">' + counts[k] + "</span>" +
          '<span class="tl-legend-label">' + esc(labelOf(k)) + "</span>" +
        "</div>";
      }).join("") +
    "</div>";
  }

  /* ============================================================
     首页「活动看板」板块 —— 全站唯一的挂载实现
     index.html 的内联脚本只调 mountHomeBoard()，渲染细节都在这。

     为什么挂载逻辑要做「旧结构自愈」：
     正式站的裸根路径 `/` 被边缘节点长期缓存住（带 ?v= 或 /index.html 才是新的），
     所以旧书签可能加载到「看板上线前」的 index.html —— 那种文档里只有
     #su-list / #su-empty，没有 #su-board。
     好在旧文档引用的 assets/*.js?v=... 解析到的都是最新文件，
     于是这里就地把它升级成看板，旧缓存也能自己长好，不用等缓存过期。
     ============================================================ */

  /* 看板上线前的旧结构 → 新结构 */
  var HOME_BOARD_HTML =
    '<div id="su-board" class="board reveal" hidden>' +
      '<div class="board-num-wrap">' +
        '<div class="board-figure" id="su-figure">' +
          '<span class="board-num" id="su-count">0</span>' +
          '<span class="board-unit" id="su-unit" data-i18n="su.unit">个</span>' +
        '</div>' +
        '<div class="board-num-label" id="su-num-label" data-i18n="su.boardNumLabel">正在开放报名</div>' +
        '<div class="board-none" id="su-none" hidden data-i18n="su.boardNone">目前暂时没有开放报名的活动</div>' +
      '</div>' +
      '<div>' +
        '<div id="su-legend" class="tl-legend"></div>' +
        '<div class="board-actions">' +
          '<a href="signup.html" class="btn btn-primary" data-i18n="su.all">打开报名页</a>' +
          '<a href="#contact" class="btn btn-secondary" data-i18n="su.ask">想参加别的板块？告诉我们</a>' +
        '</div>' +
      '</div>' +
    '</div>';

  function upgradeLegacySection() {
    var legacy = document.getElementById("su-list");
    if (!legacy || document.getElementById("su-board")) return false;   /* 不是旧结构 */
    var sec = document.getElementById("signup");
    var parent = legacy.parentNode;
    if (!parent) return false;

    /* 旧结构里「空状态」和末尾单独的「打开报名页」按钮都归新看板管，删掉免得重复 */
    var emptyBox = document.getElementById("su-empty");
    if (emptyBox && emptyBox.parentNode) emptyBox.parentNode.removeChild(emptyBox);
    if (sec) {
      Array.prototype.forEach.call(sec.querySelectorAll('a[href="signup.html"]'), function (a) {
        var box = a.parentNode;
        if (!box || !box.parentNode || (a.closest && a.closest("#su-board"))) return;
        if (box.tagName === "DIV" && box.children.length === 1) box.parentNode.removeChild(box);
        else box.removeChild(a);
      });
    }

    var holder = document.createElement("div");
    holder.innerHTML = HOME_BOARD_HTML;
    var board = holder.firstChild;
    parent.insertBefore(board, legacy);
    parent.removeChild(legacy);

    /* 标题与导语也换成看板文案；同时改掉 data-i18n，切语言时才不会再被旧键覆盖 */
    if (sec) {
      var h2 = sec.querySelector('h2[data-i18n="su.title"]');
      if (h2) { h2.setAttribute("data-i18n", "su.boardTitle"); h2.textContent = t("su.boardTitle", "活动看板"); }
      var lede = sec.querySelector('p[data-i18n="su.lede"]');
      if (lede) { lede.setAttribute("data-i18n", "su.boardLede"); lede.textContent = t("su.boardLede", ""); }
    }
    return true;
  }

  /* ---------- 画看板 ---------- */
  var lastList = [];
  var countBound = false;

  /* 看板是「动态插进来」的时候（旧缓存自愈路径），main.js 的 initReveal() 早就跑完了，
     .reveal 的进场任务不会为它注册 —— 它会一直停在 opacity:0，等于插进去也看不见。
     这里补一次注册，保证它一定会显出来。 */
  function ensureVisible(node) {
    if (!node || !node.classList.contains("reveal") || node.classList.contains("is-in")) return;
    var E = window.GUISEnter;
    if (E && E.register) E.register(node, function (n) { n.classList.add("is-in"); }, 0.12);
    else node.classList.add("is-in");
  }

  function paintHomeBoard(list) {
    if (list) lastList = list;
    var board = document.getElementById("su-board");
    if (!board) return;
    var loading = document.getElementById("su-loading");
    var legend = document.getElementById("su-legend");
    var countEl = document.getElementById("su-count");
    var figure = document.getElementById("su-figure");
    var unitEl = document.getElementById("su-unit");
    var numLabel = document.getElementById("su-num-label");
    var noneEl = document.getElementById("su-none");

    if (loading) loading.hidden = true;

    var counts = countLights(lastList);
    var n = counts.green;
    if (legend) legend.innerHTML = legendHTML(counts);
    board.hidden = false;
    ensureVisible(board);

    /* 量词「个」紧跟数字；英文没有量词，词典给空串时整个隐藏 */
    if (unitEl) { unitEl.textContent = t("su.unit", "个") || ""; unitEl.hidden = !unitEl.textContent; }

    /* 一个都没有时不显示数字，改给一句红字说明 */
    if (figure) figure.hidden = (n === 0);
    if (numLabel) numLabel.hidden = (n === 0);
    if (noneEl) noneEl.hidden = (n !== 0);

    if (n === 0 || !countEl) return;

    /* 数字滚动动画：数据比 DOMContentLoaded 晚到，所以要在这里补注册一次进场触发 */
    var E = window.GUISEnter;
    if (!countBound) {
      countBound = true;
      if (E && E.register) E.register(countEl, function (node) { E.countTo(node, n); }, 0.2);
      else countEl.textContent = String(n);
    } else {
      countEl.textContent = String(n);
    }
  }

  /* 读数据 + 画看板。首页唯一的入口。 */
  function mountHomeBoard() {
    var C = window.GUISCloud;
    if (!C) return;
    upgradeLegacySection();

    var sec = document.getElementById("signup");
    var board = document.getElementById("su-board");
    var loading = document.getElementById("su-loading");
    var box = document.getElementById("su-origin");
    if (!sec || !board) return;      /* 不是首页，什么都不做 */

    /* 站点域名与云端点不一致时（例如 GitHub Pages 镜像），云服务会拒绝请求。
       与其显示一个会被误读成「没有活动」的空看板，不如直接给正式报名地址。 */
    var host = location.origin.replace(/\/+$/, "");
    var ep = String(C.endpoint || "").replace(/\/+$/, "");
    if (ep && host !== ep) {
      if (box) {
        box.innerHTML =
          '<div class="origin-banner"><b>当前站点是静态镜像，读不到报名数据。</b>' +
          "请前往正式报名地址查看并报名：" +
          '<a href="' + C.endpoint + '/signup.html"><b>' + C.endpoint + "/signup.html</b></a></div>";
        box.hidden = false;
      }
      if (loading) loading.hidden = true;
      board.hidden = true;
      return;
    }

    if (loading) loading.hidden = false;

    /* 读取走排队组件：网络慢或拥塞时自动排队重试，平时瞬间返回、完全看不到 */
    var runner = window.GUISQueue
      ? window.GUISQueue.run(function () { return C.listOpenActivities(); }, {
          title: t("su.loading", "正在读取活动列表…"),
          busyTitle: t("q.busy", "正在为你接通…"),
          sub: t("q.sub", "访问的人有点多，我们正在排队处理，稍等一下就好。"),
          doneText: t("q.done", "请稍等，即将进入站点"),
          cancelText: t("q.cancel", "稍后再来"),
          retryText: function (attempt, max, seconds) {
            return t("q.retry", "第 {a} / {m} 次尝试 · {s} 秒后自动重试")
              .replace("{a}", attempt).replace("{m}", max).replace("{s}", seconds);
          },
          maxAttempts: 3
        })
      : C.listOpenActivities();

    runner.then(function (res) {
      /* 名额数先并进活动对象，再看板上显示几个「可报名」——否则算不准 */
      return withCounts(C, C.unwrap(res, "读取失败") || []);
    }).then(function (list) {
      paintHomeBoard(list);
    }).catch(function () {
      paintHomeBoard([]);
    });
  }

  /* 切语言后重画（文案跟着换） */
  function refreshHomeBoard() {
    paintHomeBoard(null);
  }

  window.GUISBoard = {
    lightOf: lightOf,
    isOpen: isOpen,
    isClosed: isClosed,
    isFull: isFull,
    waitlistOpen: waitlistOpen,
    notStarted: notStarted,
    reasonOf: reasonOf,
    reasonText: reasonText,
    withCounts: withCounts,
    labelOf: labelOf,
    shortLabelOf: shortLabelOf,
    lampHTML: lampHTML,
    lampOf: lampOf,
    dotHTML: dotHTML,
    countLights: countLights,
    legendHTML: legendHTML,
    esc: esc,
    mountHomeBoard: mountHomeBoard,
    paintHomeBoard: paintHomeBoard,
    refreshHomeBoard: refreshHomeBoard
  };
})();
