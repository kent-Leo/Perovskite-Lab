#!/bin/zsh
set -e
LAB_DIR="${0:A:h}"
LAB_PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
if [[ ! -x "$LAB_PYTHON" ]]; then
  LAB_PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$LAB_PYTHON" ]]; then
  print "请安装 Python 3 后重试。"
  exit 1
fi
exec "$LAB_PYTHON" "$LAB_DIR/启动服务-2026.10.1.py" --port 4176 --page worksheet-v0.2.0-2026.10.19.html
