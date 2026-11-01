from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=72)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class DeviceCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    name: str = Field(min_length=2, max_length=120)
    type: str
    location: str = ""


class IngestIn(BaseModel):
    values: dict[str, float] = Field(min_length=1, max_length=20)
    ts: datetime | None = None


class CommandIn(BaseModel):
    name: str = Field(pattern=r"^(set_relay|set_interval|reboot)$")
    payload: dict = Field(default_factory=dict)


class AckIn(BaseModel):
    ok: bool = True


class AssistantIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict] = Field(default_factory=list, max_length=20)
