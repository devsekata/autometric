import os
import re
from datetime import datetime

import pandas as pd
import streamlit as st
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL

# VERSI KOMERSIL: default schema tujuan = l0_raw (DB komersil),
# bukan mapping_engine (DB lama).
DEFAULT_DB_SCHEMA = "l0_raw"


def normalize_sql_identifier(value, default="mapped_data"):
    """Bersihkan nama schema/table agar aman untuk Postgres."""
    text_value = str(value or "").strip().lower()
    text_value = re.sub(r"[^a-z0-9_]+", "_", text_value)
    text_value = re.sub(r"_+", "_", text_value).strip("_")
    if not text_value:
        text_value = default
    if text_value[0].isdigit():
        text_value = f"t_{text_value}"
    return text_value[:63]


def get_postgres_config():
    """Ambil config dari .streamlit/secrets.toml (section [postgres_komersil]),
    fallback ke environment variable."""
    try:
        secret_cfg = dict(st.secrets.get("postgres_komersil", {}))
    except Exception:
        secret_cfg = {}

    return {
        "host": secret_cfg.get("host") or os.getenv("PGHOST", "localhost"),
        "port": int(secret_cfg.get("port") or os.getenv("PGPORT", 5432)),
        "database": secret_cfg.get("database") or os.getenv("PGDATABASE", "Mapping_Engine_Komersil"),
        "user": secret_cfg.get("user") or os.getenv("PGUSER", "postgres"),
        "password": secret_cfg.get("password") or os.getenv("PGPASSWORD", ""),
        "schema": secret_cfg.get("schema") or os.getenv("PGSCHEMA", DEFAULT_DB_SCHEMA),
    }


@st.cache_resource(show_spinner=False)
def get_postgres_engine_cached(host, port, database, user, password):
    url = URL.create(
        drivername="postgresql+psycopg2",
        username=user,
        password=password,
        host=host,
        port=port,
        database=database,
    )
    return create_engine(url, pool_pre_ping=True)


def get_postgres_engine():
    cfg = get_postgres_config()
    missing = [key for key in ["host", "database", "user", "password"] if not cfg.get(key)]
    if missing:
        raise ValueError(
            "Config Postgres belum lengkap. Isi .streamlit/secrets.toml untuk: "
            + ", ".join(missing)
        )
    return get_postgres_engine_cached(
        cfg["host"], cfg["port"], cfg["database"], cfg["user"], cfg["password"]
    )


def test_postgres_connection():
    engine = get_postgres_engine()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT current_database(), current_user")).fetchone()
    return {"database": row[0], "user": row[1]}


def table_exists(schema_name, table_name):
    """Cek keberadaan tabel via query LANGSUNG ke katalog Postgres.

    Sebelumnya pakai inspect(engine).has_table(...). Masalahnya inspector bisa
    memakai snapshot metadata yang BASI: kalau tabel dibuat di DBeaver SETELAH
    sesi Streamlit/engine dimulai, has_table() bisa tetap False walau tabelnya
    ADA. Query ke information_schema selalu live (tidak ter-cache), jadi hasilnya
    akurat. Nama schema/table dinormalisasi dulu supaya konsisten dgn yang
    dipakai saat insert.
    """
    engine = get_postgres_engine()
    sch = normalize_sql_identifier(schema_name, default=DEFAULT_DB_SCHEMA)
    tbl = normalize_sql_identifier(table_name, default="mapped_data")
    q = text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = :sch AND table_name = :tbl LIMIT 1"
    )
    with engine.connect() as conn:
        found = conn.execute(q, {"sch": sch, "tbl": tbl}).fetchone()
    return found is not None


def get_table_columns(schema_name, table_name):
    """Ambil daftar nama kolom tabel via query LANGSUNG ke katalog Postgres.

    Dipakai untuk menyaring kolom DataFrame sebelum insert: kolom yang TIDAK ada
    di tabel tujuan tidak boleh ikut di-INSERT, kalau ikut → UndefinedColumn
    error. Live query (tidak ter-cache) supaya akurat walau tabel baru
    dibuat/diubah. Return list nama kolom (lowercase) atau [] kalau tabel tak ada.
    """
    engine = get_postgres_engine()
    sch = normalize_sql_identifier(schema_name, default=DEFAULT_DB_SCHEMA)
    tbl = normalize_sql_identifier(table_name, default="mapped_data")
    q = text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = :sch AND table_name = :tbl"
    )
    with engine.connect() as conn:
        rows = conn.execute(q, {"sch": sch, "tbl": tbl}).fetchall()
    return [r[0] for r in rows]


def build_mapped_dataframe(df, expected_columns, mapping_dict):
    """Bangun dataframe full sesuai target column, bukan cuma preview 10 baris."""
    if df is None or df.empty:
        return pd.DataFrame(columns=expected_columns)

    mapped = pd.DataFrame(index=df.index)
    for target_col in expected_columns:
        source_col = mapping_dict.get(target_col, "") if isinstance(mapping_dict, dict) else ""
        if source_col and source_col in df.columns:
            mapped[target_col] = df[source_col]
        else:
            mapped[target_col] = pd.NA
    return mapped.reset_index(drop=True)


