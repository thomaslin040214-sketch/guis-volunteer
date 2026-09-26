# GUIS 义工社 · 官方网站

> 广州优联国际学校（Guangzhou Ulink International School）学生志愿服务组织官网
> 白色底色 · GUIS 品牌红 `#9C2126` · 纯静态 HTML / CSS / JS（无框架、无构建步骤）

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
├── join.html                   # 招募信（对应原站的 welcome.html）
├── README.md
└── assets/
    ├── site.css                # 全部样式（白色主题 + 品牌红）
    ├── main.js                 # 交互：语言切换 / 滚动动画 / 计数 / 进度条 / 下拉履历 / 灯箱
    ├── i18n.js                 # 中英双语词典（337 条，中英一一对应）
    ├── logo/                   # 学校校徽（8 个原始版本已按用途命名）
    │   ├── guis-logo-h.png            红 · 横版组合标（含凤纹 + GUIS + 全称）→ 导航栏
    │   ├── guis-logo-v.png            红 · 竖版组合标 → Hero 主视觉、招募信页头
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
| 5 | `#gallery` | 志愿风采 · **工作照** | 8 张照片，瀑布式网格，点击开灯箱 |
| 6 | `#team` | 团队成员 | 6 位成员，每位含**下拉履历**手风琴 |
| 7 | `#contribution` | 服务分布 | 6 条服务时长占比进度条 + 能力标签 |
| 8 | `#roster` | 岗位一览 | 6 个常态化志愿岗位列表 |
| 9 | `#projects` | 重点项目 | 4 个项目卡，各带「时间 / 规模 / 合作」三栏 |
| 10 | `#journey` | 发展历程 | 垂直时间线 6 个节点 |
| 11 | `#contact` | 联系我们 | 邮箱 + 例会时间 + 指导单位 |

---

## 四、需要替换成真实内容的地方（重要）

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

### 2. 团队成员与履历（`#team`）

当前 6 位成员（林昭阳、陈嘉懿、黄乐怡、苏文轩、何静仪、张亦驰）是**示例数据**，需要换成真实名单。

每位成员的结构：

```html
<article class="member">
  <div class="member-top">
    <div class="avatar">林</div>               <!-- 头像：可放姓名首字，也可换成 <img src="..."> -->
    <div class="member-id">
      <div class="member-name" data-i18n="m1.name">林昭阳</div>
      <div class="member-role" data-i18n="m1.role">社长 · 总负责</div>
      <div class="member-meta" data-i18n="m1.meta">G12 · ULC 英式课程 · 2023 年入社</div>
    </div>
  </div>
  <p class="bio" data-i18n="m1.bio">……简介……</p>

  <div class="cv">
    <button class="cv-head" type="button" aria-expanded="false">  <!-- ← 点击这里展开/收起履历 -->
      <span class="cv-label" data-i18n="ui.cv">查看履历</span>
      <span class="cv-caret" aria-hidden="true"></span>
    </button>
    <div class="cv-body">
      <div class="cv-inner">
        <div class="cv-timeline">
          <div class="cv-item">
            <div class="cv-when" data-i18n="m1.c1.when">2023 · 秋</div>
            <div class="cv-what" data-i18n="m1.c1.what">发起义工社前身小组</div>
            <div class="cv-note" data-i18n="m1.c1.note">……说明……</div>
          </div>
          <!-- 需要更多履历条目就复制 .cv-item -->
        </div>
        <div class="cv-facts">
          <span class="cv-fact" data-i18n="m1.f1">累计服务 320 小时</span>
        </div>
      </div>
    </div>
  </div>
</article>
```

**增删成员 / 履历条目的注意点**：`data-i18n="m1.xxx"` 里的 `m1` 是这一组的编号。
如果要加第 7 位成员，就把整块复制成 `m7.*`，并在 `assets/i18n.js` 的 `zh` 和 `en` 两个字典里
分别补上 `m7.name`、`m7.role` … 这些键（中英都要有，否则切换语言时会留空）。

### 3. 其他数据

| 内容 | 位置 |
|------|------|
| 首页 4 个数字（128+ / 3600+ / 46 / 12） | `index.html` 的 `data-count` 与 `data-suffix` |
| 服务时长占比（34% / 22% …） | `index.html` 的 `data-fill` 与显示用的 `34%` 文本 |
| 联系邮箱 `volunteer@guis.example.com` | `index.html` 与 `join.html` 的 `mailto:` 与 Outlook 深链（共 4 处） |
| 发展历程 6 个节点 | `index.html` 的 `#journey` 区块 |
| 4 个重点项目 | `index.html` 的 `#projects` 区块 |

> 联系邮箱目前是 `guis.example.com`（不可路由的保留域名），**上线前务必换成真实邮箱**，
> 可用 `grep -rn "guis.example.com" .` 一次找出全部位置。

---

## 五、如何增加一条文案（双语）

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
`team.` `m1..m6.` `ct.` `ro.` `pj.` `jr.` `bd.` `co.` `footer.` `join.` `ui.`

> 默认语言是**中文**；用户切换过一次之后会记在 `localStorage`（键名 `guis-volunteer-lang`）。
> 想要默认英文，把 `assets/main.js` 里 `var guess = "zh";` 改成 `"en"`。

---

## 六、部署到 GitHub Pages

```bash
# 1. 在 GitHub 新建一个空仓库，例如 guis-volunteer
# 2. 在本目录执行（把 <你的用户名> 换成实际的）
git remote add origin https://github.com/<你的用户名>/guis-volunteer.git
git branch -M main
git push -u origin main
# 3. 仓库 Settings → Pages → Source 选 "Deploy from a branch" → main / (root) → Save
# 4. 一两分钟后访问 https://<你的用户名>.github.io/guis-volunteer/
```

首次提交前如果 Git 提示缺少身份信息：

```bash
git config user.name  "你的名字"
git config user.email "你的邮箱"
```

---

## 七、设计规范

| 项目 | 取值 |
|------|------|
| 品牌红 | `#9C2126`（从校徽 PNG 中取样的实际色值） |
| 深红（hover / 强调） | `#7A191D` |
| 页面底色 | `#FFFFFF` |
| 次级底色 | `#FAFAFA` |
| 正文墨色 | `#17171A` |
| 次要文字 | `#6E6E76` |
| 圆角 | 卡片 16px · 大区块 24px · 胶囊 980px |
| 字体 | `-apple-system` → `PingFang SC` → `Hiragino Sans GB` → `Microsoft YaHei` |

所有颜色都定义在 `assets/site.css` 顶部的 `:root` 变量里，改一处即可全站生效。

**无障碍**：图片灯箱支持 `Esc` 关闭、`←/→` 翻页；照片格与履历按钮均可用键盘聚焦和回车触发；
页面尊重系统的「减少动态效果」设置（`prefers-reduced-motion`）。

---

## 八、浏览器兼容

在 Chrome / Edge / Safari / Firefox 的当前版本下正常。使用了 `IntersectionObserver`、
CSS 自定义属性、`backdrop-filter`；若无 JS，内容依然完整可读（只是没有滚动动画和折叠动画）。

---

© 2026 GUIS 义工社 · 校徽版权归广州优联国际学校所有，仅供本校组织使用。
