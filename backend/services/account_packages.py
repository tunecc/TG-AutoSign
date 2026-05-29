from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import ipaddress
import json
import logging
import os
import re
import shutil
import sqlite3
import struct
import tempfile
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from backend.core.config import get_settings
from backend.core.runtime_config import get_telegram_api_runtime_config
from backend.utils.tg_session import (
    delete_session_string_file,
    get_account_private_fields,
    get_account_session_string,
    get_session_mode,
    load_session_string_file,
    save_session_string_file,
    set_account_session_string,
    update_account_private_fields,
)

logger = logging.getLogger("backend.account_packages")

_PYROGRAM_SESSION_FORMAT = ">BI?256sQ?"
_TELETHON_VERSION = "1"
_MAX_ZIP_ENTRIES = 20_000
_MAX_ZIP_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024
_VALID_ACCOUNT_NAME_RE = re.compile(r"[^A-Za-z0-9\u4e00-\u9fff]")
_PHONE_DIGITS_RE = re.compile(r"\D+")

_DC_ENDPOINTS: dict[int, tuple[str, int]] = {
    1: ("149.154.175.53", 443),
    2: ("149.154.167.51", 443),
    3: ("149.154.175.100", 443),
    4: ("149.154.167.91", 443),
    5: ("91.108.56.130", 443),
}

_PYROGRAM_SCHEMA = """
CREATE TABLE sessions
(
    dc_id     INTEGER PRIMARY KEY,
    api_id    INTEGER,
    test_mode INTEGER,
    auth_key  BLOB,
    date      INTEGER NOT NULL,
    user_id   INTEGER,
    is_bot    INTEGER
);

CREATE TABLE peers
(
    id             INTEGER PRIMARY KEY,
    access_hash    INTEGER,
    type           INTEGER NOT NULL,
    phone_number   TEXT,
    last_update_on INTEGER NOT NULL DEFAULT (CAST(STRFTIME('%s', 'now') AS INTEGER))
);

CREATE TABLE usernames
(
    id       INTEGER,
    username TEXT,
    FOREIGN KEY (id) REFERENCES peers(id)
);

CREATE TABLE update_state
(
    id   INTEGER PRIMARY KEY,
    pts  INTEGER,
    qts  INTEGER,
    date INTEGER,
    seq  INTEGER
);

CREATE TABLE version
(
    number INTEGER PRIMARY KEY
);

CREATE INDEX idx_peers_id ON peers (id);
CREATE INDEX idx_peers_phone_number ON peers (phone_number);
CREATE INDEX idx_usernames_id ON usernames (id);
CREATE INDEX idx_usernames_username ON usernames (username);

CREATE TRIGGER trg_peers_last_update_on
    AFTER UPDATE
    ON peers
BEGIN
    UPDATE peers
    SET last_update_on = CAST(STRFTIME('%s', 'now') AS INTEGER)
    WHERE id = NEW.id;
END;
"""


@dataclass(frozen=True)
class SessionData:
    dc_id: int
    api_id: int
    auth_key: bytes
    user_id: Optional[int] = None
    is_bot: bool = False
    test_mode: bool = False
    server_address: Optional[str] = None
    port: Optional[int] = None


@dataclass(frozen=True)
class ImportItemResult:
    account_name: str
    source: str
    format: str
    status: str
    message: str

    @property
    def success(self) -> bool:
        return self.status == "success"


@dataclass(frozen=True)
class ImportPackageResult:
    success_count: int
    failure_count: int
    skipped_count: int
    items: list[ImportItemResult]


@dataclass(frozen=True)
class PackageMetadata:
    phone: Optional[str] = None
    username: Optional[str] = None
    first_name: Optional[str] = None
    user_id: Optional[int] = None
    api_id: Optional[int] = None
    api_hash: Optional[str] = None
    session_string: Optional[str] = None
    is_bot: bool = False
    test_mode: bool = False


@dataclass(frozen=True)
class TelethonCandidate:
    directory: Path
    json_path: Path
    session_path: Path


@dataclass(frozen=True)
class TdataCandidate:
    tdata_dir: Path
    account_dir: Path


