/* table-import.js —— 把一个表格文件读成二维数组。
   后台两处导入共用：「人员管理」批量加人、「学生名单」导入名单。

   为什么要单独一个文件：
     Excel「另存为 CSV」出来的文件不一定是 UTF-8 —— 中文 Windows 上导出的是
     GB18030，直接当 UTF-8 读会整片乱码。这里先按 UTF-8 试解，发现替换字符
     （U+FFFD）比例偏高就换 GB18030 再解一次。
     .xlsx 是 zip 包，没法手写解析 —— 只在用户真的选了 Excel 文件时，
     才临时从 CDN 拉一份 SheetJS（加载一次就留在页面上，不重复拉）。

   对外只给 window.GUISImport：
     readAsTable(file) -> Promise<string[][]>   二维数组，已去空行、已剥表头
     decodeText / parseRows / guessDelim / looksHeader / textToRows 拆开给回归脚本单测 */
(function () {
  "use strict";

  var XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  var xlsxPromise = null;

  /* ---------- 编码 ---------- */

  function countBad(s) { return (s.match(/\uFFFD/g) || []).length; }

  function decodeText(buf) {
    var u8 = new Uint8Array(buf);
    /* UTF-8 BOM：Excel 导出的 CSV 常带，必须剥掉，否则第一列表头前面会粘个乱码 */
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      try { return new TextDecoder("utf-8").decode(u8.subarray(3)); } catch (e) {}
    }
    var utf8 = "";
    try { utf8 = new TextDecoder("utf-8").decode(u8); } catch (e) { return ""; }

    var bad = countBad(utf8);
    /* 整份 GB18030 被当 UTF-8 解时，坏字符会成片出现（比例远超 1%） */
    if (bad > 0 && bad / Math.max(utf8.length, 1) > 0.01) {
      try {
        var gb = new TextDecoder("gb18030").decode(u8);
        if (countBad(gb) < bad) return gb;
      } catch (e) {}
    }
    return utf8;
  }

  /* ---------- 按分隔符切成二维数组 ----------
     手写状态机而不是 split(",")：Excel 导出的 CSV 会把含逗号的内容
     用双引号包起来（例如备注「社区关怀组, 组长」），引号里的逗号不能当分隔符。 */

  function parseRows(text, d) {
    var rows = [];
    var row = [];
    var cur = "";
    var quoted = false;

    var flush = function () { row.push(cur); cur = ""; };

    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);

      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cur += '"'; i++; }
          else quoted = false;
        } else { cur += c; }
        continue;
      }

      if (c === '"' && cur === "") { quoted = true; continue; }
      if (c === d) { flush(); continue; }
      if (c === "\n") { flush(); rows.push(row); row = []; continue; }
      if (c === "\r") continue;               /* Windows 换行 */
      cur += c;
    }
    if (cur !== "" || row.length) { flush(); rows.push(row); }

    /* 收尾：每格 trim、整行全空丢掉 */
    var out = [];
    rows.forEach(function (r) {
      var cells = r.map(function (s) { return String(s == null ? "" : s).trim(); });
      if (cells.some(function (s) { return s !== ""; })) out.push(cells);
    });
    return out;
  }

  /* 猜分隔符：看第一行里哪个符号出现得多。
     Tab 通常是整列复制粘贴；逗号是标准 CSV；分号是部分地区 Excel 的默认；
     中文逗号排在最后 —— 只有整行都没英文符号时才轮得到它，
     免得把内容里的中文标点误当分隔符。 */
  function guessDelim(line) {
    var cands = ["\t", ",", ";", "|", "，"];
    var best = ",";
    var bestN = 0;
    cands.forEach(function (d) {
      var n = line.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  }

  function firstLine(text) {
    var i = text.indexOf("\n");
    return (i < 0 ? text : text.slice(0, i)).replace(/\r/g, "");
  }

  /* ---------- 表头识别 ----------
     复制粘贴 / 导出常常带着一行列名，认出来就丢掉，
     免得把「张三」当成一行数据写进库里。 */
  var HEAD_WORDS = ["邮箱", "邮件", "email", "e-mail", "姓名", "名字", "name", "角色", "备注", "学号", "va id", "年级", "英文名"];

  function looksHeader(cells) {
    var joined = cells.join(" ").toLowerCase();
    var hit = 0;
    HEAD_WORDS.forEach(function (w) { if (joined.indexOf(w) >= 0) hit++; });
    /* 至少认出两个词 —— 只认出一个的话，可能刚好只是某个人的名字里带了这些字 */
    return hit >= 2;
  }

  function stripHeader(rows) {
    if (rows.length && looksHeader(rows[0])) return rows.slice(1);
    return rows;
  }

  function textToRows(text) {
    return stripHeader(parseRows(text, guessDelim(firstLine(text))));
  }

  /* ---------- Excel ---------- */

  function isExcel(name) { return /\.(xlsx|xls|xlsm|xlsb|ods)$/i.test(name || ""); }

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = XLSX_URL;
      s.async = true;
      s.onload = function () {
        if (window.XLSX) resolve(window.XLSX);
        else reject(new Error("SheetJS 加载了但没挂上 XLSX"));
      };
      s.onerror = function () { reject(new Error("加载失败")); };
      document.head.appendChild(s);
      setTimeout(function () { reject(new Error("加载超时")); }, 15000);
    });
    return xlsxPromise;
  }

  /* ---------- 读文件 ---------- */

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === "undefined") { reject(new Error("这个浏览器读不了文件")); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("读文件失败")); };
      fr.readAsArrayBuffer(file);
    });
  }

  function readAsTable(file) {
    if (!file) return Promise.reject(new Error("没有选中文件"));

    if (isExcel(file.name)) {
      return readArrayBuffer(file)
        .then(function (buf) { return loadXlsx().then(function () { return buf; }); })
        .then(function (buf) {
          var wb = window.XLSX.read(new Uint8Array(buf), { type: "array" });
          var sheet = wb.Sheets[wb.SheetNames[0]];
          var grid = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
          var rows = grid.map(function (r) {
            return (r || []).map(function (c) { return String(c).trim(); });
          }).filter(function (r) {
            return r.some(function (c) { return c !== ""; });
          });
          return stripHeader(rows);
        });
    }

    return readArrayBuffer(file).then(function (buf) {
      return textToRows(decodeText(buf));
    });
  }

  window.GUISImport = {
    readAsTable: readAsTable,
    decodeText: decodeText,
    parseRows: parseRows,
    guessDelim: guessDelim,
    looksHeader: looksHeader,
    textToRows: textToRows,
    isExcel: isExcel
  };
})();
