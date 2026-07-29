FROM python:3.12-slim

# libpq untuk psycopg2-binary sudah ikut wheel-nya; yang dibutuhkan hanya CA
# certificates supaya koneksi TLS ke Timescale Cloud bisa diverifikasi.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PGSSLMODE=require

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY vendor ./vendor
COPY app ./app
# Ikut disalin supaya bisa didiagnosa dari dalam container yang berjalan:
#   docker exec autometric-fpk-engine python selftest.py
COPY selftest.py ./

RUN useradd --create-home --uid 10001 mapping \
 && chown -R mapping:mapping /srv
USER mapping

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
