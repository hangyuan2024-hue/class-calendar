#!/usr/bin/env bash
# 把一个文件放到你自己 GitHub 仓库的 Release 里（国外的电脑从这里下，不靠别人的网站）。
#   一个 Release 一组：mirror-<组名>（比如 mirror-grid、mirror-gsv）；没有就建一个（预发布，不抢 latest）
#   GitHub 一个文件最大 2G：超过 1.9G 的切成 名字.p001、名字.p002…（客户端按顺序接起来，核对总的 sha256）
#   已经有、大小一样的跳过
# 用法：bash .github/workflows/gh-put.sh <本地文件> <组名> [在 Release 里叫什么名字]
# 输出一行 JSON：["下载地址1", "下载地址2", ...]（没切就只有一个）
set -euo pipefail
F="$1"; G="$2"; N="${3:-$(basename "$F")}"
TAG="mirror-$G"; REPO="${GITHUB_REPOSITORY}"
N=$(printf '%s' "$N" | tr -c 'A-Za-z0-9._+-' '_')   # Release 里的文件名只留安全字符
SIZE=$(stat -c %s "$F"); LIMIT=$((1900 * 1048576))
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 || gh release create "$TAG" --repo "$REPO" --prerelease --title "组件镜像：$G" --notes "捞捞的组件镜像（国外的电脑从这里下载）。由 Actions「AI 组件搬到国内存储」自动上传，请不要手动改。" >&2
HAVE=$(gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[] | "\(.name) \(.size)"')
base="https://github.com/$REPO/releases/download/$TAG"
put() { local f="$1" n="$2" s; s=$(stat -c %s "$f"); if printf '%s\n' "$HAVE" | grep -qx "$n $s"; then echo "GitHub 上已经有了：$n" >&2; return 0; fi
  for i in 1 2 3 4; do if gh release upload "$TAG" "$f" --repo "$REPO" --clobber >&2; then return 0; fi; echo "传 GitHub 失败，第 $i 次重试" >&2; sleep $((i * 15)); done; return 1; }
if [ "$SIZE" -le "$LIMIT" ]; then
  # Release 里的文件名 = 上传的文件名：先硬链接成要的名字（不占地方），不行再复制
  D=$(mktemp -d -p "$(dirname "$F")"); ln -f "$F" "$D/$N" 2>/dev/null || cp -f "$F" "$D/$N"
  put "$D/$N" "$N"; rm -rf "$D"
  printf '["%s/%s"]\n' "$base" "$N"
else
  D=$(mktemp -d); split -b "$LIMIT" -d -a 3 --numeric-suffixes=1 "$F" "$D/$N.p"
  urls=()
  for p in "$D"/*; do put "$p" "$(basename "$p")"; urls+=("\"$base/$(basename "$p")\""); rm -f "$p"; done
  rmdir "$D"
  (IFS=,; printf '[%s]\n' "${urls[*]}")
fi
