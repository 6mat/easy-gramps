"""Backend tests run against tests/fake_gramps.py, never a real server: `pytest` from the repo root."""
import asyncio
import os
import pathlib
import sys
import tempfile

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "app"))
os.environ.update(GRAMPS_URL="http://gramps.test", BASE_PATH="/family", DATA_DIR=tempfile.mkdtemp(), TREE_TAG="Easy Gramps")

import gramps  # noqa: E402
from fake_gramps import FakeGramps  # noqa: E402


@pytest.fixture
def fake(monkeypatch):
    """A fresh fake Gramps Web, wired into the app (role "editor"; set fake.role to change it)."""
    f = FakeGramps()
    monkeypatch.setattr(gramps, "TRANSPORT", f.transport)
    import main
    monkeypatch.setattr(main, "upstream", main.httpx.AsyncClient(base_url="http://gramps.test/api", transport=f.transport))
    main._who_cache.clear()
    main._tag.update(handle=None, until=0)
    main._login_options.update(until=0, value={"password": True, "providers": []})
    main._icons.clear()
    return f


@pytest.fixture
def client(fake):
    """The FastAPI app, logged in (every request carries the fake's valid token)."""
    from starlette.testclient import TestClient
    import main
    return TestClient(main.app, headers={"Authorization": "Bearer tok"})


@pytest.fixture
def g(fake):
    """A Gramps API client for calling familytree functions directly."""
    return gramps.Gramps("http://gramps.test", "tok")


def run(coro):
    return asyncio.run(coro)
