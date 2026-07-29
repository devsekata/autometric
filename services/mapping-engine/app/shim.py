"""Modul `streamlit` tiruan.

`vendor/postgres_addon_komersil.py` mengimpor streamlit dan memanggil 10 API-nya
(error, warning, success, toast, columns, metric, markdown, expander, button,
text_input, secrets, cache_resource). Semuanya kosmetik kecuali `secrets` dan
`cache_resource`.

Dengan mendaftarkan modul ini sebagai `sys.modules["streamlit"]` SEBELUM vendor
diimpor, file vendor bisa dipakai **tanpa satu baris pun diubah** — lihat
`vendor/VENDOR.md`.

Pesan yang tadinya dirender ke layar dikumpulkan ke buffer per-request supaya
bisa dikembalikan sebagai `warnings`/`errors` di respons API. Diagnostik vendor
memang berguna ("atribut post kosong di file", "metrik FPK GAGAL: ...") — jangan
dibuang begitu saja.
"""

from __future__ import annotations

import contextlib
import contextvars
import functools
import os
from typing import Any
from urllib.parse import unquote, urlparse

# ── buffer pesan per-request ────────────────────────────────────────────────
_MESSAGES: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar(
    "mapping_engine_messages", default=None
)


@contextlib.contextmanager
def collect_messages():
    """Kumpulkan pesan vendor selama blok ini. Yield list yang terisi in-place."""
    buf: list[dict] = []
    token = _MESSAGES.set(buf)
    try:
        yield buf
    finally:
        _MESSAGES.reset(token)


def _emit(level: str, body: Any) -> None:
    buf = _MESSAGES.get()
    if buf is not None:
        buf.append({"level": level, "message": str(body)})


# ── kredensial DB ──────────────────────────────────────────────────────────
# get_postgres_config() vendor membaca st.secrets["postgres_komersil"] lalu
# fallback ke PGHOST/PGPORT/... . Kepiai menyimpan satu DATABASE_URL, jadi kita
# uraikan di sini — hasilnya vendor otomatis menulis ke DB yang sama dengan
# aplikasi, tanpa duplikasi kredensial di dua tempat.
def _postgres_from_database_url() -> dict:
    raw = os.getenv("DATABASE_URL", "").strip()
    if not raw:
        return {}
    u = urlparse(raw)
    if not u.hostname:
        return {}
    cfg = {
        "host": u.hostname,
        "port": u.port or 5432,
        "database": (u.path or "/").lstrip("/") or "postgres",
        "schema": os.getenv("PGSCHEMA", "l0_raw"),
    }
    if u.username:
        cfg["user"] = unquote(u.username)
    if u.password:
        cfg["password"] = unquote(u.password)
    return cfg


class _Secrets(dict):
    def get(self, key, default=None):  # noqa: D102 - meniru st.secrets.get
        if key == "postgres_komersil":
            cfg = _postgres_from_database_url()
            return cfg if cfg else (default if default is not None else {})
        return super().get(key, default)

    def __getitem__(self, key):
        value = self.get(key)
        if value is None:
            raise KeyError(key)
        return value


secrets = _Secrets()


# ── API kosmetik ───────────────────────────────────────────────────────────
def error(body=None, **_kw):
    _emit("error", body)


def warning(body=None, **_kw):
    _emit("warning", body)


def success(body=None, **_kw):
    _emit("success", body)


def info(body=None, **_kw):
    _emit("info", body)


def toast(body=None, **_kw):
    _emit("info", body)


def markdown(body=None, **_kw):
    return None


def metric(label=None, value=None, **_kw):
    return None


def text_input(label=None, value="", **_kw):
    # Mode headless selalu memakai schema/table default dari aturan komersil.
    return value


def button(label=None, **_kw):
    # Insert dijalankan lewat auto_insert=True, bukan lewat tombol.
    return False


class _Slot:
    """Pengganti kolom/kontainer Streamlit — semua metode jadi no-op."""

    def __getattr__(self, _name):
        return lambda *a, **k: None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def columns(spec, **_kw):
    n = spec if isinstance(spec, int) else len(spec)
    return [_Slot() for _ in range(n)]


def container(**_kw):
    return _Slot()


def expander(label=None, **_kw):
    return _Slot()


def cache_resource(func=None, **_kw):
    """Padanan @st.cache_resource. Dipakai vendor untuk meng-cache engine
    SQLAlchemy per (host, port, database, user, password) — lru_cache cukup."""
    def wrap(f):
        return functools.lru_cache(maxsize=None)(f)

    return wrap(func) if callable(func) else wrap


def spinner(*_a, **_kw):
    return _Slot()


def __getattr__(name):
    """Jaring pengaman: API Streamlit lain yang mungkin muncul setelah vendor
    diperbarui tidak boleh menjatuhkan service — cukup jadi no-op."""
    return lambda *a, **k: None
