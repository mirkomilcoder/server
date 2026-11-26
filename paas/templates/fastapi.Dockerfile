# Mirkomil PaaS — FastAPI (generated; add your own Dockerfile to override)
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PORT=8000
WORKDIR /app
COPY . .
RUN {{INSTALL}} && pip install "uvicorn[standard]"
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER 10001
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn {{ASGI}} --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
