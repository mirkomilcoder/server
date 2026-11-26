# Mirkomil PaaS — static site served by Caddy (generated; add your own Dockerfile to override)
FROM caddy:2.10.2-alpine
COPY {{STATIC_DIR}} /srv
USER 10001
EXPOSE 8000
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":8000"]