def _normalize_phone(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    digits = _PHONE_DIGITS_RE.sub("", value)
    return digits or None


def _safe_account_name(*values: Optional[str], fallback: str = "account") -> str:
    for value in values:
        if not isinstance(value, str):
            continue
        value = value.strip()
        if not value:
            continue
        phone = _normalize_phone(value)
        if phone and len(phone) >= 5:
            return phone
        cleaned = _VALID_ACCOUNT_NAME_RE.sub("", value)
        if cleaned:
            return cleaned[:80]
    return fallback


def _safe_zip_name(path: str) -> str:
    parts = []
    for part in Path(path).parts:
        if part in {"", ".", ".."}:
            continue
        parts.append(_VALID_ACCOUNT_NAME_RE.sub("", part) or "item")
    return "/".join(parts) or "item"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _get_str(data: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _get_int(data: dict[str, Any], *keys: str) -> Optional[int]:
    for key in keys:
        value = data.get(key)
        if value is None:
            continue
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return None


def _metadata_from_json(path: Path) -> PackageMetadata:
    data = _read_json(path)
    return PackageMetadata(
        phone=_get_str(data, "phone", "phone_number", "phoneNumber"),
        username=_get_str(data, "username"),
        first_name=_get_str(data, "first_name", "firstName", "first"),
        user_id=_get_int(data, "user_id", "userId", "uid"),
        api_id=_get_int(data, "api_id", "apiId", "app_id", "appId"),
        api_hash=_get_str(data, "api_hash", "apiHash", "app_hash", "appHash"),
        session_string=_get_str(data, "session_string", "sessionString"),
        is_bot=bool(data.get("is_bot", data.get("isBot", False))),
        test_mode=bool(data.get("test_mode", data.get("testMode", False))),
    )


def _merge_metadata(primary: PackageMetadata, fallback: PackageMetadata) -> PackageMetadata:
    return PackageMetadata(
        phone=primary.phone or fallback.phone,
        username=primary.username or fallback.username,
        first_name=primary.first_name or fallback.first_name,
        user_id=primary.user_id or fallback.user_id,
        api_id=primary.api_id or fallback.api_id,
        api_hash=primary.api_hash or fallback.api_hash,
        session_string=primary.session_string or fallback.session_string,
        is_bot=primary.is_bot or fallback.is_bot,
        test_mode=primary.test_mode or fallback.test_mode,
    )


def _runtime_api_metadata() -> PackageMetadata:
    runtime = get_telegram_api_runtime_config()
    return PackageMetadata(api_id=runtime.api_id, api_hash=runtime.api_hash)


def _b64url_decode(value: str) -> bytes:
    normalized = value.strip().replace("-", "+").replace("_", "/")
    mod = len(normalized) % 4
    if mod == 2:
        normalized += "=="
    elif mod == 3:
        normalized += "="
    elif mod == 1:
        raise ValueError("base64url 长度非法")
    return base64.b64decode(normalized)


def _b64url_encode(value: bytes, *, keep_padding: bool = False) -> str:
    encoded = base64.urlsafe_b64encode(value).decode("ascii")
    return encoded if keep_padding else encoded.rstrip("=")


def parse_telethon_string_session(session_string: str, api_id: int) -> SessionData:
    value = session_string.strip()
    if not value or not value[0].isdigit():
        raise ValueError("不是 Telethon StringSession")

    packed = _b64url_decode(value[1:])
    if len(packed) not in {263, 275}:
        raise ValueError("Telethon StringSession 长度不符合预期")

    dc_id = packed[0]
    ip_len = len(packed) - 1 - 2 - 256
    if ip_len not in {4, 16}:
        raise ValueError("Telethon StringSession IP 长度不符合预期")

    ip = str(ipaddress.ip_address(packed[1 : 1 + ip_len]))
    port = struct.unpack(">H", packed[1 + ip_len : 1 + ip_len + 2])[0]
    auth_key = packed[1 + ip_len + 2 :]
    if len(auth_key) != 256:
        raise ValueError("Telethon auth_key 长度不符合预期")

    return SessionData(
        dc_id=dc_id,
        api_id=api_id,
        auth_key=auth_key,
        server_address=ip,
        port=port,
    )


def build_telethon_string_session(data: SessionData) -> str:
    server, port = _resolve_endpoint(data)
    ip_bytes = ipaddress.ip_address(server).packed
    packed = bytearray(1 + len(ip_bytes) + 2 + 256)
    packed[0] = data.dc_id
    packed[1 : 1 + len(ip_bytes)] = ip_bytes
    struct.pack_into(">H", packed, 1 + len(ip_bytes), port)
    packed[1 + len(ip_bytes) + 2 :] = data.auth_key
    return _TELETHON_VERSION + _b64url_encode(bytes(packed), keep_padding=True)


def parse_pyrogram_string_session(session_string: str) -> SessionData:
    packed = _b64url_decode(session_string.strip())
    size = struct.calcsize(_PYROGRAM_SESSION_FORMAT)
    if len(packed) != size:
        raise ValueError("Pyrogram session_string 长度不符合预期")
    dc_id, api_id, test_mode, auth_key, user_id, is_bot = struct.unpack(
        _PYROGRAM_SESSION_FORMAT,
        packed,
    )
    if len(auth_key) != 256:
        raise ValueError("Pyrogram auth_key 长度不符合预期")
    return SessionData(
        dc_id=dc_id,
        api_id=api_id,
        auth_key=auth_key,
        user_id=user_id or None,
        is_bot=bool(is_bot),
        test_mode=bool(test_mode),
    )


def build_pyrogram_string_session(data: SessionData) -> str:
    packed = struct.pack(
        _PYROGRAM_SESSION_FORMAT,
        int(data.dc_id),
        int(data.api_id),
        bool(data.test_mode),
        data.auth_key,
        int(data.user_id or 0),
        bool(data.is_bot),
    )
    return _b64url_encode(packed)


def read_session_file(path: Path, fallback_api_id: Optional[int] = None) -> SessionData:
    if not path.exists():
        raise ValueError("session 文件不存在")
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            cols = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(sessions)").fetchall()
            }
            if {"dc_id", "server_address", "port", "auth_key"}.issubset(cols):
                row = conn.execute(
                    "SELECT dc_id, server_address, port, auth_key FROM sessions LIMIT 1"
                ).fetchone()
                if not row:
                    raise ValueError("sessions 表为空")
                auth_key = bytes(row["auth_key"] or b"")
                if len(auth_key) != 256:
                    raise ValueError("Telethon auth_key 长度不符合预期")
                return SessionData(
                    dc_id=int(row["dc_id"]),
                    api_id=int(fallback_api_id or 0),
                    auth_key=auth_key,
                    server_address=str(row["server_address"] or ""),
                    port=int(row["port"] or 443),
                )
            if {"dc_id", "api_id", "test_mode", "auth_key", "user_id", "is_bot"}.issubset(cols):
                row = conn.execute(
                    "SELECT dc_id, api_id, test_mode, auth_key, user_id, is_bot FROM sessions LIMIT 1"
                ).fetchone()
                if not row:
                    raise ValueError("sessions 表为空")
                auth_key = bytes(row["auth_key"] or b"")
                if len(auth_key) != 256:
                    raise ValueError("Pyrogram auth_key 长度不符合预期")
                api_id = int(row["api_id"] or fallback_api_id or 0)
                return SessionData(
                    dc_id=int(row["dc_id"]),
                    api_id=api_id,
                    auth_key=auth_key,
                    user_id=int(row["user_id"] or 0) or None,
                    is_bot=bool(row["is_bot"]),
                    test_mode=bool(row["test_mode"]),
                )
    except sqlite3.Error as exc:
        raise ValueError(f"无法读取 SQLite session: {exc}") from exc
    raise ValueError("不支持的 session 文件格式")


def _decode_wtelegram_session_key(api_hash: Optional[str]) -> bytes:
    if not isinstance(api_hash, str) or not api_hash.strip():
        raise ValueError("缺少 api_hash，无法解密 WTelegram session")
    try:
        key = bytes.fromhex(api_hash.strip())
    except ValueError as exc:
        raise ValueError("api_hash 不是合法十六进制，无法解密 WTelegram session") from exc
    if len(key) not in {16, 24, 32}:
        raise ValueError("api_hash 长度不符合 AES key 要求，无法解密 WTelegram session")
    return key


def _iter_wtelegram_session_blocks(path: Path) -> list[bytes]:
    raw = path.read_bytes()
    blocks: list[bytes] = []
    if len(raw) >= 8:
        position, length = struct.unpack("<ii", raw[:8])
        if position >= 8 and length >= 32 and position + length <= len(raw):
            blocks.append(raw[position : position + length])
    if len(raw) >= 32:
        blocks.append(raw)

    unique: list[bytes] = []
    seen: set[bytes] = set()
    for block in blocks:
        digest = hashlib.sha256(block).digest()
        if digest in seen:
            continue
        seen.add(digest)
        unique.append(block)
    if not unique:
        raise ValueError("WTelegram session 文件过小")
    return unique


def _decrypt_wtelegram_session_block(block: bytes, key: bytes) -> dict[str, Any]:
    if len(block) < 32 or len(block) % 16 != 0:
        raise ValueError("WTelegram session 加密块长度非法")
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.primitives.padding import PKCS7
    except ImportError as exc:
        raise ValueError("缺少 cryptography 依赖，无法读取 WTelegram session") from exc

    try:
        decryptor = Cipher(
            algorithms.AES(key),
            modes.CBC(block[:16]),
        ).decryptor()
        padded = decryptor.update(block[16:]) + decryptor.finalize()
        unpadder = PKCS7(128).unpadder()
        clear = unpadder.update(padded) + unpadder.finalize()
    except Exception as exc:
        raise ValueError("WTelegram session 解密失败") from exc

    if len(clear) <= 32:
        raise ValueError("WTelegram session 明文长度非法")
    digest = clear[:32]
    payload = clear[32:]
    if hashlib.sha256(payload).digest() != digest:
        raise ValueError("WTelegram session 完整性校验失败，api_hash 可能不匹配")

    try:
        data = json.loads(payload.decode("utf-8"))
    except Exception as exc:
        raise ValueError("WTelegram session JSON 解析失败") from exc
    if not isinstance(data, dict):
        raise ValueError("WTelegram session JSON 格式非法")
    return data


def _case_get(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    lowered = {key.lower(): value for key, value in data.items() if isinstance(key, str)}
    for key in keys:
        value = lowered.get(key.lower())
        if value is not None:
            return value
    return None


def _as_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _decode_wtelegram_auth_key(value: Any) -> Optional[bytes]:
    if isinstance(value, str) and value.strip():
        try:
            return base64.b64decode(value.strip(), validate=True)
        except Exception:
            return None
    if isinstance(value, list):
        try:
            return bytes(int(item) & 0xFF for item in value)
        except Exception:
            return None
    return None


def _dc_flags_has_media_only(value: Any) -> bool:
    if isinstance(value, int):
        return bool(value & 2)
    if isinstance(value, str):
        return "media_only" in value.lower()
    if isinstance(value, list):
        return any(_dc_flags_has_media_only(item) for item in value)
    return False


def _parse_wtelegram_dc_option(
    option: Any,
    *,
    fallback_dc_id: Optional[int],
) -> tuple[Optional[int], Optional[str], Optional[int], bool]:
    if not isinstance(option, dict):
        return fallback_dc_id, None, None, False

    dc_id = _as_int(_case_get(option, "id", "Id", "ID")) or fallback_dc_id
    server = _case_get(option, "ip_address", "ipAddress", "server_address", "serverAddress")
    server = server.strip() if isinstance(server, str) and server.strip() else None
    if server:
        try:
            server = str(ipaddress.ip_address(server))
        except ValueError:
            server = None
    port = _as_int(_case_get(option, "port", "Port"))
    if not port or port <= 0 or port > 65535:
        port = None
    media_only = _dc_flags_has_media_only(_case_get(option, "flags", "Flags"))
    return dc_id, server, port, media_only


def _find_wtelegram_dc_option(
    document: dict[str, Any],
    *,
    dc_id: Optional[int],
) -> Optional[dict[str, Any]]:
    if not dc_id:
        return None
    dc_options = _case_get(document, "DcOptions", "dcOptions", "dc_options")
    if not isinstance(dc_options, list):
        return None
    for option in dc_options:
        if not isinstance(option, dict):
            continue
        option_dc_id = _as_int(_case_get(option, "id", "Id", "ID"))
        if option_dc_id == dc_id:
            return option
    return None


def _session_data_from_wtelegram_json(
    document: dict[str, Any],
    *,
    fallback_api_id: Optional[int],
    target_user_id: Optional[int],
) -> SessionData:
    api_id = _as_int(_case_get(document, "ApiId", "api_id", "apiId")) or int(fallback_api_id or 0)
    main_dc = _as_int(_case_get(document, "MainDC", "main_dc", "mainDc")) or 0
    session_user_id = _as_int(_case_get(document, "UserId", "user_id", "userId"))
    dc_sessions = _case_get(document, "DCSessions", "dcSessions", "dc_sessions")
    if not isinstance(dc_sessions, dict) or not dc_sessions:
        raise ValueError("WTelegram session 中未找到 DC 会话数据")

    candidates: list[tuple[int, SessionData]] = []
    for raw_key, raw_session in dc_sessions.items():
        if not isinstance(raw_session, dict):
            continue
        dc_key = _as_int(raw_key)
        fallback_dc_id = abs(dc_key) if dc_key else (main_dc or None)
        auth_key = _decode_wtelegram_auth_key(
            _case_get(raw_session, "AuthKey", "auth_key", "authKey")
        )
        if not auth_key or len(auth_key) != 256:
            continue

        direct_option = _case_get(raw_session, "DataCenter", "dataCenter", "data_center")
        option = direct_option if isinstance(direct_option, dict) else _find_wtelegram_dc_option(
            document,
            dc_id=fallback_dc_id,
        )
        dc_id, server, port, media_only = _parse_wtelegram_dc_option(
            option,
            fallback_dc_id=fallback_dc_id,
        )
        if not dc_id or dc_id <= 0 or dc_id > 255:
            continue
        if not server:
            endpoint = _DC_ENDPOINTS.get(dc_id)
            if endpoint:
                server, port = endpoint

        dc_user_id = (
            _as_int(_case_get(raw_session, "UserId", "user_id", "userId"))
            or session_user_id
        )
        score = 0
        if main_dc and dc_id == main_dc:
            score += 120
        if dc_user_id and dc_user_id > 0:
            score += 50
        if target_user_id and dc_user_id == target_user_id:
            score += 40
        if dc_key and dc_key > 0:
            score += 10
        if media_only or (dc_key is not None and dc_key < 0):
            score -= 30

        candidates.append(
            (
                score,
                SessionData(
                    dc_id=dc_id,
                    api_id=api_id,
                    auth_key=auth_key,
                    user_id=dc_user_id,
                    server_address=server,
                    port=port,
                ),
            )
        )

    if not candidates:
        raise ValueError("无法从 WTelegram session 中解析有效 AuthKey/DataCenter")
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def read_wtelegram_session_file(
    path: Path,
    api_hash: Optional[str],
    fallback_api_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
) -> SessionData:
    if not path.exists():
        raise ValueError("session 文件不存在")
    key = _decode_wtelegram_session_key(api_hash)
    errors: list[str] = []
    for block in _iter_wtelegram_session_blocks(path):
        try:
            document = _decrypt_wtelegram_session_block(block, key)
            return _session_data_from_wtelegram_json(
                document,
                fallback_api_id=fallback_api_id,
                target_user_id=target_user_id,
            )
        except ValueError as exc:
            message = str(exc)
            if "cryptography" in message:
                raise
            errors.append(message)

    detail = "；".join(dict.fromkeys(errors)) or "未知错误"
    raise ValueError(f"无法读取 WTelegram session：{detail}")


def read_package_session_data(path: Path, metadata: PackageMetadata) -> SessionData:
    errors: list[str] = []
    if metadata.session_string:
        try:
            return parse_telethon_string_session(metadata.session_string, int(metadata.api_id or 0))
        except ValueError as exc:
            errors.append(f"session_string 无效：{exc}")

    try:
        return read_session_file(path, metadata.api_id)
    except ValueError as exc:
        errors.append(f"SQLite session：{exc}")

    try:
        return read_wtelegram_session_file(
            path,
            metadata.api_hash,
            metadata.api_id,
            metadata.user_id,
        )
    except ValueError as exc:
        errors.append(f"WTelegram session：{exc}")

    raise ValueError("无法读取 session 文件：" + "；".join(errors))


def write_pyrogram_session_file(path: Path, data: SessionData) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".session.tmp")
    if tmp_path.exists():
        tmp_path.unlink()
    with sqlite3.connect(tmp_path) as conn:
        conn.executescript(_PYROGRAM_SCHEMA)
        conn.execute("INSERT INTO version VALUES (?)", (6,))
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                int(data.dc_id),
                int(data.api_id),
                1 if data.test_mode else 0,
                data.auth_key,
                int(time.time()),
                int(data.user_id or 0),
                1 if data.is_bot else 0,
            ),
        )
        conn.commit()
    tmp_path.replace(path)


