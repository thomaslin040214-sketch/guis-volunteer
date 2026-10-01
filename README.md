# GUIS 义工组织 · 官方网站

> 广州优联国际学校（Guangzhou Ulink International School）学生志愿服务组织官网
> 白色底色 · GUIS 品牌红 `#9C2126` · 纯静态 HTML / CSS / JS（无框架、无构建步骤）

**线上地址**：https://thomaslin040214-sketch.github.io/guis-volunteer/
**仓库地址**：https://github.com/thomaslin040214-sketch/guis-volunteer

---

## 一、本地预览

直接双击 `index.html` 即可预览。若要看完整效果（含中英文切换、灯箱、滚动动画），建议起一个本地服务：

```bash
# 在项目根目录执行
python3 -m http.server 8080
# 然后浏览器打开 http://localhost:8080
```

也可以直接用 `?lang=en` 强制英文版：`http://localhost:8080/?lang=en`

---

## 二、目录结构

```
guis-volunteer/
├── index.html                  # 主页（全部板块）
├── join.html                   # 社长欢迎信（对应原站的 welcome.html）
├── README.md
├── signup.html                 # 学生报名页（选活动 → 填表 → 提交，无需登录）
├── admin.html                  # 后台门户（登录 / 建活动 / 审核报名 / 导出 Excel）
└── assets/
    ├── site.css                # 全部样式（白色主题 + 品牌蓝）
    ├── app.css                 # 表单 / 表格 / 后台 的附加样式
    ├── main.js                 # 交互：语言切换 / 滚动动画 / 计数 / 进度条 / 下拉履历 / 灯箱
    ├── navfit.js               # 把导航的真实高度写进 --nav-h（手机端两行导航靠它对齐，见第八节）
    ├── cloud-config.js         # 云服务 publicConfig（endpoint + publishableKey）
    ├── cloud.js                # 云服务客户端：初始化一次 + 活动/报名的增删改查
    ├── i18n.js                 # 中英双语词典（中英一一对应）
    ├── fonts/                  # 导航书法体（只含「义工组织」四个字的子集，见第八节）
    ├── logo/                   # 品牌标志
    │   ├── guis-ulc-lockup.png        GUIS | ULC 联合标志 → 导航栏左、Hero、后台登录卡
    │   ├── va-logo.png                义工组织 V.A. 标志（橙蓝 V）→ 导航栏、Hero、页脚、favicon 底图
    │   ├── ulc-mark.svg               背景水印用的 ULC 标记（右侧）
    │   ├── guis-phoenix-blue.png      背景水印用的凤凰（左侧）
    │   ├── guis-logo-h.png            红 · 横版组合标（含凤纹 + GUIS + 全称）
    │   ├── guis-logo-v.png            红 · 竖版组合标
    │   ├── guis-wordmark.png          红 · GUIS 字标
    │   ├── guis-emblem.png            红 · 凤纹徽章
    │   ├── guis-logo-h-white.png      白 · 横版（深色底时使用）
    │   ├── guis-logo-v-white.png      白 · 竖版（深色底时使用）
    │   ├── guis-wordmark-white.png    白 · 字标（深色底时使用）
    │   ├── guis-emblem-white.png      白 · 徽章（深色底时使用）
    │   ├── favicon.png                浏览器标签页图标（V.A. 标志）
    │   └── apple-touch-icon.png       加入主屏图标
    └── photos/
        └── shot-01.jpg … shot-08.jpg   # 工作照（当前为占位图，见第四节）
```

---

## 三、页面板块顺序

| # | 锚点 | 板块 | 说明 |
|---|------|------|------|
| 1 | `#home` | Hero | 校徽 + 主张 + 两个 CTA + **一个标签页（打字机）** |
| 2 | `#stats` | 数据条 | 4 项核心数据（带数字滚动动画） |
| 3 | `#about` | 关于我们 | 左文右列表两栏 |
| 4 | `#programs` | 服务项目 | 6 张卡片，各带标签芯片 |
| 5 | ~~`#gallery`~~ | 志愿风采 · 工作照 | **已删除**（2026-09-30），导航里的「志愿风采」也一并去掉 |
| 6 | ~~`#team`~~ | 部门成员 + 管理层 | **已独立成 `team.html`**（2026-09-30），首页不再有这一块；数据在 `assets/team.js` |
| 7 | `#contribution` | 服务分布 | 6 条服务时长占比进度条 + 能力标签 |
| 8 | `#roster` | 岗位一览 | 6 个常态化志愿岗位列表 |
| 9 | ~~`#projects`~~ | 重点项目 | **已删除**（2026-09-30） |
| 10 | ~~`#journey`~~ | 发展历程 | **已独立成 `journey.html`**（2026-09-30） |
| 11 | ~~`#contact`~~ | 联系我们 | **已搬到页尾**（2026-10-02），首页不再单独占一个 section；导航下拉里的「联系我们」也拿掉了 |

