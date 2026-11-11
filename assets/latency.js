/* 顶栏状态簇：自动识别地区（按浏览器时区）+ 实时延迟（探测静态资源往返）。
   注入到 .nav-right（无则追加到 nav），与试点横幅分离，不会叠在一起。
   零后端成本：延迟探测只 GET 一个 0 字节的 assets/ping.txt，不写任何数据。 */
(function () {
  // 根据浏览器时区推断城市/地区 + UTC 偏移
  function detectRegion() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      var off = "";
      try {
        var parts = new Intl.DateTimeFormat("zh-CN", {
          timeZone: tz, timeZoneName: "shortOffset"
        }).formatToParts(new Date());
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === "timeZoneName") off = parts[i].value;
        }
      } catch (e) {}
      var city = tz.split("/").pop().replace(/_/g, " ");
      // 常见时区 -> 友好城市名（同属 UTC+8 的广州/上海无法靠时区区分，这里按 IANA 代表城市显示）
      var map = {
        "Shanghai": "中国 · 上海", "Beijing": "中国 · 北京", "Guangzhou": "中国 · 广州",
        "Hong Kong": "中国 · 香港", "Sydney": "澳大利亚 · 悉尼", "Perth": "澳大利亚 · 珀斯",
        "New York": "美国 · 纽约", "Los Angeles": "美国 · 洛杉矶", "Chicago": "美国 · 芝加哥",
        "London": "英国 · 伦敦", "Tokyo": "日本 · 东京", "Singapore": "新加坡",
        "Kuala Lumpur": "马来西亚 · 吉隆坡", "Dubai": "阿联酋 · 迪拜", "Paris": "法国 · 巴黎"
      };
      var label = map[city] ? map[city] : city;
      return label + (off ? " " + off : "");
    } catch (e) { return "地区未知"; }
  }

  function mount() {
    var nav = document.querySelector("nav");
    var host = document.querySelector(".nav-right") || nav;
    if (!host) return;

    var cluster = document.createElement("span");
    cluster.className = "status-cluster";
    cluster.innerHTML =
      '<span class="region-badge" title="根据浏览器时区自动识别">' +
        '<span class="region-dot"></span>' +
        '<span class="region-text">定位中…</span>' +
      '</span>' +
      '<span class="latency-badge is-ok" role="status" aria-live="polite" title="实时网络延迟：探测本站点往返耗时">' +
        '<span class="latency-dot"></span>' +
        '<span class="latency-num">--</span>' +
        '<span class="latency-unit">ms</span>' +
      '</span>';

    if (host.classList.contains("nav-right")) host.insertBefore(cluster, host.firstChild);
    else host.appendChild(cluster);

    cluster.querySelector(".region-text").textContent = detectRegion();

    var badge = cluster.querySelector(".latency-badge");
    var numEl = cluster.querySelector(".latency-num");
    var unitEl = cluster.querySelector(".latency-unit");

    var running = false;
    function setClass(state) {
      badge.classList.remove("is-ok", "is-warn", "is-bad");
      badge.classList.add("is-" + state);
    }
    function measure() {
      if (running || document.hidden) return;
      running = true;
      var t0 = performance.now();
      var url = location.origin + "/assets/ping.txt?_t=" + Date.now();
      fetch(url, { method: "GET", cache: "no-store" })
        .then(function () {
          var ms = Math.round(performance.now() - t0);
          numEl.textContent = ms; unitEl.textContent = "ms";
          if (ms < 150) setClass("ok");
          else if (ms < 400) setClass("warn");
          else setClass("bad");
        })
        .catch(function () {
          numEl.textContent = "离线"; unitEl.textContent = ""; setClass("bad");
        })
        .then(function () { running = false; });
    }
    measure();
    setInterval(measure, 4000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) measure();
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