def insert_dataframe_to_postgres(
    df,
    schema_name,
    table_name,
    if_exists_mode="append",
    require_existing_table=True,
    allow_create_schema=False,
):
    if df is None or df.empty:
        raise ValueError("Tidak ada data yang bisa di-insert.")

    schema_name = normalize_sql_identifier(schema_name, default=DEFAULT_DB_SCHEMA)
    table_name = normalize_sql_identifier(table_name, default="mapped_data")

    engine = get_postgres_engine()
    exists = table_exists(schema_name, table_name)

    if require_existing_table and not exists:
        raise ValueError(
            f"Table {schema_name}.{table_name} belum ada. Untuk production, buat table dulu di DBeaver, "
            "lalu insert dengan mode append."
        )

    with engine.begin() as conn:
        if allow_create_schema:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))

        df.to_sql(
            name=table_name,
            con=conn,
            schema=schema_name,
            if_exists=if_exists_mode,
            index=False,
            method="multi",
            chunksize=1000,
        )

    return {"schema": schema_name, "table": table_name, "rows": len(df)}

def _unique_constraint_exists(engine, schema_name, table_name, key_cols):
    # PENTING: kcu.column_name bertipe domain 'information_schema.sql_identifier',
    # bukan text biasa. Kalau di-array_agg() tanpa di-cast, psycopg2 TIDAK bisa
    # auto-parse hasilnya jadi Python list -> baliknya string mentah '{date}'.
    # Efeknya: perbandingan sorted(cols) di bawah selalu False walau constraint-nya
    # beneran ada di database (iterasi string jalan per-karakter, bukan per-elemen).
    # Fix: cast eksplisit ke ::text sebelum di-agregasi.
    q = text("""
        SELECT tc.constraint_name,
               array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS cols
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = :sch AND tc.table_name = :tbl
          AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
        GROUP BY tc.constraint_name
    """)
    with engine.connect() as conn:
        rows = conn.execute(q, {"sch": schema_name, "tbl": table_name}).fetchall()
    target = sorted(c.lower() for c in key_cols)
    return any(sorted(c.lower() for c in cols) == target for _, cols in rows)


def consolidate_duplicate_keys(df, key_cols):
    """Kalau dalam 1 DataFrame ada >1 baris dgn kombinasi key_cols yg SAMA,
    gabungin jadi 1 baris SEBELUM di-upsert.

    WAJIB dijalankan sebelum ON CONFLICT: PostgreSQL menolak KERAS 1 batch
    INSERT yg berisi >1 baris dgn conflict key yg sama persis, errornya
    "ON CONFLICT DO UPDATE command cannot affect row a second time" - ini
    bukan soal logic Python, itu batasan keras dari Postgres sendiri.

    Cara gabung per kolom non-key:
    - Kolom numerik -> ambil nilai NON-NULL TERBESAR antar baris yg key-nya
      sama (skipna otomatis). Baris yg datanya kosong TIDAK menimpa baris
      lain yg udah keisi.
    - Kolom lain (teks/tanggal/dll) -> ambil nilai non-null TERAKHIR.
    """
    if df is None or df.empty:
        return df
    dup_mask = df.duplicated(subset=key_cols, keep=False)
    if not dup_mask.any():
        return df  # jalur cepat: gak ada duplikat, gak perlu groupby sama sekali

    other_cols = [c for c in df.columns if c not in key_cols]

    def _max_skipna(s):
        s2 = s.dropna()
        return s2.max() if len(s2) else pd.NA

    def _last_non_null(s):
        s2 = s.dropna()
        return s2.iloc[-1] if len(s2) else pd.NA

    agg_map = {
        c: (_max_skipna if pd.api.types.is_numeric_dtype(df[c]) else _last_non_null)
        for c in other_cols
    }
    return df.groupby(key_cols, as_index=False, dropna=False).agg(agg_map)


