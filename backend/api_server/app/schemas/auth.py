from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import MAX_PASSWORD_LENGTH, UserPublic


class LoginRequest(BaseModel):
    email: EmailStr
    # No minimum here: length rules belong on registration. Enforcing them at
    # login would tell an attacker which passwords are too short to be real.
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    """
    Response shape consumed by the frontend's AuthContext:
    { access_token, refresh_token, token_type, user }
    """

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserPublic
