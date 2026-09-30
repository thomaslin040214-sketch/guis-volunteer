/* ============================================================
   GUIS 义工社 — 活动状态看板（红绿灯）

   三态：
     绿灯  正在开放报名（开放中，且未过报名截止时间）
     黄灯  已结束报名，等待邮件通知（过了 signup_deadline，由时间自动判定）
     红灯  已邮件通知，请查收邮箱（后台在 admin.html 手动置 notified_at）

   判定优先级：红灯（人工标记）> 黄灯（时间到点）> 绿灯。
   撤销红灯后置回 null，重新回到按时间自动判定的绿 / 黄。

   首页、报名页、后台三处共用这一份，避免各写一套判定。
   ============================================================ */
(function () {
  "use strict";

  var ORDER = ["green", "yellow", "red"];

  /* 默认文案（i18n.js 里没有对应键时的兜底） */
  var FALLBACK = {
    green: "正在开放报名",
    yellow: "已结束报名，等待邮件通知",
    red: "已邮件通知，请查收邮箱"
  };
  var SHORT = {
    green: "报名中",
    yellow: "等待通知",
    red: "已通知"
  };

  function t(key, fallback) {
    var lang = document.documentElement.lang === "en" ? "en" : "zh";
    var pack = (window.SITE_I18N && window.SITE_I18N[lang]) || {};
    return pack[key] != null ? pack[key] : fallback;
  }

  /* ---------- 判定 ---------- */
  function lightOf(a) {
    if (!a) return "green";
    /* 后台已标记「已邮件通知」→ 红灯，优先级最高 */
    if (a.notified_at) return "red";
    var dl = a.signup_deadline ? new Date(a.signup_deadline).getTime() : NaN;
    /* 过了报名截止时间 → 黄灯，等待执委会发邮件通知 */
    if (!isNaN(dl) && dl < Date.now()) return "yellow";
    return "green";
  }

  /* 是否还能报名：只有绿灯可以 */
  function isOpen(a) {
    return lightOf(a) === "green";
  }

  function labelOf(light) {
    return t("lt." + light, FALLBACK[light] || light);
  }
  function shortLabelOf(light) {
    return t("lt." + light + ".short", SHORT[light] || light);
  }

  /* ---------- 渲染 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 信号灯本体：三格灯座，只有当前状态那一格点亮 */
  function lampHTML(light, opts) {
    opts = opts || {};
    var lamps = ORDER.map(function (k) {
      var on = k === light;
      return '<i class="tl-lamp tl-' + k + (on ? " is-on" : "") + '"></i>';
    }).join("");
    var text = opts.short ? shortLabelOf(light) : labelOf(light);
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

  /* 只画一个圆点（用在紧凑排版里） */
  function dotHTML(light) {
    return '<i class="tl-dot tl-' + light + '" role="img" aria-label="' +
      esc(labelOf(light)) + '"></i>';
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

  window.GUISBoard = {
    lightOf: lightOf,
    isOpen: isOpen,
    labelOf: labelOf,
    shortLabelOf: shortLabelOf,
    lampHTML: lampHTML,
    lampOf: lampOf,
    dotHTML: dotHTML,
    countLights: countLights,
    legendHTML: legendHTML,
    esc: esc
  };
})();
