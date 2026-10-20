#!/bin/bash
# ============================================================================
#  GUIS 义工社官网 —— 一键发布脚本
# ----------------------------------------------------------------------------
#  用法：
#    ./deploy.sh "改了成员架构"     # 提交 + 推送 + 验证
#    ./deploy.sh --dry-run "说明"   # 只做检查和 bump，不提交不推送
#
#  它替你做掉的四件烦事：
#    1. 全库 JS 语法自检（node --check）—— 改坏一个文件不会推到线上
#    2. 自动 bump 版本号（16 页 data-ver + 所有 ?v= 引用）—— 漏了就白改
#    3. 提交并推送到 GitHub（Pages 自动构建）
#    4. 推完在线验证版本号真的变了
#
#  ⚠️ 云端正式站（guis-volunteer.app.workbuddy.host，带后端）不在本脚本范围内，
#     那条链路要在 WorkBuddy 里重新发布应用 —— 见 README 里的说明。
# ============================================================================

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR" || exit 1

GH_BIN="/Users/thomaslin/.workbuddy/binaries/gh/bin"
NODE_BIN="/Users/thomaslin/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
export PATH="$GH_BIN:$PATH"

DRY=0
MSG=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    *) MSG="$a" ;;
  esac
done

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYA=$'\033[36m'; DIM=$'\033[2m'; RST=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '  %s✗%s %s\n' "$RED" "$RST" "$*"; exit 1; }
step() { printf '\n%s▸ %s%s\n' "$CYA" "$*" "$RST"; }

# ---------------------------------------------------------------------------
step "0/5  仓库状态"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "${BRANCH}" = "main" ] || die "当前分支是 ${BRANCH}，请先切到 main"
if [ -n "$(git status --porcelain)" ]; then
  ok "有未提交的改动："
  git status --short | sed 's/^/      /'
else
  warn "工作区是干净的 —— 没有改动要发布"
fi
# 远端有没有新提交（不 force push，先比对）
git fetch origin main -q 2>/dev/null
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  if git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    die "远端有你本地没有的提交，请先 git pull --rebase 再发布"
  else
    die "本地和远端分叉了，请先 git pull --rebase（不要 force push）"
  fi
fi
ok "分支 ${BRANCH}，本地与远端一致"

# ---------------------------------------------------------------------------
step "1/5  JS 语法自检（全部文件）"
BAD=0
while IFS= read -r f; do
  if ! "$NODE_BIN" --check "$f" 2>/tmp/_guis_syntax_err; then
    printf '  %s✗%s %s\n' "$RED" "$RST" "$f"
    sed 's/^/      /' /tmp/_guis_syntax_err | head -6
    BAD=1
  fi
done < <(find . -name '*.js' -not -path './.git/*' | sort)
rm -f /tmp/_guis_syntax_err
[ "$BAD" = "0" ] || die "有 JS 语法错误，已拦下（修好再发布）"
ok "全部 JS 语法正确"

# ---------------------------------------------------------------------------
step "2/5  版本号 bump"
# 当前版本：20261003k 这种形式 = 8位日期 + 1个字母
# ⚠️ macOS 自带 BSD grep，BRE 里 \{8\} 配 ? 不可靠 → 一律用 -E
CUR=$(grep -oEh 'data-ver="[0-9]{8}[a-z]?"' index.html | head -1 | sed 's/data-ver="//;s/"//')
[ -n "$CUR" ] || die "读不到当前版本号（index.html 的 data-ver）"

# 新版本：日期不变的话字母往后走（k → l），日期变了就重置为 a
TODAY=$(date +%Y%m%d)
CUR_DATE="${CUR:0:8}"; CUR_CH="${CUR:8:1}"
if [ "$CUR_DATE" = "$TODAY" ]; then
  NEXT_CH=$(printf '%s' "$CUR_CH" | awk '{printf "%s", (($1 ~ /[a-y]/)?substr("abcdefghijklmnopqrstuvwxyz", index("abcdefghijklmnopqrstuvwxyz",$1)+1,1):"a")}')
  NEW="${TODAY}${NEXT_CH}"
