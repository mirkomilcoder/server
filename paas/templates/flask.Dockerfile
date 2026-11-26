# Mirkomil PaaS — Flask (generated; add your own Dockerfile to override)
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PORT=8000
WORKDIR /app
COPY . .
RUN {{INSTALL}} && pip install gunicorn
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER 10001
EXPOSE 8000
CMD ["sh", "-c", "exec gunicorn '{{WSGI_APP}}' --bind 0.0.0.0:${PORT} --workers ${WEB_CONCURRENCY:-2} --access-logfile -"]
