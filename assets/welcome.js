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

   ⚠️ 2026-10-26：词下面的语言小标签（中文 / English / …）按用户要求删了
      （原话「太恶心了」）—— 词表里的 lang 字段、SWAP_MS、langEl 一干逻辑
      全部随之移除，只留轮播本身。同日用户又要求「来到也改成对应语言的文字」，
      于是词表改用 { w, to } 结构：连接词跟着大词一起轮换（详见词表注释）。

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

  /* ---------- 词表 ----------
     2026-10-26：每个词配一个 to（「欢迎X来到」里的连接词）——
     用户要求「来到也改成对应语言的文字」：大词是哪种语言，
     下面的连接词就用哪种语言（欢迎→来到、Welcome→to、ようこそ→へ…）。
     ⚠️ to 字段**不进 i18n 词典**：它跟大词绑死轮换，与站点当前界面语言无关
        （站点语言只管下面的机构名 hero.badge）。
     ⚠️ 日/韩/印地语是后置词（てにをは 体系），所以 へ / 에 / में 排在机构名**上方**
        紧贴着它 —— 视觉上读作「机构名へようこそ」，语序才对。 */
  var WORDS = [
    { w: "欢迎",       to: "来到" },
    { w: "Welcome",    to: "to"   },
    { w: "환영합니다",  to: "에"   },
    { w: "ようこそ",   to: "へ"   },
    { w: "स्वागत है", to: "में"  }
  ];

  var HOLD_MS = 2600;   /* 一个词停多久（够读完一句，不赶） */
  var OUT_MS  = 420;    /* 旧词退场时长（与 site.css 的 .hw-layer transition 对齐） */

  function $(id) { return document.getElementById(id); }

  function boot() {
    var slot = $("hw-slot");
    if (!slot) return;

    var layers = slot.querySelectorAll(".hw-layer");
    if (layers.length < 2) return;

    /* 连接词元素（.hero-org-to）—— 找不到也不影响轮播本身 */
    var toEl = document.querySelector(".hero-org-to");

    /* top = 当前显示的那层，bottom = 藏在下面等着的那层 */
    var top = layers[0], bottom = layers[1];
    var idx = 0, timer = 0, swapTimer = 0, running = false, inView = true;

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
      /* 连接词跟大词同节奏淡出（420ms，见 site.css 的 .hero-org-to） */
      if (toEl) toEl.classList.add("is-swap");

      if (swapTimer) clearTimeout(swapTimer);
      swapTimer = setTimeout(function () {
        /* is-reset 把过渡关掉并把 transform 归位，
           强制回流后浏览器才认这个起点 → 新词才是「从下面升上来」而不是原地淡入 */
        bottom.className = "hw-layer is-reset";
        bottom.textContent = WORDS[next].w;
        void bottom.offsetWidth;          /* 强制回流 */
        bottom.className = "hw-layer is-in";

        /* 新词升上来的那一刻，连接词换字并淡入 */
        if (toEl) {
          toEl.textContent = WORDS[next].to;
          toEl.classList.remove("is-swap");
        }

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
    if (toEl) toEl.textContent = WORDS[0].to;

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
