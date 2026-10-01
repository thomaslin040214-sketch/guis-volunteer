/* ============================================================
   GUIS 义工组织 —— 页头标签页里的打字机
   一段字打出来 → 停一下 → 退格删掉 → 再来一遍，无限循环。

   两件事是刻意这么做的：
     1) 只有滚到这一块时才开始跑（IntersectionObserver），离开视口就停 ——
        省电，也保证用户滚过来的时候动画正好从头开始。
     2) 那个看不见的「占位层」写着完整文本，专门用来撑住高度：
        手机上这句话会折成两三行，没有它的话打到第二行时整块会往下跳。
   ============================================================ */
(function () {
  "use strict";

  var KEY = "co.typer";
  var FALLBACK = "有问题想问我们？请发邮件到volunteer@guiscn.com";
  /* 打字 95ms / 退格 40ms：打字比退格慢一点，看起来才像在「想」 */
  var TYPE_MS = 95, ERASE_MS = 40, HOLD_MS = 1900, GAP_MS = 700;

  function lang() {
    return document.documentElement.lang === "en" ? "en" : "zh";
  }
  function text() {
    var pack = (window.SITE_I18N && window.SITE_I18N[lang()]) || {};
    return pack[KEY] != null ? pack[KEY] : FALLBACK;
  }
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  var timer = 0, running = false, inView = false, io = null;

  function stop() {
    if (timer) clearTimeout(timer);
    timer = 0;
    running = false;
  }

  function paint(s) {
    var el = document.getElementById("co-typer-text");
    if (el) el.textContent = s;
  }
  function ghost(s) {
    var el = document.getElementById("co-typer-ghost");
    /* 占位层写完整文本 —— 撑住高度，打字过程中整块不会往下跳 */
    if (el) el.textContent = s;
  }

  function start() {
    var full = text();
    ghost(full);
    /* 系统开了「减少动态效果」：直接把整句摆出来，光标也不闪（CSS 里一并处理） */
    if (reduceMotion()) { paint(full); return; }
    if (running) return;
    running = true;

    /* Array.from：中文按字切，不会被代理对拆成半个字 */
    var chars = Array.from(full);
    var i = 0, erasing = false;

    (function step() {
      if (!running) return;
      if (!erasing) {
        i += 1;
        paint(chars.slice(0, i).join(""));
        if (i >= chars.length) { erasing = true; timer = setTimeout(step, HOLD_MS); return; }
        timer = setTimeout(step, TYPE_MS);
        return;
      }
      i -= 1;
      paint(chars.slice(0, Math.max(0, i)).join(""));
      if (i <= 0) { erasing = false; timer = setTimeout(step, GAP_MS); return; }
      timer = setTimeout(step, ERASE_MS);
    })();
  }

  function boot() {
    var host = document.querySelector(".co-typer");
    if (!host) return;

    paint("");
    ghost(text());

    if (!("IntersectionObserver" in window)) { start(); return; }

    io = new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      inView = !!(e && e.isIntersecting);
      if (inView) start(); else stop();
    }, { threshold: 0.2 });
    io.observe(host);

    /* 换语言：文本换了，从头再打一遍（main.js 的 applyLang 会放这个事件） */
    document.addEventListener("guis:langchange", function () {
      stop();
      paint("");
      start();
    });

    /* 切走标签页就停，回来再继续（后台标签的定时器会被节流，别白跑） */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else if (inView) start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
