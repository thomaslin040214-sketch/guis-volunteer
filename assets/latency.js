/* 顶栏状态簇：自动识别地区（按浏览器时区）+ 实时延迟（探测静态资源往返）。
   注入到 .nav-right（无则追加到 nav），与试点横幅分离，不会叠在一起。
   零后端成本：延迟探测只 GET 一个 0 字节的 assets/ping.txt，不写任何数据。 */
(function () {
  // 根据浏览器时区推断「国家/地区 + 城市」+ UTC 偏移。
  // 所有时区都会带上国家/地区前缀，避免海外用户只看到裸城市名而“看不见自己所在城市”。
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

      // IANA 时区 -> [国家/地区前缀, 城市中文名]
      // 中国内地只有 Asia/Shanghai 一个时区，无法靠时区区分省份，故统一显示「中国 · 城市」。
      var map = {
        "Asia/Shanghai":       ["中国", "上海"],
        "Asia/Hong_Kong":      ["中国", "香港"],
        "Asia/Macau":          ["中国", "澳门"],
        "Asia/Taipei":         ["中国", "台北"],
        "Asia/Urumqi":         ["中国", "乌鲁木齐"],
        "Asia/Chongqing":      ["中国", "重庆"],
        "Asia/Harbin":         ["中国", "哈尔滨"],
        "Asia/Kashgar":        ["中国", "喀什"],
        "Australia/Sydney":    ["澳洲", "悉尼"],
        "Australia/Melbourne": ["澳洲", "墨尔本"],
        "Australia/Brisbane":  ["澳洲", "布里斯班"],
        "Australia/Perth":     ["澳洲", "珀斯"],
        "Australia/Adelaide":  ["澳洲", "阿德莱德"],
        "Australia/Darwin":    ["澳洲", "达尔文"],
        "America/New_York":    ["美国", "纽约"],
        "America/Los_Angeles": ["美国", "洛杉矶"],
        "America/Chicago":     ["美国", "芝加哥"],
        "America/Denver":      ["美国", "丹佛"],
        "America/Anchorage":   ["美国", "安克雷奇"],
        "America/Toronto":     ["加拿大", "多伦多"],
        "America/Vancouver":   ["加拿大", "温哥华"],
        "America/Mexico_City": ["墨西哥", "墨西哥城"],
        "Europe/London":       ["英国", "伦敦"],
        "Europe/Paris":        ["法国", "巴黎"],
        "Europe/Berlin":       ["德国", "柏林"],
        "Europe/Moscow":       ["俄罗斯", "莫斯科"],
        "Europe/Madrid":       ["西班牙", "马德里"],
        "Asia/Tokyo":          ["日本", "东京"],
        "Asia/Seoul":          ["韩国", "首尔"],
        "Asia/Singapore":      ["新加坡", "新加坡"],
        "Asia/Kuala_Lumpur":   ["马来西亚", "吉隆坡"],
        "Asia/Bangkok":        ["泰国", "曼谷"],
        "Asia/Dubai":          ["阿联酋", "迪拜"],
        "Asia/Jakarta":        ["印尼", "雅加达"],
        "Asia/Manila":         ["菲律宾", "马尼拉"],
        "Asia/Mumbai":         ["印度", "孟买"],
        "Pacific/Auckland":    ["新西兰", "奥克兰"]
      };

      var entry = map[tz];
      if (!entry) {
        // 兜底：解析 IANA 路径，至少带“洲/国家”前缀 + 城市原文，绝不再出现裸城市名
        var segs = tz.split("/");
        var cityRaw = segs[segs.length - 1].replace(/_/g, " ");
        var contMap = {
          "Australia": "澳洲", "America": "美洲", "Europe": "欧洲",
          "Asia": "亚洲", "Africa": "非洲", "Pacific": "太平洋", "Antarctica": "南极"
        };
        var prefix = contMap[segs[0]] || segs[0];
        entry = [prefix, cityRaw];
      }
      return entry[0] + " · " + entry[1] + (off ? " " + off : "");
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
