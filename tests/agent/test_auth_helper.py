import json

from mirkomil.auth import Peer, role_for
from mirkomil.helper import handle_request


def test_roles_from_groups():
    assert role_for(0, ()) == "admin"
    assert role_for(1000, ("sudo",)) == "admin"
    assert role_for(1001, ("mirkomil-dev",)) == "developer"
    assert role_for(1002, ("mirkomil-viewer",)) == "viewer"
    assert role_for(1003, ("users",)) == "none"


def test_role_ranking():
    p = Peer(1, "x", (), "developer")
    assert p.at_least("viewer") and p.at_least("developer") and not p.at_least("admin")


def test_helper_rejects_unknown_uid():
    resp = handle_request(json.dumps({"verb": "ufw.status"}).encode(), uid=4242, allowed={0, 999})
    assert resp == {"ok": False, "error": "forbidden"}


def test_helper_rejects_unknown_verb_and_bad_args():
    assert "unknown verb" in handle_request(b'{"verb": "sh", "args": {"cmd": "id"}}', 0, {0})["error"]
    assert handle_request(b"not json", 0, {0})["error"] == "bad request"
    bad_unit = handle_request(b'{"verb": "unit.restart", "args": {"unit": "x; reboot"}}', 0, {0})
    assert bad_unit["ok"] is False and "invalid unit" in bad_unit["error"]
    not_allowed = handle_request(b'{"verb": "unit.restart", "args": {"unit": "sshd-keygen.service"}}', 0, {0})
    assert "not restartable" in not_allowed["error"]
