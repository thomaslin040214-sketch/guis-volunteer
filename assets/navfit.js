/* ============================================================
   GUIS 义工组织 —— 把导航的真实高度写进 --nav-h
   （assets/navfit.js · 13 页全挂，必须排在 session.js 之前）

   为什么需要这个：

   导航是 position: fixed 的，它脱离了文档流，所以页面顶部要靠
   clamp(--nav-h) 手动给它留出正好一样高的空间 ——
     · 留少了，首屏内容和锚点跳转会被压在导航底下；
     · 留多了，顶上白出一条。
   （用到 --nav-h 的地方：site.css 的 section[scroll-margin-top] /
     .hero 的 padding-top / .letter-page；app.css 的 .page-head。）

   而导航的真实高度是会变的：
     · 桌面 64px；
     · ≤720px 折成两行 ——  首页类页面（标志行有语言开关 + 登录按钮）约 78px，
       后台 / 签到 / 我的账户（标志行只有标志）约 65px；
     · 窗口很窄、或切成英文时，链接行还可能再折一行。
   历史上 --nav-h 写死在媒体查询里（一度是 104px，实际 157px），
   结果就是「首屏顶部被盖住 + 锚点跳过去少一截」。

   所以别再猜了：量一次、写回去，并在任何可能改变高度的事情之后重新量。
   ============================================================ */
(function () {
  "use strict";

  var root = document.documentElement;
  var nav = null;
  var raf = 0;

  function apply() {
    raf = 0;
    if (!nav || !nav.isConnected) nav = document.querySelector("nav");
    if (!nav) return;
    /* 取整，避免亚像素抖动反复触发 ResizeObserver */
    var h = Math.round(nav.getBoundingClientRect().height);
    if (h > 0 && Math.abs(h - current()) >= 1) root.style.setProperty("--nav-h", h + "px");
  }

  function current() {
    var v = parseFloat(root.style.getPropertyValue("--nav-h"));
    return isNaN(v) ? 0 : v;
  }

  function schedule() {
    if (raf) return;
    /* 直接用 rAF，没有就用定时器兜底（jsdom / 极老浏览器） */
    raf = window.requestAnimationFrame
      ? window.requestAnimationFrame(apply)
      : setTimeout(apply, 16);
  }

  function boot() {
    nav = document.querySelector("nav");
    if (!nav) return;
    schedule();

    /* ① 导航自己变了 —— 语言切换、头像插进来、链接折行，都会改高度。
          ⚠️ 桌面下 nav 的 height 就是 var(--nav-h)，所以这里会形成
             一次「量 → 写 → 再量」的回环；靠上面 ||h - current()|| >= 1 收敛。 */
    if (window.ResizeObserver) {
      try { new ResizeObserver(schedule).observe(nav); } catch (e) { /* 忽略 */ }
    }
    /* ② 视口变了（横竖屏、拖动窗口） */
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    /* ③ 书法体是外挂 WOFF2，字体落地后「义工组织」那四个字会变宽 */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(schedule).catch(function () {});
    }
    window.addEventListener("load", schedule);
    /* ④ i18n.applyLang() 换文案（中文比英文长）不走 resize —— 补一个兜底轮询，
          只在头两秒里跑，避免长驻定时器拖住回归脚本退出。 */
    var tries = 0;
    var timer = setInterval(function () {
      schedule();
      if (++tries >= 12) clearInterval(timer);
    }, 160);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
