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

    /* ---------- 活动 ---------- */
    listOpenActivities: function () {
      return db
        .from("activities")
        .select("id, title, summary, category, location, starts_at, ends_at, signup_deadline, capacity, status, notified_at, created_at")
        .eq("status", "open")
        .order("starts_at", { ascending: true, nullsFirst: false });
    },

    listMyActivities: function () {
      return db
        .from("activities")
        .select("id, title, summary, category, location, starts_at, ends_at, signup_deadline, capacity, contact, notes, status, notified_at, created_at")
        .order("created_at", { ascending: false });
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
        .select("id, activity_id, name, email, phone, grade, programme, student_id, slot, experience, note, status, created_at")
        .order("created_at", { ascending: true });
      if (activityId) q = q.eq("activity_id", activityId);
      return q;
    },

    setRegistrationStatus: function (id, status) {
      return db.from("registrations").update({ status: status }).eq("id", id).select();
    },

    deleteRegistration: function (id) {
      return db.from("registrations").delete().eq("id", id).select();
    },

    /* ---------- 后台白名单 ----------
       allowed_admins 是一张「仅服务端可见」的表（RLS 开启但没给任何人读权限），
       只能通过 is_allowed_admin() 这个 SECURITY DEFINER 函数间接判断。
       登录后先调 isAllowedAdmin()，不在名单里就立刻退出登录。 */
    isAllowedAdmin: function () {
      return db.rpc("is_allowed_admin");
    },

    listAdmins: function () {
      return db.from("allowed_admins").select("email, note, created_at").order("created_at", { ascending: true });
    },

    addAdmin: function (email, note) {
      return db.from("allowed_admins").insert({ email: email, note: note || null });
    },

    removeAdmin: function (email) {
      return db.from("allowed_admins").delete().eq("email", email);
    }
  };

  window.GUISCloud = api;
})();
