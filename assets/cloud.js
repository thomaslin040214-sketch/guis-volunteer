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

  /* 志愿服务记录证明申请的字段串。学生审核两侧用同一份 —— 学生本来就只能读到自己的行，
     审核侧能读全部，靠的是 RLS 里的 is_cert_reviewer()，不是靠这里多摘几个字段。 */
  var CERT_COLS =
    "id, student_email, student_name, student_name_en, id_type, id_no, hours, content, " +
    "issue_date, picks, status, reviewer_email, review_note, reviewed_at, created_at";

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

    /* ==========================================================================
       缺席（一次记一条，见 public.absences）
       --------------------------------------------------------------------------
       规则口径（2026-10-05 跟用户定的）：
       1. 学年 = 8 月 1 日 ~ 次年 7 月 31 日，用起始年份标记（2026 学年 = 2026-08 起）。
          ⚠️ 学年由数据库触发器 absences_fill_year 按活动结束时间自动填，
             前端**永远不要**自己拼学年标识 —— 拼错会造成跨学年计数串台。
       2. 一学年累计到 3 次就触线。
          ⚠️ 这里和数据库 my_absence_summary() 里的 blocked_at 是同一件事的两处写法，
             改一个必须改另一个。
       3. 触线的同学**照样能报名**（用户明确不要一刀切拦报名），
          由执委会在后台看到红色角标后决定这一场录不录取。
       4. 真有事可以标成 excused（已请假）：不计次数，但记录留着 —— 对学生透明，也留证据。
       5. 同一人同一场活动只可能有一条记录（唯一索引 activity_id + lower(email)），
          所以「自动结算 + 手工补点」不会把一次缺席记成两次。
       ========================================================================== */
    ABSENCE_LIMIT: 3,
    ABSENCE_COLS: "id, activity_id, registration_id, email, name, school_year, status, note, created_at, created_by, updated_at, updated_by",

    /* 当前学年标识（如 2026 = 2026-08-01 起这一年）。
       ⚠️ 一定要问服务端 —— 前后端各自按月份算，跨年那几天很容易差一年。 */
    currentSchoolYear: function () {
      return db.rpc("current_school_year", {});
    },

    /* 缺席记录。三个过滤条件可以叠加：
       activityId —— 看这一场都有谁缺席（名单页用）
       email      —— 看这一个人的历史（学生版本人 / 后台点某位同学）
       schoolYear —— 限定学年（不传 = 所有学年）
       ⚠️ 读策略是「本人 或 allowed_admins」，所以学生调这个只会拿回自己的。 */
    listAbsences: function (opt) {
      opt = opt || {};
      var q = db.from("absences").select(api.ABSENCE_COLS).order("created_at", { ascending: false });
      if (opt.activityId) q = q.eq("activity_id", opt.activityId);
      if (opt.email) q = q.eq("email", String(opt.email).toLowerCase());
      if (opt.schoolYear) q = q.eq("school_year", String(opt.schoolYear));
      return q;
    },

    /* 手工补一条缺席（后台名单页用）。
       school_year 不用传 —— 触发器会按活动结束时间补。
       ⚠️ 写策略是 i_manage_activity()，负责老师只能给自己带的活动记。 */
    addAbsence: function (payload) {
      return db.from("absences").insert(payload);
    },

    /* 改一条：status 传 'excused' = 标为已请假豁免，'absent' = 取消豁免恢复计数；
       note 可以顺便写原因（病假条之类）。 */
    updateAbsence: function (id, patch) {
      patch = patch || {};
      patch.updated_at = new Date().toISOString();
      return db.from("absences").update(patch).eq("id", id).select(api.ABSENCE_COLS);
    },

    /* 整条删掉 —— 「手滑点错了」用这个，不是常见的用法。
       ⚠️ 请假应该是 update 成 excused 而不是删，删了就没有「为什么没算」的记录了。 */
    removeAbsence: function (id) {
      return db.from("absences").delete().eq("id", id).select();
    },

    /* 一键结算：把这场活动里「到点了还没签到」的人一次性记为缺席。
       ⚠️ 幂等：同一场反复调用不会重复计数（撞唯一索引就被 DO NOTHING 掉）。
       ⚠️ 活动还没结束会被服务端挡回来（error = 'not_ended'）；不是自己负责的活动 = 'not_manager'。 */
    settleAbsences: function (activityId) {
      return db.rpc("settle_activity_absences", { p_activity_id: activityId });
    },

    /* 学生自查：my_absence_summary() 直接回打包好的 JSON
       { year, count, excused, blocked_at, rows:[{id,activity_id,title,starts_at,status,note}] }
       —— 一次调用拿到「本学年几次 + 明细」，不必再自己聚合。 */
    myAbsenceSummary: function () {
      return db.rpc("my_absence_summary", {});
    },

    /* 把一堆缺席记录按邮箱聚成 { email: { absent, excused, rows } }，
       名单页要在一行里显示「这位同学本学年缺席几次」，用它最省事。
       ⚠️ years 不传 = 所有学年；传进来就只认这个学年（跨学年清零要的就是这个行为）。 */
    summarizeAbsences: function (rows, year) {
      var map = {};
      (rows || []).forEach(function (a) {
        if (year && String(a.school_year) !== String(year)) return;
        var k = String(a.email || "").toLowerCase();
        if (!k) return;
        if (!map[k]) map[k] = { absent: 0, excused: 0, rows: [] };
        if (a.status === "excused") map[k].excused += 1;
        else map[k].absent += 1;
        map[k].rows.push(a);
      });
      return map;
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
        .select("email, name, note, role, is_student, must_change_password, last_login_at, created_at")
        .order("created_at", { ascending: true });
    },

    addMember: function (payload) {
      return db.from("allowed_admins").insert(payload).select();
    },

    /* 批量加人（从 CSV / Excel 导入）。走 upsert：邮箱是主键，
       同一份名单导两次只会刷新姓名角色备注，不会报「已存在」炸掉整批。
       ⚠️ 不链 .select()：这张表的读策略是 is_owner()，回读对非执委会一律被拒。 */
    importMembers: function (rows) {
      if (!rows || !rows.length) return Promise.resolve({ data: [], error: null });
      return db.from("allowed_admins").upsert(rows, { onConflict: "email" });
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
        /* name_en —— 英文全名，会印在义工证明的姓名栏（中文名前面）。
           没登记的话证明上只显示中文名，学生那一侧改不了这一项。 */
        .select("email, name, name_en, grade, student_id, programme, activated, activated_at, created_at")
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

    /* ================= 志愿服务记录证明 · 申请与审核（2026-10-02 加） =================
       为什么要「提交 → 审核 → 才能下载」：之前勾完记录就能直接拿走一份成品，
       等于任何人可以给自己开一张抬头是学校的证明。现在这一层的权限分成两半：
         · certificate_requests —— 申请本体。学生只能插自己的、看自己的，而且只能带着
           status='pending' 插；**通过 / 驳回没有 UPDATE 策略**，只能走
           review_certificate_request()（SECURITY DEFINER），它认 cert_reviewers 名单。
           学生唯一能改的是「把自己那条 pending 撤成 withdrawn」（策略里卡了方向）。
         · cert_reviewers —— 指定的审核人名单，只有执委会（owner）能增删。
           ⚠️ owner 不自动等于审核人 —— 想审就得把自己也加进这张表。
       ⚠️ 证件号码现在会存在库里（审核和日后重打都要看）。这跟「页面不留痕」不冲突：
          浏览器本地一个字都不写，只是云端这行记录里有，且只有本人和审核人读得到。 */
    myCertRequests: function () {
      return db
        .from("certificate_requests")
        .select(CERT_COLS)
        .order("created_at", { ascending: false })
        .limit(50);
    },

    submitCertRequest: function (payload) {
      /* ⚠️ 不链 .select()：写入后的回读受 SELECT 策略约束会报 42501。
         重复提交（同一账户已有一条 pending）由唯一索引 uq_certreq_pending 挡下 → 23505。 */
      return db.from("certificate_requests").insert(payload);
    },

    withdrawCertRequest: function (id) {
      return db.from("certificate_requests").update({ status: "withdrawn" }).eq("id", id);
    },

    /* 审核人读全部（RLS 里 is_cert_reviewer() 放行）。传 status 就是只看某一类。 */
    listCertRequests: function (status) {
      var q = db
        .from("certificate_requests")
        .select(CERT_COLS)
        .order("created_at", { ascending: false })
        .limit(300);
      if (status) q = q.eq("status", status);
      return q;
    },

    reviewCertRequest: function (id, pass, note) {
      return db.rpc("review_certificate_request", {
        p_id: id,
        p_pass: !!pass,
        p_note: note || null
      });
    },

    /* 角标：还有几条没判。审核人之外的人 select 不到别人的行，数出来自然是自己的（0）。 */
    pendingCertCount: function () {
      return db
        .from("certificate_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
    },

    isCertReviewer: function () {
      return db.rpc("is_cert_reviewer");
    },

    listCertReviewers: function () {
      return db
        .from("cert_reviewers")
        .select("email, note, created_at, created_by")
        .order("created_at", { ascending: true });
    },

    addCertReviewer: function (payload) {
      return db.from("cert_reviewers").insert(payload).select();
    },

    removeCertReviewer: function (email) {
      return db.from("cert_reviewers").delete().eq("email", email).select();
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

    /* ================= 招新面试 · 安排与记录（2026-10-06 加） =================
       两张表，各管一件事：
         · interview_slots   —— 面试时间表。一行 = 一位候选人的一个 15 分钟场次。
                                只有执委会（is_owner）能增删改；负责老师可读。
         · interview_records —— 面试记录。一个时段最多一条，保存走 upsert。
                                执委会与负责老师都能写。
       ⚠️ 学生读不到这两张表 —— 学生端只拿 my_interview() 那一条安排
          （刻意不含分数、不含结论，那些由执委会单独通知）。 */

    INTERVIEW_SLOT_COLS:
      "id, day, slot_start, slot_end, name, name_en, class_name, dept, email, note, created_at",
    INTERVIEW_RECORD_COLS:
      "id, slot_id, result, scores, avg_score, offer_dept, note, " +
      "interviewer_email, interviewer_name, created_at, updated_at, updated_by",

    /* 打分维度。⚠️ 维度名会**原样当 scores 的 jsonb key** 存进库 ——
       所以改这里的措辞，老记录还是按老 key 读得出来（不会丢），
       但会在统计里多出一列。要真正换口径，得连库里已有记录一起改。 */
    IV_CRITERIA: ["表达沟通", "责任态度", "团队协作", "岗位匹配"],

    /* 面试结论只有这四种，和库里的 interview_result_chk 一致。 */
    IV_RESULTS: ["pending", "pass", "hold", "fail"],

    /* 时间表。不传 day = 取全部（前台一次拉完再按天分组，省得来回请求）。 */
    listInterviewSlots: function (day) {
      var q = db
        .from("interview_slots")
        .select(api.INTERVIEW_SLOT_COLS)
        .order("day", { ascending: true })
        .order("slot_start", { ascending: true });
      if (day) q = q.eq("day", day);
      return q.limit(500);
    },

    /* 批量导入时间表。onConflict 认唯一约束 uq_interview_slot_person(day, slot_start, name)，
       所以同一份表重复导入只会刷新英文名 / 班级 / 部门，不会变成两行。
       ⚠️ onConflict 只能写「列名」，用不了表达式索引 —— 这也是那个约束
          没用 lower(name) 的原因。 */
    importInterviewSlots: function (rows) {
      if (!rows || !rows.length) return Promise.resolve({ data: [], error: null });
      return db.from("interview_slots").upsert(rows, { onConflict: "day,slot_start,name" });
    },

    updateInterviewSlot: function (id, patch) {
      return db.from("interview_slots").update(patch).eq("id", id);
    },

    /* 删一个场次会把挂在它下面的面试记录一起带走（外键 ON DELETE CASCADE）——
       这是故意的：时段都没了，那条记录就是无主数据。 */
    removeInterviewSlot: function (id) {
      return db.from("interview_slots").delete().eq("id", id);
    },

    /* 一次把全部记录读回来。表很小（一个招新季几十条），
       前台要一边点一边算「这场还剩几个人没面」，读一次比逐个查省事。 */
    listInterviewRecords: function () {
      return db
        .from("interview_records")
        .select(api.INTERVIEW_RECORD_COLS)
        .order("updated_at", { ascending: false })
        .limit(500);
    },

    /* 保存一条记录。
       ⚠️ 一个时段最多一条（唯一索引 uq_interview_record_slot）→ 走 upsert，
          重复点「保存」是覆盖，不是新增两条。
       ⚠️ 不链 .select()：回读要再过一道 SELECT 策略，这里不需要读回，
          保存完前端会重新拉列表。 */
    saveInterviewRecord: function (payload) {
      payload = payload || {};
      payload.updated_at = new Date().toISOString();
      return db.from("interview_records").upsert(payload, { onConflict: "slot_id" });
    },

    removeInterviewRecord: function (id) {
      return db.from("interview_records").delete().eq("id", id);
    },

    /* 学生自查自己的面试安排：
       { found, day, slot_start, slot_end, dept, done } —— 没有安排时 found=false。 */
    myInterview: function () {
      return db.rpc("my_interview", {});
    },

    /* ---------- 大模型（读图识别证明上的信息） ---------- */
    llmModels: function () {
      return cloud.llm.models.list();
    }
  };

  window.GUISCloud = api;
})();
