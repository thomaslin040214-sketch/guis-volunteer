/* ============================================================
   GUIS 义工组织 — 排队 / 等待组件
   只在请求「变慢或失败」时才出现；平时请求很快，用户完全看不到它。

   用法：
     GUISQueue.run(function (attempt) { return C.listOpenActivities(); }, {
       title: "正在读取活动…",
       busyTitle: "正在为你接通…"
     }).then(handleResult).catch(handleError);
   ============================================================ */
(function () {
  "use strict";

  var DEFAULTS = {
    title: "正在处理…",              // 尚未判定拥挤时的文案
    busyTitle: "正在为你接通…",        // 判定拥挤后的文案
    sub: "报名的人有点多，我们正在排队处理，稍等一下就好。",
    maxAttempts: 5,                  // 最多自动重试几次
    showAfter: 900,                  // 超过这个毫秒数还没返回，才显示排队界面
    baseDelay: 800,                  // 首次重试等待，之后按 2 倍递增，上限 8 秒
    cancelText: "稍后再来",           // 取消按钮文案（调用方按当前语言传入）
    /* 加载完成后那一瞬的文案。以前没有默认值，调用方忘了传就显示「好了，进去了」，
       而用户希望的是「请稍等，即将进入站点」—— 这里给个默认值，别的调用点忘了也不至于跑偏。 */
    doneText: "请稍等，即将进入站点",
    // 重试倒计时文案，调用方可按语言覆盖
    retryText: function (attempt, max, seconds) {
      return "第 " + attempt + " / " + max + " 次尝试 · " + seconds + " 秒后自动重试";
    },
    // 有些错误重试也没用（重复报名、权限不足），用这个跳过重试、立刻交给调用方处理
    shouldRetry: null
  };

  var mask, card, titleEl, subEl, barFill, metaEl, cancelBtn;
  var rafId = null;
  var countTimer = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensureDom() {
    if (mask) return;

    mask = el("div", "queue-mask");
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-live", "polite");
    mask.hidden = true;

    card = el("div", "queue-card");
    titleEl = el("div", "queue-title");
    subEl = el("div", "queue-sub");
    var bar = el("div", "queue-bar");
    barFill = el("span");
    bar.appendChild(barFill);
    metaEl = el("div", "queue-meta");
    cancelBtn = el("button", "queue-cancel", DEFAULTS.cancelText);
    cancelBtn.type = "button";

    card.appendChild(titleEl);
    card.appendChild(subEl);
    card.appendChild(bar);
    card.appendChild(metaEl);
    card.appendChild(cancelBtn);
    mask.appendChild(card);
    document.body.appendChild(mask);
  }

  function stopAnimations() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (countTimer) { clearInterval(countTimer); countTimer = null; }
  }

  function show(title, sub) {
    ensureDom();
    titleEl.textContent = title;
    subEl.textContent = sub;
    mask.classList.remove("is-done");
    mask.hidden = false;
    // 触发进场动画
    requestAnimationFrame(function () { mask.classList.add("is-on"); });
  }

  function hide() {
    if (!mask) return;
    stopAnimations();
    mask.classList.remove("is-on");
    setTimeout(function () { if (mask) mask.hidden = true; }, 260);
  }

  /* 进度条：在 ms 毫秒内从 0 走到 100% */
  function fillOver(ms) {
    if (!barFill) return;
    var start = performance.now();
    barFill.style.width = "0%";
    function step(now) {
      var p = Math.min((now - start) / ms, 1);
      barFill.style.width = (p * 100).toFixed(1) + "%";
      if (p < 1) rafId = requestAnimationFrame(step);
      else rafId = null;
    }
    rafId = requestAnimationFrame(step);
  }

  /* 不确定进度：左右来回的呼吸条，用于「还在等第一次响应」 */
  function fillIndeterminate() {
    if (!barFill) return;
    if (mask) mask.classList.add("is-waiting");
  }

  function finishOk(message) {
    if (!mask) return;
    stopAnimations();
    if (mask) mask.classList.remove("is-waiting");
    if (barFill) barFill.style.width = "100%";
    if (mask) mask.classList.add("is-done");
    if (titleEl) titleEl.textContent = message || DEFAULTS.doneText;
    if (subEl) subEl.textContent = "";
    if (metaEl) metaEl.textContent = "";
    setTimeout(hide, 550);
  }

  /**
   * 执行一个异步任务，必要时显示排队界面并自动重试。
   * @param {function(number):Promise} task  每次尝试都要返回一个新的 Promise
   * @param {object} opts
   * @returns {Promise}
   */
  function run(task, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});

    return new Promise(function (resolve, reject) {
      var attempt = 0;
      var delay = opts.baseDelay;
      var cancelled = false;
      var visible = false;

      function onCancel() {
        cancelled = true;
        hide();
        var e = new Error("已取消");
        e.cancelled = true;
        reject(e);
      }

      function showIfNeeded() {
        if (visible) return;
        visible = true;
        ensureDom();
        if (cancelBtn) {
          cancelBtn.textContent = opts.cancelText || DEFAULTS.cancelText;
          cancelBtn.onclick = onCancel;
        }
        show(opts.busyTitle, opts.sub);
        fillIndeterminate();
      }

      function once() {
        if (cancelled) return;
        attempt++;

        /* 超过 showAfter 还没回来，才判定为「有点挤」并显示排队界面 */
        var slowTimer = setTimeout(showIfNeeded, opts.showAfter);

        var p;
        try {
          p = task(attempt);
        } catch (e) {
          p = Promise.reject(e);
        }

        p.then(function (res) {
          clearTimeout(slowTimer);
          if (visible) finishOk(opts.doneText);
          resolve(res);
        }).catch(function (err) {
          clearTimeout(slowTimer);
          if (cancelled) return;

          /* 确定性错误（重复报名、无权限）不需要排队重试 */
          if (typeof opts.shouldRetry === "function" && !opts.shouldRetry(err)) {
            hide();
            reject(err);
            return;
          }

          if (attempt < opts.maxAttempts) {
            showIfNeeded();
            if (mask) mask.classList.remove("is-waiting");
            if (metaEl) {
              var mk = typeof opts.retryText === "function" ? opts.retryText : DEFAULTS.retryText;
              metaEl.textContent = mk(attempt, opts.maxAttempts, (delay / 1000).toFixed(1));
            }
            fillOver(delay);

            countTimer = setTimeout(function () {
              countTimer = null;
              delay = Math.min(delay * 2, 8000);
              once();
            }, delay);
            return;
          }

          hide();
          reject(err);
        });
      }

      once();
    });
  }

  window.GUISQueue = {
    run: run,
    show: show,
    hide: hide
  };
})();
