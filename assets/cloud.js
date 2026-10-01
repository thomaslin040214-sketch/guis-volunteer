/* ============================================================
   GUIS 义工组织 — 云服务客户端（初始化一次，全站共用）
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

  /* 活动查询统一用这一串字段。
     ⚠️ 2026-10-01 起不再有「报名截止时间」：报名只按名额自动截止（见 register_signup）。
        数据库里那个旧列还留着（历史数据），但前端不再读它、也不再写它。
     ⚠️ 加 waitlist_capacity：名额满了还能收多少人进备选名单（waiting list）。
     ⚠️ 2026-10-02 起多了四列：
        · code_prefix / code_no —— 活动编号，前后两截拼起来显示（如 SAO + 26001 = SAO26001）。
          前缀按板块自动给（SAO / AO / CAS），「公益募捐」「未被框定」没有固定代号，
          留 Exec 自己填（code_prefix 可为空）。
        · kind —— 'signup' 需要报名的活动 / 'event' 校内日程（只进日历，不能报名）。
        · show_positions —— false 时报名表单不显示职位选择（只有一个职位的活动用）。 */
  var ACT_COLS =
    "id, title, summary, category, location, starts_at, ends_at, signup_opens_at, " +
    "capacity, waitlist_capacity, status, notified_at, manager_email, hours, created_at, " +
    "code_prefix, code_no, kind, show_positions, all_day";

  /* 校外时长认定申请的字段串。
     ⚠️ 学生版**不含** ocr_text / reviewer_email —— 那是审核侧才该看的东西
        （ocr_text 是模型从证明图里读出来的原文，里面有可能是学生手写的杂信息）。 */
  var EXT_COLS =
    "id, org_name, activity_name, service_date, hours, status, proof_path, note, " +
    "review_note, reviewed_at, created_at";
  var EXT_COLS_ALL =
    "id, student_email, student_name, org_name, activity_name, service_date, hours, " +
    "status, proof_path, ocr_text, note, reviewer_email, review_note, reviewed_at, created_at";

  var api = {
    cloud: cloud,
    db: db,
    auth: cloud.auth,
    storage: cloud.storage,
    llm: cloud.llm,
    unwrap: unwrap,
    endpoint: cfg.endpoint,

    /* ---------- 会话 ---------- */
    getSession: function () {
      return cloud.auth.getSession();
    },

    /* ⚠️ 这个一定要用，不要自己读 getSession().data.user.email ——
       登录响应里根本没有 email，getSession() 只回
       { accessToken, refreshToken, expiresAt, user: { id, isAnonymous, raw } }。
       邮箱要另外问一次 /v1/user/me（也就是 cloud.auth.getUser）。
       以前四个页面（login / me / admin / checkin）各自写了
       `s && s.user && s.user.email`，于是全都判成「没登录」——
       表现就是：登录完跳到学生端却又弹回登录表单、右上角头像永远不出现。
       返回 null（没有会话）或 { id, email }；email 拿不到时会是空串。 */
    sessionUser: function () {
      return cloud.auth.getSession().then(function (res) {
        var s = res && res.data;
        if (!s) {
          /* ⚠️ getSession() 从来不抛异常，它把两种情况都塞进 data:null：
               · 真的没会话   → error.kind === "unauthenticated" → 返回 null
               · 网络 / 服务端临时出错 → kind 是 network / backend-unavailable …
                 这种要**往外抛**，让调用方按「临时故障」处理（别把人踢下线）。
             以前两种都返回 null，结果一断网头像就没了、还要重新登录。 */
          var kind = res && res.error && res.error.kind;
          if (kind && kind !== "unauthenticated") return Promise.reject(res.error);
          return null;
        }
        var u = s.user || (s.session && s.session.user) || {};
        var out = {
          id: String(u.id || u.sub || (u.raw && u.raw.sub) || s.sub || ""),
          email: ""
        };
        var direct = u.email || (u.user_metadata && u.user_metadata.email) ||
          (u.raw && u.raw.email) || s.email || "";
        if (direct) { out.email = String(direct); return out; }

        if (!cloud.auth || typeof cloud.auth.getUser !== "function") return out;
        /* 只是补一个邮箱，取不到不该把人踢出去 —— 会话本身是有效的 */
        return cloud.auth.getUser().then(function (r) {
          var m = r && r.data;
          var e = m && (m.email || (m.user_metadata && m.user_metadata.email));
          if (e) out.email = String(e);
          return out;
        }, function () { return out; });
      });
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
    /* 报名页候选列表：kind = 'signup' 才需要报名。
       ⚠️ 校内日程（kind = 'event'）也要能建、能在日历里看到，但它不能报名 ——
          这里在服务端就滤掉，免得学生选了之后被 register_signup 一句 'not_signup' 拒回来。 */
    listOpenActivities: function () {
      return db
        .from("activities")
        .select(ACT_COLS)
        .eq("status", "open")
        .eq("kind", "signup")
        .order("starts_at", { ascending: true, nullsFirst: false });
    },

    /* 日历专用：不加 status 过滤，交给 RLS 决定能看到哪些
       （匿名：开放报名的 + 已归档的；管理员：全部）。
       这样公开日历既能看到未来排期，也能翻到过往活动。 */
    listCalendarActivities: function () {
      return db
        .from("activities")
        .select(ACT_COLS.replace(" status,", " status, archived,"))
        .order("starts_at", { ascending: true, nullsFirst: false });
    },

    listMyActivities: function () {
      return db
        .from("activities")
        .select(ACT_COLS.replace(" status,", " contact, notes, status, recap_html, archived, archived_at,"))
        .order("created_at", { ascending: false });
    },

    /* 2026-09-30 之前这里有 listCategoryManagers / setCategoryManager 一对
       「板块默认负责人」的读写。用户决定改成「每个活动单独选一位负责老师」，
       面板和调用都删了，所以这两个接口也一起删掉 —— 需要找回看 git 历史。
       ⚠️ category_managers 这张表前端已经不再读写（备份表里也摘掉了），
          只剩数据库里那点历史数据，什么时候想清理 DROP 掉不影响业务。 */

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
    setActivityNotified: function (id, notified) {      return db
        .from("activities")
        .update({ notified_at: notified ? new Date().toISOString() : null })
        .eq("id", id)
        .select();
    },

    /* ---------- 报名 ----------
       走 register_signup()（SECURITY DEFINER）而不是直接 INSERT，原因有两个：
       1. 名额要在服务端一次性算准 —— 前端先数一遍再插入会撞车（两个人同时报第 30 位）；
       2. 匿名读不到 registrations（SELECT 策略挡着），只能靠函数回话。
       返回 { ok, status: 'pending' | 'waiting', waitlisted, position }，
       或 { ok:false, error: 'duplicate' | 'full' | 'no_activity' | 'missing' }。 */
    register: function (payload) {
      return db.rpc("register_signup", { p: payload });
    },

    /* 每个活动已占名额 / 备选人数 —— 匿名也能调，报名页和首页看板靠它判断满没满 */
    counts: function () {
      return db.rpc("activity_counts");
    },

    /* 改整个活动的默认义工时长（activities.hours）。
       为什么要走 SECURITY DEFINER：activities 的 UPDATE 策略只认 is_owner()，
       但带队的负责老师也要能在签到页临时改（用户明确要求），
       于是把判断收敛到函数里 —— i_manage_activity() 已包含执委会。 */
    setActivityHours: function (id, hours) {
      return db.rpc("set_activity_hours", {
        p_activity_id: id,
        p_hours: (hours === "" || hours == null) ? null : Number(hours)
      });
    },

    /* ---------- 职位（岗位）----------
       一个活动可以有多个职位（如家长会的「指引义工」「翻译义工」），
       每个职位各自有名额与备选名额；一旦这个活动有职位，
       register_signup 就按职位算名额，activities.capacity 不再参与。
       ⚠️ 写操作只有执委会能通过 RLS（is_owner()），读则跟着活动状态走
          （开放报名或已归档的活动，匿名也能读到它的职位）。 */
    listPositions: function (activityId) {
      var q = db
        .from("activity_positions")
        .select("id, activity_id, name, sort_order, capacity, waitlist_capacity, created_at")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      if (activityId) q = q.eq("activity_id", activityId);
      return q;
    },

    createPositions: function (rows) {
      if (!rows || !rows.length) return Promise.resolve({ data: [], error: null });
      return db.from("activity_positions").insert(rows).select();
    },

    updatePosition: function (id, patch) {
      return db.from("activity_positions").update(patch).eq("id", id).select();
    },

    deletePositions: function (ids) {
      if (!ids || !ids.length) return Promise.resolve({ data: [], error: null });
      return db.from("activity_positions").delete().in("id", ids);
    },

    /* 报名前用它显示每个职位还剩几个位置（匿名可调用，SECURITY DEFINER） */
    positionCounts: function () {
      return db.rpc("position_counts");
    },

    listRegistrations: function (activityId) {
      var q = db
        .from("registrations")
        .select("id, activity_id, name, email, phone, grade, programme, student_id, slot, experience, note, status, selected, selected_at, selected_by, check_token, checked_in, checked_in_at, checked_in_by, hours, position_id, position_name, created_at")
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
        .select("id, activity_id, name, email, phone, grade, programme, student_id, slot, status, selected, check_token, checked_in, checked_in_at, checked_in_by, position_id, position_name, hours, created_at")
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
        .select(ACT_COLS.replace(" status,", " contact, notes, status, recap_html, archived, archived_at,"))
        .eq("archived", true)
        .order("starts_at", { ascending: false, nullsFirst: false });
    },

    getActivity: function (id) {
      return db
        .from("activities")
        .select(ACT_COLS.replace(" status,", " contact, notes, status, recap_html, archived, archived_at,"))
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
    },

    /* ================= 校外义工时长认定（2026-10-02 加） =================
       学生拿着校外机构的义工证明来申请，执委会审核通过后并入他本人的义工小时
       —— 合并发生在服务端：my_service() 里 UNION 了 status='approved' 的申请，
         所以「我的义工账户」的累计小时自然就带上了，前端不用另外加一遍。

       两张表，权限分工是刻意的：
         · external_hour_requests —— 申请本体。学生只能插自己的、看自己的，
           而且只能带着 status='pending' 插（不能自己给自己通过）；
           改状态只有执委会可以（RLS 里 is_owner()）。
         · admin_inbox —— 执委会收件箱。⚠️ 学生**没有**这张表的 INSERT 权限，
           收件那一行的写入者是数据库触发器 —— 免得有人伪造一条消息误导审核人。
       证明图片走云存储的 shared 路径（为什么不是 users/：users 只有本人能读，
       执委会就看不到图、没法核；shared 的代价是任何登录的人都能读，但文件名是
       随机串，只有先拿到申请记录才知道去读哪一个）。 */
    submitExternal: function (payload) {
      /* ⚠️ 不链 .select()：匿名/学生写入后的回读受 SELECT 策略约束会报 42501。 */
      return db.from("external_hour_requests").insert(payload);
    },

    myExternal: function () {
      return db
        .from("external_hour_requests")
        .select(EXT_COLS)
        .order("created_at", { ascending: false });
    },

    /* 执委会看全部（RLS 里 is_owner() 放行）。传 status 就是只看某一类。 */
    listExternalAll: function (status) {
      var q = db
        .from("external_hour_requests")
        .select(EXT_COLS_ALL)
        .order("created_at", { ascending: false })
        .limit(300);
      if (status) q = q.eq("status", status);
      return q;
    },

    reviewExternal: function (id, status, note, reviewerEmail) {
      return db
        .from("external_hour_requests")
        .update({
          status: status,
          review_note: note || null,
          reviewer_email: reviewerEmail || null,
          reviewed_at: new Date().toISOString()
        })
        .eq("id", id);
    },

    deleteExternal: function (id) {
      return db.from("external_hour_requests").delete().eq("id", id);
    },

    listInbox: function () {
      return db
        .from("admin_inbox")
        .select("id, kind, ref_id, title, body, created_at, read_at")
        .order("created_at", { ascending: false })
        .limit(100);
    },

    /* 未读数：只数「还没点开过的」。head:true 不回传行，省流量。 */
    unreadInboxCount: function () {
      return db
        .from("admin_inbox")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
    },

    markInboxRead: function (ids) {
      if (!ids || !ids.length) return Promise.resolve({ data: [], error: null });
      return db
        .from("admin_inbox")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
    },

    /* ---------- 证明图片（云存储） ---------- */
    uploadProof: function (file, uid) {
      var ext = String(file.name || "").split(".").pop() || "jpg";
      ext = ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      var name = "ext-hours/" + Date.now() + "-" +
        Math.random().toString(36).slice(2, 10) + "." + ext;
      var p = cloud.storage.sharedPath(uid, name);
      return cloud.storage
        .upload(p, file, { contentType: file.type || "image/jpeg", upsert: false })
        .then(function (res) {
          if (!res || res.error) return res;
          /* 统一成 { data: { path } } —— 调用方只关心「存到哪儿了」 */
          return { data: { path: p }, error: null };
        });
    },

    /* 签名链接默认 15 分钟：够审核人看完，也不至于被人转发出去长期有效 */
    proofUrl: function (p, ttl) {
      return cloud.storage.createSignedUrl(p, ttl || 900);
    },

    /* ---------- 大模型（读图识别证明上的信息） ---------- */
    llmModels: function () {
      return cloud.llm.models.list();
    }
  };

  window.GUISCloud = api;
})();
