/* ============================================================
   GUIS 义工组织 — 最小 DOCX 打包器
   目的：在浏览器里凭空拼出一个能打开的 .docx，不引任何 CDN。

   为什么不用 JSZip：
   1. 站点已经尽量不依赖外网（vendor/ 里的库都是自托管的），多引一个包就多一处断网风险；
   2. 我们只做「新建」不做「改写」，不需要读 zip、不需要解压 ——
      省掉整个 inflate 依赖（DecompressionStream 也不是所有浏览器都有）。

   zip 里全部条目用 STORE（method 0，不压缩）。Word / WPS / LibreOffice 都认，
   代价只是文件大一点 —— 一份证明本来也就几十 KB。

   ⚠️ 两个容易写错的地方：
     · general purpose flag 必须带 0x0800（UTF-8 文件名），否则中文文件名乱码；
     · CRC-32 只按未压缩的原始字节算，压缩前后一致（STORE 下就是原样）。
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------- CRC-32（zip 规范用的那个多项式 0xEDB88320） ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (global.TextEncoder) return new TextEncoder().encode(str);
    /* 老浏览器兜底（这个站点支持到的下限其实用不上，但留着不亏） */
    var esc = unescape(encodeURIComponent(str));
    var out = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
    return out;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return utf8(String(data));
  }

  /* ---------- 小工具：按小端写整数 ---------- */
  function Writer() { this.parts = []; this.len = 0; }
  Writer.prototype.raw = function (bytes) { this.parts.push(bytes); this.len += bytes.length; return this; };
  Writer.prototype.u16 = function (v) {
    return this.raw(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]));
  };
  Writer.prototype.u32 = function (v) {
    v = v >>> 0;
    return this.raw(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]));
  };
  Writer.prototype.bytes = function () {
    var out = new Uint8Array(this.len), off = 0;
    for (var i = 0; i < this.parts.length; i++) { out.set(this.parts[i], off); off += this.parts[i].length; }
    return out;
  };

  /* ---------- DOS 时间戳 ----------
     zip 用的是 1980 纪元的 DOS 格式。写当前时间即可，写错也不会打不开，
     只是资源管理器里显示的修改时间不对。 */
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  /* ---------- 打包 ----------
     files: [{ name: "word/document.xml", data: string | Uint8Array }, ...]
     返回 Blob（MIME 用 docx 的官方类型）。 */
  function zip(files) {
    var now = new Date();
    var time = dosTime(now), date = dosDate(now);
    var local = new Writer(), central = new Writer(), offset = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = toBytes(f.data);
      var crc = crc32(data);

      /* 本地文件头 */
      var lh = new Writer();
      lh.u32(0x04034B50).u16(20).u16(0x0800).u16(0)      /* 0x0800 = 文件名是 UTF-8 */
        .u16(time).u16(date).u32(crc).u32(data.length).u32(data.length)
        .u16(name.length).u16(0).raw(name);
      local.raw(lh.bytes()).raw(data);

      /* 中央目录项 */
      central.u32(0x02014B50).u16(20).u16(20).u16(0x0800).u16(0)
        .u16(time).u16(date).u32(crc).u32(data.length).u32(data.length)
        .u16(name.length).u16(0).u16(0)                  /* 无 extra、无 comment */
        .u16(0)                                          /* 起始磁盘号 */
        .u16(0)                                          /* 内部属性 */
        .u32(0)                                          /* 外部属性 */
        .u32(offset).raw(name);

      offset += lh.bytes().length + data.length;         /* 下一个本地头的偏移 */
    });

    var localBytes = local.bytes(), centralBytes = central.bytes();
    var end = new Writer();
    end.u32(0x06054B50).u16(0).u16(0)
      .u16(files.length).u16(files.length)
      .u32(centralBytes.length).u32(localBytes.length)
      .u16(0);                                           /* 无 zip 注释 */

    return new Blob([localBytes, centralBytes, end.bytes()], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }

  /* ---------- 把一个 Blob 存到下载目录 ----------
     用 Object URL + 一个临时的 <a download>。记得 revoke，否则整页期间都占着内存。 */
  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      URL.revokeObjectURL(url);
    }, 1500);
  }

  global.GUISDocx = { zip: zip, save: save, crc32: crc32, utf8: utf8 };
})(window);