def upsert_dataframe_to_postgres(
    df, schema_name, table_name, key_cols,
    require_existing_table=True, chunksize=500,
):
    if df is None or df.empty:
        raise ValueError("Tidak ada data yang bisa di-upsert.")

    schema_name = normalize_sql_identifier(schema_name, default=DEFAULT_DB_SCHEMA)
    table_name = normalize_sql_identifier(table_name, default="mapped_data")
    key_cols = [str(c).strip() for c in key_cols]

    engine = get_postgres_engine()
    if require_existing_table and not table_exists(schema_name, table_name):
        raise ValueError(f"Table {schema_name}.{table_name} belum ada. Buat table dulu di DBeaver.")

    missing_key_cols = [c for c in key_cols if c not in df.columns]
    if missing_key_cols:
        raise ValueError(f"key_cols {missing_key_cols} tidak ada di DataFrame yang mau di-upsert.")

    # Konsolidasi duplikat key DALAM BATCH INI dulu (lihat docstring
    # consolidate_duplicate_keys) - HARUS sebelum ON CONFLICT dibentuk,
    # kalau tidak Postgres bakal reject seluruh batch-nya.
    df = consolidate_duplicate_keys(df, key_cols)

    # ── MODE UPSERT ──
    # DB acuan baru: tabel snapshot (fb_post_snapshots, ig_media_snapshots,
    # *_profile_snapshots, ig_stories) SENGAJA tidak punya UNIQUE di kunci
    # bisnis — hanya PK(id) — supaya crawler backend bebas menyimpan BANYAK
    # snapshot per post/akun (bandingkan: tabel *competitor* justru punya
    # UNIQUE dedup). Karena itu JANGAN menambah UNIQUE di tabel itu.
    #   • Ada UNIQUE persis di key_cols  → jalur cepat ON CONFLICT (atomik).
    #   • Tidak ada                      → jalur MANUAL via temp table:
    #     UPDATE baris TERBARU per key (fetched_at paling akhir) dgn pola
    #     COALESCE/merge-jsonb yang sama, sisanya INSERT baris baru.
    #     Riwayat snapshot lama milik crawler TIDAK disentuh.
    use_on_conflict = _unique_constraint_exists(
        engine, schema_name, table_name, key_cols)

    # ── METADATA kolom tabel tujuan (sekali query): tipe, nullable, default ──
    # Dipakai utk (a) deteksi kolom jsonb, (b) AUTO-ISI kolom wajib DB acuan
    # baru yang tidak dibawa DataFrame:
    #   • id uuid NOT NULL tanpa default  → di-generate uuid4 per baris
    #     (tabel l0_raw.* / l0_extra.* punya PK id uuid; kalau kolomnya punya
    #     DEFAULT di DB, dibiarkan kosong biar DB yang mengisi).
    #   • fetched_at/created_at/updated_at NOT NULL tanpa default → now()
    #     (utk jalur KONTEN yg key-nya post_id/media_id, fetched_at = waktu
    #     upload; utk jalur profil harian fetched_at sudah dibawa df).
    # Kolom wajib lain yang tetap kosong → error JELAS di sini, bukan error
    # NotNullViolation mentah dari Postgres.
    q_meta = text(
        "SELECT column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns "
        "WHERE table_schema = :sch AND table_name = :tbl"
    )
    with engine.connect() as conn:
        meta_rows = conn.execute(
            q_meta, {"sch": schema_name, "tbl": table_name}).fetchall()
    jsonb_cols = {r[0] for r in meta_rows if r[1] == "jsonb"}

    # SARING kolom DataFrame → hanya kolom yang ADA di tabel tujuan.
    # render_postgres_insert_section sudah menyaring utk jalur UI, tapi ada
    # pemanggil LANGSUNG (mis. handler TikTok overview) — tanpa saringan ini,
    # kolom sisa (mis. brand_id di tabel yang tak punya) → UndefinedColumn.
    table_cols_lc = {str(r[0]).lower() for r in meta_rows}
    if table_cols_lc:
        keep = [c for c in df.columns if str(c).lower() in table_cols_lc]
        dropped_keys = [c for c in key_cols if c not in keep]
        if dropped_keys:
            raise ValueError(
                f"key_cols {dropped_keys} tidak ada di tabel "
                f"{schema_name}.{table_name} — cek aturan komersil."
            )
        if keep and len(keep) != len(df.columns):
            df = df[keep]

    df_cols_lc = {str(c).lower() for c in df.columns}
    autofilled_cols = set()   # kolom yg DIISI OTOMATIS (bukan dari file sumber)
    missing_required = []
    for col_name, data_type, is_nullable, col_default in meta_rows:
        if is_nullable == "YES" or col_default is not None:
            continue
        if str(col_name).lower() in df_cols_lc:
            continue
        if data_type == "uuid" and str(col_name).lower() == "id":
            import uuid as _uuid
            df = df.copy()
            df["id"] = [str(_uuid.uuid4()) for _ in range(len(df))]
            df_cols_lc.add("id")
            autofilled_cols.add("id")
        elif data_type in ("integer", "bigint") and str(col_name).lower() == "id":
            # id numerik NOT NULL tanpa default (tabel l0_extra bila sequence
            # belum dipasang): lanjutkan dari MAX(id). Aman utk pemakaian
            # single-writer aplikasi ini; kalau DB produksi sudah pakai
            # serial/identity, blok ini tidak pernah jalan (ada default).
            with engine.connect() as conn:
                mx = conn.execute(text(
                    f'SELECT COALESCE(MAX("id"), 0) '
                    f'FROM "{schema_name}"."{table_name}"')).scalar() or 0
            df = df.copy()
            df["id"] = range(int(mx) + 1, int(mx) + 1 + len(df))
            df_cols_lc.add("id")
            autofilled_cols.add("id")
        elif data_type.startswith("timestamp") and str(col_name).lower() in (
                "fetched_at", "created_at", "updated_at"):
            df = df.copy()
            df[col_name] = pd.Timestamp.now(tz="UTC")
            df_cols_lc.add(str(col_name).lower())
            autofilled_cols.add(str(col_name).lower())
        else:
            missing_required.append(col_name)
    if missing_required:
        raise ValueError(
            f"Kolom wajib (NOT NULL tanpa default) di {schema_name}.{table_name} "
            f"tidak terisi dari hasil mapping: {missing_required}. "
            "Cek aturan komersil / spec native_column utk kategori ini."
        )

    cols = list(df.columns)
    # 'id' TIDAK PERNAH ikut di-UPDATE saat conflict: id adalah PK baris lama;
    # kalau ikut, EXCLUDED.id (uuid baru hasil generate) MENIMPA id lama →
    # relasi lain yang menunjuk id itu putus. Insert baru tetap membawa id.
    # Kolom AUTO-ISI (id, fetched_at=now, dst.) hanya untuk INSERT baris baru.
    # Saat UPDATE baris yang sudah ada (termasuk baris snapshot milik crawler),
    # kolom itu TIDAK boleh menimpa nilai asli — mis. fetched_at crawler harus
    # tetap waktu crawl aslinya, bukan waktu upload FPK.
    update_cols = [
        c for c in cols
        if c not in key_cols
        and str(c).lower() != "id"
        and str(c).lower() not in autofilled_cols
    ]
    col_list = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(f":{c}" for c in cols)

    # PENTING: cast ke dtype 'object' DULU sebelum .where(). Kalau tidak,
    # pandas TIDAK BISA taruh Python None di kolom ber-dtype float64 (float64
    # cuma bisa nyimpen NaN sbg penanda kosong) -> None otomatis "dipaksa"
    # balik jadi NaN. Efeknya fatal utk UPSERT: NaN itu BUKAN SQL NULL (dia
    # nilai numerik "Not a Number" yang valid), jadi COALESCE(EXCLUDED.col,
    # existing.col) tidak fallback ke nilai lama, malah MENIMPA dgn NaN.
    # Kolom teks (dtype object) tidak kena masalah ini krn None valid di situ
    # -> makanya cuma kolom percentage_* yg ke-reset, bukan age/gender/dll.
    records = df.astype(object).where(pd.notnull(df), None).to_dict(orient="records")

    # SERIALISASI NILAI KOLOM JSONB. psycopg2 mengirim int/float dgn tipe
    # angka → Postgres menolak (DatatypeMismatch integer vs jsonb; kasus
    # nyata: ig_stories.navigation — FPK bawa TOTAL angka, kolom DB jsonb
    # utk breakdown crawler). Aturan konversi:
    #   • str        → dibiarkan (dianggap JSON siap pakai, mis. demographics_*
    #                  & follows_and_unfollows yg sudah json.dumps di hulu)
    #   • dict/list  → json.dumps (objek/array jsonb)
    #   • angka      → {"total": n} — HARUS objek, bukan skalar jsonb,
    #                  supaya operator merge || di bawah tetap sah
    #                  (objek || skalar = error di Postgres).
    if jsonb_cols:
        import json as _json
        _jsonb_in_df = [c for c in cols if c in jsonb_cols]
        for _rec in records:
            for _c in _jsonb_in_df:
                _v = _rec.get(_c)
                if _v is None or isinstance(_v, str):
                    continue
                if isinstance(_v, (dict, list)):
                    _rec[_c] = _json.dumps(_v)
                    continue
                try:
                    _f = float(_v)
                    _rec[_c] = _json.dumps(
                        {"total": int(_f) if _f.is_integer() else _f})
                except (TypeError, ValueError):
                    _rec[_c] = _json.dumps(str(_v))

    # KOLOM JSONB → MERGE KEY, bukan timpa. Alasan: satu kolom jsonb bisa
    # diisi BEBERAPA file berbeda (mis. follows_and_unfollows: file New
    # Follows menulis {"follows":63}, file Unfollows menulis {"unfollows":77}
    # utk tanggal yg sama). COALESCE biasa membuat file kedua MENIMPA seluruh
    # isi (data file pertama hilang). Operator || jsonb menggabungkan key:
    # {"follows":63} || {"unfollows":77} = keduanya utuh; key yg sama di-
    # update dgn nilai terbaru (upload ulang tetap benar).
    if use_on_conflict:
        # ── JALUR CEPAT: UNIQUE constraint tersedia → ON CONFLICT atomik ──
        conflict_cols = ", ".join(f'"{c}"' for c in key_cols)
        sql_text = (
            f'INSERT INTO "{schema_name}"."{table_name}" ({col_list}) '
            f'VALUES ({placeholders}) ON CONFLICT ({conflict_cols}) '
        )
        if update_cols:
            parts = []
            for c in update_cols:
                if c in jsonb_cols:
                    parts.append(
                        f'"{c}" = COALESCE("{table_name}"."{c}", \'{{}}\'::jsonb) '
                        f'|| COALESCE(EXCLUDED."{c}"::jsonb, \'{{}}\'::jsonb)'
                    )
                else:
                    parts.append(f'"{c}" = COALESCE(EXCLUDED."{c}", "{table_name}"."{c}")')
            sql_text += "DO UPDATE SET " + ", ".join(parts)
        else:
            sql_text += "DO NOTHING"
        sql = text(sql_text)
        with engine.begin() as conn:
            for start in range(0, len(records), chunksize):
                conn.execute(sql, records[start:start + chunksize])
        return {"schema": schema_name, "table": table_name, "rows": len(df)}

    # ── JALUR MANUAL: tabel snapshot TANPA UNIQUE di key bisnis ──────────
    # Semantik (aman utk tabel append-history milik crawler):
    #   1. Data batch di-stage ke TEMP TABLE (1x perjalanan per chunk).
    #   2. UPDATE hanya SATU baris per key: baris snapshot TERBARU
    #      (fetched_at paling akhir; seri: id terbesar). Snapshot lama
    #      TIDAK diubah — riwayat crawler tetap utuh.
    #   3. Key yang belum ada sama sekali → INSERT baris baru.
    #   Idempoten: upload ulang file yang sama meng-update baris yg sama.
    meta_by_lc = {str(r[0]).lower(): r for r in meta_rows}
    _TYPE_MAP = {
        "character varying": "varchar",
        "timestamp with time zone": "timestamptz",
        "timestamp without time zone": "timestamp",
        "ARRAY": "text[]",
        "USER-DEFINED": "text",
    }

    def _stage_type(col):
        dt = meta_by_lc.get(str(col).lower(), (None, "text"))[1]
        return _TYPE_MAP.get(dt, dt)

    import uuid as _uuid_mod
    stage = f"_me_stage_{_uuid_mod.uuid4().hex[:10]}"
    stage_defs = ", ".join(f'"{c}" {_stage_type(c)}' for c in cols)
    has_id = "id" in meta_by_lc
    has_fetched = "fetched_at" in meta_by_lc

    tgt = f'"{schema_name}"."{table_name}"'
    join_keys_ts = " AND ".join(f't."{k}" = s."{k}"' for k in key_cols)
    key_list_t = ", ".join(f't."{k}"' for k in key_cols)

    order_parts = []
    if has_fetched and "fetched_at" not in [k.lower() for k in key_cols]:
        order_parts.append('t."fetched_at" DESC NULLS LAST')
    if has_id:
        order_parts.append('t."id" DESC')
    if not order_parts:
        order_parts.append("t.ctid DESC")

    set_parts = []
    for c in update_cols:
        if c in jsonb_cols:
            set_parts.append(
                f'"{c}" = COALESCE(t."{c}", \'{{}}\'::jsonb) '
                f'|| COALESCE(s."{c}"::jsonb, \'{{}}\'::jsonb)'
            )
        else:
            set_parts.append(f'"{c}" = COALESCE(s."{c}", t."{c}")')

    with engine.begin() as conn:
        conn.execute(text(
            f'CREATE TEMP TABLE "{stage}" ({stage_defs}) ON COMMIT DROP'))
        ins_stage = text(
            f'INSERT INTO "{stage}" ({col_list}) VALUES ({placeholders})')
        for start in range(0, len(records), chunksize):
            conn.execute(ins_stage, records[start:start + chunksize])

        if set_parts:
            if has_id:
                join_l = " AND ".join(f's."{k}" = l."{k}"' for k in key_cols)
                upd = (
                    f'WITH latest AS ('
                    f'  SELECT DISTINCT ON ({key_list_t}) t."id" AS _tid, {key_list_t} '
                    f'  FROM {tgt} t JOIN "{stage}" s ON {join_keys_ts} '
                    f'  ORDER BY {key_list_t}, {", ".join(order_parts)}'
                    f') '
                    f'UPDATE {tgt} t SET {", ".join(set_parts)} '
                    f'FROM "{stage}" s JOIN latest l ON {join_l} '
                    f'WHERE t."id" = l."_tid"'
                )
            else:
                upd = (
                    f'UPDATE {tgt} t SET {", ".join(set_parts)} '
                    f'FROM "{stage}" s WHERE {join_keys_ts}'
                )
            conn.execute(text(upd))

        conn.execute(text(
            f'INSERT INTO {tgt} ({col_list}) '
            f'SELECT {col_list} FROM "{stage}" s '
            f'WHERE NOT EXISTS (SELECT 1 FROM {tgt} t WHERE {join_keys_ts})'
        ))

    return {"schema": schema_name, "table": table_name, "rows": len(df)}

