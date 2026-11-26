# Mirkomil PaaS — Python bot / worker, e.g. aiogram (generated; add your own Dockerfile to override)
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY . .
RUN {{INSTALL}}
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER 10001
CMD ["python", "{{ENTRY}}"]
