/* ============================================================
   GUIS 义工组织 —— 首屏多语言欢迎词
   ------------------------------------------------------------
   一行大标题里嵌一个循环替换的欢迎词，做法参照 Western Sydney
   International Airport 的抬头（他们依次是 Dharug 原住民语 /
   普通话拼音 / 阿拉伯语 / 越南语）。

   这里按用户指定只做五种：中文、英文、韩语、日语、印地语。

   要改词 → 改下面 WORDS 这张表
   要改节奏 → 改 HOLD_MS（一个词停多久）
   离场/进场的时长在 site.css 的 .hw-layer（transition）

   ⚠️ 这个词表**不进 i18n 词典**：
      它本来就是「同时展示多种语言」，跟站点当前是中文还是英文界面无关。
      塞进 zh/en 词典会让人误以为它该跟着界面语言变。

   ⚠️ 词宽不一样（Welcome 比「欢迎」宽）→ 不用管宽度：
      词槽是**整块宽**，每个词自己 left:50% + translateX(-50%) 居中，
      词变宽变窄都是**从中心往两边长**，中心点纹丝不动 → 天然不抖。
      （早期版本把词槽做成 max-content，宽度随词变化，整行会左右晃，已弃用。）
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 词表 ---------- */
  var WORDS = [
    { w: "欢迎", lang: "中文" },
    { w: "Welcome", lang: "English" },
    { w: "환영합니다", lang: "한국어" },
    { w: "ようこそ", lang: "日本語" },
    { w: "स्वागत है", lang: "हिन्दी" }
  ];

  var HOLD_MS = 2600;   /* 一个词停多久（够读完一句，不赶） */
  var OUT_MS  = 420;    /* 旧词退场时长（与 site.css 的 .hw-layer transition 对齐） */
  var SWAP_MS = 200;    /* 语言小标签换字的时机（离场过渡的中点） */

  function $(id) { return document.getElementById(id); }

  function boot() {
    var slot = $("hw-slot");
    var langEl = $("hw-lang");
    if (!slot || !langEl) return;

    var layers = slot.querySelectorAll(".hw-layer");
    if (layers.length < 2) return;

    /* top = 当前显示的那层，bottom = 藏在下面等着的那层 */
    var top = layers[0], bottom = layers[1];
    var idx = 0, timer = 0, langTimer = 0, swapTimer = 0, running = false, inView = true;

    function reduceMotion() {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    /* ---------- 换词：上面那层往槽顶退，退完了下面那层再从槽底升上来 ----------
       ⚠️ **必须错开时序，不能两层同时在场**：
          早期版本是「旧的开始退的同时新的就开始进」，
          结果两个词在半空交叠 → 糊成一团（截图抓到的就是这个画面）。
          现在改成：旧的退干净（OUT_MS）→ 再让新的进来。中间有 ~60ms 空档，
          读起来是「翻页」，不是「重影」。 */
    function swap() {
      var next = (idx + 1) % WORDS.length;

      top.className = "hw-layer is-out";

      if (langTimer) clearTimeout(langTimer);
      langEl.className = "hw-lang is-out";
      langTimer = setTimeout(function () {
        langEl.textContent = WORDS[next].lang;
        langEl.className = "hw-lang is-in";
      }, SWAP_MS);

      if (swapTimer) clearTimeout(swapTimer);
      swapTimer = setTimeout(function () {
        /* is-reset 把过渡关掉并把 transform 归位，
           强制回流后浏览器才认这个起点 → 新词才是「从下面升上来」而不是原地淡入 */
        bottom.className = "hw-layer is-reset";
        bottom.textContent = WORDS[next].w;
        void bottom.offsetWidth;          /* 强制回流 */
        bottom.className = "hw-layer is-in";

        var t = top; top = bottom; bottom = t;
        idx = next;
      }, OUT_MS);
    }

    function start() {
      if (running || reduceMotion()) return;
      running = true;
      timer = setInterval(swap, HOLD_MS);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = 0; running = false;
    }

    /* ---------- 首帧 ---------- */
    top.className = "hw-layer is-in";
    top.textContent = WORDS[0].w;
    bottom.className = "hw-layer is-reset";
    bottom.textContent = WORDS[1].w;
    langEl.textContent = WORDS[0].lang;
    langEl.className = "hw-lang is-in";

    if (reduceMotion()) return;   /* 开了「减少动态效果」就停在这一个词 */

    start();

    /* 标签页切走就停，别在后台白跑 */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else if (inView) start();
    });

    /* 滚出首屏就停 */
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting;
        if (inView && !document.hidden) start();
        else stop();
      }, { threshold: 0 }).observe(slot);
    }

    /* 鼠标悬停时暂停，方便把某一个词读完 */
    var wrap = slot.closest ? (slot.closest(".hero-welcome") || slot) : slot;
    wrap.addEventListener("mouseenter", function () { stop(); });
    wrap.addEventListener("mouseleave", function () {
      if (inView && !document.hidden) start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
