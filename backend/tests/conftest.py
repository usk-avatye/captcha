"""같은 ASGI 앱을 사용하는 HTTP 클라이언트와 앱별 독립 저장소 fixture."""
import asyncio

import httpx
import pytest

from app.main import create_app
from app.store import Store


class ApiClient:
    def __init__(self, app):
        self.app = app

    def post(self, path, **kwargs):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=self.app), base_url="http://test",
            ) as client:
                return await client.post(path, **kwargs)
        return asyncio.run(send())


@pytest.fixture
def client_factory():
    return lambda: ApiClient(create_app(store=Store()))


@pytest.fixture
def client(client_factory):
    return client_factory()
