/* ============================================================================
   GUIS 义工组织 —— 部门成员 & 管理层 数据
   ----------------------------------------------------------------------------
   这是【唯一需要你编辑】的文件。改这里就能更新「部门成员」页和其中的管理层。

   编辑位置一目了然：
   1) departments[]  —— 三个部门，每个部门有一张「架构图」：
         head    = 部长（在架构图顶部，有头像 / 姓名 / 加入时间 / 过往履历）
         members = 部员（在架构图下方，只有头像 / 姓名 / 加入时间，没有履历）
   2) leadership[]  —— 管理层：社长，以及三个部门的部长（本届不设副社长）。
         社长：在这里直接填（含履历）。
         三个部长：用 { headRef: "pr" | "hr" | "org" } 引用上面部门里的部长，
                   这样「部门架构图」和「管理层」共用同一份头像与履历，改一处即可。

   字段说明（每条都可直接改）：
     avatar  头像图片路径。把照片放到 assets/photos/ 下，写 "assets/photos/xxx.jpg"。
             如果留空 "" 或图片不存在，会自动显示姓名首字作为占位头像。
     name / name_en        姓名（中文 / 英文，英文可留空，留空则显示中文）
     role / role_en        职务（如 "部长"、"President"），管理层/部长必填
     join / join_en        加入时间（如 "2024-09" 或 "2024 年 9 月"）
     resume[]             过往履历（只有部长和管理层需要，部员不用填）。
                         每条：{ when, what, note, when_en, what_en, note_en }
     facts[]              履历底部的小标签（如 "累计服务 320 小时"、"中英双语"）

   提示：头像建议正方形、约 400×400 以上；文件名随便起，只要和 avatar 路径一致。
   ============================================================================ */

window.GUIS_TEAM = {
  departments: [
    {
      id: "pr",
      name: "公关及对外宣传部",
      name_en: "Publicity & Public Relations",
      // —— 部长（架构图顶部，需要履历）——
      head: {
        avatar: "assets/photos/dep-pr-head.jpg",
        name: "吴依颖",
        name_en: "Ellie Wu",
        role: "部长",
        role_en: "Department Lead",
        join: "于2026年08月就任",
        join_en: "Inaugurated in August 2026",
        resume: [
          {
            when: "2023年09月",
            what: "加入义工组织并就职于人力资源部",
            note: "担任部员及统计一职",
            when_en: "September 2023", what_en: "Joined the GUIS-VA Human Resources Department", note_en: "Enrol as the member and data keeping role"
          },
          {
            when: "2024年2月",
            what: "调任义工组织公关及对外宣传部",
            note: "由于组织架构调整调任于宣传部",
            when_en: "February 2024", what_en: "Joined the Publicity & PR Department", note_en: "Due to adjustment of team structure, role reallocating to the Publicity Dept."
          }
        ],
        facts: ["（亮点一，如 累计服务 200 小时）", "（亮点二，如 中英双语）"]
      },
      // —— 部员（架构图下方，只有头像 / 姓名 / 加入时间）——
      members: [
        { avatar: "assets/photos/dep-pr-m1.jpg", name: "（部员姓名）", name_en: "", join: "（加入时间）", join_en: "" },
        { avatar: "assets/photos/dep-pr-m2.jpg", name: "（部员姓名）", name_en: "", join: "（加入时间）", join_en: "" },
        { avatar: "assets/photos/dep-pr-m3.jpg", name: "（部员姓名）", name_en: "", join: "（加入时间）", join_en: "" }
      ]
    },

    {
      id: "hr",
      name: "人力资源部",
      name_en: "Human Resources Department",
      head: {
        avatar: "assets/photos/dep-hr-head.jpg",
        name: "邱梅馨颍",
        name_en: "Evelyn Qiumei",
        role: "部长",
        role_en: "Department Head",
        join: "于2026年08月就任",
        join_en: "Inaugurated in August 2026",
        resume: [
          {
            when: "（年份·学期）",
            what: "（事件标题）",
            note: "（具体说明）",
            when_en: "", what_en: "", note_en: ""
          },
          {
            when: "（年份·学期）",
            what: "（事件标题）",
            note: "（具体说明）",
            when_en: "", what_en: "", note_en: ""
          }
        ],
        facts: ["（亮点一）", "（亮点二）"]
      },
      members: [
        { avatar: "assets/photos/dep-hr-m1.jpg", name: "陈芳", name_en: "Ariel Chen", join: "2023年08月加入", join_en: "Joined in August 2022" },
        { avatar: "assets/photos/dep-hr-m2.jpg", name: "厉一尘", name_en: "Cherise Li", join: "2023年08月加入", join_en: "Joined in August 2023" },
         { avatar: "assets/photos/dep-hr-m2.jpg", name: "邹以恬", name_en: "Celina Zou", join: "2023年08月加入", join_en: "Joined in August 2023" },        
         { avatar: "assets/photos/dep-hr-m2.jpg", name: "何家秀", name_en: "Julie He", join: "2023年08月加入", join_en: "Joined in August 2023" },
      ]
    },

    {
      id: "org",
      name: "组织部",
      name_en: "Organization Department",
      head: {
        avatar: "assets/photos/dep-org-head.jpg",
        name: "（在此填写部长姓名）",
        name_en: "",
        role: "部长",
        role_en: "Department Head",
        join: "（在此填写加入时间，如 2024-09）",
        join_en: "",
        resume: [
          {
            when: "（年份·学期）",
            what: "（事件标题）",
            note: "（具体说明）",
            when_en: "", what_en: "", note_en: ""
          },
          {
            when: "（年份·学期）",
            what: "（事件标题）",
            note: "（具体说明）",
            when_en: "", what_en: "", note_en: ""
          }
        ],
        facts: ["（亮点一）", "（亮点二）"]
      },
      members: [
        { avatar: "assets/photos/dep-org-m1.jpg", name: "（部员姓名）", name_en: "", join: "（加入时间）", join_en: "" },
        { avatar: "assets/photos/dep-org-m2.jpg", name: "（部员姓名）", name_en: "", join: "（加入时间）", join_en: "" },
        { avatar: "assets/photos/dep-org-m3.jpg", name: "（部员姓名）", name_en: "", join: "（加入时间）", join_en: "" }
      ]
    }
  ],

  leadership: [
    {
      role: "社长",
      role_en: "President",
      avatar: "assets/photos/lead-president.jpg",
      name: "（在此填写社长姓名）",
      name_en: "",
      join: "（加入时间）",
      join_en: "",
      resume: [
        {
          when: "（年份·学期）",
          what: "（事件标题）",
          note: "（具体说明）",
          when_en: "", what_en: "", note_en: ""
        },
        {
          when: "（年份·学期）",
          what: "（事件标题）",
          note: "（具体说明）",
          when_en: "", what_en: "", note_en: ""
        }
      ],
      facts: ["（亮点一）", "（亮点二）", "（亮点三）"]
    },
    // 三个部长：引用上面部门里的 head，头像与履历自动共用，改部门即可同步。
    { headRef: "pr" },
    { headRef: "hr" },
    { headRef: "org" }
  ]
};
