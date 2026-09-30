/* ============================================================
   GUIS 义工社 — 公众号式富文本编辑器（GUISRich）

   用法：
     var ed = GUISRich.create(document.getElementById("box"), { placeholder: "正文…" });
     ed.setHTML("<p>你好</p>");
     var html = ed.getHTML();     // 已消毒，可直接存库

   为什么自己写而不用 contenteditable 裸奔：
   contenteditable 在不同浏览器下 execCommand 行为差别很大，而且会把粘贴进来的
   整段 Word / 网页样式原样带进来。这里统一走「工具栏按钮 → document.execCommand
   （只用它做行内格式）＋ 粘贴拦截 → 消毒」的组合，落库前再统一消毒一次，
   保证前台渲染出来的东西永远是干净的。

   图片：以 data URL 形式直接存在正文 HTML 里。
   原因是云存储的 shared / users 两个作用域当前权限都是 admin_only，
   匿名访客（学生家长）读不到对象，公开页面会全是裂图；存进正文最稳。
   因此插入前一律压到最大边 1280px、JPEG 0.82，避免正文膨胀得太离谱。
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- 消毒：白名单标签 + 白名单属性 ---------- */
  var ALLOWED = {
    P: [], BR: [], DIV: [], SPAN: [],
    H2: [], H3: [], H4: [],
    STRONG: [], B: [], EM: [], I: [], U: [], S: [], STRIKE: [],
    BLOCKQUOTE: [], PRE: [], CODE: [],
    UL: [], OL: [], LI: [],
    A: ["href", "title", "target", "rel"],
    IMG: ["src", "alt", "width", "height"],
    HR: [], FIGURE: [], FIGCAPTION: [], TABLE: [], THEAD: [], TBODY: [], TR: [], TD: [], TH: []
  };
  var KEEP_ATTR_ON_ALL = ["style"];   /* style 保留，但只放行一组安全属性 */

  /* 整个节点（含子节点）一起丢掉的标签 */
  var DROP_ENTIRELY = ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT", "BUTTON", "SVG", "MATH"];

  var SAFE_STYLE = /^\s*(text-align|font-size|font-weight|font-style|color|background-color|margin-left|padding-left)\s*:/i;

  function sanitize(html) {
    if (!html) return "";
    var doc;
    if (typeof DOMParser === "undefined") {
      /* 极老的浏览器：退化成「去掉 script/style/事件属性」的字符串处理 */
      return String(html)
        .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\sjavascript:/gi, " ");
    }
    doc = new DOMParser().parseFromString("<div id=\"root\">" + html + "</div>", "text/html");
    var rootEl = doc.getElementById("root");
    if (!rootEl) return "";
    walk(rootEl);
    return rootEl.innerHTML;
  }

  function walk(node) {
    var kids = Array.prototype.slice.call(node.childNodes);
    kids.forEach(function (child) {
      if (child.nodeType === 3) return;                       /* 文本保留 */
      if (child.nodeType === 8) { node.removeChild(child); return; }  /* 注释丢掉 */
      if (child.nodeType !== 1) { node.removeChild(child); return; }

      var tag = child.tagName;

      /* 这几个连内容一起丢掉 —— 只剥掉标签的话，script 里的代码会变成正文里的
         一串明文留下来，看着像「文章里莫名多了一段怪字」。 */
      if (DROP_ENTIRELY.indexOf(tag) >= 0) { node.removeChild(child); return; }

      if (!Object.prototype.hasOwnProperty.call(ALLOWED, tag)) {
        /* 不在白名单：把它的子节点提到上一层，内容不丢，外壳去掉 */
        var frag = node.ownerDocument.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        node.replaceChild(frag, child);
        return;
      }

      /* 属性白名单 */
      var allowed = ALLOWED[tag];
      Array.prototype.slice.call(child.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var keep = allowed.indexOf(name) >= 0;
        if (!keep && name === "style" && KEEP_ATTR_ON_ALL.indexOf("style") >= 0) keep = true;
        if (!keep) { child.removeAttribute(attr.name); return; }
        if (name === "style") {
          /* style 只放行排版类属性，挡掉 position/expression/url() 之类的注入 */
          var ok = String(attr.value).split(";").filter(function (d) {
            return d.trim() && SAFE_STYLE.test(d) && !/url\(|expression|@import/i.test(d);
          }).join(";");
          if (ok) child.setAttribute("style", ok); else child.removeAttribute("style");
          return;
        }
        if (name === "href" && /^\s*javascript:/i.test(String(attr.value))) {
          child.removeAttribute(attr.name);
        }
      });

      /* 外链统一加 rel，别把 referrer 和 opener 带出去 */
      if (tag === "A" && child.getAttribute("href")) {
        child.setAttribute("rel", "noopener noreferrer nofollow");
        child.setAttribute("target", "_blank");
      }
      /* 图片只接受 data: 或 http(s):，挡掉 javascript: / vbscript: */
      if (tag === "IMG") {
        var src = String(child.getAttribute("src") || "");
        if (!/^\s*(data:image\/|https?:\/\/|assets\/|\.\/|\/)/i.test(src)) {
          child.removeAttribute("src");
        }
        child.setAttribute("loading", "lazy");
      }
      if (child.firstChild) walk(child);
    });
  }

  /* ---------- 图片压缩 ---------- */
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error("读取图片失败")); };
      fr.readAsDataURL(file);
    });
  }

  /* 压到最大边 MAX 像素、JPEG QUALITY；GIF 与已经很小的图直接原样返回 */
  var MAX_EDGE = 1280;
  var QUALITY = 0.82;
  var KEEP_SMALL = 120 * 1024;

  function compressImage(file) {
    if (!file) return Promise.reject(new Error("没有文件"));
    var isImage = /^image\//i.test(file.type || "");
    if (!isImage) return Promise.reject(new Error("这不是图片文件"));
    if (/gif$/i.test(file.type || "") || file.size <= KEEP_SMALL) return readAsDataURL(file);

    return readAsDataURL(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          if (scale >= 1 && dataUrl.length <= 400 * 1024) { resolve(dataUrl); return; }
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var cv = document.createElement("canvas");
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext("2d");
          if (!ctx) { resolve(dataUrl); return; }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          try { resolve(cv.toDataURL("image/jpeg", QUALITY)); }
          catch (e) { resolve(dataUrl); }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  /* ---------- 工具栏定义 ---------- */
  var TOOLS = [
    { cmd: "formatBlock", arg: "p", label: "正文", title: "正文段落", kind: "block" },
    { cmd: "formatBlock", arg: "h2", label: "大标题", title: "大标题", kind: "block" },
    { cmd: "formatBlock", arg: "h3", label: "小标题", title: "小标题", kind: "block" },
    { sep: true },
    { cmd: "bold", label: "B", title: "加粗", cls: "rt-b" },
    { cmd: "italic", label: "I", title: "斜体", cls: "rt-i" },
    { cmd: "underline", label: "U", title: "下划线", cls: "rt-u" },
    { sep: true },
    { cmd: "insertUnorderedList", label: "• 列表", title: "无序列表" },
    { cmd: "insertOrderedList", label: "1. 列表", title: "有序列表" },
    { cmd: "formatBlock", arg: "blockquote", label: "❝ 引用", title: "引用段" },
    { cmd: "insertHorizontalRule", label: "— 分隔线", title: "插入分隔线" },
    { sep: true },
    { cmd: "justifyLeft", label: "⇤ 左", title: "左对齐" },
    { cmd: "justifyCenter", label: "↔ 中", title: "居中" },
    { cmd: "link", label: "🔗 链接", title: "插入 / 取消链接" },
    { cmd: "image", label: "🖼 图片", title: "插入图片（也可直接粘贴）" },
    { sep: true },
    { cmd: "removeFormat", label: "清除格式", title: "清除选中文字的格式" }
  ];

  function create(el, opts) {
    opts = opts || {};
    if (!el) throw new Error("GUISRich.create: 缺少容器");

    var box = document.createElement("div");
    box.className = "rich";

    var bar = document.createElement("div");
    bar.className = "rich-bar";

    var area = document.createElement("div");
    area.className = "rich-area";
    area.contentEditable = "true";
    area.setAttribute("role", "textbox");
    area.setAttribute("aria-multiline", "true");
    if (opts.placeholder) area.setAttribute("data-placeholder", opts.placeholder);

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    box.appendChild(fileInput);

    var status = document.createElement("div");
    status.className = "rich-status";

    function exec(cmd, arg) {
      area.focus();
      try { document.execCommand(cmd, false, arg); }
      catch (e) { /* 个别命令在部分浏览器下不支持，静默忽略 */ }
      sync();
    }

    function insertImage(dataUrl) {
      area.focus();
      var html = '<figure><img src="' + dataUrl + '" alt="" /></figure><p><br/></p>';
      if (document.execCommand("insertHTML", false, html)) { sync(); return; }
      area.innerHTML += html;   /* execCommand 不可用时的兜底 */
      sync();
    }

    function pickImages(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      status.textContent = "正在处理 " + list.length + " 张图片…";
      var chain = Promise.resolve();
      list.forEach(function (f) {
        chain = chain.then(function () {
          return compressImage(f).then(insertImage).catch(function () { /* 单张失败不影响其余 */ });
        });
      });
      chain.then(function () {
        status.textContent = "";
        sync();
      });
    }

    TOOLS.forEach(function (t) {
      if (t.sep) { var s = document.createElement("span"); s.className = "rich-sep"; bar.appendChild(s); return; }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rich-btn" + (t.cls ? " " + t.cls : "");
      b.textContent = t.label;
      b.title = t.title;
      b.setAttribute("aria-label", t.title);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });  /* 别让按钮抢走选区 */
      b.addEventListener("click", function () {
        if (t.cmd === "image") { fileInput.click(); return; }
        if (t.cmd === "link") {
          var url = window.prompt("输入链接地址（留空则取消当前链接）", "https://");
          if (url === null) return;
          if (url.trim() === "") { exec("unlink"); return; }
          if (!/^(https?:)?\/\//i.test(url.trim())) url = "https://" + url.trim();
          exec("createLink", url.trim());
          return;
        }
        exec(t.cmd, t.arg);
      });
      bar.appendChild(b);
    });

    fileInput.addEventListener("change", function () {
      pickImages(fileInput.files);
      fileInput.value = "";
    });

    /* 粘贴：图片直接压了插进来；HTML 先消毒再插；纯文本按段落拆开 */
    area.addEventListener("paste", function (e) {
      var cd = e.clipboardData || (window.clipboardData);
      if (!cd) return;
      var items = cd.items || [];
      var files = [];
      Array.prototype.forEach.call(items, function (it) {
        if (it.kind === "file" && /^image\//i.test(it.type)) {
          var f = it.getAsFile && it.getAsFile();
          if (f) files.push(f);
        }
      });
      if (files.length) { e.preventDefault(); pickImages(files); return; }

      var html = cd.getData("text/html");
      if (html) { e.preventDefault(); insertRaw(sanitize(html)); return; }

      var text = cd.getData("text/plain");
      if (text) {
        e.preventDefault();
        var safe = text.split(/\r?\n{2,}/).map(function (p) {
          return "<p>" + sanitize(p.replace(/\r?\n/g, "<br/>")) + "</p>";
        }).join("");
        insertRaw(safe);
      }
    });

    /* 拖放图片 */
    area.addEventListener("dragover", function (e) { e.preventDefault(); });
    area.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      var files = Array.prototype.slice.call(dt.files || []).filter(function (f) { return /^image\//i.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      pickImages(files);
    });

    function insertRaw(html) {
      area.focus();
      if (document.execCommand("insertHTML", false, html)) { sync(); return; }
      area.innerHTML += html;
      sync();
    }

    /* 字数与图片数提示 */
    function sync() {
      var text = (area.textContent || "").replace(/\s+/g, "");
      var imgs = area.querySelectorAll("img").length;
      var parts = [text.length + " 字"];
      if (imgs) parts.push(imgs + " 张图");
      status.textContent = parts.join(" · ");
      if (opts.onChange) opts.onChange(getHTML());
    }

    area.addEventListener("input", sync);
    area.addEventListener("keyup", function () {
      var b = document.queryCommandState("bold");
      var i = document.queryCommandState("italic");
      bar.querySelectorAll(".rt-b").forEach(function (x) { x.classList.toggle("is-on", b); });
      bar.querySelectorAll(".rt-i").forEach(function (x) { x.classList.toggle("is-on", i); });
    });

    box.appendChild(bar);
    box.appendChild(area);
    box.appendChild(status);
    el.appendChild(box);

    if (!area.innerHTML.trim()) area.innerHTML = "<p><br/></p>";
    sync();

    return {
      el: box,
      area: area,
      focus: function () { area.focus(); },
      setHTML: function (html) { area.innerHTML = sanitize(html) || "<p><br/></p>"; sync(); },
      getHTML: function () { return sanitize(area.innerHTML); },
      getText: function (n) {
        var t = (area.textContent || "").replace(/\s+/g, " ").trim();
        n = n || 110;
        return t.length > n ? t.slice(0, n) + "…" : t;
      },
      /* 取正文里第一张图，当作封面候选 */
      firstImage: function () {
        var img = area.querySelector("img");
        return img ? img.getAttribute("src") : "";
      },
      clear: function () { area.innerHTML = "<p><br/></p>"; sync(); }
    };
  }

  root.GUISRich = {
    create: create,
    sanitize: sanitize,
    compressImage: compressImage
  };
})(typeof window !== "undefined" ? window : this);
