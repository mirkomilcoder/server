import asyncio

import pytest

from mirkomil import api as api_mod
from mirkomil.auth import Peer


class FakeDB:
    @staticmethod
    def history(metric, since, buckets=240):
        if metric not in ("cpu", "mem"):
            raise ValueError("unknown metric")
        return [(since, 1.0)]

    @staticmethod
    def events(limit=100, before=None):
        return [{"id": 1, "title": "x"}]


class FakeState:
    db = FakeDB()

    def snapshot(self):
        return {"score": 100}


async def call(peer, raw: bytes):
    api = api_mod.build_api(FakeState())
    reader = asyncio.StreamReader()
    reader.feed_data(raw)
    reader.feed_eof()
    return await api._dispatch(peer, reader)


VIEWER = Peer(1000, "v", ("mirkomil-viewer",), "viewer")
NOBODY = Peer(1001, "n", (), "none")


def run(coro):
    return asyncio.run(coro)


def test_status_needs_a_role():
    assert run(call(VIEWER, b"GET /v1/status HTTP/1.1\r\n\r\n")) == (200, {"score": 100})
    with pytest.raises(api_mod.HttpError) as e:
        run(call(NOBODY, b"GET /v1/status HTTP/1.1\r\n\r\n"))
    assert e.value.status == 403


def test_me_is_public():
    status, body = run(call(NOBODY, b"GET /v1/me HTTP/1.1\r\n\r\n"))
    assert status == 200 and body["role"] == "none"


def test_history_validates_range_and_metric():
    status, body = run(call(VIEWER, b"GET /v1/history?range=24h&metrics=cpu,mem HTTP/1.1\r\n\r\n"))
    assert status == 200 and set(body["series"]) == {"cpu", "mem"}
    with pytest.raises(api_mod.HttpError):
        run(call(VIEWER, b"GET /v1/history?range=99y HTTP/1.1\r\n\r\n"))
    with pytest.raises(api_mod.HttpError):
        run(call(VIEWER, b"GET /v1/history?metrics=evil HTTP/1.1\r\n\r\n"))


def test_unknown_route_404_and_bad_json_400():
    with pytest.raises(api_mod.HttpError) as e:
        run(call(VIEWER, b"GET /nope HTTP/1.1\r\n\r\n"))
    assert e.value.status == 404
    with pytest.raises(api_mod.HttpError) as e:
        run(call(VIEWER, b"POST /v1/status HTTP/1.1\r\nContent-Length: 3\r\n\r\nabc"))
    assert e.value.status in (400, 405)
