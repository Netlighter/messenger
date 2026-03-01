from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import time

ROOT = Path(__file__).parent / "public"
DB_PATH = Path(__file__).parent / "messenger.db"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
ONLINE_TTL_SECONDS = 60 * 3
MAX_AVATAR_SIZE = 1024 * 1024
MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024
MAX_ATTACHMENTS = 6


def now_ts() -> int:
    return int(time.time())


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with connect_db() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode=WAL;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                avatar_data_url TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                attachments_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )

        cols = {r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()}
        if "attachments_json" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'")
        conn.commit()


def hash_password(password: str, salt: str) -> str:
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hashed.hex()


def issue_token() -> str:
    return secrets.token_urlsafe(32)


def sanitize_nickname(raw: str) -> str:
    return str(raw or "").strip()[:32]


def sanitize_text(raw: str) -> str:
    return str(raw or "").strip()[:700]


def sanitize_image_data_url(data_url: str | None, max_size: int) -> str | None:
    if not data_url:
        return None
    data_url = str(data_url)
    if len(data_url) > max_size * 2:
        return None
    if not data_url.startswith("data:image/") or ";base64," not in data_url:
        return None
    header, b64 = data_url.split(",", 1)
    if not (header.startswith("data:image/png") or header.startswith("data:image/jpeg") or header.startswith("data:image/webp") or header.startswith("data:image/gif")):
        return None
    try:
        decoded = base64.b64decode(b64, validate=True)
    except Exception:
        return None
    if len(decoded) > max_size:
        return None
    return data_url


def sanitize_avatar_data_url(data_url: str | None) -> str | None:
    return sanitize_image_data_url(data_url, MAX_AVATAR_SIZE)


def sanitize_attachments(raw) -> list[str] | None:
    if raw is None:
        return []
    if not isinstance(raw, list):
        return None
    cleaned: list[str] = []
    for item in raw[:MAX_ATTACHMENTS]:
        val = sanitize_image_data_url(item, MAX_ATTACHMENT_SIZE)
        if not val:
            return None
        cleaned.append(val)
    return cleaned


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = issue_token()
    ts = now_ts()
    conn.execute(
        "INSERT INTO sessions(token, user_id, expires_at, last_seen) VALUES (?, ?, ?, ?)",
        (token, user_id, ts + SESSION_TTL_SECONDS, ts),
    )
    return token


def purge_expired_sessions(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_ts(),))


