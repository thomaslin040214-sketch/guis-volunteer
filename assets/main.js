/* ============================================================
   GUIS 义工组织 — site behaviour
   语言切换 / 滚动进场 / 计数动画 / 进度条 / 导航高亮
   下拉履历手风琴 / 工作照灯箱
   ============================================================ */
(function () {
  "use strict";

  var STORE_KEY = "guis-volunteer-lang";
  var DICT = window.SITE_I18N || {};
  var current = "zh";

  /* ---------- Language ---------- */
  function readStored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function store(lang) {
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { /* file:// may block */ }
  }

  function applyLang(lang) {
    if (!DICT[lang]) lang = "zh";
    current = lang;

    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

    var pack = DICT[lang];
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (pack[key] != null) el.innerHTML = pack[key];
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      // format: "title:doc.title,aria-label:nav.about"
      el.getAttribute("data-i18n-attr").split(",").forEach(function (pair) {
        var bits = pair.split(":");
        if (bits.length !== 2) return;
        var attr = bits[0].trim();
        var key = bits[1].trim();
        if (pack[key] != null) el.setAttribute(attr, pack[key]);
      });
    });
    var titleKey = document.documentElement.getAttribute("data-page-title") || "doc.title";
    if (pack[titleKey]) document.title = pack[titleKey];

    document.querySelectorAll(".lang-btn").forEach(function (b) {
      var on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // Keep photo alt text in step with the visible caption
    document.querySelectorAll(".shot").forEach(function (shot) {
      var img = shot.querySelector("img");
      var cap = shot.querySelector(".shot-cap");
      if (img && cap) img.setAttribute("alt", cap.textContent.trim());
    });

    store(lang);

    /* 语言换了：需要跟着重来的东西自己接住这个事件 ——
       页头那个打字机就是靠它换语言后从头再打一遍（assets/typer.js）。 */
    try {
      document.dispatchEvent(new CustomEvent("guis:langchange", { detail: { lang: lang } }));
    } catch (e) { /* 没有 CustomEvent 的老浏览器就算了 */ }
  }

  function initLang() {
    // Priority: ?lang=xx in the URL > saved choice > 中文
    var qs = new URLSearchParams(window.location.search).get("lang");
    var stored = readStored();
    var guess = "zh";
    if (qs === "en" || qs === "zh") guess = qs;
    else if (stored === "en" || stored === "zh") guess = stored;

    applyLang(guess);

    document.querySelectorAll(".lang-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyLang(btn.getAttribute("data-lang"));
      });
    });
  }

  /* ---------- "Enter the viewport" helper ----------
     IntersectionObserver is the primary trigger; a rAF-throttled
     scroll/resize check is the safety net (headless or exotic
     environments where IO callbacks may never fire). */
  var enterTasks = [];
  var enterIO = null;
  var patrolId = 0;
  var engineStarted = false;
  var sweepQueued = false;

  function runTask(task) {
    if (task.done) return;
    task.done = true;
    task.fn(task.el);
  }

  // Fallback sweep (also covers environments where IO never calls back)
  function sweep() {
    sweepQueued = false;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    enterTasks.forEach(function (t) {
      if (t.done) return;
      var r = t.el.getBoundingClientRect();
      var trigger = vh * 0.95;
      if (r.top < trigger && r.bottom > -40) runTask(t);
    });
  }

  function requestSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    window.requestAnimationFrame(sweep);
  }

  function startPatrol() {
    if (patrolId) return;
    patrolId = window.setInterval(function () {
      var pending = false;
      enterTasks.forEach(function (t) { if (!t.done) pending = true; });
      if (!pending) { window.clearInterval(patrolId); patrolId = 0; return; }
      sweep();
    }, 900);
  }

  function registerEnter(el, fn, ratio) {
    var task = { el: el, fn: fn, ratio: ratio || 0.15, done: false };
    enterTasks.push(task);
    /* 引擎启动之后才补注册的任务（例如活动数据异步加载完再加的计数动画）
       必须补上 observe 并重启巡逻，否则它可能永远等不到触发。 */
    if (engineStarted) {
      if (enterIO) enterIO.observe(el);
      startPatrol();
      requestSweep();
    }
    return task;
  }

  function initEnterEngine() {
    if ("IntersectionObserver" in window) {
      enterIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          enterTasks.forEach(function (t) {
            if (t.el === en.target) { runTask(t); enterIO.unobserve(en.target); }
          });
        });
      }, { threshold: 0.05, rootMargin: "0px 0px -6% 0px" });
      enterTasks.forEach(function (t) { enterIO.observe(t.el); });
    }

    window.addEventListener("scroll", requestSweep, { passive: true });
    window.addEventListener("resize", requestSweep);
    window.addEventListener("load", requestSweep);
    engineStarted = true;
    startPatrol();
    requestSweep();
  }

  /* ---------- Cursor spotlight ---------- */
  function initSpotlight() {
    var overlay = document.getElementById("spotlight");
    if (!overlay || window.matchMedia("(hover: none)").matches) {
      if (overlay) overlay.style.display = "none";
      return;
    }
    window.addEventListener("pointermove", function (e) {
      document.documentElement.style.setProperty("--mouse-x", e.clientX + "px");
      document.documentElement.style.setProperty("--mouse-y", e.clientY + "px");
    }, { passive: true });

    document.querySelectorAll(".card, .block, .member").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--card-mouse-x", (e.clientX - r.left) + "px");
        card.style.setProperty("--card-mouse-y", (e.clientY - r.top) + "px");
      }, { passive: true });
    });
  }

  /* ---------- Reveal on scroll ---------- */
  function initReveal() {
    document.querySelectorAll(".reveal").forEach(function (el) {
      registerEnter(el, function (node) { node.classList.add("is-in"); }, 0.12);
    });
  }

  /* ---------- Number counters ---------- */
  function countTo(node, target, suffix, dur) {
    suffix = suffix || "";
    dur = dur || 1300;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(target * eased).toLocaleString("en-US") + (p === 1 ? suffix : "");
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
    // Guarantee the final number even if frames are starved
    window.setTimeout(function () {
      node.textContent = target.toLocaleString("en-US") + suffix;
    }, dur + 400);
  }

  function initCounters() {
    document.querySelectorAll("[data-count]").forEach(function (el) {
      registerEnter(el, function (node) {
        countTo(node, parseInt(node.getAttribute("data-count"), 10) || 0, node.getAttribute("data-suffix") || "");
      }, 0.2);
    });
  }

  /* ---------- Skill / distribution bars ---------- */
  function initBars() {
    document.querySelectorAll("[data-fill]").forEach(function (el) {
      registerEnter(el, function (node) {
        node.style.width = node.getAttribute("data-fill") + "%";
      }, 0.2);
    });
  }

  /* ---------- Nav active section ---------- */
  function initNavState() {
    var links = Array.prototype.slice.call(document.querySelectorAll('nav a[href^="#"]'));
    if (!links.length) return;
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var sec = document.getElementById(id);
      if (sec) map[id] = a;
    });
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove("is-active"); });
        if (map[en.target.id]) map[en.target.id].classList.add("is-active");
      });
    }, { threshold: 0.35 });
    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  /* ---------- Gallery lightbox ---------- */
  function initLightbox() {
    var lb = document.getElementById("lightbox");
    var shots = Array.prototype.slice.call(document.querySelectorAll(".shot"));
    if (!lb || !shots.length) return;

    var imgEl = document.getElementById("lightbox-img");
    var capEl = document.getElementById("lightbox-cap");
    var prevBtn = lb.querySelector(".lightbox-nav.prev");
    var nextBtn = lb.querySelector(".lightbox-nav.next");
    var closeBtn = lb.querySelector(".lightbox-close");
    var index = 0;
    var lastFocus = null;

    function show(i) {
      index = (i + shots.length) % shots.length;
      var shot = shots[index];
      var img = shot.querySelector("img");
      var cap = shot.querySelector(".shot-cap");
      if (!img) return;
      imgEl.src = img.getAttribute("src");
      imgEl.alt = cap ? cap.textContent.trim() : "";
      capEl.textContent = cap ? cap.textContent.trim() : "";
    }

    function open(i) {
      lastFocus = document.activeElement;
      show(i);
      lb.classList.add("is-open");
      document.body.style.overflow = "hidden";
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      lb.classList.remove("is-open");
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    shots.forEach(function (shot, i) {
      shot.setAttribute("tabindex", "0");
      shot.setAttribute("role", "button");
      shot.addEventListener("click", function () { open(i); });
      shot.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); }
      });
    });

    if (prevBtn) prevBtn.addEventListener("click", function (e) { e.stopPropagation(); show(index - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function (e) { e.stopPropagation(); show(index + 1); });
    if (closeBtn) closeBtn.addEventListener("click", close);
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });

    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(index - 1);
      else if (e.key === "ArrowRight") show(index + 1);
    });
  }

  /* 对外暴露：供异步渲染复用（首页活动看板在云端数据回来后才补计数动画） */
  window.GUISEnter = { register: registerEnter, countTo: countTo };

  /* ---------- 旧首页自愈 ----------
     正式站的裸根路径 `/` 会被边缘节点长期缓存：带 ?v= 或 /index.html 才是新文档，
     裸域名可能一直返回「看板上线前」的 index.html（只有 #su-list / #su-empty）。
     那种旧文档没有引 board.js，这里补上并把看板挂进去，
     让旧书签 / 裸域名也能看到正确的看板，不用等缓存过期。

     只在自己确实跑在旧文档里时才动手（新文档有 #su-board，直接跳过）。 */
  function healLegacyHome() {
    if (document.getElementById("su-board") || !document.getElementById("su-list")) return;

    /* 先把旧列表藏起来，免得旧内联脚本把它渲染出来闪一下 */
    var legacyList = document.getElementById("su-list");
    if (legacyList) legacyList.style.setProperty("display", "none", "important");

    function boot() {
      if (window.GUISBoard && window.GUISBoard.mountHomeBoard) window.GUISBoard.mountHomeBoard();
    }
    if (window.GUISBoard) { boot(); return; }

    var s = document.createElement("script");
    s.src = "assets/board.js?v=20260930f";
    s.onload = boot;
    s.onerror = function () { if (legacyList) legacyList.style.removeProperty("display"); };
    document.head.appendChild(s);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initLang();
    initSpotlight();
    initReveal();
    initCounters();
    initBars();
    initNavState();
    initLightbox();
    initEnterEngine();
    healLegacyHome();
  });
})();
