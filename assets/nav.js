/* ============================================================
   GUIS 义工社 — 导航栏下拉菜单（全站共用）

   为什么单独一个文件：导航在 10 个 HTML 里各写了一遍，
   下拉的行为逻辑只有一份，改一次全站生效。

   交互：点「关于我们」展开 / 收起；点页面别处、按 Esc、
   或者点菜单里的某一项，都会收起。键盘也能用（button + aria-expanded）。

   注意：i18n 会整块覆盖带 data-i18n 元素的 textContent，
   所以按钮里的文字必须包在 <span> 里，否则小箭头会被一起冲掉。
   ============================================================ */
(function () {
  "use strict";

  function closeAll(except) {
    var drops = document.querySelectorAll(".nav-drop");
    Array.prototype.forEach.call(drops, function (d) {
      if (d === except) return;
      d.classList.remove("is-open");
      var b = d.querySelector(".nav-drop-btn");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  function bind() {
    var drops = document.querySelectorAll(".nav-drop");
    Array.prototype.forEach.call(drops, function (d) {
      var btn = d.querySelector(".nav-drop-btn");
      if (!btn || btn.getAttribute("data-nav-bound") === "1") return;
      btn.setAttribute("data-nav-bound", "1");

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var willOpen = !d.classList.contains("is-open");
        closeAll(d);
        d.classList.toggle("is-open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });

      /* 点了菜单里的链接就收起 —— 否则跳走之前菜单还挂在屏幕上 */
      Array.prototype.forEach.call(d.querySelectorAll(".nav-drop-menu a"), function (a) {
        a.addEventListener("click", function () { closeAll(null); });
      });
    });
  }

  document.addEventListener("click", function () { closeAll(null); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc") closeAll(null);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  /* 有些页面的导航是脚本后插进来的，晚一点再绑一次也没坏处 */
  window.addEventListener("load", bind);
})();
