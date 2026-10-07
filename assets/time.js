/* time.js —— 全站统一的「中国标准时间」处理。
   为什么需要这个文件（2026-10-07）：

   站点维护者在澳洲悉尼，主要用户在中国大陆。这两件事凑在一起会出问题：
   库里存的 16:40 读出来 —— 数据库时区是 PRC，会渲染成 `+08:00`（对的），
   但悉尼的浏览器 `getHours()` 读到的是 19:40（错的，多 3 小时）。
   于是「同一条数据，维护者看到的和学生看到的不一样」，
   而保存时如果又按悉尼墙上时间去算，存进去的就是 16:40 悉尼时间 = 13:40 北京时间。

   ⚠️ 一个容易搞反的前提：**写侧不用改。**
     前端写库用 `new Date(...).toISOString()`，那是「瞬时值」（UTC 表示），
     语义正确 —— 2026-10-07T08:40:00Z 就是 16:40 北京时间这个瞬间。
     PostgREST 读回来时会按数据库会话时区（本项目是 PRC = +08:00）渲染，
     又是对的。**所以要改的只有「读墙上时间」这一半。**

   本模块提供三件事：
     nowCst()        —— 「现在」的东八区墙上时间，替代裸 new Date()
     wallOf(date)    —— 把一个 Date 换算成东八区的 {年月日时分}
     partsOf(date)   —— 同上，但用 Date.UTC 做载体（不新建 Date，省一次解析）
   读侧一律改用这里的取字段方式，写侧继续用 toISOString()。

   固定 +08:00 而不是用「Asia/Shanghai」时区名：
   中国自 1991 年起不再用夏令时，+08:00 恒定，历史上也不会有 DST 切换导致的时间跳变。 */

(function () {
  "use strict";

  /* 站点统一时区。中国全境单一时区，固定 +08:00（无夏令时）。 */
  var OFFSET_MIN = 8 * 60;      /* 东八区相对 UTC 的分钟数 */
  var OFFSET_MS = OFFSET_MIN * 60 * 1000;

  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

  /* 墙上时间字段。用 UTC 做载体只是「借个地方放数字」，
     真正的语义是「东八区墙上时间」，所以字段名照常叫 y/m/d/h/min。 */
  function wall(d) {
    var t = new Date(d.getTime() + OFFSET_MS);
    return {
      y: t.getUTCFullYear(),
      m: t.getUTCMonth() + 1,
      d: t.getUTCDate(),
      h: t.getUTCHours(),
      min: t.getUTCMinutes(),
      s: t.getUTCSeconds(),
      dow: t.getUTCDay()          /* 0=周日 */
    };
  }

  /* 现在的东八区墙上时间。用来代替裸的 new Date() 取年月日时分。 */
  function nowCst() { return wall(new Date()); }

  /* "2026-10-07" —— 「今天」的标准写法。 */
  function todayYmd() {
    var w = nowCst();
    return w.y + "-" + pad2(w.m) + "-" + pad2(w.d);
  }

  /* "2026-10-07" —— 任意瞬间的东八区日期。 */
  function ymdOf(dateOrIso) {
    var d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
    if (isNaN(d.getTime())) return "";
    var w = wall(d);
    return w.y + "-" + pad2(w.m) + "-" + pad2(w.d);
  }

  /* "16:40" —— 任意瞬间的东八区时刻。 */
  function hmOf(dateOrIso) {
    var d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
    if (isNaN(d.getTime())) return "";
    var w = wall(d);
    return pad2(w.h) + ":" + pad2(w.min);
  }

  /* "2026-10-07 16:40" —— 后台里最常用的那个格式。 */
  function fmtDT(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var w = wall(d);
    return w.y + "-" + pad2(w.m) + "-" + pad2(w.d) + " " + pad2(w.h) + ":" + pad2(w.min);
  }

  /* "10月7日" —— 列表里配「全天」两个字用的短日期。 */
  function fmtMD(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var w = wall(d);
    return w.m + "月" + w.d + "日";
  }

  /* "2026-10-07T16:40" —— input type="datetime-local" 要的格式（也是文本框校验的格式）。 */
  function dtLocalValue(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var w = wall(d);
    return w.y + "-" + pad2(w.m) + "-" + pad2(w.d) + "T" + pad2(w.h) + ":" + pad2(w.min);
  }

  /* 反向：把「东八区墙上时间」字符串换成存库用的瞬时值（UTC 形式）。
     ⚠️ 这里必须显式带 +08:00 —— 直接 new Date("2026-10-07T16:40") 会被
     按浏览器本地时区解析，悉尼就变成「悉尼 16:40」了。 */
  function dtLocalToIso(v) {
    if (!v) return null;
    var s = String(v).trim().replace(" ", "T");
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return null;
    if (s.length === 10) s += "T00:00";
    if (s.length === 16) s += ":00";
    var d = new Date(s + "+08:00");
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /* "2026-10-07 16:40" → 上面那个函数认识。写个小工具给文本框用。 */
  function normalizeDtText(v) {
    if (!v) return "";
    return String(v).trim().replace("T", " ");
  }

  /* 「今天」是星期几（0=周日），用来给日历打标。 */
  function todayDow() { return nowCst().dow; }

  /* 一周几天的中文短名，按东八区那天算。 */
  var DOW_CN = ["日", "一", "二", "三", "四", "五", "六"];
  var DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function dowOf(ymd) {
    var d = new Date(String(ymd) + "T12:00:00+08:00");
    if (isNaN(d.getTime())) return "";
    return DOW_CN[d.getUTCDay()];
  }
  function dowEnOf(ymd) {
    var d = new Date(String(ymd) + "T12:00:00+08:00");
    if (isNaN(d.getTime())) return "";
    return DOW_EN[d.getUTCDay()];
  }

  /* 从任意瞬间取东八区年月日（用于「现在是几点」这类判断） */
  function hmOfNow() { var w = nowCst(); return pad2(w.h) + ":" + pad2(w.min); }
  function minutesNow() { var w = nowCst(); return w.h * 60 + w.min; }

  /* 「北京时间」的英文说法，用于界面提示。 */
  function zoneLabel() { return "北京时间"; }
  function zoneLabelEn() { return "Beijing time (UTC+8)"; }

  window.GUISTime = {
    OFFSET_MIN: OFFSET_MIN,
    OFFSET_MS: OFFSET_MS,
    pad2: pad2,
    wall: wall,
    nowCst: nowCst,
    todayYmd: todayYmd,
    ymdOf: ymdOf,
    hmOf: hmOf,
    fmtDT: fmtDT,
    fmtMD: fmtMD,
    dtLocalValue: dtLocalValue,
    dtLocalToIso: dtLocalToIso,
    normalizeDtText: normalizeDtText,
    todayDow: todayDow,
    dowOf: dowOf,
    dowEnOf: dowEnOf,
    hmOfNow: hmOfNow,
    minutesNow: minutesNow,
    zoneLabel: zoneLabel,
    zoneLabelEn: zoneLabelEn,
    DOW_CN: DOW_CN,
    DOW_EN: DOW_EN,
    MON_EN: MON_EN
  };
})();