def get_session_user(conn: sqlite3.Connection, token: str | None):
    if not token:
        return None
    purge_expired_sessions(conn)
    row = conn.execute(
        """
        SELECT u.id, u.nickname, u.avatar_data_url
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()
    if not row:
        return None
    conn.execute(
        "UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token = ?",
        (now_ts(), now_ts() + SESSION_TTL_SECONDS, token),
    )
    return row


def list_users_with_status(conn: sqlite3.Connection):
    threshold = now_ts() - ONLINE_TTL_SECONDS
    rows = conn.execute(
        """
        SELECT
            u.nickname,
            u.avatar_data_url,
            MAX(CASE WHEN s.last_seen >= ? AND s.expires_at >= ? THEN 1 ELSE 0 END) AS online
        FROM users u
        LEFT JOIN sessions s ON s.user_id = u.id
        GROUP BY u.id
        ORDER BY online DESC, u.nickname COLLATE NOCASE
        """,
        (threshold, now_ts()),
    ).fetchall()
    return [
        {
            "nickname": r["nickname"],
            "avatar": r["avatar_data_url"],
            "online": bool(r["online"]),
        }
        for r in rows
    ]


def list_messages(conn: sqlite3.Connection, limit: int = 150):
    rows = conn.execute(
        """
        SELECT m.id, m.text, m.attachments_json, m.created_at, u.nickname, u.avatar_data_url
        FROM messages m
        JOIN users u ON u.id = m.user_id
        ORDER BY m.id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    rows.reverse()
    payload = []
    for r in rows:
        try:
            attachments = json.loads(r["attachments_json"] or "[]")
        except Exception:
            attachments = []
        if not isinstance(attachments, list):
            attachments = []
        payload.append(
            {
                "id": r["id"],
                "text": r["text"],
                "createdAt": r["created_at"],
                "nickname": r["nickname"],
                "avatar": r["avatar_data_url"],
                "attachments": attachments[:MAX_ATTACHMENTS],
            }
        )
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "MessengerServer/2.1"

    def _json(self, status: int, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(size) if size else b"{}"
        return json.loads(raw)

    def _bearer_token(self) -> str | None:
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        return None

    def do_GET(self):
        if self.path.startswith("/api/me"):
            with connect_db() as conn:
                user = get_session_user(conn, self._bearer_token())
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                conn.commit()
                return self._json(
                    200,
                    {
                        "id": user["id"],
                        "nickname": user["nickname"],
                        "avatar": user["avatar_data_url"],
                    },
                )

        if self.path.startswith("/api/state"):
            with connect_db() as conn:
                user = get_session_user(conn, self._bearer_token())
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                payload = {
                    "me": {
                        "id": user["id"],
                        "nickname": user["nickname"],
                        "avatar": user["avatar_data_url"],
                    },
                    "users": list_users_with_status(conn),
                    "messages": list_messages(conn),
                }
                conn.commit()
                return self._json(200, payload)

        file_path = ROOT / ("index.html" if self.path == "/" else self.path.lstrip("/"))
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return

        content = file_path.read_bytes()
        mime = "text/plain; charset=utf-8"
        if file_path.suffix == ".html":
            mime = "text/html; charset=utf-8"
        elif file_path.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif file_path.suffix in {".js", ".jsx"}:
            mime = "application/javascript; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path == "/api/register":
            data = self._read_json()
            nickname = sanitize_nickname(data.get("nickname", ""))
            password = str(data.get("password", ""))
            avatar = sanitize_avatar_data_url(data.get("avatar"))
            if len(nickname) < 3 or len(password) < 6:
                return self._json(400, {"error": "nickname >=3 and password >=6 required"})

            salt = secrets.token_hex(16)
            password_hash = hash_password(password, salt)

            try:
                with connect_db() as conn:
                    cursor = conn.execute(
                        "INSERT INTO users(nickname, password_hash, salt, avatar_data_url, created_at) VALUES (?, ?, ?, ?, ?)",
                        (nickname, password_hash, salt, avatar, now_ts()),
                    )
                    token = create_session(conn, cursor.lastrowid)
                    conn.commit()
                    return self._json(200, {"token": token})
            except sqlite3.IntegrityError:
                return self._json(409, {"error": "nickname already exists"})

        if self.path == "/api/login":
            data = self._read_json()
            nickname = sanitize_nickname(data.get("nickname", ""))
            password = str(data.get("password", ""))
            with connect_db() as conn:
                row = conn.execute(
                    "SELECT id, password_hash, salt FROM users WHERE nickname = ?",
                    (nickname,),
                ).fetchone()
                if not row:
                    return self._json(401, {"error": "invalid credentials"})
                computed = hash_password(password, row["salt"])
                if not hmac.compare_digest(computed, row["password_hash"]):
                    return self._json(401, {"error": "invalid credentials"})
                token = create_session(conn, row["id"])
                conn.commit()
                return self._json(200, {"token": token})

        if self.path == "/api/logout":
            with connect_db() as conn:
                token = self._bearer_token()
                if token:
                    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                    conn.commit()
            return self._json(200, {"ok": True})

        if self.path == "/api/avatar":
            data = self._read_json()
            avatar = sanitize_avatar_data_url(data.get("avatar"))
            if avatar is None:
                return self._json(400, {"error": "invalid avatar"})
            with connect_db() as conn:
                user = get_session_user(conn, self._bearer_token())
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                conn.execute("UPDATE users SET avatar_data_url = ? WHERE id = ?", (avatar, user["id"]))
                conn.commit()
                return self._json(200, {"ok": True, "avatar": avatar})

        if self.path == "/api/message":
            data = self._read_json()
            text = sanitize_text(data.get("text", ""))
            attachments = sanitize_attachments(data.get("attachments"))
            if attachments is None:
                return self._json(400, {"error": "invalid attachments"})
            if not text and not attachments:
                return self._json(400, {"error": "empty message"})
            with connect_db() as conn:
                user = get_session_user(conn, self._bearer_token())
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                conn.execute(
                    "INSERT INTO messages(user_id, text, attachments_json, created_at) VALUES (?, ?, ?, ?)",
                    (user["id"], text, json.dumps(attachments, ensure_ascii=False), now_ts() * 1000),
                )
                conn.commit()
                return self._json(200, {"ok": True})

        self.send_error(404)


if __name__ == "__main__":
    init_db()
    host = "0.0.0.0"
    port = 3000
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Server started at http://{host}:{port}")
    server.serve_forever()
