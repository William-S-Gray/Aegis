from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit, metrics
from app.core.deps import client_ip, get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    verify_password,
)
from app.core.state import login_throttle
from app.database import get_db
from app.models import RefreshToken, User
from app.schemas import LoginRequest, RefreshRequest, TokenResponse, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid email or password",
    headers={"WWW-Authenticate": "Bearer"},
)

# Verifying against a throwaway digest keeps the response time for an unknown
# email close to that of a known one, so timing cannot be used to enumerate
# accounts.
_DUMMY_HASH = hash_password("aegis-timing-equalizer")


def _issue_tokens(db: Session, user: User) -> TokenResponse:
    raw_refresh, digest, expires_at = create_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=digest, expires_at=expires_at))
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=raw_refresh,
        user=UserPublic.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    throttle_key = f"{payload.email}|{client_ip(request) or 'unknown'}"

    retry_after = login_throttle.retry_after(throttle_key)
    if retry_after:
        response.headers["Retry-After"] = str(retry_after)
        audit.record(
            db,
            action="auth.login.throttled",
            request=request,
            actor_email=payload.email,
        )
        metrics.login_attempts.labels(outcome="throttled").inc()
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    user = db.scalar(select(User).where(User.email == payload.email))

    # Always run a verification so the timing profile does not leak whether the
    # account exists.
    password_ok = (
        verify_password(payload.password, user.hashed_password)
        if user is not None
        else verify_password(payload.password, _DUMMY_HASH) and False
    )

    if user is None or not password_ok or not user.is_active:
        login_throttle.record_failure(throttle_key)
        audit.record(
            db,
            action="auth.login.failed",
            request=request,
            actor_id=user.id if user else None,
            actor_email=payload.email,
            details={"reason": "inactive" if user and password_ok else "bad_credentials"},
        )
        metrics.login_attempts.labels(outcome="failed").inc()
        db.commit()
        # One message for every failure mode: wrong password, unknown account,
        # and deactivated account are indistinguishable to the caller.
        raise _INVALID_CREDENTIALS

    # Transparently upgrade digests hashed with older Argon2 parameters.
    if needs_rehash(user.hashed_password):
        user.hashed_password = hash_password(payload.password)

    login_throttle.reset(throttle_key)
    user.last_login_at = datetime.now(timezone.utc)

    tokens = _issue_tokens(db, user)
    metrics.login_attempts.labels(outcome="succeeded").inc()
    audit.record(
        db,
        action="auth.login.succeeded",
        request=request,
        actor_id=user.id,
        actor_email=user.email,
    )
    db.commit()
    return tokens


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    payload: RefreshRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    digest = hash_refresh_token(payload.refresh_token)
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest))

    if stored is None or not stored.is_active:
        audit.record(db, action="auth.refresh.rejected", request=request)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.get(User, stored.user_id)
    if user is None or not user.is_active:
        raise _INVALID_CREDENTIALS

    # Rotate: the presented token is retired as the replacement is issued, so a
    # stolen refresh token is usable at most once.
    stored.revoked_at = datetime.now(timezone.utc)
    tokens = _issue_tokens(db, user)
    audit.record(
        db,
        action="auth.refresh.succeeded",
        request=request,
        actor_id=user.id,
        actor_email=user.email,
    )
    db.commit()
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: RefreshRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    digest = hash_refresh_token(payload.refresh_token)
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest))

    # Only revoke a token that belongs to the caller.
    if stored is not None and stored.user_id == current_user.id:
        stored.revoked_at = datetime.now(timezone.utc)

    audit.record(
        db,
        action="auth.logout",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
    )
    db.commit()


@router.get("/me", response_model=UserPublic)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