---

## 三之二、页尾联系区与页头打字机（2026-10-02）

首页**不再有 `#contact` 这一块**。联系方式整份留在每页的 `<footer>` 里，
排在标志 / 版权 / 链接那一行之上，占满一整行：

- 邮箱 `volunteer@guiscn.com`（mailto）+ 「写信给义工组织」按钮（Outlook 深链）
- 例会时间 / 招募窗口 / 指导单位三行、地址一行
- 容器 `id="footer-contact"` —— **其它页面页脚的「联系我们」链接都指到
  `index.html#footer-contact`**，别再写 `index.html#contact`（锚点已经没了）

页头 Hero 的 CTA 下面多了一个**标签页 `.hero-tab`**，专门跑打字机：

- 文字：`co.typer`（zh「有问题想问我们？请发邮件到volunteer@guiscn.com」/ en 同义）
- 节奏：打字 95ms/字 → 停 1.9s → 退格 40ms/字 → 停 0.7s → 循环
- 只有滚到这一块时才开始跑（`IntersectionObserver`），离开视口就停；切走标签页也停
- ⚠️ 里面套了一层 `visibility:hidden` 的占位层写完整文本**撑住高度**：
  手机上这句话会折行，没有它的话打到第二行整块会往下跳
- 系统开了「减少动态效果」时直接摆整句、光标也不闪

打字机在 `assets/typer.js`，靠 `main.js` 的 `applyLang()` 放出的
`guis:langchange` 事件换语言后重打一遍。

---

## 四、后台管理与报名功能

网站接了云端后端，实现「**后台创建活动 → 学生在线报名 → 后台导出 Excel**」这条闭环。

### 页面

| 页面 | 用途 | 需要登录 |
|------|------|----------|
| `signup.html` | 学生报名页：选活动 → 填表 → 提交成功页 | 否 |
| `admin.html` | 后台：创建/编辑活动、查看并审核报名、导出 Excel | 是（邮箱） |

主页的 `#signup` 板块会**自动读取云端「开放报名」的活动**并列出，点「去报名」直接跳到对应活动的报名表单。

### 数据表（云端 PostgreSQL）

| 表 | 说明 |
|----|------|
| `activities` | 义工活动 / 校内日程。管理员创建，公开可见 |
| `activity_positions` | 活动的职位（岗位），每个职位各有名额与备选名额 |
| `registrations` | 报名记录。学生公开提交，只有白名单管理员能查看 |

两张表都开启了行级安全（RLS），规则是：

- 任何人都能读到 `status = 'open'` 的活动；草稿和已停止的活动只有创建者可见。
- 任何人都能提交报名，但**只能报「开放中」的活动**（写策略里做了校验）。
- `(activity_id, email)` 上有唯一约束 —— 同一邮箱对同一活动重复提交会被数据库拒绝，前端提示「你已经报名过了」。
- **报名名单只有该活动的创建者登录后才能读**；匿名访问返回空数组，学生的手机号、邮箱不会泄露。

### 🔒 后台是邀请制（白名单）

**后台不开放公开注册。** 统一登录页 `login.html` 只有「密码登录」和「首次开通」两个入口，
没有注册按钮；即使有人拿到了账号，只要邮箱不在白名单里，登录后也会被立刻踢出并提示原因。
（学生走的「首次开通」也要先在学校名单里登记过，才拿得到验证码。）

> 2026-09-30 之前的「验证码登录」那一档已经删掉 —— 它和「首次开通」的后半步
> 一模一样（都是发 6 位码到邮箱），留着只是多一个走错的入口。

白名单存在云端 `allowed_admins` 表里，由 `is_allowed_admin()`（SECURITY DEFINER）判断，
并且**写进了 `activities` 和 `registrations` 的全部读写策略** —— 所以这是服务端强制，
不是只在前端拦一道。白名单本身不会被未授权的人读到（匿名查询返回空）。

