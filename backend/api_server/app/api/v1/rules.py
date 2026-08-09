import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_admin
from app.database import get_db
from app.models import AttributeMismatchRule, User
from app.schemas import RuleCreate, RulePublic

router = APIRouter(prefix="/attribute-mismatch-rules", tags=["rules"])


@router.get("", response_model=list[RulePublic])
def list_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[AttributeMismatchRule]:
    return list(
        db.scalars(
            select(AttributeMismatchRule).order_by(
                AttributeMismatchRule.attribute, AttributeMismatchRule.value_a
            )
        ).all()
    )


@router.post("", response_model=RulePublic, status_code=status.HTTP_201_CREATED)
def create_rule(
    payload: RuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> AttributeMismatchRule:
    value_a, value_b = AttributeMismatchRule.normalize_pair(*payload.allowed_pair)

    existing = db.scalar(
        select(AttributeMismatchRule).where(
            AttributeMismatchRule.attribute == payload.attribute,
            AttributeMismatchRule.value_a == value_a,
            AttributeMismatchRule.value_b == value_b,
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That rule already exists"
        )

    rule = AttributeMismatchRule(
        attribute=payload.attribute, value_a=value_a, value_b=value_b
    )
    db.add(rule)
    db.flush()

    # These rules suppress alerts, so every change is security-relevant.
    audit.record(
        db,
        action="rule.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="attribute_mismatch_rule",
        resource_id=str(rule.id),
        details={"attribute": rule.attribute, "pair": [value_a, value_b]},
    )
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> None:
    rule = db.get(AttributeMismatchRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    audit.record(
        db,
        action="rule.deleted",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="attribute_mismatch_rule",
        resource_id=str(rule.id),
        details={"attribute": rule.attribute, "pair": [rule.value_a, rule.value_b]},
    )
    db.delete(rule)
    db.commit()
