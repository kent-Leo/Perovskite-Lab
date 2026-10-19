"""Serve the built frontend locally. No third-party Python packages required."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
from socketserver import TCPServer
import threading
import webbrowser


class LocalServer(ThreadingHTTPServer):
    def server_bind(self):
        # A numeric loopback address needs no reverse DNS lookup.
        TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


def main():
    parser = argparse.ArgumentParser(description="启动 Perovskite Lab 本地网页")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / "dist"
    if not (root / "index.html").is_file():
        raise SystemExit("缺少构建后的网页，请先完成前端 build。")
    try:
        server = LocalServer(
            ("127.0.0.1", args.port), partial(SimpleHTTPRequestHandler, directory=str(root))
        )
    except OSError as exc:
        raise SystemExit(f"无法启动端口 {args.port}：{exc}\n可使用 --port 其他端口 再试。")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Perovskite Lab 已启动：{url}\n使用期间请保留此窗口。结束时按 Ctrl+C。", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPerovskite Lab 已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