def write_telethon_session_file(path: Path, data: SessionData) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".session.tmp")
    if tmp_path.exists():
        tmp_path.unlink()
    server, port = _resolve_endpoint(data)
    with sqlite3.connect(tmp_path) as conn:
        conn.execute("CREATE TABLE version (version INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO version VALUES (7)")
        conn.execute(
            "CREATE TABLE sessions (dc_id INTEGER PRIMARY KEY, server_address TEXT, port INTEGER, auth_key BLOB, takeout_id INTEGER)"
        )
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, NULL)",
            (int(data.dc_id), server, int(port), data.auth_key),
        )
        conn.execute(
            "CREATE TABLE entities (id INTEGER PRIMARY KEY, hash INTEGER NOT NULL, username TEXT, phone INTEGER, name TEXT, date INTEGER)"
        )
        conn.execute("CREATE TABLE sent_files (md5_digest BLOB, file_size INTEGER, type INTEGER, id INTEGER, hash INTEGER, PRIMARY KEY(md5_digest, file_size, type))")
        conn.execute("CREATE TABLE update_state (id INTEGER PRIMARY KEY, pts INTEGER, qts INTEGER, date INTEGER, seq INTEGER)")
        conn.commit()
    tmp_path.replace(path)


def _resolve_endpoint(data: SessionData) -> tuple[str, int]:
    if data.server_address:
        return data.server_address, int(data.port or 443)
    endpoint = _DC_ENDPOINTS.get(int(data.dc_id))
    if endpoint:
        return endpoint
    return _DC_ENDPOINTS[2]


