/* ============================================================
   GUIS 义工社 — 导航栏下拉菜单（全站共用）

   为什么单独一个文件：导航在 10 个 HTML 里各写了一遍，
   下拉的行为逻辑只有一份，改一次全站生效。

   交互（2026-10-01 起）：
     · **鼠标移上去就展开**，移开就收起（不用点）
     · 键盘仍然可用：Tab 聚焦到按钮后按 Enter / 空格照样展开
     · 点页面别处、按 Esc、或者点菜单里的某一项，都会收起
     · 触摸设备没有 hover，改成点一下展开（见下面 isTouch）

   注意：i18n 会整块覆盖带 data-i18n 元素的 textContent，
   所以按钮里的文字必须包在 <span> 里，否则小箭头会被一起冲掉。
   ============================================================ */
(function () {
  "use strict";

  /* 触摸设备（手机 / 平板）没有真正的 hover —— 那里还是点一下展开 */
  function isTouch() {
    return !!(window.matchMedia && window.matchMedia("(hover: none)").matches);
  }

  function closeAll(except) {
    var drops = document.querySelectorAll(".nav-drop");
    Array.prototype.forEach.call(drops, function (d) {
      if (d === except) return;
      d.classList.remove("is-open");
      var b = d.querySelector(".nav-drop-btn");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  function open(d, btn, on) {
    d.classList.toggle("is-open", on);
    btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function bind() {
    var drops = document.querySelectorAll(".nav-drop");
    Array.prototype.forEach.call(drops, function (d) {
      var btn = d.querySelector(".nav-drop-btn");
      if (!btn || btn.getAttribute("data-nav-bound") === "1") return;
      btn.setAttribute("data-nav-bound", "1");

      var touch = isTouch();

      /* 点：触摸设备靠它展开；鼠标点一下也能当「钉住」用 */
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var willOpen = !d.classList.contains("is-open");
        closeAll(d);
        open(d, btn, willOpen);
      });

      if (!touch) {
        var timer = null;
        var enter = function () {
          if (timer) { clearTimeout(timer); timer = null; }
          closeAll(d);
          open(d, btn, true);
        };
        /* 移开留 160ms 缓冲：从按钮移到菜单里那几像素不会立刻关掉 */
        var leave = function () {
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { open(d, btn, false); }, 160);
        };
        d.addEventListener("mouseenter", enter);
        d.addEventListener("mouseleave", leave);
        btn.addEventListener("focus", function () { closeAll(d); open(d, btn, true); });
      }

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