else
  NEW="${TODAY}a"
fi
[ "${NEW}" != "${CUR}" ] || die "算不出新版本号（当前 ${CUR}）"

# ⚠️ 只替换完整版本号串，不会碰 login.html 里的 placeholder="20261001"（学号示例）
CNT=0
for f in *.html; do
  [ -f "$f" ] || continue
  perl -pi -e "s/\Q$CUR\E/$NEW/g" "$f"
  CNT=$((CNT + 1))
done
ok "$CUR  →  $NEW   （已改 $CNT 个 HTML 里的 data-ver 与 ?v= 引用）"

# 校验：16 页必须全部一致
MIS=0
for f in *.html; do
  v=$(grep -oE 'data-ver="[^"]*"' "${f}" | head -1 | sed 's/data-ver="//;s/"//')
  [ "${v}" = "${NEW}" ] || { warn "${f} 的 data-ver 是 ${v}（应为 ${NEW}）"; MIS=1; }
done
[ "$MIS" = "0" ] || die "版本号没对齐，中止"
ok "$(ls *.html | wc -l | tr -d ' ') 页版本号一致"

# ---------------------------------------------------------------------------
step "3/5  提交"
if [ "$DRY" = "1" ]; then
  warn "dry-run 模式：到此为止，不提交不推送"
  git diff --stat | tail -20 | sed 's/^/      /'
  say ""
  say "  ${DIM}检查通过。去掉 --dry-run 就会真正发布。${RST}"
  exit 0
fi

[ -n "$MSG" ] || MSG="更新内容"
git add -A
git commit -q -m "$MSG" || die "提交失败"
NEWCOMMIT=$(git rev-parse --short HEAD)
ok "已提交 $NEWCOMMIT  $MSG"

# ---------------------------------------------------------------------------
step "4/5  推送到 GitHub"
# 永不 force push
git push -q origin main || die "推送失败（凭据问题找 thomaslin040214-sketch 的 token）"
ok "已推送 origin/main"

# ---------------------------------------------------------------------------
step "5/5  验证线上"
sleep 3
PAGES="https://thomaslin040214-sketch.github.io/guis-volunteer/"
CLOUD="https://guis-volunteer.app.workbuddy.host/"

check() {
  local name="$1" url="$2"
  local got=""
  for i in 1 2 3 4 5; do
    got=$(curl -sL "${url}?cb=$(date +%s)$RANDOM" | grep -oE 'data-ver="[^"]*"' | head -1 | sed 's/data-ver="//;s/"//')
    [ -n "$got" ] && break
    sleep 2
  done
  if [ "$got" = "$NEW" ]; then
    printf '  %s✓%s %-14s %s  %s\n' "$GRN" "$RST" "$name" "$got" "（已更新）"
  else
    printf '  %s!%s %-14s %s  %s（构建可能还在跑，等 1 分钟刷新）\n' "$YEL" "$RST" "$name" "${got:-读取失败}" ""
  fi
}

check "GitHub Pages" "$PAGES"
check "云端正式站" "$CLOUD"

say ""
say "  ${GRN}发布完成${RST}  版本 $NEW  (commit $NEWCOMMIT)"
say ""
say "  ${DIM}镜像站（无后端）${RST}  $PAGES"
say "  ${DIM}正式站（有后端）${RST}  $CLOUD"
say ""
say "  ${YEL}注意${RST}  如果上面「云端正式站」那行没变成 ${NEW}，"
say "  说明云应用还没重新发布 —— 在 WorkBuddy 里对 guis-volunteer 目录"
say "  说一句「发布」即可（那个必须走应用发布，不能只靠 git push）。"
say ""
say "  ${DIM}浏览器要 Cmd+Shift+R 强刷，否则可能还看旧缓存。${RST}"
