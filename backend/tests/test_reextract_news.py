"""La auditoría no pierde evidencia, reanuda por URL y aplica sin nuevo LLM."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.db import SessionLocal
from app.models import Beach, NewsExtractionReview, NewsItem
from app.news_llm import EventExtraction
from scripts import reextract_news as audit


@pytest.fixture
def sample(seed_data):
    with SessionLocal() as db:
        beach = db.get(Beach, seed_data["beach_id"])
        row = NewsItem(
            url="https://test.ci/reextract-1",
            title="La playa sigue cerrada",
            source="test",
            published_at=datetime(2090, 1, 1, tzinfo=UTC),
            relevant=True,
            event_type="closure",
            scope="whole",
            cause="riesgo de desprendimientos",
            beach_id=beach.id,
            extracted_beach=beach.name,
            extracted_municipality=beach.municipality,
            confidence=0.9,
            body_verified=True,
        )
        db.add(row)
        db.commit()
        try:
            yield db, row, beach
        finally:
            db.rollback()
            db.query(NewsExtractionReview).filter(
                NewsExtractionReview.url.like("https://test.ci/reextract-%")
            ).delete(synchronize_session=False)
            db.query(NewsItem).filter(
                NewsItem.url.like("https://test.ci/reextract-%")
            ).delete(synchronize_session=False)
            db.commit()


def extraction(row, **changes):
    fields = dict(
        relevant=True,
        confidence=0.95,
        event_type="closure",
        scope="whole",
        cause=row.cause,
        beach_name=row.extracted_beach,
        municipality=row.extracted_municipality,
        evidence_quote="La playa sigue cerrada",
    )
    fields.update(changes)
    return EventExtraction(**fields)


def args(**changes):
    fields = dict(
        model="test-model",
        fallback=None,
        all=False,
        year=2090,
        beach=None,
        max=1,
        dry_run=False,
    )
    fields.update(changes)
    return SimpleNamespace(**fields)


def setup_extractor(monkeypatch, beach, result):
    monkeypatch.setattr(
        audit, "resolve_and_fetch", lambda _: "La playa sigue cerrada"
    )
    monkeypatch.setattr(audit, "match_beaches", lambda *a, **kw: [beach])
    monkeypatch.setattr(
        audit, "narrow_hits_by_zone", lambda hits, *a, **kw: hits
    )

    class Extractor:
        last_error = "HTTP 503"
        calls = 0

        def extract(self, article, prompt=None, candidates=None):
            self.calls += 1
            return result

    return Extractor()


@pytest.mark.parametrize(
    "changes",
    [
        {"cause": None},
        {"scope": "access_point"},
        {"event_type": "reopening"},
        {"relevant": False},
        {"closed_since": "2020"},
        {"event_type": "pollution"},
    ],
)
def test_state_changes_are_held_even_with_same_beach(sample, changes):
    _, row, beach = sample
    proposal = audit.make_proposal(extraction(row, **changes), [beach], True)
    assert audit.review_reasons([row], proposal)


def test_removing_replica_is_reviewed(sample):
    _, row, _ = sample
    proposal = audit.make_proposal(extraction(row), [], True)
    assert "cambio de asociación con playas" in audit.review_reasons(
        [row], proposal
    )


def test_failed_attempt_retries_then_pending_review_is_not_repeated(
    sample, monkeypatch
):
    db, row, beach = sample
    before = audit.snapshot([row])
    failed = setup_extractor(monkeypatch, beach, None)
    assert audit.audit(db, failed, args()) == 2
    assert audit.snapshot([row]) == before
    record = db.query(NewsExtractionReview).filter_by(url=row.url).one()
    assert record.status == "failed"
    ex = setup_extractor(monkeypatch, beach, extraction(row, cause=None))
    assert audit.audit(db, ex, args()) == 0
    assert record.status == "review" and record.attempts == 2
    assert audit.snapshot([row]) == before
    assert audit.audit(db, ex, args()) == 0
    assert ex.calls == 1


def test_resume_moves_to_next_url_and_keeps_replicas(sample, monkeypatch):
    db, row, beach = sample
    second = NewsItem(
        url="https://test.ci/reextract-2",
        title=row.title,
        source=row.source,
        published_at=row.published_at,
        relevant=True,
        event_type="closure",
        scope="whole",
        cause=row.cause,
        beach_id=beach.id,
        extracted_beach=row.extracted_beach,
        extracted_municipality=row.extracted_municipality,
        body_verified=True,
    )
    db.add(second)
    db.commit()
    ex = setup_extractor(monkeypatch, beach, extraction(row))
    audit.audit(db, ex, args())
    audit.audit(db, ex, args())
    audit.audit(db, ex, args())
    assert ex.calls == 2
    records = (
        db.query(NewsExtractionReview)
        .filter(NewsExtractionReview.url.like("https://test.ci/reextract-%"))
        .all()
    )
    assert len(records) == 2 and all(r.status == "unchanged" for r in records)
    assert row.beach_id == second.beach_id == beach.id


def test_dry_run_never_writes_progress_or_rows(sample, monkeypatch):
    db, row, beach = sample
    before = audit.snapshot([row])
    ex = setup_extractor(monkeypatch, beach, extraction(row))
    audit.audit(db, ex, args(dry_run=True))
    assert audit.snapshot([row]) == before
    assert db.query(NewsExtractionReview).filter_by(url=row.url).count() == 0


def test_approval_uses_saved_result_and_refuses_stale_snapshot(
    sample, monkeypatch
):
    db, row, beach = sample
    ex = setup_extractor(
        monkeypatch, beach, extraction(row, cause="riesgo de alud")
    )
    audit.audit(db, ex, args())
    record = db.query(NewsExtractionReview).filter_by(url=row.url).one()
    row.cause = "corrección humana posterior"
    db.commit()
    with pytest.raises(ValueError, match="evidencia cambió"):
        audit.decide(db, record.id, accept=True)
    db.rollback()
    row.cause = record.before[0]["cause"]
    db.commit()
    audit.decide(db, record.id, accept=True)
    assert row.cause == "riesgo de alud" and row.locked
    assert record.status == "accepted" and ex.calls == 1


def test_locked_url_does_not_consume_batch_limit(sample, monkeypatch):
    db, row, beach = sample
    row.locked = True
    db.commit()
    ex = setup_extractor(monkeypatch, beach, None)
    audit.audit(db, ex, args())
    assert ex.calls == 0
    assert (
        db.query(NewsExtractionReview).filter_by(url=row.url).one().status
        == "locked"
    )
