/* ============================================================
   GUIS 义工社 — 二维码公用工具
   后台（看每个人的签到码）和老师签到页（扫同学的码）都要用，
   所以抽成一个模块，两边共用同一套「懒加载 + 画码 + 弹层」。

   为什么懒加载：
     - qrcode.min.js（生成，20KB）点开二维码时才拉
     - jsQR.js（识别，250KB）只有老师按「开始扫描」时才拉
   老师可能全程只用手动打钩，那就一个字节都不用下载。

   两个库都 vendored 在 assets/vendor/ 下，不依赖第三方 CDN。
   ============================================================ */
(function () {
  "use strict";

  /* 资源版本号跟着 <script src="assets/qr.js?v=xxxx"> 走。
     以后 HTML 里 bump 版本号时这里会自动跟上，不会再出现
     「动态加载的脚本用了旧版本号、被边缘节点缓存住」的老毛病。 */
  var V = (function () {
    var s = document.currentScript;
    var m = s && /[?&]v=([^&]+)/.exec(s.src || "");
    return m ? m[1] : "20260930p";
  })();

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + V;
      s.onload = function () {
        if (ready()) resolve();
        else reject(new Error("脚本已加载但没有导出需要的对象：" + src));
      };
      s.onerror = function () { reject(new Error("加载失败：" + src)); };
      document.head.appendChild(s);
    });
  }

  var genP = null, scanP = null;

  function loadGen() {
    if (!genP) {
      genP = loadScript("assets/vendor/qrcode.min.js", function () { return !!window.QRCode; });
    }
    return genP;
  }

  function loadScan() {
    if (!scanP) {
      scanP = loadScript("assets/vendor/jsqr.js", function () { return !!window.jsQR; });
    }
    return scanP;
  }

  /* 把一个字符串画成二维码塞进容器。
     qrcodejs 每次 new 都会往容器里追加内容，所以必须先清空。 */
  function render(el, text, size) {
    if (!el) return el;
    el.innerHTML = "";
    var px = size || 220;
    /* eslint-disable no-new */
    new window.QRCode(el, {
      text: String(text || ""),
      width: px,
      height: px,
      colorDark: "#144C90",     /* 品牌蓝，跟全站一个色 */
      colorLight: "#FFFFFF",
      correctLevel: window.QRCode.CorrectLevel.M
    });
    return el;
  }

  /* 扫到的码可能是纯签到码，也可能是「…/checkin.html?t=xxxx」这种整串。
     统一把签到码抠出来再查库。 */
  function extractToken(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return "";
    var m = /[?&#]t(?:oken)?=([A-Za-z0-9]+)/.exec(s);
    if (m) return m[1];
    m = /([A-Za-z0-9]{8,})\s*$/.exec(s);
    if (m && /^(?:https?:)?\/\//.test(s) === false) return m[1];
    return s;
  }

  /* ---------------- 弹层 ----------------
     弹层是直接挂到 body 下的，这样 @media print 可以靠
     body > *:not(.qr-mask) 把页面其它部分整个藏掉，直接打印二维码表。 */
  var mask = null;

  function close() {
    if (!mask) return;
    if (mask.parentNode) mask.parentNode.removeChild(mask);
    mask = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function build(opt) {
    close();
    mask = document.createElement("div");
    mask.className = "qr-mask";
    mask.hidden = true;

    var box = document.createElement("div");
    box.className = "qr-box";

    var head = document.createElement("div");
    head.className = "qr-head";
    var h = document.createElement("div");
    h.innerHTML = "<h3>" + esc(opt.title || "签到二维码") + "</h3>" +
      (opt.sub ? '<p class="qr-sub">' + esc(opt.sub) + "</p>" : "");
    var x = document.createElement("button");
    x.type = "button";
    x.className = "qr-close";
    x.setAttribute("aria-label", "关闭");
    x.textContent = "×";
    x.addEventListener("click", close);
    head.appendChild(h);
    head.appendChild(x);

    var body = document.createElement("div");
    body.className = "qr-body";

    var foot = document.createElement("div");
    foot.className = "qr-actions";
    if (opt.printable) {
      var pb = document.createElement("button");
      pb.type = "button";
      pb.className = "btn btn-primary";
      pb.textContent = "打印 / 存为 PDF";
      pb.addEventListener("click", function () { window.print(); });
      foot.appendChild(pb);
    }
    var cb = document.createElement("button");
    cb.type = "button";
    cb.className = "btn btn-secondary";
    cb.textContent = "关闭";
    cb.addEventListener("click", close);
    foot.appendChild(cb);

    box.appendChild(head);
    box.appendChild(body);
    if (foot.children.length) box.appendChild(foot);
    mask.appendChild(box);
    document.body.appendChild(mask);
    document.addEventListener("keydown", onKey);
    mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
    mask.hidden = false;
    requestAnimationFrame(function () { mask.classList.add("is-on"); });

    return body;
  }

  function card(item) {
    var c = document.createElement("div");
    c.className = "qr-card";
    var holder = document.createElement("div");
    holder.className = "qr-holder";
    var nm = document.createElement("div");
    nm.className = "qr-name";
    nm.textContent = item.name || "";
    var sb = document.createElement("div");
    sb.className = "qr-sub2";
    sb.textContent = item.sub || "";
    var tk = document.createElement("div");
    tk.className = "qr-token";
    tk.textContent = item.token || "";
    c.appendChild(holder);
    c.appendChild(nm);
    c.appendChild(sb);
    c.appendChild(tk);
    return { node: c, holder: holder };
  }

  /* 画一张（或一批）二维码。items 里缺 token 的会先被补上再画。
     ensure 收到的是整条 item（不是 id），补完直接改 item.token 即可。 */
  function paint(body, items, size, ensure) {
    var jobs = items.map(function (it) {
      if (it.token || !ensure) return Promise.resolve(it);
      return Promise.resolve(ensure(it)).then(function (tok) { it.token = tok || ""; return it; });
    });
    return Promise.all(jobs).then(function (list) {
      list.forEach(function (it) {
        var c = card(it);
        body.appendChild(c.node);
        if (it.token) render(c.holder, it.token, size);
        else c.holder.textContent = "还没有签到码";
      });
    });
  }

  /**
   * 一个人的二维码。
   * @param {{title?:string, sub?:string, name:string, sub2?:string, token:string, id?:number, size?:number}} opt
   */
  function showOne(opt) {
    var body = build({ title: opt.title || "签到二维码", sub: opt.sub, printable: false });
    body.classList.add("is-single");
    body.innerHTML = '<div class="qr-loading"><span class="loading"></span> 正在生成…</div>';
    return loadGen().then(function () {
      body.innerHTML = "";
      return paint(body, [{ name: opt.name, sub: opt.sub2 || "", token: opt.token, id: opt.id }],
        opt.size || 240, opt.ensure);
    }).catch(function (err) {
      body.innerHTML = '<div class="alert alert-error">生成失败：' + esc(err && err.message) + "</div>";
    });
  }

  /**
   * 一批人的二维码（打印给同学 / 发到群里用）。
   * @param {{title?:string, sub?:string, items:Array, size?:number, ensure?:function}} opt
   */
  function showSheet(opt) {
    var items = opt.items || [];
    if (!items.length) return Promise.resolve();
    var body = build({
      title: opt.title || "签到二维码",
      sub: opt.sub,
      printable: true
    });
    body.classList.add("is-grid");
    body.innerHTML = '<div class="qr-loading"><span class="loading"></span> 正在生成 ' +
      items.length + " 张…</div>";
    return loadGen().then(function () {
      body.innerHTML = "";
      return paint(body, items, opt.size || 168, opt.ensure);
    }).catch(function (err) {
      body.innerHTML = '<div class="alert alert-error">生成失败：' + esc(err && err.message) + "</div>";
    });
  }

  window.GUISQR = {
    version: V,
    loadGen: loadGen,
    loadScan: loadScan,
    render: render,
    extractToken: extractToken,
    showOne: showOne,
    showSheet: showSheet,
    close: close
  };
})();