新成员怎么进后台（两步）：

1. **已在后台的管理员** → 「白名单」页签 → 填邮箱 + 备注 → 加入白名单。
2. **对方**访问 `admin.html?setup=1`（这个入口平时是隐藏的）→ 用该邮箱收验证码 → 设置密码 → 开通完成。
   开通后以后直接用 `admin.html` 登录即可。

> 初始白名单由仓库所有者维护。想直接改数据库也可以，但更推荐用后台的「白名单」页签。
> 移除某人后，对方立刻失去后台权限；其已创建的活动和报名数据不会被删除。

### 📇 负责老师：一个活动一个人（按活动指定，不按板块）

每位负责老师先加进「人员管理」，然后**在每个活动的表单里单独把他选成负责老师**。
拿到某个活动的签到 / 改小时权限＝这个活动的 `manager_email` 正好是你的登录邮箱；
不在你自己名下的活动，名单可以看（只读），签到按钮会禁用并提示这一场是谁负责。

> 2026-09-30 之前还有一层「板块默认负责人」作兜底（现已删除）。
> 归属判定只有一个口径：`activities.manager_email`。这一点在后台 `admin.js` 和
> 签到页 `checkin.js` 里各有一份 `effectiveManager()`，**改规则两边必须一起改**。

义工时长有两层，都能在签到页改：

- **每个人**：名单里「义工小时」那一列，留空表示用活动默认时长（库里存 `null`）。
- **整个活动的默认时长**：签到页「本次义工时长」那条横条。
  这是唯一一条老师也能改的活动字段 —— `activities` 的 UPDATE 策略只认执委会，
  所以走 `set_activity_hours()`（SECURITY DEFINER），服务端再用 `i_manage_activity()`
  判一次。改它只影响「还没有被单独填过小时」的同学。

### 🔢 活动编号 · 👷 职位 · 🗓 校内日程（2026-10-02 加的）

**编号** = 前缀 + 流水号，前后两截拼起来显示（`SAO` + `26001` = `SAO26001`）。
后台活动表单里是一个框、两个输入框：

| 板块 | 前缀 | 说明 |
|------|------|------|
| 学生事务处活动(SAO) | `SAO` | 固定，跟着「所属板块」自动填 |
| 教务处活动(AO) | `AO` | 同上 |
| 升学指导办公室活动(CAS) | `CAS` | 同上 |
| 公益募捐 | 自己写 | 没有固定代号，前缀留空 —— 以后想用哪个开头自己填 |
| 未被框定(NTCLASSIFIED) | 自己写 | 同上 |

流水号默认「两位年份 + 三位序号」（26001、26002…），按同前缀已有活动自动顺延；
手写过前缀之后，再切板块也不会被覆盖。编号会显示在后台列表、报名页和日历里。

**职位**：一个活动可以拆成若干职位（如家长会的「指引义工」「翻译义工」），
每个职位各算自己的名额与备选名额。一旦有职位，报名的名额就按职位算，
活动自己的「计划招募人数 / 备选名额」退场（表单会把它们锁住并说明合计是多少）。
报名页的规则：没有职位 → 不显示；**一个职位 → 自动选中、不显示**；
两个以上 → 列出来让学生挑，各自显示剩余名额。

**校内日程**（`kind = 'event'`）：只出现在日历里，不进报名列表、也不能报名
（`register_signup()` 会直接回 `not_signup`）。建法有两种：在后台活动表单顶部
切类型，或者点日历某一天底部的「在这一天新建校内日程」。

切到「校内日程」之后表单**只剩四样**，跟苹果日历新建日程一样的建法：

| 留着 | 收起来的（`.only-signup`） |
|------|--------------------------|
| 名称（label 变「日程名称」） | 一句话简介 |
| 地点 | 所属板块 |
| 时间（开始 – 结束，可勾「全天」） | 活动编号 |
| 备注 | 报名开始时间 / 报名状态 / 计划招募人数 / 备选名额 / 义工时长 / 职位 / 负责老师 |

日程不编号（`code_prefix`、`code_no` 存 null），后台列表里也不给它挂板块。

**全天**（`activities.all_day`，对活动和日程都有效）：勾上之后两个时间框从
`datetime-local` 变成 `date`，只选日期不选时刻；存库时补成整天 ——
开始 `00:00`、结束 `23:59`。全天的条目不进当日时间轴（它没有时刻），
列表和当天面板只写「全天」，跨天时再补一段日期区间。

