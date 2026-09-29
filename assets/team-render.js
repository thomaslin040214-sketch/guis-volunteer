/* ============================================================================
   GUIS 义工组织 —— 部门成员 & 管理层 渲染
   读取 window.GUIS_TEAM（assets/team.js），把数据渲染到首页 #dept-list / #lead-list。
   无需改动本文件；所有内容都在 assets/team.js 里编辑。
   ============================================================================ */
(function () {
  "use strict";

  function t(key, fallback) {
    var lang = (document.documentElement.lang === "en") ? "en" : "zh";
    var pack = (window.SITE_I18N && window.SITE_I18N[lang]) || {};
    return pack[key] != null ? pack[key] : (fallback != null ? fallback : key);
  }
  // 取某人/某条记录的中英文字段：当前语言优先，英文缺省回退中文
  function L(o, k) {
    if (!o) return "";
    var lang = (document.documentElement.lang === "en") ? "en" : "zh";
    if (lang === "en") return (o[k + "_en"] != null && o[k + "_en"] !== "") ? o[k + "_en"] : (o[k] != null ? o[k] : "");
    return (o[k] != null) ? o[k] : (o[k + "_en"] != null ? o[k + "_en"] : "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initial(name) {
    var n = String(name || "").trim();
    return n ? n.charAt(0) : "？";
  }
  function avatarHTML(person) {
    var av = person && person.avatar ? esc(person.avatar) : "";
    var ini = esc(initial(person ? person.name : ""));
    if (av) {
      return '<div class="avatar"><img src="' + av + '" alt="" loading="lazy" ' +
        'onerror="this.remove()">' + ini + "</div>";
    }
    return '<div class="avatar">' + ini + "</div>";
  }

  /* 一张带履历的成员卡（部长 / 管理层 / 管理层里的部长引用） */
  function memberCard(person) {
    var items = (person.resume || []).map(function (it) {
      return '<div class="cv-item">' +
        '<div class="cv-when">' + esc(L(it, "when")) + "</div>" +
        '<div class="cv-what">' + esc(L(it, "what")) + "</div>" +
        '<div class="cv-note">' + esc(L(it, "note")) + "</div>" +
      "</div>";
    }).join("");

    var factsHTML = (person.facts && person.facts.length)
      ? '<div class="cv-facts">' + person.facts.map(function (f) { return '<span class="cv-fact">' + esc(f) + "</span>"; }).join("") + "</div>"
      : "";

    return '<article class="member reveal">' +
      '<div class="member-top">' +
        avatarHTML(person) +
        '<div class="member-id">' +
          '<div class="member-name">' + esc(L(person, "name")) + "</div>" +
          '<div class="member-role">' + esc(L(person, "role")) + "</div>" +
          '<div class="member-meta">' + esc(L(person, "join")) + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="cv">' +
        '<button class="cv-head" type="button" aria-expanded="false">' +
          '<span class="cv-label">' + esc(t("ui.cv", "查看履历")) + "</span>" +
          '<span class="cv-caret" aria-hidden="true"></span>' +
        "</button>" +
        '<div class="cv-body">' +
          '<div class="cv-inner">' +
            (items ? '<div class="cv-timeline">' + items + "</div>" : "") +
            factsHTML +
          "</div>" +
        "</div>" +
      "</div>" +
    "</article>";
  }

  /* 部员小卡（无履历） */
  function miniCard(person) {
    return '<div class="mmini reveal">' +
      avatarHTML(person) +
      '<div class="member-id">' +
        '<div class="member-name">' + esc(L(person, "name")) + "</div>" +
        '<div class="member-meta">' + esc(L(person, "join")) + "</div>" +
      "</div>" +
    "</div>";
  }

  function render() {
    var data = window.GUIS_TEAM;
    if (!data) return;

    var deptRoot = document.getElementById("dept-list");
    var leadRoot = document.getElementById("lead-list");
    if (!deptRoot || !leadRoot) return;

    // 部门架构图
    deptRoot.innerHTML = (data.departments || []).map(function (dep) {
      var head = dep.head || {};
      var members = (dep.members || []).map(miniCard).join("");
      return '<div class="dept">' +
        '<h4 class="dept-name">' + esc(L(dep, "name")) +
          ' <span class="dept-name-en">' + esc(L(dep, "name_en")) + "</span></h4>" +
        '<div class="org-chart">' +
          '<div class="org-node org-head-wrap">' + memberCard(head) + "</div>" +
          '<div class="org-connector" aria-hidden="true"></div>' +
          '<div class="dept-members">' + members + "</div>" +
        "</div>" +
      "</div>";
    }).join("");

    // 管理层：解析 headRef 引用部门部长
    var byId = {};
    (data.departments || []).forEach(function (d) { byId[d.id] = d; });
    leadRoot.innerHTML = (data.leadership || []).map(function (p) {
      var person = p.headRef ? (byId[p.headRef] && byId[p.headRef].head) : p;
      // 若引用的是部门部长，给角色补上部门前缀，更清楚
      if (p.headRef && person) {
        person = Object.assign({}, person, {
          role: L(byId[p.headRef], "name") + " · " + L(person, "role"),
          role_en: L(byId[p.headRef], "name_en") + " · " + L(person, "role_en")
        });
      }
      return memberCard(person);
    }).join("");

    wireAccordions();
  }

  /* 折叠履历：为新生成的 .cv-head 绑定点击，并在展开时量高 */
  function wireAccordions() {
    document.querySelectorAll("#dept-list .cv-head, #lead-list .cv-head").forEach(function (head) {
      if (head.dataset.bound) return;
      head.dataset.bound = "1";
      var item = head.closest(".member");
      if (!item) return;
      var body = item.querySelector(".cv-body");
      head.addEventListener("click", function () {
        var open = !item.classList.contains("is-open");
        item.classList.toggle("is-open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
        var label = head.querySelector(".cv-label");
        if (label) label.textContent = open ? t("ui.cvHide", "收起履历") : t("ui.cv", "查看履历");
        if (open) {
          body.style.maxHeight = body.scrollHeight + "px";
          body.addEventListener("transitionend", function te(e) {
            if (e.propertyName === "max-height" && item.classList.contains("is-open")) {
              body.style.maxHeight = "none";
            }
            body.removeEventListener("transitionend", te);
          });
        } else {
          // 先固定当前高度再归零，才有收起动画
          body.style.maxHeight = body.scrollHeight + "px";
          void body.offsetHeight;
          body.style.maxHeight = "0px";
        }
      });
    });
  }

  // 首次渲染 + 语言切换时重渲染（让中英文履历同步）
  document.addEventListener("DOMContentLoaded", function () {
    if (!window.GUIS_TEAM) return;
    render();
    var last = document.documentElement.lang;
    Array.prototype.forEach.call(document.querySelectorAll(".lang-btn"), function (b) {
      b.addEventListener("click", function () {
        setTimeout(function () {
          if (document.documentElement.lang !== last) { last = document.documentElement.lang; render(); }
        }, 60);
      });
    });
  });
})();
