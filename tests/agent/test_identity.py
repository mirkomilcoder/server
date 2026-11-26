from mirkomil.config import valid_brand, valid_domain
from mirkomil.helper import handle_request


def test_brand_rules_match_installer():
    assert valid_brand("Mirkomil Host")
    assert valid_brand("O'zbek Server-1")
    for bad in ["A", 'Bad"Name', "x}{", "a\\b", "$(id)", "a;b", " lead", "x" * 41, "two\nlines"]:
        assert not valid_brand(bad), bad


def test_domain_rules():
    assert valid_domain("mirkomil-host.uz")
    for bad in ["Mirkomil.UZ", "*.mirkomil-host.uz", "localhost", "a..uz", "-x.uz"]:
        assert not valid_domain(bad), bad


def test_identity_verb_rejects_bad_input_before_touching_files():
    r = handle_request(b'{"verb": "identity.apply", "args": {"brand": "x\\"}", "domain": "ok.uz"}}', 0, {0})
    assert r == {"ok": False, "error": "invalid brand or domain"}
