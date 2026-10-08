"""Serve the prototype locally. Stop with Ctrl+C.

The project list is rebuilt every time the page loads, so a findings file added
to data/<method>/ shows up on the next browser refresh.
"""

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build_manifest

ROOT = Path(__file__).parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }

    def do_GET(self):
        if self.path.split("?")[0] == "/data/projects.json":
            build_manifest.main(verbose=False)
        super().do_GET()

    def end_headers(self):
        # Edited data files show up on refresh instead of coming from the browser cache.

        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to share on your network")
    args = parser.parse_args()

    build_manifest.main()

    handler = functools.partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"\nSmell Presenter running at http://{args.host}:{args.port}  (Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
