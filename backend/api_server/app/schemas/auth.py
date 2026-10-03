from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import MAX_PASSWORD_LENGTH, UserPublic


class LoginRequest(BaseModel):
    email: EmailStr
    # No minimum here: length rules belong on registration. Enforcing them at
    # login would tell an attacker which passwords are too short to be real.
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)
    # "cookie" (browsers): the refresh token goes only into an httpOnly cookie,
    # never the body, so no script can read it. "body": API clients.
    session: Literal["body", "cookie"] = "body"

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class RefreshRequest(BaseModel):
    # Omitted by browsers, which send the httpOnly cookie instead.
    refresh_token: str | None = None


class TokenResponse(BaseModel):
    """
    Response shape consumed by the frontend's AuthContext:
    { access_token, refresh_token, token_type, user }
    """

    access_token: str
    # None in cookie mode: the token is in the httpOnly cookie only.
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: UserPublic
