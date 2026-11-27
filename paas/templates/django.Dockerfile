# Mirkomil PaaS — Django (generated; add your own Dockerfile to override)
FROM python:{{PY}}-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PORT=8000
WORKDIR /app
# dependencies first: unchanged requirements → this layer comes from cache (fast redeploys)
COPY {{DEPS}} ./
RUN --mount=type=cache,target=/root/.cache/pip {{INSTALL}} && pip install gunicorn
COPY . .
RUN python manage.py collectstatic --noinput || echo "collectstatic skipped"
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER 10001
EXPOSE 8000
# migrations run on every start (idempotent), then gunicorn
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn {{WSGI}}:application --bind 0.0.0.0:${PORT} --workers ${WEB_CONCURRENCY:-2} --access-logfile - --forwarded-allow-ips='*'"]
