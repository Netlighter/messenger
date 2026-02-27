from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from pathlib import Path
import json
import time
import uuid

ROOT = Path(__file__).parent / "public"
TTL_SECONDS = 12

clients = {}
messages = []


def cleanup_clients():
    now = time.time()
    stale = [cid for cid, c in clients.items() if now - c["last_seen"] > TTL_SECONDS]
    for cid in stale:
        clients.pop(cid, None)


def online_users():
    return [entry["nickname"] for entry in clients.values()]


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(size) if size else b"{}")

    def do_GET(self):
        if self.path.startswith("/api/state"):
            cleanup_clients()
            query = parse_qs(urlparse(self.path).query)
            client_id = (query.get("clientId") or [""])[0]
            if client_id in clients:
                clients[client_id]["last_seen"] = time.time()
            return self._json(200, {"users": online_users(), "messages": messages})

        file_path = ROOT / ("index.html" if self.path == "/" else self.path.lstrip("/"))
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return

        content = file_path.read_bytes()
        mime = "text/plain"
        if file_path.suffix == ".html":
            mime = "text/html; charset=utf-8"
        elif file_path.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif file_path.suffix == ".js":
            mime = "application/javascript; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path == "/api/join":
            data = self._read_json()
            nickname = str(data.get("nickname", "")).strip()[:32]
            client_id = str(data.get("clientId", "")).strip() or str(uuid.uuid4())
            if not nickname:
                return self._json(400, {"error": "nickname required"})

            clients[client_id] = {"nickname": nickname, "last_seen": time.time()}
            cleanup_clients()
            return self._json(200, {"ok": True, "clientId": client_id})

        if self.path == "/api/message":
            data = self._read_json()
            client_id = str(data.get("clientId", "")).strip()
            text = str(data.get("text", "")).strip()[:400]
            sender = clients.get(client_id)
            if not sender or not text:
                return self._json(400, {"error": "invalid message"})

            message = {
                "id": str(uuid.uuid4()),
                "nickname": sender["nickname"],
                "text": text,
                "createdAt": int(time.time() * 1000),
            }
            messages.append(message)
            if len(messages) > 200:
                del messages[:-200]
            return self._json(200, {"ok": True})

        self.send_error(404)


if __name__ == "__main__":
    host = "0.0.0.0"
    port = 3000
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Server started at http://{host}:{port}")
    server.serve_forever()
