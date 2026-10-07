/* ============================================================
   校外义工时长认定 · 申请端（2026-10-02 加）
   学生拿着校外机构的义工证明来申请 → 组织成员审核 → 通过后并入其义工小时。

   三件事是这里的核心，改之前先看：

   1) **提交不等于计入。** 插入时 status 固定 'pending'（RLS 的 WITH CHECK 里
      就卡死了，学生没法自己填 'approved'）。只有组织成员在后台点「通过」，
      my_service() 才会把这条算进他的累计小时。
   2) **收件箱不是前端写的。** admin_inbox 那一行由数据库触发器负责 ——
      前端只有读和标记已读的权限。这样谁也伪造不了「有新申请」的消息。
   3) **自动识别只是帮忙填表。** 模型读图可能读错，所以识别完一定让学生自己看一遍
      再提交；识别失败也不拦着他手动填。
   ============================================================ */
(function () {
  "use strict";

  /* ⚠️ 整段只跑一次。真机上出现过「点一下提交 → 库里多了两条一模一样的申请」，
     排查下来是同一个 click 被两套监听各接了一次（脚本被重复执行）。
     这里在 window 上打桩，就算脚本真被引了两次，第二份也直接退出，不会再绑一遍。 */
  if (window.__GUIS_EXTERNAL_BOOTED) return;
  window.__GUIS_EXTERNAL_BOOTED = true;

  var C = window.GUISCloud;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function alertIn(el, kind, msg) {
    if (el) el.innerHTML = '<div class="alert alert-' + kind + '">' + msg + "</div>";
  }
  function clear(el) { if (el) el.innerHTML = ""; }
  function busyOn(btn, label) {
    if (!btn) return;
    btn.setAttribute("data-busy-label", btn.textContent);
    btn.disabled = true;
    if (label) btn.textContent = label;
  }
  function busyOff(btn) {
    if (!btn) return;
    btn.disabled = false;
    var old = btn.getAttribute("data-busy-label");
    if (old != null) btn.textContent = old;
  }

  var ME = { id: "", email: "" };
  var file = null;       /* 选中的证明图片 */
  var proofPath = "";    /* 上传成功后云存储里的路径 */

  /* ---------- 未绑定云服务的域名提示（跟 me.html / admin.html 一致） ---------- */
  (function originCheck() {
    var banner = $("origin-banner"), link = $("origin-link");
    if (!banner || !C || !C.endpoint) return;
    try {
      var host = new URL(C.endpoint).host;
      if (location.host && host && location.host !== host) {
        link.href = "https://" + host + "/external.html";
        link.textContent = "https://" + host;
        banner.hidden = false;
      }
    } catch (e) { /* URL 解析不出来就算了，别拦着页面 */ }
  })();

  /* ================= 启动：先看有没有登录 ================= */
  function boot() {
    if (!C || typeof C.sessionUser !== "function") {
      $("ext-boot").hidden = true;
      $("ext-gate").hidden = false;
      return;
    }
    C.sessionUser().then(function (u) {
      $("ext-boot").hidden = true;
      if (!u || !u.email) {
        $("ext-gate").hidden = false;
        return;
      }
      ME.id = u.id || "";
      ME.email = u.email;
      $("ext-app").hidden = false;
      loadMine();
    }).catch(function () {
      /* 断网也算没登录：这里不让他瞎填，填完提交不了更烦 */
      $("ext-boot").hidden = true;
      $("ext-gate").hidden = false;
    });
  }

  /* ================= 图片：选图 + 预览 ================= */
  var fileIn = $("ext-file"), ocrBtn = $("ext-ocr");

  if (fileIn) {
    fileIn.addEventListener("change", function () {
      var f = fileIn.files && fileIn.files[0];
      proofPath = "";
      if (!f) {
        file = null;
        $("ext-preview").hidden = true;
        if (ocrBtn) ocrBtn.disabled = true;
        return;
      }
      if (!/^image\//.test(f.type || "")) {
        alertIn($("ext-alerts"), "error", "只能上传图片（JPG / PNG / HEIC 都行）。");
        fileIn.value = "";
        return;
      }
      /* 单张上限 12 MB —— 云存储和内容审核都吃不消再大的原图 */
      if (f.size > 12 * 1024 * 1024) {
        alertIn($("ext-alerts"), "error", "这张图有 " + Math.round(f.size / 1048576) + " MB，太大了。请压缩到 12 MB 以内再上传。");
        fileIn.value = "";
        return;
      }
      clear($("ext-alerts"));
      file = f;
      var img = $("ext-img");
      img.src = URL.createObjectURL(f);
      $("ext-preview").hidden = false;
      if (ocrBtn) ocrBtn.disabled = false;
    });
  }

  /* 压到长边 1280、JPEG 0.82 —— 跟刊物配图同一档。
     既要让模型看得清字，又不能把整张原图（动辄 5 MB）塞进请求里烧积分。 */
  function compress(f) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var max = 1280;
          var w = im.width, h = im.height;
          var scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var cv = document.createElement("canvas");
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(im, 0, 0, cw, ch);
          resolve(cv.toDataURL("image/jpeg", 0.82));
        };
        im.onerror = function () { reject(new Error("图片读不出来，换一张试试。")); };
        im.src = fr.result;
      };
      fr.onerror = function () { reject(new Error("图片读不出来，换一张试试。")); };
      fr.readAsDataURL(f);
    });
  }

  /* ================= 自动识别：大模型读图 =================
     模型怎么挑：先问云端有哪些模型，挑**支持读图**且没被禁用的里面最便宜的
     （目录里 glm-5.3-flash 是 x0.06，比 auto 便宜一个数量级）。
     目录是空的 / 一个能读图的都没有 → 直接告诉学生手动填，不要硬来。 */
  var OCR_SYSTEM =
    "你是一个从志愿者服务证明图片里提取信息的助手。" +
    "只输出一个 JSON 对象，不要解释、不要代码块、不要多余文字。" +
    "看不清或图里没有的字段一律给空字符串（小时数给 0），绝对不要编造。";

  var OCR_PROMPT =
    "读这张义工/志愿服务证明图片，提取下面这些字段：\n" +
    '{"student_name":"志愿者姓名","org_name":"出具证明的机构名称","activity_name":"做了什么服务",' +
    '"service_date":"服务日期，YYYY-MM-DD 格式","hours":服务小时数，只给数字}\n' +
    "注意：hours 只填数字（可以是小数），不要写单位；日期尽量精确到日，只有年月就补 01 号。";

  function pickVisionModel(models) {
    var list = (models || []).filter(function (m) {
      return m && m.id && m.disabled !== true && m.supportsImages === true;
    });
    if (!list.length) return null;
    /* 最便宜优先：目录里带 credits 的形如 "x0.06" / "x0.06 credits" */
    function cost(m) {
      var s = String(m.credits || "");
      var n = parseFloat(s.replace(/[^0-9.]/g, ""));
      return isNaN(n) ? 999 : n;
    }
    var prefer = list.filter(function (m) { return m.id === "glm-5.3-flash"; })[0];
    if (prefer) return prefer;
    list.sort(function (a, b) { return cost(a) - cost(b); });
    return list[0];
  }

  /* 从模型回话里抠出第一个 JSON 对象 —— 模型偶尔会在前后加一句废话 */
  function parseJSONish(text) {
    var s = String(text || "").trim();
    s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  function runOcr() {
    if (!file) return;
    if (!C || !C.llm) {
      alertIn($("ext-alerts"), "error", "云服务没连上，识别用不了 —— 下面的内容你自己填就行，不影响提交。");
      return;
    }
    busyOn(ocrBtn, "正在识别…");
    $("ext-ocr-note").textContent = "正在读图，通常几秒钟…";

    compress(file).then(function (dataUrl) {
      return C.llmModels().then(function (models) {
        /* models.list() 直接回数组（不是 { data } 包一层）—— 实测确认过 */
        var list = Object.prototype.toString.call(models) === "[object Array]"
          ? models : ((models && models.data) || []);
        var model = pickVisionModel(list);
        if (!model) throw new Error("NO_VISION_MODEL");

        /* ⚠️ create() **不是** Promise —— 它返回一个带 [Symbol.asyncIterator] 的流对象。
           第一次按 Promise 写（.then(...)）直接抛
           "create(...).then is not a function"。只能手动 next() 往下读。 */
        var stream = C.llm.chat.completions.create({
          model: model.id,
          messages: [
            { role: "system", content: OCR_SYSTEM },
            {
              role: "user",
              content: [
                { type: "text", text: OCR_PROMPT },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          stream: true,
          temperature: 0.2
        });

        var it = stream && stream[Symbol.asyncIterator] ? stream[Symbol.asyncIterator]() : null;
        if (!it) throw new Error("STREAM_NOT_ITERABLE");

        var acc = { text: "", credit: null, model: model.id };
        function step() {
          return it.next().then(function (r) {
            if (r.done) return acc;
            var ch = r.value;
            var d = ch && ch.choices && ch.choices[0] && ch.choices[0].delta;
            if (d && d.content) acc.text += d.content;
            /* 最后一个 chunk 带上 usage，里面的 credit 就是这次调用实际花的积分 */
            if (ch && ch.usage && ch.usage.credit != null) acc.credit = ch.usage.credit;
            return step();
          });
        }
        return step();
      });
    }).then(function (r) {
      busyOff(ocrBtn);
      var data = parseJSONish(r.text);
      if (!data) {
        $("ext-ocr-note").textContent = "没能认出这张图上的信息 —— 麻烦你自己在下面填一遍。";
        return;
      }
      var filled = [];
      function set(id, val) {
        if (val == null || val === "") return;
        var el = $(id);
        if (!el || el.value) return;   /* 学生已经填过的不覆盖 */
        el.value = String(val);
        filled.push(id);
      }
      set("ext-name", data.student_name);
      set("ext-org", data.org_name);
      set("ext-title", data.activity_name);
      if (data.service_date && /^\d{4}-\d{2}(-\d{2})?$/.test(String(data.service_date))) {
        var d = String(data.service_date);
        if (d.length === 7) d += "-01";
        set("ext-date", d);
      }
      var h = Number(data.hours);
      if (!isNaN(h) && h > 0) set("ext-hours", String(h));

      $("ext-ocr-note").textContent = filled.length
        ? "已帮你填好 " + filled.length + " 项，请核对一下（尤其是小时数）" +
          (r.credit != null ? " · 本次识别花 " + r.credit + " 积分" : "") + "。"
        : "图上没找到可填的信息，麻烦你自己填一遍" +
          (r.credit != null ? " · 本次识别花 " + r.credit + " 积分" : "") + "。";
    }).catch(function (err) {
      busyOff(ocrBtn);
      var msg = (err && err.message) || "";
      if (msg === "NO_VISION_MODEL") {
        $("ext-ocr-note").textContent = "当前没有可用「读图」的模型，请手动填写下面的内容。";
      } else {
        $("ext-ocr-note").textContent = "识别没成功（" + (msg || "请稍后再试") + "）—— 不影响提交，你自己填就行。";
      }
    });
  }
  if (ocrBtn) ocrBtn.addEventListener("click", runOcr);

  /* ================= 提交 ================= */
  var submitting = false;   /* 手抖连点 / 网络慢时再点一下，都只会有一条申请 */

  function submit() {
    if (submitting) return;
    submitting = true;
    var org = ($("ext-org").value || "").trim();
    var title = ($("ext-title").value || "").trim();
    var hours = parseFloat($("ext-hours").value);

    /* 校验没过的分支也要把锁松开，不然改完再点就没反应了 */
    function stop(msg) {
      submitting = false;
      alertIn($("ext-alerts"), "error", msg);
    }
    if (!file) { stop("请先上传义工证明图片 —— 没有证明审核不了。"); return; }
    if (!org) { stop("请填写机构名称。"); return; }
    if (!title) { stop("请填写你做了什么服务。"); return; }
    if (isNaN(hours) || hours <= 0) { stop("服务小时数要填一个大于 0 的数字。"); return; }

    /* 云存储的路径要拿 uid 拼，uid 空了会抛一句谁也看不懂的
       CloudStoragePathError —— 这里提前拦住，让他重新登录。 */
    if (!ME.id) {
      stop("登录状态没读到，请退出后重新登录再提交。");
      return;
    }

    var btn = $("ext-submit");
    busyOn(btn, "正在提交…");
    clear($("ext-alerts"));

    var payload = {
      student_email: ME.email,
      student_name: ($("ext-name").value || "").trim() || null,
      org_name: org,
      activity_name: title,
      service_date: $("ext-date").value || null,
      hours: hours,
      note: ($("ext-note").value || "").trim() || null,
      status: "pending"
    };

    /* 先传图，拿到路径再写库 —— 图传失败了就别落一条没证明的申请 */
    C.uploadProof(file, ME.id).then(function (res) {
      var err = res && res.error;
      if (err) throw new Error((err && err.message) || "图片上传失败");
      proofPath = (res.data && res.data.path) || "";
      payload.proof_path = proofPath;
      return C.submitExternal(payload);
    }).then(function (res) {
      busyOff(btn);
      submitting = false;
      /* ⚠️ 把 PostgREST 的 code 带上（23505 = 重复申请），
         只 new Error(message) 会把 code 丢掉，前端就分不清是哪一种失败了。 */
      if (res && res.error) {
        var e2 = new Error(res.error.message || "提交失败");
        e2.code = res.error.code;
        throw e2;
      }
      alertIn($("ext-alerts"), "ok",
        "已提交，等着组织成员审核。<b>审核通过后会并进你的累计义工小时</b>，驳回时也能看到原因。");
      resetForm();
      loadMine();
    }).catch(function (err) {
      busyOff(btn);
      submitting = false;
      /* 23505 = 撞了 uq_extreq_pending：同一学生同样内容的申请还在待审。
         这是数据库的最后一道闸 —— 前端那把 submitting 锁只能挡住同一个页面里的连点，
         挡不住别的标签页 / 上一次没关干净的浏览器。 */
      /* ⚠️ 别只信 err.code：实测 PostgREST 有时不把 code 带回来，只有一句
         duplicate key value violates unique constraint "uq_extreq_pending"。
         所以 code 和报错文本一起看，两条路都能认出来。 */
      var dup = (err && err.code === "23505") ||
        /duplicate key value violates unique constraint/i.test((err && err.message) || "");
      if (dup) {
        alertIn($("ext-alerts"), "error",
          "你已经提交过一条一模一样的申请了，还在等审核 —— 不用再交一次。");
        loadMine();
        return;
      }
      alertIn($("ext-alerts"), "error", "提交失败：" + ((err && err.message) || "请稍后重试"));
    });
  }
  var submitBtn = $("ext-submit");
  if (submitBtn) submitBtn.addEventListener("click", submit);

  function resetForm() {
    ["ext-name", "ext-org", "ext-title", "ext-date", "ext-hours", "ext-note"].forEach(function (id) {
      var el = $(id);
      if (el) el.value = "";
    });
    if (fileIn) fileIn.value = "";
    file = null;
    proofPath = "";
    $("ext-preview").hidden = true;
    if (ocrBtn) ocrBtn.disabled = true;
    $("ext-ocr-note").textContent = "选好图片后点这里，系统会试着把机构、活动、日期、小时数填进下面；填错的地方你自己改就行。";
  }
  var resetBtn = $("ext-reset");
  if (resetBtn) resetBtn.addEventListener("click", function () { resetForm(); clear($("ext-alerts")); });

  /* ================= 我提交过的申请 ================= */
  var ST = {
    pending: { cls: "st-pending", text: "待审核" },
    approved: { cls: "st-approved", text: "已通过" },
    rejected: { cls: "st-rejected", text: "已驳回" }
  };

  function loadMine() {
    var loading = $("ext-list-loading"), list = $("ext-list"), empty = $("ext-list-empty");
    loading.hidden = false; list.hidden = true; empty.hidden = true;
    C.myExternal().then(function (res) {
      var rows = C.unwrap(res, "读取失败") || [];
      loading.hidden = true;
      if (!rows.length) { empty.hidden = false; return; }
      list.hidden = false;
      list.innerHTML = rows.map(function (r) {
        var st = ST[r.status] || ST.pending;
        var when = r.service_date ? String(r.service_date).slice(0, 10) : "日期未填";
        return '<div class="act-item">' +
          '<div class="act-main">' +
            '<div class="act-title">' + esc(r.activity_name || "（未填活动内容）") + "</div>" +
            '<div class="act-sub">' + esc(r.org_name || "—") + " · " + when + " · " +
              Number(r.hours) + " 小时</div>" +
            (r.review_note ? '<div class="act-sub">审核意见：' + esc(r.review_note) + "</div>" : "") +
          "</div>" +
          '<div class="act-right">' +
            '<span class="st ' + st.cls + '">' + st.text + "</span>" +
          "</div>" +
        "</div>";
      }).join("");
    }).catch(function (err) {
      loading.hidden = true;
      empty.hidden = false;
      empty.textContent = "读取失败：" + ((err && err.message) || "请刷新重试");
    });
  }
  var refreshBtn = $("ext-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", loadMine);

  boot();
})();
