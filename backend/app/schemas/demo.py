from typing import Literal

from pydantic import BaseModel

from app.demo_config import DemoLocationId, DemoSlotId
from app.schemas.captcha import Identifier


class TestDriveRequest(BaseModel):
    clickId: Identifier
    locationId: DemoLocationId
    slotId: DemoSlotId


class TestDriveResponse(BaseModel):
    leadId: str
    clickId: str
    locationId: DemoLocationId
    slotId: DemoSlotId
    status: Literal["completed"] = "completed"
    isDemo: Literal[True] = True
