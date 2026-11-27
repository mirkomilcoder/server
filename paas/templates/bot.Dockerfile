# Mirkomil PaaS — Python bot / worker, e.g. aiogram (generated; add your own Dockerfile to override)
# A webhook bot listens on $PORT (published as a site); a polling bot needs no port.
FROM python:{{PY}}-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
# dependencies first: unchanged requirements → this layer comes from cache (fast redeploys)
COPY {{DEPS}} ./
RUN --mount=type=cache,target=/root/.cache/pip {{INSTALL}}
COPY . .
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER 10001
CMD ["python", "{{ENTRY}}"]
