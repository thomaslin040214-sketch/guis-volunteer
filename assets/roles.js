/* roles.js —— 全站唯一的角色真源。
   为什么要有这个文件：以前每个页面各自写 `role === "owner" ? A : B`，
   一共 11 处。新增一档角色时，那 11 处会**默默把新角色当成 teacher**（二选一的 else 支），
   于是新角色拿到了「改义工小时」的权限 —— 这是权限模型里最容易出事的写法。
   现在改成查表：加一档只改这张表，别处只问「到不到得了这一级」。

   等级从低到高：
     student  义工学生   —— 只有自己的义工账户
     member   普通成员   —— 后台只读：过往活动、刊物、报名名单（只读）
     teacher  负责老师   —— 报名名单只读 + 自己负责的活动可签到 / 改小时
     owner    组织成员   —— 全改

   ⚠️ 角色只有服务端说了算（my_access 是 SECURITY DEFINER）。
      这里只做「拿到角色之后怎么解释」，不参与判定。 */

(function () {
  "use strict";

  /* 等级数字：越大权限越高。中间插档时只改这里。 */
  var RANK = { student: 0, member: 1, teacher: 2, owner: 3 };

  var LIST = ["student", "member", "teacher", "owner"];

  /* 认不认识的都归一化：将来库里加了新值而前端没跟上，
     宁可当成学生（权限最低、看不到后台），也不要当成 teacher。
     —— 反过来兜底就是给权限，这是最危险的默认值。 */
  function norm(role) {
    var r = String(role == null ? "" : role).toLowerCase();
    return Object.prototype.hasOwnProperty.call(RANK, r) ? r : "student";
  }

  /* 到不到得了 level 这一级 */
  function atLeast(role, level) {
    return RANK[norm(role)] >= RANK[norm(level)];
  }

  var isOwner = function (role) { return atLeast(role, "owner"); };
  var isTeacher = function (role) { return atLeast(role, "teacher"); };
  var isMember = function (role) { return atLeast(role, "member"); };

  /* 能不能进后台（活动 / 名单 / 过往活动 / 刊物这些页面）。
     服务端 is_allowed_admin() 只看「在不在名单里」，所以这一层是给人看的。 */
  var canEnterBackoffice = isMember;

  /* 能不能在后台做写操作（建活动、改名单、审核…）。
     owner 与 teacher 之间目前没有区别，都算能写。 */
  var canWriteBackoffice = isTeacher;

  /* 能不能进面试工作台 —— 那是给面试官记账的，不是普通成员的事。 */
  var canUseInterview = isTeacher;

  /* 各身份登录后的落脚页。登录完按这个分流，登录前不暴露身份。 */
  var HOME = {
    owner: "admin.html",
    teacher: "checkin.html",
    member: "admin.html",
    student: "me.html"
  };

  var ALL = {
    owner: "组织成员",
    teacher: "负责老师",
    member: "普通成员",
    student: "义工学生"
  };

  var EN = {
    owner: "Organiser",
    teacher: "Teacher",
    member: "Member",
    student: "Student volunteer"
  };

  function home(role) { return HOME[norm(role)]; }
  function list() { return LIST.slice(); }
  /* 供后台「人员管理」的角色下拉用 —— 只列后台里能出现的，前两种是学生档 */
  function backofficeOptions() { return ["owner", "teacher", "member"]; }

  window.GUISRoles = {
    RANK: RANK,
    norm: norm,
    atLeast: atLeast,
    isOwner: isOwner,
    isTeacher: isTeacher,
    isMember: isMember,
    canEnterBackoffice: canEnterBackoffice,
    canWriteBackoffice: canWriteBackoffice,
    canUseInterview: canUseInterview,
    home: home,
    list: list,
    backofficeOptions: backofficeOptions,
    label: ALL,
    labelEn: EN
  };

  /* 中文标签带 i18n（英文站要显示英文），拿不到 i18n 就退回中文常量。 */
  window.GUISRoles.labelOf = function (role) {
    var r = norm(role);
    var zh = { owner: "组织成员", teacher: "负责老师", member: "普通成员", student: "义工学生" };
    var en = EN;
    var isEn = false;
    try { isEn = String(document.documentElement.lang || "").toLowerCase().indexOf("en") === 0; } catch (e) {}
    return isEn ? en[r] : zh[r];
  };
})();