def _looks_like_tdata_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    try:
        if (path / "key_datas").exists():
            return True
        return any(path.glob("D877F783D5D3EF8C*"))
    except OSError:
        return False


class TdataSessionBridge:
    _setup_lock = asyncio.Lock()

    _TDATA_TO_TELETHON_SCRIPT = """
import { convertFromTdata, convertToTelethonSession } from '@mtcute/convert';

const inputPath = process.argv[process.argv.length - 1];

try {
  const session = await convertFromTdata({ path: inputPath, ignoreVersion: true });
  const sessionString = convertToTelethonSession(session);
  const userId = session?.self?.userId ?? null;
  console.log(JSON.stringify({ ok: true, sessionString, userId }));
} catch (error) {
  const message = error?.stack ? String(error.stack) : String(error);
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
"""

    _TELETHON_TO_TDATA_SCRIPT = """
import { convertFromTelethonSession, convertToTdata } from '@mtcute/convert';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const payload = JSON.parse(raw || '{}');

try {
  const session = convertFromTelethonSession(payload.sessionString);
  const userId = Number.parseInt(String(payload.userId || '0'), 10);
  if (Number.isFinite(userId) && userId > 0) {
    session.self = {
      userId,
      isBot: Boolean(payload.isBot),
      isPremium: false,
      usernames: [],
    };
  }
  await convertToTdata(session, { path: payload.outputDir });
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  const message = error?.stack ? String(error.stack) : String(error);
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
"""

    def __init__(self) -> None:
        self.runtime_dir = self._resolve_runtime_dir()

    @staticmethod
    def _resolve_runtime_dir() -> Path:
        override = os.getenv("TG_TDATA_RUNTIME_DIR")
        if override:
            return Path(override).expanduser()
        opt_runtime = Path("/opt/tg-autosign-tdata-runtime")
        if (opt_runtime / "node_modules" / "@mtcute" / "convert" / "package.json").exists():
            return opt_runtime
        return get_settings().resolve_base_dir() / "tdata-runtime"

    async def convert_tdata_to_telethon(self, tdata_dir: Path) -> tuple[str, Optional[int]]:
        await self._ensure_runtime_ready()
        result = await self._run_node(
            ["--input-type=module", "-e", self._TDATA_TO_TELETHON_SCRIPT, "--", str(tdata_dir.resolve())],
            timeout=90,
        )
        data = self._parse_node_json(result[0], result[1])
        if not data.get("ok"):
            raise ValueError(str(data.get("error") or "tdata 转换失败"))
        session_string = str(data.get("sessionString") or "").strip()
        if not session_string:
            raise ValueError("tdata 转换结果缺少 sessionString")
        user_id = data.get("userId")
        try:
            parsed_user_id = int(user_id) if user_id else None
        except (TypeError, ValueError):
            parsed_user_id = None
        return session_string, parsed_user_id

    async def convert_telethon_to_tdata(
        self,
        session_string: str,
        output_dir: Path,
        *,
        user_id: Optional[int] = None,
        is_bot: bool = False,
    ) -> None:
        await self._ensure_runtime_ready()
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {
                "sessionString": session_string,
                "outputDir": str(output_dir.resolve()),
                "userId": user_id or 0,
                "isBot": is_bot,
            },
            ensure_ascii=False,
        )
        stdout, stderr = await self._run_node(
            ["--input-type=module", "-e", self._TELETHON_TO_TDATA_SCRIPT],
            input_text=payload,
            timeout=90,
        )
        data = self._parse_node_json(stdout, stderr)
        if not data.get("ok"):
            raise ValueError(str(data.get("error") or "Telethon 转 tdata 失败"))
        if not any(output_dir.iterdir()):
            raise ValueError("tdata 输出目录为空")

    async def _ensure_runtime_ready(self) -> None:
        async with self._setup_lock:
            self.runtime_dir.mkdir(parents=True, exist_ok=True)
            if self._has_required_packages():
                return
            await self._run_node(["--version"], timeout=10)
            package_json = self.runtime_dir / "package.json"
            if not package_json.exists():
                package_json.write_text(
                    json.dumps(
                        {
                            "name": "tg-autosign-tdata-runtime",
                            "private": True,
                            "type": "module",
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            stdout, stderr = await self._run_process(
                "npm",
                ["install", "--silent", "--no-audit", "--no-fund", "@mtcute/convert", "@mtcute/node"],
                timeout=180,
            )
            if not self._has_required_packages():
                detail = (stderr or stdout or "npm install failed").strip()
                raise ValueError(f"tdata 依赖不可用：{detail}")

    def _has_required_packages(self) -> bool:
        return (
            self.runtime_dir / "node_modules" / "@mtcute" / "convert" / "package.json"
        ).exists() and (
            self.runtime_dir / "node_modules" / "@mtcute" / "node" / "package.json"
        ).exists()

    async def _run_node(
        self,
        args: list[str],
        *,
        input_text: Optional[str] = None,
        timeout: int,
    ) -> tuple[str, str]:
        return await self._run_process("node", args, input_text=input_text, timeout=timeout)

    async def _run_process(
        self,
        executable: str,
        args: list[str],
        *,
        input_text: Optional[str] = None,
        timeout: int,
    ) -> tuple[str, str]:
        try:
            process = await asyncio.create_subprocess_exec(
                executable,
                *args,
                cwd=str(self.runtime_dir),
                stdin=asyncio.subprocess.PIPE if input_text is not None else None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise ValueError(f"{executable} 不可用，请确认运行环境已安装") from exc

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(
                    input_text.encode("utf-8") if input_text is not None else None
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError as exc:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            raise ValueError(f"{executable} 执行超时") from exc

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")
        if process.returncode != 0 and not stdout.strip():
            raise ValueError((stderr or f"{executable} 执行失败").strip())
        return stdout, stderr

    @staticmethod
    def _parse_node_json(stdout: str, stderr: str) -> dict[str, Any]:
        lines = [line.strip() for line in stdout.splitlines() if line.strip()]
        for line in reversed(lines):
            if line.startswith("{") and line.endswith("}"):
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    break
                if isinstance(data, dict):
                    return data
        detail = (stderr or stdout or "node 输出为空").strip()
        raise ValueError(detail)


class AccountPackageService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.session_dir = self.settings.resolve_session_dir()
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.tdata_bridge = TdataSessionBridge()

    async def import_zip(self, content: bytes, *, overwrite: bool = False) -> ImportPackageResult:
        items: list[ImportItemResult] = []
        with tempfile.TemporaryDirectory(prefix="tg-autosign-import-") as temp_root:
            root = Path(temp_root)
            try:
                self._extract_zip(content, root)
            except ValueError as exc:
                item = ImportItemResult("", "zip", "unknown", "failed", str(exc))
                return ImportPackageResult(0, 1, 0, [item])

            telethon_candidates = self._find_telethon_candidates(root)
            imported_tdata_roots: set[Path] = set()

            for candidate in telethon_candidates:
                result = await self._import_telethon_candidate(candidate, overwrite=overwrite)
                items.append(result)
                if result.status in {"success", "skipped"}:
                    imported_tdata_roots.add(candidate.directory.resolve())

            for candidate in self._find_tdata_candidates(root, imported_tdata_roots):
                items.append(await self._import_tdata_candidate(candidate, overwrite=overwrite))

        if not items:
            items.append(ImportItemResult("", "zip", "unknown", "failed", "未发现可导入账号"))

        return ImportPackageResult(
            success_count=sum(1 for item in items if item.status == "success"),
            failure_count=sum(1 for item in items if item.status == "failed"),
            skipped_count=sum(1 for item in items if item.status == "skipped"),
            items=items,
        )

    async def export_zip(
        self,
        account_names: Optional[list[str]] = None,
        *,
        format: str = "telethon",
    ) -> bytes:
        from io import BytesIO
        from zipfile import ZIP_DEFLATED

        from backend.services.telegram import get_telegram_service

        normalized_format = "tdata" if format.lower() == "tdata" else "telethon"
        service = get_telegram_service()
        accounts = service.list_accounts(force_refresh=True)
        selected = {name for name in (account_names or []) if name}
        if selected:
            accounts = [item for item in accounts if item.get("name") in selected]

        output = BytesIO()
        with zipfile.ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
            self._write_text(
                archive,
                "README.txt",
                "\n".join(
                    [
                        "TG-AutoSign 账号导出包",
                        f"导出格式：{normalized_format}",
                        "每个账号一个目录，包含 .json + .session；tdata 格式额外包含 tdata/。",
                        "请妥善保管该压缩包，其中包含可登录 Telegram 的会话数据。",
                    ]
                ),
            )

            for account in accounts:
                account_name = str(account.get("name") or "").strip()
                if not account_name:
                    continue
                safe_folder = _safe_account_name(account_name, fallback="account")
                try:
                    data = self._read_account_session_data(account_name)
                    metadata = get_account_private_fields(account_name)
                    api_hash = str(
                        metadata.get("api_hash")
                        or get_telegram_api_runtime_config().api_hash
                        or ""
                    )
                    self._write_export_json(archive, safe_folder, account_name, data, metadata, api_hash)
                    self._write_export_session(archive, safe_folder, data)
                    two_factor_password = metadata.get("two_factor_password")
                    if isinstance(two_factor_password, str) and two_factor_password.strip():
                        self._write_text(archive, f"{safe_folder}/2fa.txt", two_factor_password.strip())

                    if normalized_format == "tdata":
                        await self._write_export_tdata(archive, safe_folder, data)
                except Exception as exc:
                    logger.warning("导出账号失败: account=%s, error=%s", account_name, exc)
                    self._write_text(
                        archive,
                        f"{safe_folder}/ERROR.txt",
                        f"导出该账号失败：{exc}",
                    )

        return output.getvalue()

    def _extract_zip(self, content: bytes, target_dir: Path) -> None:
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                infos = archive.infolist()
                if not infos:
                    raise ValueError("Zip 压缩包为空")
                if len(infos) > _MAX_ZIP_ENTRIES:
                    raise ValueError("Zip 文件数量过多")
                total_size = sum(max(0, info.file_size) for info in infos)
                if total_size > _MAX_ZIP_TOTAL_UNCOMPRESSED:
                    raise ValueError("Zip 解压后体积过大")

                target_root = target_dir.resolve()
                for info in infos:
                    raw_name = info.filename.replace("\\", "/")
                    if raw_name.startswith("/") or "\x00" in raw_name:
                        raise ValueError("Zip 包含非法路径")
                    dest = (target_dir / raw_name).resolve()
                    if target_root != dest and target_root not in dest.parents:
                        raise ValueError("Zip 包含路径穿越内容")
                    if info.is_dir():
                        dest.mkdir(parents=True, exist_ok=True)
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as src, dest.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
        except zipfile.BadZipFile as exc:
            raise ValueError("不是有效的 Zip 压缩包") from exc

    def _find_telethon_candidates(self, root: Path) -> list[TelethonCandidate]:
        candidates: list[TelethonCandidate] = []
        seen: set[Path] = set()
        for directory in [root, *[p for p in root.rglob("*") if p.is_dir()]]:
            json_files = sorted(directory.glob("*.json"))
            session_files = sorted(directory.glob("*.session"))
            if not json_files or not session_files:
                continue
            resolved = directory.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            json_path = self._pick_matching_file(json_files, session_files)
            session_path = self._pick_matching_file(session_files, json_files)
            candidates.append(TelethonCandidate(directory, json_path, session_path))
        candidates.sort(key=lambda item: str(item.directory.relative_to(root)))
        return candidates

    @staticmethod
    def _pick_matching_file(primary: list[Path], secondary: list[Path]) -> Path:
        secondary_stems = {item.stem for item in secondary}
        for item in primary:
            if item.stem in secondary_stems:
                return item
        return primary[0]

    def _find_tdata_candidates(self, root: Path, imported_roots: set[Path]) -> list[TdataCandidate]:
        candidates: list[TdataCandidate] = []
        seen: set[Path] = set()
        for directory in [root, *[p for p in root.rglob("*") if p.is_dir()]]:
            if not _looks_like_tdata_dir(directory):
                continue
            resolved = directory.resolve()
            if resolved in seen:
                continue
            if any(parent == resolved or parent in resolved.parents for parent in imported_roots):
                continue
            seen.add(resolved)
            account_dir = directory.parent if directory.name.lower() == "tdata" else directory
            candidates.append(TdataCandidate(directory, account_dir))
        candidates.sort(key=lambda item: str(item.tdata_dir.relative_to(root)))
        return candidates

    async def _import_telethon_candidate(
        self,
        candidate: TelethonCandidate,
        *,
        overwrite: bool,
    ) -> ImportItemResult:
        metadata = _merge_metadata(
            _metadata_from_json(candidate.json_path),
            _runtime_api_metadata(),
        )
        account_name = _safe_account_name(
            metadata.phone,
            metadata.username,
            candidate.directory.name,
            candidate.json_path.stem,
            fallback="account",
        )
        source = _safe_zip_name(str(candidate.directory.name or candidate.json_path.name))
        try:
            if self._account_exists(account_name) and not overwrite:
                return ImportItemResult(account_name, source, "telethon", "skipped", "账号已存在")

            if not metadata.api_id:
                return ImportItemResult(account_name, source, "telethon", "failed", "缺少 api_id")

            session_data = read_package_session_data(candidate.session_path, metadata)
            session_data = self._apply_metadata(session_data, metadata)
            await self._persist_account_session(account_name, session_data, overwrite=overwrite)
            self._persist_account_metadata(account_name, metadata, candidate.directory)
            return ImportItemResult(account_name, source, "telethon", "success", "导入成功")
        except Exception as exc:
            logger.warning("Telethon 账号导入失败: source=%s, error=%s", source, exc)
            return ImportItemResult(account_name, source, "telethon", "failed", str(exc))

    async def _import_tdata_candidate(
        self,
        candidate: TdataCandidate,
        *,
        overwrite: bool,
    ) -> ImportItemResult:
        raw_source_name = candidate.account_dir.name or "tdata"
        if raw_source_name.lower().startswith("tg-autosign-import-"):
            raw_source_name = "tdata"
        source = _safe_zip_name(str(raw_source_name))
        metadata = _runtime_api_metadata()
        account_name = (
            "account"
            if raw_source_name.lower() == "tdata"
            else _safe_account_name(raw_source_name, fallback="account")
        )
        try:
            session_string, user_id = await self.tdata_bridge.convert_tdata_to_telethon(candidate.tdata_dir)
            if user_id:
                metadata = _merge_metadata(PackageMetadata(user_id=user_id), metadata)
            if account_name == "account" and user_id:
                account_name = f"account{user_id}"

            if self._account_exists(account_name) and not overwrite:
                return ImportItemResult(account_name, source, "tdata", "skipped", "账号已存在")

            if not metadata.api_id:
                return ImportItemResult(account_name, source, "tdata", "failed", "缺少 api_id")

            session_data = parse_telethon_string_session(session_string, metadata.api_id)
            session_data = self._apply_metadata(session_data, metadata)
            await self._persist_account_session(account_name, session_data, overwrite=overwrite)
            self._persist_account_metadata(account_name, metadata, candidate.account_dir)
            return ImportItemResult(account_name, source, "tdata", "success", "导入成功")
        except Exception as exc:
            logger.warning("TData 账号导入失败: source=%s, error=%s", source, exc)
            return ImportItemResult(account_name, source, "tdata", "failed", str(exc))

    @staticmethod
    def _apply_metadata(data: SessionData, metadata: PackageMetadata) -> SessionData:
        return SessionData(
            dc_id=data.dc_id,
            api_id=metadata.api_id or data.api_id,
            auth_key=data.auth_key,
            user_id=metadata.user_id or data.user_id,
            is_bot=metadata.is_bot or data.is_bot,
            test_mode=metadata.test_mode or data.test_mode,
            server_address=data.server_address,
            port=data.port,
        )

    async def _persist_account_session(
        self,
        account_name: str,
        data: SessionData,
        *,
        overwrite: bool,
    ) -> None:
        if overwrite:
            from backend.services.telegram import get_telegram_service

            await get_telegram_service().delete_account(account_name)

        self.session_dir.mkdir(parents=True, exist_ok=True)
        if get_session_mode() == "string":
            session_string = build_pyrogram_string_session(data)
            set_account_session_string(account_name, session_string)
            save_session_string_file(self.session_dir, account_name, session_string)
            session_file = self.session_dir / f"{account_name}.session"
            if session_file.exists():
                session_file.unlink()
        else:
            write_pyrogram_session_file(self.session_dir / f"{account_name}.session", data)
            delete_session_string_file(self.session_dir, account_name)

    def _persist_account_metadata(
        self,
        account_name: str,
        metadata: PackageMetadata,
        directory: Path,
    ) -> None:
        fields: dict[str, Any] = {
            "phone": metadata.phone,
            "username": metadata.username,
            "first_name": metadata.first_name,
            "user_id": metadata.user_id,
            "api_id": metadata.api_id,
            "api_hash": metadata.api_hash,
        }
        two_factor_password = self._read_two_factor_password(directory)
        if two_factor_password:
            fields["two_factor_password"] = two_factor_password
        update_account_private_fields(account_name, fields)

    @staticmethod
    def _read_two_factor_password(directory: Path) -> Optional[str]:
        for name in ("2fa.txt", "2FA.txt", "2fa", "2FA", "twofa.txt", "password.txt"):
            path = directory / name
            if path.exists() and path.is_file():
                try:
                    value = path.read_text(encoding="utf-8").strip()
                except UnicodeDecodeError:
                    value = path.read_text(encoding="utf-8", errors="ignore").strip()
                if value:
                    return value
        return None

    def _account_exists(self, account_name: str) -> bool:
        if get_account_session_string(account_name):
            return True
        if load_session_string_file(self.session_dir, account_name):
            return True
        return (self.session_dir / f"{account_name}.session").exists()

    def _read_account_session_data(self, account_name: str) -> SessionData:
        private = get_account_private_fields(account_name)
        fallback_api_id = _get_int(private, "api_id") or get_telegram_api_runtime_config().api_id
        session_string = get_account_session_string(account_name) or load_session_string_file(
            self.session_dir,
            account_name,
        )
        if session_string:
            data = parse_pyrogram_string_session(session_string)
            if fallback_api_id and not data.api_id:
                return self._apply_metadata(data, PackageMetadata(api_id=fallback_api_id))
            return data
        return read_session_file(self.session_dir / f"{account_name}.session", fallback_api_id)

    def _write_export_json(
        self,
        archive: zipfile.ZipFile,
        folder: str,
        account_name: str,
        data: SessionData,
        metadata: dict[str, Any],
        api_hash: str,
    ) -> None:
        payload = {
            "phone": metadata.get("phone") or account_name,
            "user_id": data.user_id or metadata.get("user_id"),
            "username": metadata.get("username"),
            "first_name": metadata.get("first_name"),
            "api_id": data.api_id or metadata.get("api_id"),
            "api_hash": api_hash,
            "session_string": build_telethon_string_session(data),
            "session_mode": "tg-autosign-export",
            "exported_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        self._write_text(
            archive,
            f"{folder}/{folder}.json",
            json.dumps(payload, ensure_ascii=False, indent=2),
        )

    def _write_export_session(
        self,
        archive: zipfile.ZipFile,
        folder: str,
        data: SessionData,
    ) -> None:
        with tempfile.TemporaryDirectory(prefix="tg-autosign-export-session-") as temp_dir:
            session_path = Path(temp_dir) / f"{folder}.session"
            write_telethon_session_file(session_path, data)
            archive.write(session_path, f"{folder}/{folder}.session")

    async def _write_export_tdata(
        self,
        archive: zipfile.ZipFile,
        folder: str,
        data: SessionData,
    ) -> None:
        with tempfile.TemporaryDirectory(prefix="tg-autosign-export-tdata-") as temp_dir:
            output_dir = Path(temp_dir) / "tdata"
            await self.tdata_bridge.convert_telethon_to_tdata(
                build_telethon_string_session(data),
                output_dir,
                user_id=data.user_id,
                is_bot=data.is_bot,
            )
            for path in sorted(output_dir.rglob("*")):
                if not path.is_file():
                    continue
                rel = path.relative_to(output_dir).as_posix()
                archive.write(path, f"{folder}/tdata/{rel}")

    @staticmethod
    def _write_text(archive: zipfile.ZipFile, path: str, content: str) -> None:
        archive.writestr(path, content.encode("utf-8"))


_account_package_service: Optional[AccountPackageService] = None


def get_account_package_service() -> AccountPackageService:
    global _account_package_service
    if _account_package_service is None:
        _account_package_service = AccountPackageService()
    return _account_package_service
