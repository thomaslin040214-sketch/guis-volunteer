/* ============================================================
   GUIS 义工组织 — 报名名单导出（正式名单模板）

   表格长这样：
     左上角 GUIS 横版 + V.A 双标志 ｜ 右侧大标题「义工组织官方人员导出名单」
     下面是活动名 + 记录数，再下面是深色表头 + 数据
     最后两行是落款：导出时间 / 经手人（当前登录账号）

   为什么要单独一个文件：模板逻辑一百多行，塞进 admin.html 太挤；
   拆出来之后本地也能直接跑它来验证（Node 里加载同一份代码）。

   降级链：ExcelJS（带完整的抬头与落款）→ SheetJS（纯数据）→ CSV（兜底）
   图片只有 ExcelJS 支持 —— SheetJS 社区版写不了 worksheet picture。
   ============================================================ */
(function (global) {
  "use strict";

  var BRAND = "9C2126";
  var TITLE = "义工组织官方人员导出名单";
  var SIGNER_NOTE = "义工组织后台导出账号";

  var LOGO_GUIS = "assets/logo/guis-logo-h.png";   /* GUIS 横版（红） */
  var LOGO_VA = "assets/logo/va-logo.png";         /* 义工社 VA 标志（红调，同款） */

  /* 导出字段：顺序必须与 admin.html 里 toRows() 造出来的键一致 */
  var COLS = [
    { t: "序号", w: 6 },
    { t: "姓名", w: 12 },
    { t: "邮箱", w: 26 },
    { t: "手机号", w: 16 },
    { t: "年级", w: 8 },
    { t: "课程体系", w: 12 },
    { t: "学号", w: 12 },
    { t: "岗位/时段", w: 22 },
    { t: "相关经验", w: 26 },
    { t: "备注", w: 24 },
    { t: "状态", w: 10 },
    { t: "报名时间", w: 18 }
  ];

  /* 行高（单位：磅）。1–2 行放标志与标题，3 行副标题，4 行细分隔，5 行表头 */
  var ROW_H = [34, 30, 22, 8, 26];
  var HDR_ROW = ROW_H.length;          /* 表头在第 5 行 */

  function colLetter(i) { return String.fromCharCode(65 + i); }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtNow(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function thinBorder(argb) {
    var b = { style: "thin", color: { argb: argb } };
    return { top: b, left: b, bottom: b, right: b };
  }

  /* ---------- 抬头双标志 ---------- */
  /* 先 fetch 成二进制再转成 blob: URL 喂给 <img>。
     直接用相对路径当 img.src 也能画，但那样画布可能被标记为"被污染"，
     toDataURL 就会抛 SecurityError（同一套代码在 file:// 下必然踩到）。
     blob: URL 是同源的，导出的画布永远干净。fetch 不可用时退回直接 src。 */
  function loadImage(src) {
    return fetchBytes(src).then(function (bytes) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("logo 解码失败")); };
        img.src = url;
      });
    }).catch(function () {
      /* 老浏览器没有 fetch，退回直接加载（同源 https 下同样不会污染画布） */
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error("logo 加载失败：" + src)); };
        img.src = src;
      });
    });
  }

  function fetchBytes(url) {
    if (typeof fetch !== "function") return Promise.reject(new Error("no fetch"));
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    });
  }

  /* 把 GUIS 横版和 VA 画到同一张画布上一次插入。
     好处：间距和相对大小能精确控制，不用去算 ExcelJS 那套「零起算小数行列」偏移。
     两者之间加一道细竖线 —— 和站点导航里「GUIS ｜ VA ｜ 义工社」的组合方式一致。
     VA 比校标略小一点，视觉上主次分明。 */
  function composeLockup() {
    var H = 44;              /* GUIS 横版高度 */
    var VH_VA = 38;          /* VA 略小，作为陪衬 */
    var PAD = 10, GAP = 12, RULE_W = 1, SCALE = 2;
    var RULE_COLOR = "#DCC9CA";

    return Promise.all([loadImage(LOGO_GUIS), loadImage(LOGO_VA)]).then(function (imgs) {
      var g = imgs[0], v = imgs[1];
      var gw = Math.round(g.naturalWidth * (H / g.naturalHeight));
      var vw = Math.round(v.naturalWidth * (VH_VA / v.naturalHeight));
      var W = PAD * 2 + gw + GAP + RULE_W + GAP + vw;
      var VH = H + PAD * 2;

      var cv = document.createElement("canvas");
      cv.width = W * SCALE;
      cv.height = VH * SCALE;
      var ctx = cv.getContext("2d");
      ctx.scale(SCALE, SCALE);
      ctx.drawImage(g, PAD, PAD, gw, H);

      var ruleX = PAD + gw + GAP;
      ctx.fillStyle = RULE_COLOR;
      ctx.fillRect(ruleX, PAD + 4, RULE_W, VH - PAD * 2 - 8);

      ctx.drawImage(v, ruleX + RULE_W + GAP, PAD + (H - VH_VA) / 2, vw, VH_VA);
      return { buffer: dataURLToBytes(cv.toDataURL("image/png")), width: W, height: VH };
    });
  }

  function dataURLToBytes(url) {
    var bin = atob(url.substring(url.indexOf(",") + 1));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- 建工作簿（纯逻辑，Node 里也能跑） ---------- */
  function buildWorkbook(opts) {
    var EJ = global.ExcelJS;
    var rows = opts.rows || [];
    var last = colLetter(COLS.length - 1);      /* L */

    var wb = new EJ.Workbook();
    wb.creator = opts.signer || SIGNER_NOTE;
    wb.created = new Date();

    var ws = wb.addWorksheet("报名名单", {
      views: [{ state: "frozen", ySplit: HDR_ROW }],   /* 表头以上冻结 */
      pageSetup: {                                     /* 横向铺满一页宽，便于打印 */
        orientation: "landscape", paperSize: 9,
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
      }
    });

    ws.columns = COLS.map(function (c) { return { width: c.w }; });
    ROW_H.forEach(function (h, i) { ws.getRow(i + 1).height = h; });

    /* 左上双标志 */
    if (opts.lockup) {
      var imgId = wb.addImage({ buffer: opts.lockup.buffer, extension: "png" });
      ws.addImage(imgId, {
        tl: { col: 0, row: 0 },
        ext: { width: opts.lockup.width, height: opts.lockup.height },
        editAs: "oneCell"
      });
    }

    /* 右侧大标题（跨 E 到最后一列） */
    ws.mergeCells("E1:" + last + "2");
    var title = ws.getCell("E1");
    title.value = TITLE;
    title.font = { size: 16, bold: true, color: { argb: "FF" + BRAND } };
    title.alignment = { horizontal: "right", vertical: "middle" };

    /* 副标题：活动 + 记录数 */
    ws.mergeCells("A3:" + last + "3");
    var sub = ws.getCell("A3");
    sub.value = "活动：" + (opts.activityTitle || "（未选择活动）") +
      "　·　共 " + rows.length + " 条报名记录";
    sub.font = { size: 10, color: { argb: "FF666666" } };
    sub.alignment = { vertical: "middle" };

    /* 表头 */
    var hr = ws.getRow(HDR_ROW);
    COLS.forEach(function (c, i) {
      var cell = hr.getCell(i + 1);
      cell.value = c.t;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder("FFD9C7C8");
    });
    hr.commit();

    /* 数据行（隔行浅色底，正文统一细边框） */
    rows.forEach(function (r, ri) {
      var row = ws.getRow(HDR_ROW + 1 + ri);
      COLS.forEach(function (c, i) {
        var cell = row.getCell(i + 1);
        var val = r[c.t];
        cell.value = (val == null || val === "") ? "" : val;
        cell.alignment = {
          vertical: "middle",
          horizontal: c.t === "序号" ? "center" : "left",
          wrapText: (c.t === "相关经验" || c.t === "备注")
        };
        cell.border = thinBorder("FFE6E6E6");
        if (ri % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF6F6" } };
        }
      });
      row.commit();
    });

    /* 落款：空一行，然后「导出时间」「经手人」 */
    var foot = HDR_ROW + 1 + rows.length + 1;
    putFoot(ws, foot, "导出时间：" + fmtNow());
    putFoot(ws, foot + 1, "经手人：" + (opts.signer || "未知账号") + "（" + SIGNER_NOTE + "）");

    return wb;
  }

  function putFoot(ws, rowNo, text) {
    var cell = ws.getCell("A" + rowNo);
    cell.value = text;
    cell.font = { size: 10, color: { argb: "FF555555" } };
    cell.alignment = { vertical: "middle" };
    ws.getRow(rowNo).height = 18;
  }

  /* ---------- 下载 ---------- */
  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* SheetJS 降级版：没有 ExcelJS 时至少导出一份列宽正常的纯数据表 */
  function plainXlsx(opts) {
    var X = global.XLSX;
    var ws = X.utils.json_to_sheet(opts.rows || []);
    ws["!cols"] = COLS.map(function (c) { return { wch: c.w }; });
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "报名名单");
    X.writeFile(wb, opts.fileName + ".xlsx");
  }

  function toCsv(opts) {
    var rows = opts.rows || [];
    if (!rows.length) return;
    var head = COLS.map(function (c) { return c.t; });
    var lines = [head].concat(rows.map(function (r) {
      return COLS.map(function (c) { return r[c.t] == null ? "" : String(r[c.t]); });
    }));
    var csv = lines.map(function (line) {
      return line.map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(",");
    }).join("\r\n");
    saveBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }), opts.fileName + ".csv");
  }

  /* ---------- 对外入口 ----------
     返回 Promise<string>：用的是哪条导出路径，交给 admin.html 决定提示文案。 */
  function run(opts) {
    if (global.ExcelJS) {
      /* 合成 logo 失败（比如图片被删了）也要能导出，只是没了抬头图案 */
      var lockup = composeLockup().catch(function () { return null; });
      return lockup.then(function (lock) {
        opts.lockup = lock;
        var wb = buildWorkbook(opts);
        return wb.xlsx.writeBuffer().then(function (buf) {
          saveBlob(new Blob([buf], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          }), opts.fileName + ".xlsx");
          return lock ? "template" : "template-nologo";
        });
      }).catch(function () {
        if (global.XLSX) { plainXlsx(opts); return "plain"; }
        toCsv(opts);
        return "csv";
      });
    }
    if (global.XLSX) { plainXlsx(opts); return Promise.resolve("plain"); }
    toCsv(opts);
    return Promise.resolve("csv");
  }

  global.GUISExport = {
    run: run,
    buildWorkbook: buildWorkbook,
    composeLockup: composeLockup,
    fmtNow: fmtNow,
    COLS: COLS,
    TITLE: TITLE
  };
})(typeof window !== "undefined" ? window : this);
