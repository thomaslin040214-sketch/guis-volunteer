/* ============================================================================
   GUIS 义工组织 —— 活动日历
   ----------------------------------------------------------------------------
   一个共用模块，两处使用：
     1) signup.html 的「活动日历」（公开，匿名可读到什么就显示什么）
     2) admin.html 的「活动日历」页签（执委会，可以改活动的开始 / 结束 / 报名截止）

   规则：
     - 一周以**星期一**开头（不是周日）
     - 今天高亮
     - 以**月份**为单位切换：上一月 / 下一月 / 顶部 12 个月缩略条直接跳
     - 点任意一天 → 下方列出当天的活动：开始时间、结束时间、报名截止时间、状态灯
     - 跨天活动会在它覆盖的每一天都出现

   用法：
     var cal = GUISCalendar.create(document.getElementById("cal-root"), {
       renderDay: function (list, ymd) { return "<html>"; }   // 可选，自定义当天面板
     });
     cal.setData(rows);
   ============================================================================ */
(function () {
  "use strict";

  var WEEK_ZH = ["一", "二", "三", "四", "五", "六", "日"];
  var WEEK_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MON_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  var MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function lang() {
    return (document.documentElement && document.documentElement.lang === "en") ? "en" : "zh";
  }
  function t(key, fallback) {
    var pack = (window.SITE_I18N && window.SITE_I18N[lang()]) || {};
    return pack[key] != null ? pack[key] : (fallback != null ? fallback : key);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  /* 统一用本地时间的 yyyy-mm-dd 做键，别用 toISOString（那是 UTC，会差一天） */
  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  /* 星期一 = 0 …… 星期日 = 6 */
  function mondayFirst(d) {
    var w = d.getDay();
    return w === 0 ? 6 : w - 1;
  }
  function lightOf(a) {
    if (window.GUISBoard && window.GUISBoard.lightOf) return window.GUISBoard.lightOf(a);
    // 没引 board.js 时的兜底：只看报名截止时间和 status
    if (a.notified_at) return "red";
    if (a.signup_deadline && new Date(a.signup_deadline).getTime() < Date.now()) return "yellow";
    return a.status === "open" ? "green" : "yellow";
  }
  function dot(light, text) {
    if (window.GUISBoard && window.GUISBoard.dotHTML) {
      return window.GUISBoard.dotHTML(light, { text: text || "" });
    }
    return '<i class="tl-dot tl-' + light + '" role="img" aria-label="' + esc(text || light) + '"></i>';
  }
  function lamp(a) {
    if (window.GUISBoard && window.GUISBoard.lampOf) return window.GUISBoard.lampOf(a);
    return dot(lightOf(a));
  }

  /* 时间显示：同一天内只写一次日期 */
  function fmtDT(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    if (lang() === "en") {
      return MON_EN[d.getMonth()] + " " + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtRange(a) {
    var s = a.starts_at ? fmtDT(a.starts_at) : t("cal.tbd", "待定");
    if (!a.ends_at) return s;
    var d1 = new Date(a.starts_at), d2 = new Date(a.ends_at);
    var sameDay = a.starts_at && d1.getFullYear() === d2.getFullYear() &&
                  d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
    var e = sameDay ? pad(d2.getHours()) + ":" + pad(d2.getMinutes()) : fmtDT(a.ends_at);
    return s + " → " + e;
  }
  function fmtHM(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function phaseText(phase) {
    if (phase === "open") return t("cal.phaseOpen", "开始报名");
    if (phase === "close") return t("cal.phaseClose", "报名截止");
    return "";
  }

  /* 当日进程：每 2 小时一档的时间轴
     只排「活动当天真的在进行」的那些（phase = run），报名日不占时间格。
     时间范围由当天活动的起止推出，并向两端各扩到偶数整点，最少 4 档。 */
  var SLOT_HOURS = 2;
  function dayTimelineHTML(list, ymd) {
    var runs = (list || []).filter(function (it) {
      return it.phase === "run" && it.a.starts_at;
    });
    if (!runs.length) return "";

    var minH = 24, maxH = 0, any = false;
    runs.forEach(function (it) {
      var s = new Date(it.a.starts_at);
      var e = it.a.ends_at ? new Date(it.a.ends_at) : s;
      if (isNaN(s.getTime())) return;
      if (isNaN(e.getTime())) e = s;
      any = true;
      minH = Math.min(minH, s.getHours());
      /* 结束时间落在整点上时不额外占下一档（10:00-11:00 归到 10 点档） */
      var endH = e.getHours() + (e.getMinutes() > 0 ? 1 : 0);
      maxH = Math.max(maxH, endH);
    });
    if (!any) return "";

    /* 向偶数整点对齐：开始向下取偶，结束向上取偶 */
    var from = Math.max(0, Math.floor(minH / SLOT_HOURS) * SLOT_HOURS);
    var to = Math.min(24, Math.ceil(maxH / SLOT_HOURS) * SLOT_HOURS);
    if (to - from < SLOT_HOURS * 4) {          /* 至少给 4 档，太短不好看 */
      var mid = Math.round((from + to) / 2 / SLOT_HOURS) * SLOT_HOURS;
      from = Math.max(0, mid - SLOT_HOURS * 2);
      to = Math.min(24, from + SLOT_HOURS * 4);
      if (to - from < SLOT_HOURS * 4) from = Math.max(0, to - SLOT_HOURS * 4);
    }

    var html = '<div class="cal-timeline" role="list" aria-label="' +
      esc(t("cal.timeline", "当日时间轴")) + '">';
    for (var h = from; h < to; h += SLOT_HOURS) {
      var s0 = h * 60, e0 = s0 + SLOT_HOURS * 60;      /* 档位的分钟区间 */
      var chips = runs.filter(function (it) {
        var s = new Date(it.a.starts_at);
        var e = it.a.ends_at ? new Date(it.a.ends_at) : s;
        if (isNaN(e.getTime())) e = s;
        var a0 = s.getHours() * 60 + s.getMinutes();
        var a1 = e.getHours() * 60 + e.getMinutes();
        if (a1 <= a0) a1 = a0 + 30;                    /* 没填结束时间就画一小段 */
        return a0 < e0 && a1 > s0;                     /* 与该档有交集 */
      }).map(function (it) {
        var s = new Date(it.a.starts_at);
        var e = it.a.ends_at ? new Date(it.a.ends_at) : null;
        return '<div class="cal-chip" role="listitem">' +
          '<span class="cal-chip-time">' + esc(fmtHM(it.a.starts_at)) +
            (e ? "–" + esc(fmtHM(it.a.ends_at)) : "") + "</span>" +
          '<span class="cal-chip-title">' + esc(it.a.title || "") + "</span>" +
        "</div>";
      }).join("");

      html += '<div class="cal-slot' + (chips ? "" : " is-empty") + '">' +
        '<span class="cal-slot-time">' + pad(h) + ":00</span>" +
        '<div class="cal-slot-body">' + chips +
          (chips ? "" : '<span class="cal-slot-none">·</span>') +
        "</div>" +
      "</div>";
    }
    return html + "</div>";
  }

  function create(root, opts) {
    opts = opts || {};
    if (!root) throw new Error("GUISCalendar.create 需要一个容器元素");

    var now = new Date();
    var state = { y: now.getFullYear(), m: now.getMonth(), sel: dayKey(now), data: [] };
    var byDay = {};

    root.classList.add("cal");
    root.innerHTML =
      '<div class="cal-bar">' +
        '<div class="cal-nav">' +
          '<button type="button" class="cal-btn" data-act="prev" aria-label="' + esc(t("cal.prev", "上一月")) + '">‹</button>' +
          '<span class="cal-title" id="cal-title"></span>' +
          '<button type="button" class="cal-btn" data-act="next" aria-label="' + esc(t("cal.next", "下一月")) + '">›</button>' +
        '</div>' +
        '<div class="cal-nav-right">' +
          '<button type="button" class="cal-btn cal-today" data-act="today">' + esc(t("cal.today", "今天")) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cal-months" id="cal-months"></div>' +
      '<div class="cal-week" id="cal-week"></div>' +
      '<div class="cal-grid" id="cal-grid"></div>' +
      '<div class="cal-day" id="cal-day"></div>';

    var elTitle = root.querySelector("#cal-title");
    var elMonths = root.querySelector("#cal-months");
    var elWeek = root.querySelector("#cal-week");
    var elGrid = root.querySelector("#cal-grid");
    var elDay = root.querySelector("#cal-day");

    /* 一天里的一条记录：a = 活动本体，phase 说明这天为什么出现在日历上
         run   = 活动本身在这天进行（跨天活动会在覆盖的每一天出现）
         open  = 这一天开始报名
         close = 这一天报名截止
       同一天同时是「活动日」和「截止日」时，run 优先。 */
    function addDay(k, a, phase) {
      var arr = (byDay[k] = byDay[k] || []);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].a === a) { if (phase === "run") arr[i].phase = "run"; return; }
      }
      arr.push({ a: a, phase: phase });
    }

    function index() {
      byDay = {};
      (state.data || []).forEach(function (a) {
        /* ① 活动进行的每一天 */
        if (a.starts_at) {
          var ds = new Date(a.starts_at);
          if (!isNaN(ds.getTime())) {
            var de = a.ends_at ? new Date(a.ends_at) : null;
            var cur = new Date(ds.getFullYear(), ds.getMonth(), ds.getDate());
            var last = de && !isNaN(de.getTime())
              ? new Date(de.getFullYear(), de.getMonth(), de.getDate())
              : cur;
            var guard = 0;
            while (cur <= last && guard++ < 400) {
              addDay(dayKey(cur), a, "run");
              cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
            }
          }
        }
        /* ② 报名开始日 / 报名截止日也标进日历 */
        if (a.signup_opens_at) {
          var os = new Date(a.signup_opens_at);
          if (!isNaN(os.getTime())) {
            addDay(dayKey(os), a, "open");
          }
        }
        if (a.signup_deadline) {
          var dl = new Date(a.signup_deadline);
          if (!isNaN(dl.getTime())) {
            addDay(dayKey(dl), a, "close");
          }
        }
      });
    }

    function renderMonths() {
      var months = lang() === "en" ? MON_EN : MON_ZH;
      elMonths.innerHTML = months.map(function (name, i) {
        return '<button type="button" class="cal-month' + (i === state.m ? " is-on" : "") + '" data-month="' + i + '">' +
          esc(name) + "</button>";
      }).join("");
    }

    function renderWeek() {
      var w = lang() === "en" ? WEEK_EN : WEEK_ZH;
      elWeek.innerHTML = w.map(function (name, i) {
        return '<span class="cal-wd' + (i >= 5 ? " is-weekend" : "") + '">' + esc(name) + "</span>";
      }).join("");
    }

    function renderGrid() {
      var first = new Date(state.y, state.m, 1);
      var lead = mondayFirst(first);               // 前面要补几格
      var days = new Date(state.y, state.m + 1, 0).getDate();
      var today = dayKey(new Date());
      var html = "";

      /* 上个月尾巴（灰掉，不可点） */
      var prevDays = new Date(state.y, state.m, 0).getDate();
      for (var i = lead - 1; i >= 0; i--) {
        html += '<div class="cal-cell is-out"><span class="cal-num">' + (prevDays - i) + "</span></div>";
      }
      /* 本月 */
      for (var d = 1; d <= days; d++) {
        var key = state.y + "-" + pad(state.m + 1) + "-" + pad(d);
        var list = byDay[key] || [];
        var cls = ["cal-cell"];
        if (key === today) cls.push("is-today");
        if (key === state.sel) cls.push("is-sel");
        if (list.length) cls.push("has-act");
        html += '<button type="button" class="' + cls.join(" ") + '" data-day="' + key + '"' +
          ' aria-label="' + esc(key + (list.length ? " · " + list.length + " " + t("cal.count", "个活动") : "")) + '">' +
          '<span class="cal-num">' + d + "</span>" +
          (list.length
            ? '<span class="cal-dots">' + list.slice(0, 3).map(function (it) {
                return dot(lightOf(it.a), (it.a.title || "") + phaseText(it.phase));
              }).join("") + "</span>"
            : "") +
        "</button>";
      }
      /* 补到整周，让最后一排是完整的 7 格 */
      var tail = (7 - ((lead + days) % 7)) % 7;
      for (var k = 1; k <= tail; k++) {
        html += '<div class="cal-cell is-out"><span class="cal-num">' + k + "</span></div>";
      }
      elGrid.innerHTML = html;
    }

    function renderDay() {
      var list = byDay[state.sel] || [];
      if (opts.renderDay) {
        var html = opts.renderDay(list, state.sel);
        elDay.innerHTML = html || "";
        elDay.hidden = false;
        return;
      }
      elDay.innerHTML = defaultDayHTML(list, state.sel);
      elDay.hidden = false;
    }

    function defaultDayHTML(list, key) {
      var head = '<div class="cal-day-head">' + esc(key) + "</div>";
      if (!list.length) {
        return head + '<div class="empty">' + esc(t("cal.none", "这一天没有安排活动。")) + "</div>";
      }
      return head +
        dayTimelineHTML(list, key) +
        '<div class="cal-day-list">' + list.map(function (it) {
          var a = it.a;
          var open = !window.GUISBoard || window.GUISBoard.isOpen(a);
          return '<div class="cal-item">' +
            '<div class="cal-item-top">' +
              '<span class="cal-item-title">' + esc(a.title || "") + "</span>" +
              (it.phase !== "run" ? '<span class="cal-phase cal-phase-' + it.phase + '">' +
                esc(phaseText(it.phase)) + "</span>" : "") +
              lamp(a) +
            "</div>" +
            '<div class="cal-item-meta">' +
              "<span>" + esc(t("cal.start", "开始")) + "：" + esc(fmtDT(a.starts_at) || t("cal.tbd", "待定")) + "</span>" +
              "<span>" + esc(t("cal.end", "结束")) + "：" + esc(a.ends_at ? fmtHM(a.ends_at) : "—") + "</span>" +
              "<span>" + esc(t("cal.opens", "报名开始")) + "：" + esc(a.signup_opens_at ? fmtDT(a.signup_opens_at) : t("cal.opensNow", "建好即开放")) + "</span>" +
              "<span>" + esc(t("cal.deadline", "报名截止")) + "：" + esc(a.signup_deadline ? fmtDT(a.signup_deadline) : "—") + "</span>" +
              (a.location ? "<span>" + esc(t("cal.place", "地点")) + "：" + esc(a.location) + "</span>" : "") +
            "</div>" +
            /* 报名页认的是 ?activity=<id>（见 signup.html 内联脚本），不是 ?a= */
            (open ? '<a class="btn btn-primary btn-sm" href="' + (opts.signupHref || "signup.html?activity=") +
                     encodeURIComponent(a.id) + '">' + esc(t("cal.goSignup", "去报名")) + "</a>" : "") +
          "</div>";
        }).join("") + "</div>";
    }

    function render() {
      elTitle.textContent = state.y + " " + t("cal.year", "年") + " " + (lang() === "en" ? MON_EN[state.m] : MON_ZH[state.m]);
      renderMonths();
      renderWeek();
      renderGrid();
      renderDay();
    }

    root.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-act],[data-month],[data-day]") : null;
      if (!btn) return;
      if (btn.dataset.day) {
        state.sel = btn.dataset.day;
        renderGrid();
        renderDay();
        return;
      }
      if (btn.dataset.month != null) {
        state.m = Number(btn.dataset.month);
        renderGrid();
        renderMonths();
        return;
      }
      var act = btn.dataset.act;
      if (act === "prev") { state.m -= 1; if (state.m < 0) { state.m = 11; state.y -= 1; } render(); }
      if (act === "next") { state.m += 1; if (state.m > 11) { state.m = 0; state.y += 1; } render(); }
      if (act === "today") {
        var n = new Date();
        state.y = n.getFullYear(); state.m = n.getMonth(); state.sel = dayKey(n);
        render();
      }
    });

    render();

    var api = {
      setData: function (list) {
        state.data = list || [];
        index();
        renderGrid();
        renderDay();
        return api;
      },
      goTo: function (y, m) { state.y = y; state.m = m; render(); return api; },
      goToday: function () {
        var n = new Date();
        state.y = n.getFullYear(); state.m = n.getMonth(); state.sel = dayKey(n);
        render();
        return api;
      },
      /* 语言切换后重画（星期名、月份名、时间格式都会变） */
      refresh: function () { render(); return api; },
      selected: function () { return state.sel; },
      dayList: function (key) { return byDay[key || state.sel] || []; },
      /* 给后台用：把某天作为一批活动的起始日 */
      fmtDT: fmtDT,
      fmtHM: fmtHM
    };
    return api;
  }

  window.GUISCalendar = {
    create: create, dayKey: dayKey, fmtDT: fmtDT, fmtHM: fmtHM, fmtRange: fmtRange,
    lamp: lamp, dot: dot, esc: esc, t: t,
    dayTimelineHTML: dayTimelineHTML, phaseText: phaseText
  };
})();
