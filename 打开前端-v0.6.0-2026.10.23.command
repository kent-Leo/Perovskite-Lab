#!/bin/zsh
set -e
LAB_DIR="${0:A:h}"
LAB_PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
if [[ ! -x "$LAB_PYTHON" ]]; then
  LAB_PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$LAB_PYTHON" ]]; then
  print "未找到 Python 3。请按 README-2026.10.1.md 中的前端启动方法运行。"
  read "?按回车退出"
  exit 1
fi
exec "$LAB_PYTHON" "$LAB_DIR/启动服务-2026.10.1.py"
