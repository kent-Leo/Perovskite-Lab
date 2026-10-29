#!/bin/zsh
set -e
LAB_DIR="${0:A:h}"
cd "$LAB_DIR"
if ! command -v npm >/dev/null 2>&1; then
  print "Perovskite Lab v0.9.2 需要 Node.js 20.19+ 或 22.12+。请安装 Node.js 后重新打开。"
  read "?按回车退出"
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print "请先在项目目录运行 npm install，再重新打开工作台。"
  read "?按回车退出"
  exit 1
fi
print "正在构建 Perovskite Lab v0.9.2。网页与 AI 转发接口使用 http://127.0.0.1:4173/"
print "如端口被旧版服务占用，请先在旧服务终端按 Ctrl+C。"
npm run build
exec npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --open