这五样东西落在数据库的这些地方：`activities` 多出
`code_prefix / code_no / kind / show_positions / all_day` 五列、新表 `activity_positions`、
`registrations` 多出 `position_id / position_name`，
以及两个 SECURITY DEFINER 函数 `position_counts()` 和 `set_activity_hours()`。

### 🌐 校外义工时长认定（2026-10-02 加）

同学在校外机构（社区、图书馆、公益组织…）做过的义工，可以上传证明申请把服务小时计入学校记录。

| 环节 | 在哪 | 说明 |
|------|------|------|
| 申请端 | `external.html` | 学生登录后上传证明图片 → 可点「自动识别」让模型把机构/活动/日期/小时填好 → 自己核对后提交 |
| 自动识别 | `assets/external.js` | 调云端大模型读图（免密钥）。只挑目录里**支持读图且最便宜**的模型，识别完**不覆盖学生已填的字段**，失败也不拦着手动填 |
| 收件箱 | 后台「校外时长审核」页签 | 学生一提交，数据库触发器自动往 `admin_inbox` 写一条；页签上有未读角标 |
| 审核 | 同上 | 执委会看图核定 → 通过 / 驳回（可写理由） |

⚠️ 三条设计边界，改之前先看：

1. **通过 ≠ 前端去加小时。** 审核只是把 `status` 改成 `approved`，
   `my_service()` 会把 approved 的申请 UNION 进那个人的义工记录 ——
   所以「我的义工账户」的累计小时自动带上。**前端不要再另外加一遍，会算重。**
2. **收件箱不是前端写的。** `admin_inbox` 只给了执委会读和标已读的权限，
   没有 INSERT —— 消息由数据库触发器写入，谁也伪造不了「有新申请」。
3. **学生不能自己给自己通过。** INSERT 策略的 `WITH CHECK` 里卡死
   `status = 'pending'`；改状态只有 `is_owner()` 能做到。

数据表：`external_hour_requests`（申请本体）、`admin_inbox`（执委会收件箱）。
证明图片存云存储 `shared/<uid>/ext-hours/`，审核时现签一个 15 分钟有效的链接来看
（用 `shared` 而不是 `users/`，是因为 `users/` 只有本人能读，执委会看不到图就没法核）。

### 👤 登录态：右上角头像（全站共用 `assets/session.js`）

登录之后回到任意页面，右上角那颗「登录」按钮会让位给**你的头像**：

- 头像取邮箱前缀的缩写（`linjtom@gmail.com` → `LI`，`20261001@guiscn.com` → `20`），
  点开是「邮箱 + 角色 + 去自己该去的页面 + 退出登录」。
- 头像插在**导航右半区 `.nav-right` 里、「登录」按钮之前**（那个按钮会隐藏，位置自然顶上）。
  ⚠️ 手机端第 1 行就是「标志 + `.nav-right`」，所以头像必须留在这个容器里 ——
  插到 `.nav-links` 里去的话会掉到第 2 行。`host()` 里保留了 `.nav-links` 兜底路径。
- **不用每次回来都重新登录。** 会话由云服务自己续期（access token 2 小时，
  快到期时 SDK 自动用 refresh token 换新的），我们额外做了三件事：
  1. 头像先从 `localStorage` 秒画（只画头像，不当登录凭证）；
  2. 后台静默跟服务端复核一次，角色有变化再改画；
  3. 页面开着时每 10 分钟续一次，切回标签页 / 前进后退回来也续一次。
- 只有**服务端明确说没有会话**时才退出登录态并把「登录」按钮放回去；
  网络抖一下、接口报错都不会把人踢出去（2 分钟后自动重试）。
- 能撑多久的上限由云服务决定（refresh token 的寿命），前端改不了。

### 演示账号（测试用，正式上线前请删掉）

只存在于云端，方便自测三档身份，**不属于真实成员**：

| 账号 | 密码 | 登录后去哪 | 备注 |
|------|------|-----------|------|
| `teacher.demo@guiscn.com` | `GUISdemo2026` | `checkin.html` 签到页 | 已在人员名单里，且是目前那个「签到测试」活动的负责老师 |
| `2510032@guiscn.com` | `GUISdemo2026` | `me.html` 我的义工账户 | 已在学生名单里（已开通）；用它可以去 `signup.html` 真报一次名 |

删掉测试账号（三张表各一行）：

