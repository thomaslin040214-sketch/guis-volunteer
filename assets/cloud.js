/* ============================================================
   GUIS 义工社 — 云服务客户端（初始化一次，全站共用）
   依赖：assets/cloud-config.js + WorkBuddyCloud CDN SDK
   ============================================================ */
(function () {
  "use strict";

  var cfg = window.CLOUD_PUBLIC_CONFIG;
  if (!cfg || !cfg.endpoint || !cfg.publishableKey) {
    console.error("[GUIS Cloud] 缺少 publicConfig，请检查 assets/cloud-config.js");
    return;
  }

  var cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: cfg.endpoint,
    publishableKey: cfg.publishableKey
  });

  /* 把 { data, error } 转成 throw-on-error，调用点更干净 */
  function unwrap(res, fallbackMsg) {
    if (!res) throw new Error(fallbackMsg || "请求失败");
    if (res.error) {
      var e = new Error(res.error.message || fallbackMsg || "请求失败");
      e.code = res.error.code;
      e.raw = res.error;
      throw e;
    }
    return res.data;
  }

  /* 签到码兜底生成器。数据库里 check_token 已有默认值，
     这里只在「历史行刚好是空码」这种意外情况下补一个，正常路径用不到。 */
  function newToken() {
    var a = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    var s = "";
    for (var j = 0; j < a.length; j++) s += ("0" + a[j].toString(16)).slice(-2);
    return s.slice(0, 14);
  }

  var db = cloud.database;

  var api = {
    cloud: cloud,
    db: db,
    auth: cloud.auth,
    unwrap: unwrap,
    endpoint: cfg.endpoint,

    /* ---------- 会话 ---------- */
    getSession: function () {
      return cloud.auth.getSession();
    },

    /* ---------- 我是谁 ----------
       角色只有服务端说了算：allowed_admins 的读策略是 is_owner()，
       普通老师读不到自己那一行，所以走 my_access()（SECURITY DEFINER）。
       返回 role = owner（执委会）/ teacher（负责老师）/ student（学生）。 */
    myAccess: function () {
      return db.rpc("my_access");
    },
    touchLogin: function () {
      return db.rpc("touch_login");
    },

    /* ---------- 学生身份 ---------- */
    /* 开通前还没账号，是匿名调用，只能靠 SECURITY DEFINER 函数核对名单，
       并且只回 known / 姓名 / 年级，不泄漏整张表。 */
    checkStudentEmail: function (email) {
      return db.rpc("check_student_email", { p_email: email });
    },
    markStudentActivated: function () {
      return db.rpc("mark_student_activated");
    },
    /* 学生的义工记录：走 SECURITY DEFINER 函数拼好活动信息一次返回，
       免得给 registrations 再开一条「读自己」的策略。 */
    myService: function () {
      return db.rpc("my_service");
    },

    /* ---------- 活动 ---------- */
    listOpenActivities: function () {
      return db
        .from("activities")
        .select("id, title, summary, category, location, starts_at, ends_at, signup_deadline, capacity, status, notified_at, manager_email, hours, created_at")
        .eq("status", "open")
        .order("starts_at", { ascending: true, nullsFirst: false });
    },

    listMyActivities: function () {
      return db
        .from("activities")
        .select("id, title, summary, category, location, starts_at, ends_at, signup_deadline, capacity, contact, notes, status, notified_at, recap_html, archived, archived_at, manager_email, hours, created_at")
        .order("created_at", { ascending: false });
    },

    /* 活动负责人：单活动的指定优先，没有就用板块的默认负责人。
       category_managers 提供板块默认值，有效负责人 = COALESCE(单活动, 板块)。 */
    listCategoryManagers: function () {
      return db.from("category_managers").select("category, email, updated_at").order("category", { ascending: true });
    },

    setCategoryManager: function (category, email) {
      return db.from("category_managers").upsert(
        { category: category, email: email || null, updated_at: new Date().toISOString() },
        { onConflict: "category" }
      );
    },

    createActivity: function (payload) {
      return db.from("activities").insert(payload).select();
    },

    updateActivity: function (id, patch) {
      return db.from("activities").update(patch).eq("id", id).select();
    },

    deleteActivity: function (id) {
      return db.from("activities").delete().eq("id", id).select();
    },

    /* 后台把活动标成「已邮件通知」（看板上的红灯）。
       传 false 撤销 —— 撤销后回到按截止时间自动判定的绿 / 黄灯。 */
    setActivityNotified: function (id, notified) {
      return db
        .from("activities")
        .update({ notified_at: notified ? new Date().toISOString() : null })
        .eq("id", id)
        .select();
    },

    /* ---------- 报名 ---------- */
    /* 注意：这里故意不链 .select()。
       报名是匿名提交，插入后回读表示会受 registrations 的 SELECT 策略限制
       （匿名者读不到任何报名行），PostgREST 会报 42501。
       重复报名由 (activity_id, email) 唯一约束返回 23505 来识别。 */
    register: function (payload) {
      return db.from("registrations").insert(payload);
    },

    listRegistrations: function (activityId) {
      var q = db
        .from("registrations")
        .select("id, activity_id, name, email, phone, grade, programme, student_id, slot, experience, note, status, selected, selected_at, selected_by, check_token, checked_in, checked_in_at, checked_in_by, hours, created_at")
        .order("created_at", { ascending: true });
      if (activityId) q = q.eq("activity_id", activityId);
      return q;
    },

    /* 逐人覆盖义工小时。传 null 表示「用活动默认时长」。 */
    setHours: function (id, hours) {
      return db
        .from("registrations")
        .update({ hours: (hours === "" || hours == null) ? null : Number(hours) })
        .eq("id", id)
        .select("id, hours");
    },

    setRegistrationStatus: function (id, status) {
      return db.from("registrations").update({ status: status }).eq("id", id).select();
    },

    deleteRegistration: function (id) {
      return db.from("registrations").delete().eq("id", id).select();
    },

    /* ---------- 录取（报名成功）----------
       「选了谁」是一次整体决定，不是一条条改：
       先把这个活动下所有人清成未录取，再把勾选的人标成已录取。
       selected_by 记下经手人邮箱，活动详情页会显示是谁定的。 */
    clearSelection: function (activityId) {
      return db
        .from("registrations")
        .update({ selected: false, selected_at: null, selected_by: null })
        .eq("activity_id", activityId);
    },

    markSelected: function (ids, by) {
      if (!ids || !ids.length) return Promise.resolve({ data: [], error: null });
      return db
        .from("registrations")
        .update({ selected: true, selected_at: new Date().toISOString(), selected_by: by || null })
        .in("id", ids);
    },

    /* ---------- 签到 ----------
       签到码 check_token 由数据库默认生成（新行自动有），历史行已回填，
       所以前端原则上不用自己造码 —— 这里只在万一遇到空码时补一个。 */
    ensureCheckToken: function (id) {
      var tok = newToken();
      return db
        .from("registrations")
        .update({ check_token: tok })
        .eq("id", id)
        .select("id, check_token")
        .then(function (res) {
          var row = (res && res.data && res.data[0]) || null;
          return row ? row.check_token : tok;
        });
    },

    /* 按签到码找人：老师扫到码之后用。只有白名单管理员能读 registrations。 */
    findByCheckToken: function (token) {
      return db
        .from("registrations")
        .select("id, activity_id, name, email, phone, grade, programme, student_id, slot, status, selected, check_token, checked_in, checked_in_at, checked_in_by, created_at")
        .eq("check_token", token)
        .limit(1);
    },

    /* 打钩 / 取消打钩。on=false 时把时间和经手人一起清掉，不留半截状态。 */
    setCheckedIn: function (id, on, by) {
      return db
        .from("registrations")
        .update({
          checked_in: !!on,
          checked_in_at: on ? new Date().toISOString() : null,
          checked_in_by: on ? (by || null) : null
        })
        .eq("id", id)
        .select("id, checked_in, checked_in_at, checked_in_by");
    },

    /* ---------- 过往活动（归档）---------- */
    listArchivedActivities: function () {
      return db
        .from("activities")
        .select("id, title, summary, category, location, starts_at, ends_at, signup_deadline, capacity, contact, notes, status, notified_at, recap_html, archived, archived_at, manager_email, hours, created_at")
        .eq("archived", true)
        .order("starts_at", { ascending: false, nullsFirst: false });
    },

    getActivity: function (id) {
      return db
        .from("activities")
        .select("id, title, summary, category, location, starts_at, ends_at, signup_deadline, capacity, contact, notes, status, notified_at, recap_html, archived, archived_at, manager_email, hours, created_at")
        .eq("id", id)
        .limit(1);
    },

    setArchived: function (id, archived) {
      return db
        .from("activities")
        .update({ archived: !!archived, archived_at: archived ? new Date().toISOString() : null })
        .eq("id", id)
        .select();
    },

    setRecap: function (id, html) {
      return db.from("activities").update({ recap_html: html || null }).eq("id", id).select();
    },

    /* ---------- 刊物（文章）---------- */
    listArticles: function (onlyPublished) {
      var q = db
        .from("articles")
        .select("id, title, author, cover, excerpt, activity_id, status, published_at, created_at, updated_at")
        .order("published_at", { ascending: false, nullsFirst: false });
      if (onlyPublished) q = q.eq("status", "published");
      return q;
    },

    getArticle: function (id) {
      return db.from("articles").select("*").eq("id", id).limit(1);
    },

    createArticle: function (payload) {
      return db.from("articles").insert(payload).select();
    },

    updateArticle: function (id, patch) {
      return db.from("articles").update(patch).eq("id", id).select();
    },

    deleteArticle: function (id) {
      return db.from("articles").delete().eq("id", id).select();
    },

    /* ---------- 公告 ---------- */
    listAnnouncements: function (onlyPublished) {
      var q = db
        .from("announcements")
        .select("id, title, body_html, priority, status, published_at, created_at, updated_at")
        .order("published_at", { ascending: false, nullsFirst: false });
      if (onlyPublished) q = q.eq("status", "published");
      return q;
    },

    createAnnouncement: function (payload) {
      return db.from("announcements").insert(payload).select();
    },

    updateAnnouncement: function (id, patch) {
      return db.from("announcements").update(patch).eq("id", id).select();
    },

    deleteAnnouncement: function (id) {
      return db.from("announcements").delete().eq("id", id).select();
    },

    /* ---------- 后台白名单 ----------
       allowed_admins 是一张「仅服务端可见」的表（RLS 开启但没给任何人读权限），
       只能通过 is_allowed_admin() 这个 SECURITY DEFINER 函数间接判断。
       登录后先调 isAllowedAdmin()，不在名单里就立刻退出登录。 */
    isAllowedAdmin: function () {
      return db.rpc("is_allowed_admin");
    },
    isOwner: function () {
      return db.rpc("is_owner");
    },

    /* ---------- 人员管理（只有执委会能读能写）---------- */
    listMembers: function () {
      return db
        .from("allowed_admins")
        .select("email, note, role, is_student, must_change_password, last_login_at, created_at")
        .order("created_at", { ascending: true });
    },

    addMember: function (payload) {
      return db.from("allowed_admins").insert(payload).select();
    },

    updateMember: function (email, patch) {
      return db.from("allowed_admins").update(patch).eq("email", email).select();
    },

    removeMember: function (email) {
      return db.from("allowed_admins").delete().eq("email", email).select();
    },

    /* ---------- 学生名单（开通白名单）---------- */
    listStudents: function () {
      return db
        .from("student_directory")
        .select("email, name, grade, student_id, programme, activated, activated_at, created_at")
        .order("email", { ascending: true });
    },

    importStudents: function (rows) {
      if (!rows || !rows.length) return Promise.resolve({ data: [], error: null });
      /* upsert：重复导入同一份名单不会报错，只会把姓名年级刷新一遍 */
      return db.from("student_directory").upsert(rows, { onConflict: "email" }).select("email");
    },

    deleteStudent: function (email) {
      return db.from("student_directory").delete().eq("email", email).select("email");
    }
  };

  window.GUISCloud = api;
})();
