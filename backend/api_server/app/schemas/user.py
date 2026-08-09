import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import Role

# Long enough to resist offline cracking, bounded so a huge input cannot be
# used to burn CPU in the Argon2 hasher.
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128


class UserPublic(BaseModel):
    """User representation safe to return to a client."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: Role
    is_active: bool


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    role: Role = Role.USER

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserUpdate(BaseModel):
    """Partial update. Password changes go through a dedicated flow."""

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    role: Role | None = None
    is_active: bool | None = None

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else value
