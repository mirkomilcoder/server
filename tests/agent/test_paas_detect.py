import pytest

from mirkomil.paas.detect import DetectError, detect


def make(tmp_path, files: dict[str, str]):
    for name, body in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    return tmp_path


def test_own_dockerfile_wins(tmp_path):
    d = detect(make(tmp_path, {"Dockerfile": "FROM scratch", "manage.py": "", "requirements.txt": "django"}))
    assert d.type == "dockerfile" and d.web


def test_django_finds_wsgi_module(tmp_path):
    d = detect(make(tmp_path, {"manage.py": "", "requirements.txt": "Django==5.1\n", "shop/wsgi.py": "application = 1"}))
    assert (d.type, d.vars["WSGI"], d.vars["INSTALL"]) == ("django", "shop.wsgi", "pip install -r requirements.txt")


def test_fastapi_finds_app_object(tmp_path):
    d = detect(make(tmp_path, {"requirements.txt": "fastapi\nuvicorn", "app/main.py": "from fastapi import FastAPI\napi = FastAPI()\n"}))
    assert (d.type, d.vars["ASGI"]) == ("fastapi", "app.main:api")


def test_flask(tmp_path):
    d = detect(make(tmp_path, {"requirements.txt": "flask", "app.py": "from flask import Flask\napp = Flask(__name__)\n"}))
    assert (d.type, d.vars["WSGI_APP"]) == ("flask", "app:app")


def test_aiogram_bot_is_a_worker(tmp_path):
    d = detect(make(tmp_path, {"requirements.txt": "aiogram==3.15", "bot.py": "print(1)"}))
    assert d.type == "bot" and d.web is False and d.vars["ENTRY"] == "bot.py"


def test_node_requires_start_script(tmp_path):
    make(tmp_path, {"package.json": '{"scripts": {"build": "vite build"}}'})
    with pytest.raises(DetectError, match="start"):
        detect(tmp_path)


def test_static_site_in_public_dir(tmp_path):
    d = detect(make(tmp_path, {"public/index.html": "<h1>hi</h1>"}))
    assert (d.type, d.vars["STATIC_DIR"]) == ("static", "public")


def test_compose_is_refused_for_now(tmp_path):
    make(tmp_path, {"docker-compose.yml": "services: {}"})
    with pytest.raises(DetectError, match="docker-compose"):
        detect(tmp_path)


def test_unknown_repo_explains_what_to_do(tmp_path):
    make(tmp_path, {"README.md": "hello"})
    with pytest.raises(DetectError, match="Dockerfile"):
        detect(tmp_path)


def test_forced_type_is_still_validated(tmp_path):
    make(tmp_path, {"requirements.txt": "requests", "main.py": "print(1)"})
    assert detect(tmp_path, forced="bot").vars["ENTRY"] == "main.py"
    with pytest.raises(DetectError):
        detect(tmp_path, forced="django")
    with pytest.raises(DetectError):
        detect(tmp_path, forced="evil")


def test_module_names_cannot_inject_into_templates(tmp_path):
    # a malicious folder name must not end up in the generated CMD
    make(tmp_path, {"manage.py": "", "requirements.txt": "django", "a;rm -rf/wsgi.py": "x"})
    with pytest.raises(DetectError):
        detect(tmp_path)


def test_site_policy_web_frameworks_always_public_bots_opt_in():
    from mirkomil.paas.detect import is_public, site_mode
    for kind in ("django", "fastapi", "flask", "static"):
        assert site_mode(kind) == "required"
        assert is_public(kind, False) is True  # can't be switched off
    assert site_mode("bot") == "optional"
    assert is_public("bot", None) is False  # aiogram etc.: private unless asked (webhook)
    assert is_public("bot", True) is True
    assert is_public("node", None) is True and is_public("node", False) is False
    assert is_public("dockerfile", False) is False
    assert site_mode(None) == "auto"


def test_spec_public_flag_is_normalised():
    from mirkomil.paas.engine import validate_spec
    base = {"app": "kino-bot", "repo": "https://github.com/a/b", "deploy_id": "20261127-101010-abcd"}
    assert validate_spec(base)["public"] is None
    assert validate_spec({**base, "public": 1})["public"] is True
    assert validate_spec({**base, "public": 0})["public"] is False