```sql
DELETE FROM auth.users               WHERE email IN ('teacher.demo@guiscn.com','2510032@guiscn.com');
DELETE FROM allowed_admins           WHERE email = 'teacher.demo@guiscn.com';
DELETE FROM student_directory        WHERE email = '2510032@guiscn.com';
UPDATE activities SET manager_email = NULL WHERE manager_email = 'teacher.demo@guiscn.com';
```

### 使用流程

1. 确认你的邮箱已在白名单里，打开 `login.html` 登录。
2. 「活动管理」里创建活动：名称、板块、地点、时间、报名开始 / 截止、人数、负责老师、状态。
   状态选「开放报名」后学生侧立刻可见。
3. 学生打开 `signup.html`（或从主页点进去）选活动、填表、提交。
4. 回到后台「报名名单」：选活动 → 可按姓名/邮箱/学号搜索、按状态筛选 → 逐条「通过 / 不通过 / 删除」→ 点 **「导出 Excel」** 下载 `.xlsx`（含姓名、邮箱、手机、年级、课程、学号、岗位、经验、备注、状态、报名时间）。

> 导出用的是 SheetJS。万一 CDN 没加载成功，会自动退化成 CSV（Excel 同样能打开，带 BOM 不会乱码）。

### ⚠️ 必须知道的域名限制

**登录和数据读写只在应用的正式域名 `https://guis-volunteer.app.workbuddy.host` 上生效。**

GitHub Pages 那份（`thomaslin040214-sketch.github.io/guis-volunteer`）是纯静态展示 ——
在那里打开后台会看到「当前访问地址未绑定到云服务」的提示，登录和报名都会失败。
这是云服务强制 Origin 精确匹配导致的，不是 bug。

以后如果要换域名或重新部署，**必须复用同一个 `applicationId`**，否则云端登录会失效。

---

## 五、需要替换成真实内容的地方（重要）

HTML 里凡是可以替换的位置都留了 `<!-- EDIT: ... -->` 注释，用编辑器搜索 `EDIT:` 可以逐个找到。

### 1. 工作照（`#gallery`）

当前 `assets/photos/shot-01.jpg` ~ `shot-08.jpg` 是**同风格的占位图**（粉色底 + 校徽水印 + 相机图标）。
替换方式很简单：**用真实照片覆盖同名文件即可**，不需要改 HTML。

| 文件名 | 页面位置 | 建议尺寸 |
|--------|----------|----------|
| `shot-01.jpg` | 大图（占 2 列） | 1600×900（16:9 横构图） |
| `shot-02.jpg` | 竖图（占 2 行） | 900×1300（竖构图） |
| `shot-03.jpg` ~ `shot-05.jpg` | 普通格 | 1200×850 |
| `shot-06.jpg` | 大图（占 2 列） | 1600×900 |
| `shot-07.jpg`、`shot-08.jpg` | 普通格 | 1200×850 |