def render_postgres_insert_section(
    channel,
    category,
    selected_file,
    source_df,
    expected_columns,
    mapping_dict,
    filled_mapping,
    slugify_func=None,
    append_history_func=None,
    selected_brand=None,
    auto_insert=False,
    raw_bytes=None,
    selected_org_id=None,
):
    def safe_slug(value):
        if slugify_func:
            return slugify_func(value)
        return normalize_sql_identifier(value, "x")

    # ── REVISI UX: 2 kategori (Content/Channel Performance) ──
    # Pilihan UI baru di-resolve ke kategori internal lama berdasarkan judul
    # di dalam file FPK. Kategori lama tetap diterima (kompatibel mundur).
    from kategori_detector import resolve_kategori
    try:
        category = resolve_kategori(raw_bytes, selected_file, channel, category)
    except ValueError as e:
        st.error(f"Gagal masuk database: {e}")
        return {"ok": False, "error": str(e), "rows": 0,
                "table": "-", "file": selected_file}

    default_cfg = get_postgres_config()
    default_table = normalize_sql_identifier(f"{channel}_{category}")

    if auto_insert:
        # ── MODE AUTO (dipanggil dari blok submit bulk) ──
        # Fungsi ini sudah berada di dalam st.expander milik pemanggil, jadi
        # TIDAK boleh bikin expander lagi (Streamlit melarang expander bersarang).
        # Pakai schema & table default langsung, tanpa text_input.
        schema_name = normalize_sql_identifier(
            default_cfg.get("schema", DEFAULT_DB_SCHEMA), DEFAULT_DB_SCHEMA)
        table_name = default_table
    else:
        with st.expander("Target database", expanded=False):
            col_db1, col_db2 = st.columns(2)
            with col_db1:
                schema_name = st.text_input(
                    "Schema",
                    value=normalize_sql_identifier(default_cfg.get("schema", DEFAULT_DB_SCHEMA), DEFAULT_DB_SCHEMA),
                    key=f"pg_schema_{safe_slug(channel)}_{safe_slug(category)}",
                )
            with col_db2:
                table_name = st.text_input(
                    "Table",
                    value=default_table,
                    key=f"pg_table_{safe_slug(channel)}_{safe_slug(category)}",
                )
        if "schema_name" not in locals():
            schema_name = normalize_sql_identifier(default_cfg.get("schema", DEFAULT_DB_SCHEMA), DEFAULT_DB_SCHEMA)
            table_name = default_table

    require_existing_table = True
    allow_create_schema = False
    if_exists_mode = "append"
    drop_empty_rows = True

    # ── BANGUN DATAFRAME SIAP-INSERT ──
    # Jalur BARU: kalau raw_bytes (file mentah) tersedia, pakai
    # proses_mapping_data — yg membaca file dgn deteksi header, mapping via
    # kolom 'metrics di fpk' di file acuan, type-casting, & kolom derived.
    # Jalur LAMA (build_mapped_dataframe via mapping_dict UI) tetap jadi
    # fallback agar pemanggilan single-file lama tidak rusak.
    used_new_mapping = False
    if raw_bytes is not None:
        try:
            from io import BytesIO
            # FIX KOMERSIL: nama FUNGSI di modul proses_mapping_data_komersil
            # tetap 'proses_mapping_data' (hasil copy). Import lama
            # 'import proses_mapping_data_komersil' (nama fungsi) GAGAL diam-
            # diam → selalu jatuh ke fallback mapping lama. Alias di sini.
            from proses_mapping_data_komersil import (
                proses_mapping_data as proses_mapping_data_komersil,
            )
            # Sertakan nama file asli sebagai .name pada BytesIO. Tanpa ini,
            # proses_mapping_data tidak bisa mengenali format (CSV vs XLSX) →
            # file CSV WIDE (mis. total followers) gagal di-unpivot → kosong.
            _bio = BytesIO(raw_bytes)
            try:
                _bio.name = selected_file
            except Exception:
                pass
            if str(category).strip().lower() == "audience":
                # File audience FPK formatnya khusus (csv ';', desimal koma,
                # snapshot periode tanpa deret tanggal, baris comparison) —
                # pembaca lama tidak sanggup → pakai parser khusus.
                from audience_fpk import parse_audience_fpk
                full_mapped_df = parse_audience_fpk(raw_bytes, selected_file)
            else:
                full_mapped_df = proses_mapping_data_komersil(_bio, channel, category)
            used_new_mapping = True
        except Exception as e:
            st.warning(f"proses_mapping_data_komersil gagal ({e}); "
                       "memakai mapping lama sebagai fallback.")
            full_mapped_df = build_mapped_dataframe(source_df, expected_columns, mapping_dict)
    else:
        full_mapped_df = build_mapped_dataframe(source_df, expected_columns, mapping_dict)

    if drop_empty_rows and not full_mapped_df.empty:
        full_mapped_df = full_mapped_df.dropna(how="all").reset_index(drop=True)

    # ══ LAPISAN KOMERSIL ════════════════════════════════════════════════
    # Terjemahkan DataFrame gaya DB LAMA → gaya l0_raw (DB komersil)
    # berdasarkan aturan di mapping_engine.mapping_rules. Sekaligus
    # menentukan tabel tujuan & key upsert dari aturan, MENGABAIKAN
    # schema/table default gaya lama di atas.
    # Simpan SALINAN df gaya-lama dulu: kolom atribut manual (content_pillar
    # dkk.) akan DIBUANG oleh to_komersil (tidak ada di tabel l0_raw) —
    # salinan ini dipakai utk insert KEDUA ke l0_extra.*_post_extra_attribute.
    legacy_df_for_extra = (
        full_mapped_df.copy() if not full_mapped_df.empty else None)
    key_cols_override = None
    if not full_mapped_df.empty:
        try:
            from komersil_rules import to_komersil
            (full_mapped_df, schema_name, table_name,
             key_cols_override) = to_komersil(
                full_mapped_df, channel, category, get_postgres_engine(),
                brand=selected_brand, org_id=selected_org_id)
        except ValueError as e:
            st.error(f"Gagal masuk database: {e}")
            return {"ok": False, "error": str(e), "rows": 0,
                    "table": f"{schema_name}.{table_name}", "file": selected_file}
    # ════════════════════════════════════════════════════════════════════

    # Daftar kolom tabel tujuan (live). Dipakai untuk menyaring kolom DataFrame
    # agar tidak mengirim kolom yang tak ada di tabel → mencegah error
    # UndefinedColumn saat INSERT.
    try:
        target_table_cols = get_table_columns(schema_name, table_name)
    except Exception:
        target_table_cols = []
    target_cols_lc = {c.lower() for c in target_table_cols}

    if selected_brand is not None and not full_mapped_df.empty:
        # hanya isi/sisipkan 'brand' bila tabel tujuan MEMANG punya kolom brand
        # (tabel l0_raw TIDAK punya brand → otomatis dilewati; identitas akun
        # dibawa oleh social_account_id hasil derivasi komersil_rules)
        if "brand" in target_cols_lc:
            full_mapped_df = full_mapped_df.copy()
            if "brand" in full_mapped_df.columns:
                full_mapped_df["brand"] = selected_brand
            else:
                full_mapped_df.insert(0, "brand", selected_brand)

    # Saring kolom DataFrame → hanya kolom yang ADA di tabel tujuan. Kalau daftar
    # kolom tabel tidak bisa diambil (kosong), lewati penyaringan agar perilaku
    # lama tetap jalan (mis. tabel baru yg akan di-create).
    if target_cols_lc and not full_mapped_df.empty:
        keep = [c for c in full_mapped_df.columns if str(c).lower() in target_cols_lc]
        if keep:
            full_mapped_df = full_mapped_df[keep]

    row_col, target_col = st.columns([1, 2])
    row_col.metric("Rows siap masuk", len(full_mapped_df))
    target_col.markdown(f"**Target:** `{normalize_sql_identifier(schema_name)}.{normalize_sql_identifier(table_name)}`")

    if auto_insert:
        # Tidak perlu tombol kedua — pemanggil (tombol "Masukkan ke Database"
        # utama) sudah diklik. Langsung eksekusi.
        do_insert = True
    else:
        do_insert = st.button(
            "Masukkan ke Database",
            use_container_width=True,
            type="primary",
            key=f"insert_pg_{safe_slug(channel)}_{safe_slug(category)}",
        )

    if do_insert:
        # GATE 'belum ada kolom dimapping': dulu cuma cek filled_mapping (hasil
        # mapping UI via mapping_dict). Tapi jalur insert SEBENARNYA berjalan via
        # proses_mapping_data (raw_bytes) — yang memetakan kolom sendiri. Untuk
        # kategori itu mapping_dict UI kosong → filled_mapping==0, padahal
        # full_mapped_df sudah terisi benar. Jadi: kalau jalur baru dipakai dan
        # menghasilkan DataFrame dgn minimal satu kolom berisi data, JANGAN blokir.
        new_path_has_data = (
            used_new_mapping
            and not full_mapped_df.empty
            and any(full_mapped_df[c].notna().any() for c in full_mapped_df.columns)
        )
        if filled_mapping == 0 and not new_path_has_data:
            msg = "belum ada kolom yang dimapping."
            st.error(f"Gagal masuk database: {msg}")
            return {"ok": False, "error": msg, "rows": 0,
                    "table": f"{schema_name}.{table_name}", "file": selected_file}
        if full_mapped_df.empty:
            msg = "data hasil mapping kosong."
            st.error(f"Gagal masuk database: {msg}")
            return {"ok": False, "error": msg, "rows": 0,
                    "table": f"{schema_name}.{table_name}", "file": selected_file}
        try:
            # ── PENENTUAN KEY UPSERT (versi komersil) ──
            # Prioritas: key hasil aturan komersil (post_id/media_id/video_id
            # di tabel l0_raw). Fallback: deteksi lama (utk jalur non-komersil
            # yg mungkin masih terpakai).
            if key_cols_override:
                key_cols = key_cols_override
            elif "post_id" in full_mapped_df.columns:
                key_cols = ["post_id"]
            elif "date" in full_mapped_df.columns:
                key_cols = ["date"]
            else:
                key_cols = None

            if key_cols:
                result = upsert_dataframe_to_postgres(
                    full_mapped_df,
                    schema_name=schema_name,
                    table_name=table_name,
                    key_cols=key_cols,
                    require_existing_table=require_existing_table,
                )
            else:
                result = insert_dataframe_to_postgres(
                    full_mapped_df,
                    schema_name=schema_name,
                    table_name=table_name,
                    if_exists_mode=if_exists_mode,
                    require_existing_table=require_existing_table,
                    allow_create_schema=allow_create_schema,
                )
            # ── INSERT KEDUA: atribut manual post → l0_extra ──
            # content_pillar / brand_offering / format / is_* (bila terisi di
            # file) tidak punya kolom di l0_raw; rumahnya
            # l0_extra.<channel>_post_extra_attribute (key brand_id+post_id).
            # Gagal di sini TIDAK membatalkan insert utama — hanya warning.
            extra_note = ""
            _is_post_cat = str(category).strip().lower() == "post"
            if legacy_df_for_extra is not None:
                try:
                    from komersil_rules import extra_attributes_to_komersil
                    extra = extra_attributes_to_komersil(
                        legacy_df_for_extra, channel, category,
                        get_postgres_engine(), brand=selected_brand,
                        org_id=selected_org_id)
                    if extra is not None:
                        edf, esch, etbl, ekeys = extra
                        eres = upsert_dataframe_to_postgres(
                            edf, schema_name=esch, table_name=etbl,
                            key_cols=ekeys)
                        extra_note = (f" +{eres['rows']} baris atribut → "
                                      f"{eres['schema']}.{eres['table']}")
                    elif _is_post_cat:
                        # kategori Post tapi kolom atribut kosong semua →
                        # beri tahu eksplisit (bukan diam-diam), supaya jelas
                        # kenapa l0_extra tidak bertambah.
                        extra_note = (" (atribut post kosong di file → "
                                      "l0_extra dilewati)")
                except Exception as extra_err:
                    extra_note = f" ⚠ atribut GAGAL: {str(extra_err)[:200]}"
                    st.warning("Atribut post (content_pillar dkk.) tidak ikut "
                               f"masuk ke l0_extra: {extra_err}")

            # ── INSERT KETIGA (khusus TikTok Post): metrik FPK per-post yang
            # tidak punya kolom di tt_video_snapshots maupun
            # tiktok_post_extra_attribute → l0_extra.tt_post_fpk (keputusan
            # 20/7, melanjutkan pola tt_profile_fpk arahan mentor 18/7).
            # Gagal di sini TIDAK membatalkan insert utama — hanya warning.
            if legacy_df_for_extra is not None:
                try:
                    from komersil_rules import tt_post_fpk_to_komersil
                    fpk_extra = tt_post_fpk_to_komersil(
                        legacy_df_for_extra, channel, category,
                        get_postgres_engine(), brand=selected_brand,
                        org_id=selected_org_id)
                    if fpk_extra is not None:
                        fdf, fsch, ftbl, fkeys = fpk_extra
                        fres = upsert_dataframe_to_postgres(
                            fdf, schema_name=fsch, table_name=ftbl,
                            key_cols=fkeys)
                        extra_note += (f" +{fres['rows']} baris metrik FPK → "
                                       f"{fres['schema']}.{fres['table']}")
                except Exception as fpk_err:
                    extra_note += f" ⚠ metrik FPK GAGAL: {str(fpk_err)[:200]}"
                    st.warning(
                        "Metrik FPK per-post tidak ikut masuk ke "
                        f"l0_extra.tt_post_fpk: {fpk_err} — kalau tabelnya "
                        "belum ada, jalankan setup_tt_post_fpk.sql sekali "
                        "di DBeaver."
                    )

            if append_history_func:
                append_history_func({
                    "event": "upload_history",
                    "action": "insert_to_postgres",
                    "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "nama_file": selected_file,
                    "tanggal_upload": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "status_upload": "Berhasil",
                    "channel": channel,
                    "kategori": category,
                    "file_name": selected_file,
                    "brand": selected_brand,
                    "target_table": f"{result['schema']}.{result['table']}",
                    "inserted_rows": result["rows"],
                    "ukuran_data": f"{result['rows']:,} rows",
                })
            st.success(f"Data berhasil dimasukkan ke database! "
                       f"{result['rows']} rows.{extra_note}")
            try:
                st.toast(f"✅ {result['rows']} baris masuk ke {result['table']}")
            except Exception:
                pass
            return {"ok": True, "error": "", "rows": result["rows"],
                    "table": f"{result['schema']}.{result['table']}",
                    "extra_note": extra_note,
                    "file": selected_file}
        except Exception as e:
            err_msg = str(e)
            st.error(f"Gagal masuk database: {err_msg}")
            if append_history_func:
                append_history_func({
                    "event": "upload_history",
                    "action": "insert_to_postgres",
                    "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "nama_file": selected_file,
                    "tanggal_upload": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "status_upload": "Gagal",
                    "channel": channel,
                    "kategori": category,
                    "file_name": selected_file,
                    "brand": selected_brand,
                    "ukuran_data": f"{len(full_mapped_df):,} rows",
                    "error_message": err_msg[:500],  # simpan pesan error utk diagnosa
                })
            return {"ok": False, "error": err_msg, "rows": 0,
                    "table": f"{schema_name}.{table_name}", "file": selected_file}

    # tombol belum diklik (mode non-auto) → tidak ada aksi
    return {"ok": None, "error": "", "rows": 0,
            "table": f"{schema_name}.{table_name}", "file": selected_file}