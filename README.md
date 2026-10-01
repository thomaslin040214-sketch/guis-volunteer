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
    ├── site.css                # 全部样式（白色主题 + 品牌红）
    ├── app.css                 # 表单 / 表格 / 后台 的附加样式
    ├── main.js                 # 交互：语言切换 / 滚动动画 / 计数 / 进度条 / 下拉履历 / 灯箱
    ├── cloud-config.js         # 云服务 publicConfig（endpoint + publishableKey）
    ├── cloud.js                # 云服务客户端：初始化一次 + 活动/报名的增删改查
    ├── i18n.js                 # 中英双语词典（中英一一对应）
    ├── fonts/                  # 导航书法体（只含「义工组织」四个字的子集，见第八节）
    ├── logo/                   # 学校校徽（8 个原始版本已按用途命名）
    │   ├── guis-logo-h.png            红 · 横版组合标（含凤纹 + GUIS + 全称）→ 导航栏
    │   ├── guis-logo-v.png            红 · 竖版组合标 → Hero 主视觉、欢迎信页头
    │   ├── guis-wordmark.png          红 · GUIS 字标 → 页脚
    │   ├── guis-emblem.png            红 · 凤纹徽章 → 背景水印
    │   ├── guis-logo-h-white.png      白 · 横版（深色底时使用）
    │   ├── guis-logo-v-white.png      白 · 竖版（深色底时使用）
    │   ├── guis-wordmark-white.png    白 · 字标（深色底时使用）
    │   ├── guis-emblem-white.png      白 · 徽章（深色底时使用）
    │   └── favicon.png                浏览器标签页图标
    └── photos/
        └── shot-01.jpg … shot-08.jpg   # 工作照（当前为占位图，见第四节）
```

---

## 三、页面板块顺序

| # | 锚点 | 板块 | 说明 |
|---|------|------|------|
| 1 | `#home` | Hero | 校徽 + 主张 + 两个 CTA |
| 2 | `#stats` | 数据条 | 4 项核心数据（带数字滚动动画） |
| 3 | `#about` | 关于我们 | 左文右列表两栏 |
| 4 | `#programs` | 服务项目 | 6 张卡片，各带标签芯片 |
| 5 | ~~`#gallery`~~ | 志愿风采 · 工作照 | **已删除**（2026-09-30），导航里的「志愿风采」也一并去掉 |
| 6 | ~~`#team`~~ | 部门成员 + 管理层 | **已独立成 `team.html`**（2026-09-30），首页不再有这一块；数据在 `assets/team.js` |
| 7 | `#contribution` | 服务分布 | 6 条服务时长占比进度条 + 能力标签 |
| 8 | `#roster` | 岗位一览 | 6 个常态化志愿岗位列表 |
| 9 | ~~`#projects`~~ | 重点项目 | **已删除**（2026-09-30） |
| 10 | ~~`#journey`~~ | 发展历程 | **已独立成 `journey.html`**（2026-09-30） |
| 11 | `#contact` | 联系我们 | 邮箱 + 例会时间 + 指导单位 |

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
| `activities` | 义工活动。管理员创建，公开可见 |
| `registrations` | 报名记录。学生公开提交，只有该活动的创建者能查看 |

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

### 👤 登录态：右上角头像（全站共用 `assets/session.js`）

登录之后回到任意页面，右上角那颗「登录」按钮会让位给**你的头像**：

- 头像取邮箱前缀的缩写（`linjtom@gmail.com` → `LI`，`20261001@guiscn.com` → `20`），
  点开是「邮箱 + 角色 + 去自己该去的页面 + 退出登录」。
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

---

## 九、浏览器兼容

在 Chrome / Edge / Safari / Firefox 的当前版本下正常。使用了 `IntersectionObserver`、
CSS 自定义属性、`backdrop-filter`；若无 JS，内容依然完整可读（只是没有滚动动画和折叠动画）。

---

© 2026 GUIS 义工组织 · 校徽版权归广州优联国际学校所有，仅供本校组织使用。
