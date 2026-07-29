"""Menyiapkan lingkungan agar modul di `vendor/` bisa dipakai tanpa diubah.

Tiga hal yang dikerjakan, dan HARUS dalam urutan ini:

1. Daftarkan shim `streamlit` ke `sys.modules` — sebelum vendor diimpor.
2. Tambahkan `vendor/` ke `sys.path` — modul vendor saling mengimpor dengan
   nama telanjang (`from komersil_rules import ...`), dan
   `proses_mapping_data_komersil._find_spec_path()` mencari file spec di folder
   skripnya sendiri, jadi xlsx-nya ikut ketemu.
3. Tambal resolusi identitas akun/brand — lihat `pin_identity()`.
"""

from __future__ import annotations

import contextlib
import contextvars
import os
import re
import sys
from pathlib import Path

_VENDOR = Path(__file__).resolve().parent.parent / "vendor"

_ready = False


def _load_dev_env() -> None:
    """Di dev lokal, ambil DATABASE_URL dari .env.local repo.

    Di Docker tidak pernah aktif: `env_file` compose sudah menyediakan
    DATABASE_URL, dan `.env.local` memang tidak ikut disalin ke image (Dockerfile
    hanya menyalin `vendor/` dan `app/`). Jadi ini murni kenyamanan `uvicorn`
    langsung dari mesin developer.
    """
    if os.getenv("DATABASE_URL"):
        return
    env_file = Path(__file__).resolve().parents[3] / ".env.local"
    if not env_file.exists():
        return
    pattern = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        m = pattern.match(line)
        if not m:
            continue
        value = m.group(2).strip()
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        os.environ.setdefault(m.group(1), value)


def ensure_ready() -> None:
    """Idempoten; aman dipanggil berulang."""
    global _ready
    if _ready:
        return

    _load_dev_env()

    from . import shim

    sys.modules.setdefault("streamlit", shim)

    vendor = str(_VENDOR)
    if vendor not in sys.path:
        sys.path.insert(0, vendor)

    # psycopg2 menghormati variabel libpq. Timescale Cloud mewajibkan TLS,
    # sementara get_postgres_engine_cached() vendor membangun URL tanpa
    # sslmode — jadi kita setel lewat environment, bukan dengan mengedit vendor.
    os.environ.setdefault("PGSSLMODE", "require")

    _install_identity_patch()
    _ready = True


# ── identitas akun & brand ─────────────────────────────────────────────────
# Keputusan desain: Kepiai yang memiliki siklus hidup akun (kuota per platform,
# soft-delete, aturan satu platform satu sumber, upload avatar). Karena itu
# self-heal vendor — yang bisa MEMBUAT baris social_accounts sendiri, lalu jatuh
# ke UUID uuid5 deterministik kalau gagal — dimatikan total. Kalau id-nya tidak
# dikirim, kita berhenti dengan error; jauh lebih baik daripada menulis data ke
# akun hantu yang tak pernah muncul di UI.

_PINNED: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "mapping_engine_identity", default=None
)


@contextlib.contextmanager
def pin_identity(accounts: dict[str, str], brand_id: str | None):
    """`accounts` = {platform: social_account_id} untuk batch ini."""
    token = _PINNED.set({
        "accounts": {str(k).strip().lower(): str(v) for k, v in (accounts or {}).items() if v},
        "brand_id": str(brand_id) if brand_id else None,
    })
    try:
        yield
    finally:
        _PINNED.reset(token)


class IdentityNotPinned(ValueError):
    pass


def _install_identity_patch() -> None:
    import komersil_rules

    def _resolve_social_account_id(engine, channel, brand=None, username=None,
                                   platform_user_id=None, org_id=None):
        pinned = _PINNED.get()
        key = str(channel or "").strip().lower()
        sid = (pinned or {}).get("accounts", {}).get(key)
        if not sid:
            raise IdentityNotPinned(
                f"social_account_id untuk platform '{key or '-'}' tidak dikirim. "
                "Akun harus dibuat lebih dulu di Kepiai — mesin ini tidak "
                "membuat akun sendiri."
            )
        return sid

    def _brand_id(engine, brand=None, org_id=None):
        return (_PINNED.get() or {}).get("brand_id")

    komersil_rules._resolve_social_account_id = _resolve_social_account_id
    komersil_rules._brand_id = _brand_id