> 建议导出时压缩到 300KB 以内（可用 [squoosh.app](https://squoosh.app)），页面会更轻快。
> 图片下方的说明文字在 `index.html` 的 `data-i18n="s1.cap" … "s8.cap"` 两处（中文在 `index.html`，英文在 `assets/i18n.js`）。

### 2. 部门成员与管理层（`#team`）

`#team` 现在分成两块，全部由 **`assets/team.js`** 这一个文件驱动（这是你唯一需要编辑的地方）：

- **部门成员**：三个部门（宣传及对外公关部 / 人力资源部 / 组织部），每个部门是一张「架构图」——
  一位**部长**在顶部（含头像、姓名、加入时间、可展开的过往履历），其下是若干**部员**（只有头像、姓名、加入时间，没有履历）。
- **管理层**：社长，以及三个部门的部长（本届不设副社长；三位部长用 `headRef` 引用部门数据，
  与部门架构图共用同一份头像与履历，改一处即可同步）。管理层全员展示完整履历。

`assets/team.js` 里每个字段都写了注释：

```js
head: {
  avatar: "assets/photos/dep-pr-head.jpg",  // 头像：放进 assets/photos/，文件名与这里一致即可；留空或图片缺失会自动显示姓名首字
  name: "（在此填写部长姓名）",
  role: "部长",
  join: "（加入时间，如 2024-09）",
  resume: [ { when, what, note }, … ],     // 只有部长和管理层需要
  facts: ["（亮点一）", "（亮点二）"]
},
members: [ { avatar, name, join }, … ]     // 部员：只有头像/姓名/加入时间
```

- 渲染逻辑在 `assets/team-render.js`（自动处理中英双语、头像占位、履历折叠）。**不要改这个文件。**
- 章节标题、按钮等文案在 `assets/i18n.js` 的 `team.* / dept.* / lead.*` 键里（zh + en）。
- 改成员内容 → 只动 `assets/team.js`；改界面文字 → 才动 `assets/i18n.js`。

### 3. 其他数据

| 内容 | 位置 |
|------|------|
| 首页 4 个数字（128+ / 3600+ / 46 / 12） | `index.html` 的 `data-count` 与 `data-suffix` |
| 服务时长占比（34% / 22% …） | `index.html` 的 `data-fill` 与显示用的 `34%` 文本 |
| 联系邮箱 `volunteer@guiscn.com` | `index.html`（`mailto:` + 显示文字 + Outlook 深链）与 `join.html`（Outlook 深链） |
| 发展历程 6 个节点 | `index.html` 的 `#journey` 区块 |
| 4 个重点项目 | `index.html` 的 `#projects` 区块 |

> 邮箱若需要改动，用 `grep -rn "volunteer@guiscn.com" .` 可以一次找出全部位置。

---

## 六、如何增加一条文案（双语）

1. 在 `index.html`（或 `join.html`）里给元素加上 `data-i18n="自定义键名"`，例如
   `<p data-i18n="about.extra">中文文案</p>`
2. 打开 `assets/i18n.js`，在 `zh: { ... }` 和 `en: { ... }` 里**各加一条**同名的键：
   ```js
   zh: { ..., "about.extra": "中文文案" },
   en: { ..., "about.extra": "English copy" }
   ```
3. 只给属性（如 `title`、`aria-label`）赋值时，用
   `data-i18n-attr="title:自定义键名"`。

键值命名建议沿用现有前缀：`nav.` `hero.` `about.` `prog.` `g1..g6.` `gal.` `s1..s8.`
`team.` `dept.` `lead.` `ct.` `ro.` `pj.` `jr.` `bd.` `co.` `footer.` `join.` `ui.`

> 默认语言是**中文**；用户切换过一次之后会记在 `localStorage`（键名 `guis-volunteer-lang`）。
> 想要默认英文，把 `assets/main.js` 里 `var guess = "zh";` 改成 `"en"`。

---

## 七、部署到 GitHub Pages

本站已部署完成，仓库为 `thomaslin040214-sketch/guis-volunteer`，
Pages 来源设为 **Deploy from a branch → `main` / `/ (root)`**。

**日常更新流程**：改完文件后提交并推送，GitHub 会自动重新构建，通常 1–2 分钟后线上生效。

```bash
git add -A
git commit -m "说明这次改了什么"
git push
```

若要重新部署到一个新仓库：

```bash
gh repo create <新仓库名> --public --source=. --remote=origin --push
gh api -X POST repos/<你的用户名>/<新仓库名>/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

> 注意：Pages 免费版只支持**公开**仓库。若仓库是私有的，Pages 不会生效。

---

## 八、设计规范

| 项目 | 取值 |
|------|------|
| 品牌蓝 | `#144C90`（从 GUIS\|ULC 组合标志里 ULC 字标取样的实际色值） |
| 深蓝（hover / 强调） | `#0E3767` |
| 页面底色 | `#FFFFFF` |
| 次级底色 | `#FAFAFA` |
| 正文墨色 | `#17171A` |
| 次要文字 | `#6E6E76` |
| 圆角 | 卡片 16px · 大区块 24px · 胶囊 980px |
| 字体 | `-apple-system` → `PingFang SC` → `Hiragino Sans GB` → `Microsoft YaHei` |

所有颜色都定义在 `assets/site.css` 顶部的 `:root` 变量里，改一处即可全站生效。

### 导航里的书法体（`assets/fonts/`）

左上角「义工组织」四个字用的是**马善政毛笔楷书**（Ma Shan Zheng，SIL OFL 1.1，可自由自托管）。

⚠️ 这是**只含这四个字**的字符子集，**2 KB**，不是完整字库 —— 这是刻意的：中文全字库动辄 5–10 MB，
为了四个装饰字拖慢整站不值得。代价是**字体里没有别的字**，所以：

- 只有中文界面用书法体（`html[lang^="zh"] .nav-logo .org-script`）；英文是 Volunteer Association，
  走书法体会掉到兜底字体、反而更丑。
- **改这四个字就要重做子集**，否则新字会掉到 `STXingkai / Kaiti SC / KaiTi / 楷体` 兜底链上。

重做子集（只换 `text=` 里的字即可）：

```bash
curl -A "Mozilla/5.0" \
  "https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&text=义工组织&display=swap"
# 从返回的 CSS 里取出 src: url(...) 那个地址，直接下载：
curl -A "Mozilla/5.0" "<上面取到的 fonts.gstatic.com 地址>" \
  -o assets/fonts/ma-shan-zheng-org.woff2
```

**无障碍**：图片灯箱支持 `Esc` 关闭、`←/→` 翻页；照片格与履历按钮均可用键盘聚焦和回车触发；
页面尊重系统的「减少动态效果」设置（`prefers-reduced-motion`）。

### 手机端导航：两行 + `--nav-h` 自动量高（2026-10-01）

导航是 `position: fixed`，脱离文档流，所以页面顶部要靠 `--nav-h` 手动留出正好一样高的空间
（`site.css` 的 `section[scroll-margin-top]` / `.hero` 的 `padding-top`、`app.css` 的 `.page-head`）。
**留少了首屏和锚点会被盖住，留多了顶上白一条。**

坑在于这个高度是会变的：

| 场景 | 导航高度 |
|------|----------|
| 桌面（>720px） | `64px` |
| 手机 · 首页类页面（标志行还有语言开关 + 登录） | `78px` |
| 手机 · 后台 / 签到 / 我的账户（标志行只有标志） | `56px` |

以前 `--nav-h` 写死在媒体查询里（一度是 `104px`），而且导航是「所有元素混在一行里自然换行」，
390px 下折成 **4 行、157px**（占屏 19%），「关于我们」还被 `order: 9` 甩到单独一行。

现在：

1. **`assets/navfit.js`（13 页全挂，必须排在 `session.js` 之前）**量出导航真实高度写回 `--nav-h`，
   并用 `ResizeObserver` + `document.fonts.ready` 跟随字体落地、语言切换、头像插入等变化。
   CSS 里只留一个偏大的兜底值 `84px`（禁 JS 时宁可多留也不要盖住）。
2. **导航拆成三段**：`.nav-logo` / `.nav-links` / `.nav-right`。手机端第 1 行是
   「标志 + `.nav-right`（语言开关 + 登录 / 头像）」，第 2 行是 `.nav-links`（`order: 3; width: 100%`）。
   ⚠️ 以后**新增页面时语言开关和登录按钮必须放进 `.nav-right`**，否则它们会掉到第 2 行去。
   `session.js` 的 `host()` 也是优先往 `.nav-right` 里插头像，找不到才退回 `.nav-links`。
3. **下拉菜单在手机端保持绝对定位**（`top: calc(100% + 0.5rem)`）。
   ⚠️ 别给 `nav` / `.nav-links` 加 `overflow`，也别把 `.nav-drop-menu` 改回 `position: static` ——
   前者会把菜单裁掉，后者会把「关于我们」顶成独占一行。
4. 「义工组织」这四个书法字在手机上**不显示**：GUIS\|ULC 联合标志本身就宽 163px，
   语言开关 + 登录还要 145px，390px 屏幕只剩 50 多px，硬塞就得把标志或按钮压到看不清。
   最窄档 `≤480px`（320px 小屏）另外把标志和右半区一起收紧，否则第 1 行会顶成 3 行。
5. 页脚 `.footer-brand` 在 `≤640px` 也要换行：两个标志留一行，长长的中英文校名 `flex: 1 0 100%`
   独占一行居中。只改 `.footer-inner` 不够 —— 校名会被挤成五行的窄柱。

回归套件：`/tmp/guis-mobile-check.js`（72 项）钉住以上约束；
`/tmp/guis-nav-check.js` 钉住导航结构；`/tmp/guis-session-check.js` 钉住头像插入位置。

---

## 九、浏览器兼容

在 Chrome / Edge / Safari / Firefox 的当前版本下正常。使用了 `IntersectionObserver`、
CSS 自定义属性、`backdrop-filter`；若无 JS，内容依然完整可读（只是没有滚动动画和折叠动画）。

---

© 2026 GUIS 义工组织 · 校徽版权归广州优联国际学校所有，仅供本校组织使用。
