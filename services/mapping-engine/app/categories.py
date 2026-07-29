"""Kategori yang benar-benar bisa ditulis, diturunkan dari aturan vendor.

Daftarnya TIDAK ditulis ulang di sisi Kepiai: kalau `BUILTIN_RULES` berubah saat
vendor diperbarui, dropdown di UI ikut berubah sendiri. Menyalin daftar ini ke
TypeScript akan melenceng cepat dan diam-diam.
"""

from __future__ import annotations

from .bootstrap import ensure_ready

_PLATFORMS = ("instagram", "facebook", "tiktok")

# Jalur khusus di `to_komersil()` yang tidak lewat BUILTIN_RULES.
_SPECIAL: dict[str, list[tuple[str, str]]] = {
    # (kategori, keterangan singkat untuk UI)
    "instagram": [
        ("Audience", "Age / Gender / Top Cities / World Map → demographics_* (JSONB)"),
        ("New Follows", "dilipat ke follows_and_unfollows (JSONB)"),
        ("Unfollows", "dilipat ke follows_and_unfollows (JSONB)"),
    ],
    "tiktok": [
        ("overview", "gabungan file 1-metrik → l0_extra.tt_profile_fpk"),
    ],
}

# Bucket UI (revisi Mba Yunita): kategori dikelompokkan jadi 3.
_BUCKET = {"Post": "Content Performance", "Story": "Story Performance"}


def _label(category: str) -> str:
    return "Overview" if category == "overview" else category


def supported_categories() -> dict:
    ensure_ready()

    import komersil_rules as kr
    from kategori_detector import PSEUDO_CHANNEL

    out: dict[str, list[dict]] = {p: [] for p in _PLATFORMS}
    seen: dict[str, set[str]] = {p: set() for p in _PLATFORMS}

    for legacy_key, rules in kr.BUILTIN_RULES.items():
        for platform in _PLATFORMS:
            prefix = f"{platform}_"
            if not legacy_key.startswith(prefix):
                continue
            # Kategori internal = sisa key, dikembalikan ke Title Case; harus
            # cocok dengan apa yang dihasilkan kategori_detector.
            raw = legacy_key[len(prefix):]
            category = " ".join(w.capitalize() for w in raw.split("_"))
            targets = sorted({f"{r.target_schema}.{r.target_table}" for r in rules
                              if r.transform_type in ("direct", "rename", "cast")})
            if not targets or category in seen[platform]:
                continue
            seen[platform].add(category)
            out[platform].append({
                "category": category,
                "label": _label(category),
                "bucket": _BUCKET.get(category, "Channel Performance"),
                "targets": targets,
                "note": None,
            })

    for platform, extras in _SPECIAL.items():
        for category, note in extras:
            if category in seen[platform]:
                continue
            seen[platform].add(category)
            out[platform].append({
                "category": category,
                "label": _label(category),
                "bucket": _BUCKET.get(category, "Channel Performance"),
                "targets": [],
                "note": note,
            })

    for platform in _PLATFORMS:
        out[platform].sort(key=lambda c: (c["bucket"] != "Content Performance",
                                          c["bucket"], c["label"]))

    return {
        "platforms": list(_PLATFORMS),
        "categories": out,
        # Kategori yang sengaja ditolak, beserta alasannya — supaya UI bisa
        # menjelaskan, bukan sekadar diam.
        "gaps": {k: v for k, v in kr.GAP_NOTES.items()},
        "buckets": ["Content Performance", "Story Performance", PSEUDO_CHANNEL.title()],
    }
