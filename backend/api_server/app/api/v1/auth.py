from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
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
from app.core.state import ip_throttle, login_throttle
from app.database import get_db
from app.models import RefreshToken, User
from app.schemas import LoginRequest, RefreshRequest, TokenResponse, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid email or password",
    headers={"WWW-Authenticate": "Bearer"},
)

# Verifying against a throwaway digest keeps the response time for an unknown
# email close to that of a known one, so timing cannot be used to enumerate
# accounts.
_DUMMY_HASH = hash_password("aegis-timing-equalizer")


# The browser's refresh token (R-002): httpOnly so no script can read it,
# SameSite=Strict and scoped to the auth routes so it is sent nowhere else.
REFRESH_COOKIE = "aegis_refresh"
_COOKIE_PATH = "/api/v1/auth"
# Cookie-mode refresh and logout must carry this header. A cross-site page
# cannot add a custom header without passing CORS, which lists only our origins.
CSRF_HEADER = "X-Aegis-CSRF"


def _issue_tokens(db: Session, user: User, response: Response, cookie: bool) -> TokenResponse:
    raw_refresh, digest, expires_at = create_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=digest, expires_at=expires_at))
    if cookie:
        response.set_cookie(
            REFRESH_COOKIE,
            raw_refresh,
            max_age=settings.refresh_token_expire_days * 86400,
            path=_COOKIE_PATH,
            secure=settings.refresh_cookie_secure,
            httponly=True,
            samesite="strict",
        )
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=None if cookie else raw_refresh,
        user=UserPublic.model_validate(user),
    )


def _presented_refresh_token(payload: RefreshRequest | None, request: Request) -> tuple[str | None, bool]:
    """(token, came from the cookie). A cookie without the CSRF header is ignored."""
    if payload is not None and payload.refresh_token:
        return payload.refresh_token, False
    if request.headers.get(CSRF_HEADER) != "1":
        return None, True
    return request.cookies.get(REFRESH_COOKIE), True


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE, path=_COOKIE_PATH, secure=settings.refresh_cookie_secure, httponly=True, samesite="strict"
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    ip = client_ip(request) or "unknown"
    account_key = f"{payload.email}|{ip}"

    # Two limits, both counted on every attempt before the password is checked:
    # per account+address stops guessing one password, per address stops one
    # source spraying many accounts.
    retry_after = max(
        login_throttle.attempt(account_key),
        ip_throttle.attempt(f"ip:{ip}"),
    )
    if retry_after:
        # Audited once per address per window. Auditing every rejected request
        # would let an unauthenticated caller grow the audit table at will.
        if login_throttle.first_rejection(ip):
            audit.record(
                db,
                action="auth.login.throttled",
                request=request,
                actor_email=payload.email,
            )
            db.commit()
        metrics.login_attempts.labels(outcome="throttled").inc()
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

    # The address counter is deliberately not reset: one success must not
    # clear a spraying source's tally.
    login_throttle.reset(account_key)
    user.last_login_at = datetime.now(timezone.utc)

    tokens = _issue_tokens(db, user, response, cookie=payload.session == "cookie")
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
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    db: Session = Depends(get_db),
) -> TokenResponse:
    raw, from_cookie = _presented_refresh_token(payload, request)
    stored = (
        db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
        if raw
        else None
    )

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
    tokens = _issue_tokens(db, user, response, cookie=from_cookie)
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
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    raw, from_cookie = _presented_refresh_token(payload, request)
    if from_cookie:
        _clear_cookie(response)
    stored = (
        db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
        if raw
        else None
    )

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
