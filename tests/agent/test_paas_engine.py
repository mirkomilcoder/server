import pytest

from mirkomil.paas.engine import DeployError, render_caddyfile, validate_spec, new_deploy_id, ENV_KEY_RE

BASE = {"app": "shop", "repo": "https://github.com/acme/shop", "branch": "main", "deploy_id": "20261126-120000-ab12",
        "domain": "mirkomil-host.uz", "mem_mb": 512, "cpus": 1}


def test_valid_spec_normalises():
    s = validate_spec(BASE)
    assert s["app"] == "shop" and s["port"] == 0 and s["type"] is None and s["by"] == "?"


@pytest.mark.parametrize("field,value", [
    ("app", "Shop"), ("app", "a"), ("app", "-x-"), ("app", "x" * 40), ("app", "a;b"),
    ("repo", "git@github.com:acme/shop.git"), ("repo", "https://evil.com/acme/shop"),
    ("repo", "https://github.com/acme/shop/../x"), ("repo", "file:///etc"),
    ("branch", "--upload-pack=x"), ("branch", "a..b"),
    ("type", "compose"), ("mem_mb", 10), ("cpus", 99), ("deploy_id", "x"),
])
def test_bad_spec_rejected(field, value):
    with pytest.raises(DeployError):
        validate_spec({**BASE, field: value})


def test_rollback_image_must_be_ours():
    assert validate_spec({**BASE, "repo": "", "image": "mirkomil/app-shop:20261126-120000-ab12"})["image"]
    with pytest.raises(DeployError):
        validate_spec({**BASE, "image": "evil/root:latest"})


def test_deploy_ids_are_valid_and_unique():
    ids = {new_deploy_id() for _ in range(50)}
    assert len(ids) > 40
    for i in ids:
        validate_spec({**BASE, "deploy_id": i})


def test_caddyfile_routes_and_default():
    text = render_caddyfile({"shop": {"hosts": ["shop.mirkomil-host.uz"], "upstream": "mk-shop-abc:8000"}})
    assert "http://shop.mirkomil-host.uz {" in text
    assert "reverse_proxy mk-shop-abc:8000" in text
    assert "auto_https off" in text and ":80 {" in text


def test_env_keys():
    assert ENV_KEY_RE.match("DATABASE_URL") and ENV_KEY_RE.match("_x")
    assert not ENV_KEY_RE.match("1BAD") and not ENV_KEY_RE.match("A-B") and not ENV_KEY_RE.match("A B")


def test_pick_port_prefers_app_ports_over_admin_ports():
    from mirkomil.paas.engine import pick_port
    assert pick_port([80, 443, 2019, 8000]) == 8000   # caddy base image + our EXPOSE
    assert pick_port([443, 2019, 80]) == 80
    assert pick_port([3000]) == 3000
    assert pick_port([443, 2019]) is None
    assert pick_port([]) is None
