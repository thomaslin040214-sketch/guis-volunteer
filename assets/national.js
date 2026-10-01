/* ============================================================
   GUIS 义工组织 — 国庆横幅与专区（节日限定）

   为什么要做成「自动过期」：
   节日横幅最怕的就是过了节还挂着。这里按本地日期判断，出了窗口自己消失，
   不用再记得回来拆。窗口写在 WINDOW 里，明年改两个数字就行。

   想提前看效果：网址后面加 ?nd=1
   想临时关掉：  ?nd=0
   ============================================================ */
(function () {
  "use strict";

  var FOUNDING_YEAR = 1949;
  /* 显示窗口：[起, 止)，止是「不显示的第一天」。10 月 9 日起自动消失。 */
  var WINDOW = { from: "2026-09-28", until: "2026-10-09" };
  var BAR_OFF_KEY = "guis-nd-bar-off";

  function inWindow() {
    var today = new Date();
    var y = today.getFullYear();
    var m = today.getMonth() + 1;
    var d = today.getDate();
    var stamp = y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
    return stamp >= WINDOW.from && stamp < WINDOW.until;
  }

  function readStored() {
    try { return localStorage.getItem(BAR_OFF_KEY); } catch (e) { return null; }
  }
  function store(v) {
    try { localStorage.setItem(BAR_OFF_KEY, v); } catch (e) { /* 隐私模式下写不了，忽略 */ }
  }

  function visible() {
    var qs = new URLSearchParams(location.search).get("nd");
    if (qs === "1" || qs === "on") return true;      /* 强制预览 */
    if (qs === "0" || qs === "off") return false;    /* 强制关闭 */
    return inWindow();
  }

  function boot() {
    var bar = document.getElementById("nd-bar");
    var sec = document.getElementById("national");
    if (!bar && !sec) return;

    if (!visible()) {
      if (bar) bar.hidden = true;
      if (sec) sec.hidden = true;
      return;
    }

    /* 周年数按当前年份算，明年不用改文案 */
    var years = new Date().getFullYear() - FOUNDING_YEAR;
    var set = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    /* 周年数在横幅和专区里各出现一次，两处一起填 */
    ["", "-2"].forEach(function (suffix) {
      set("nd-year-start" + suffix, String(FOUNDING_YEAR));
      set("nd-year-now" + suffix, String(new Date().getFullYear()));
      set("nd-anniv" + suffix, String(years));
    });

    if (sec) {
      sec.hidden = false;
      var wrapper = sec.querySelector(".reveal");
      var E = window.GUISEnter;
      if (wrapper && E && E.register) E.register(wrapper, function (n) { n.classList.add("is-in"); }, 0.12);
      else if (wrapper) wrapper.classList.add("is-in");
    }

    /* 横幅可以关掉，关了记在 localStorage，这个节日里不再出来烦人 */
    if (bar) {
      bar.hidden = readStored() === "1";

      /* 顶栏是 fixed 的，横幅是普通文档流 —— 不撑开就会被压在导航栏底下看不见。
         导航栏在小屏会换行变高，所以这里量它的实际高度，别写死 64px。 */
      var nav = document.querySelector("nav");
      function offset() {
        if (!nav) return;
        bar.style.marginTop = nav.offsetHeight + "px";
      }
      offset();
      window.addEventListener("resize", offset);

      var close = document.getElementById("nd-close");
      if (close) {
        close.addEventListener("click", function () {
          bar.hidden = true;
          store("1");
        });
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
