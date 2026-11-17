"""Curaduría manual (`locked`): un ítem congelado no lo toca el
pipeline automático — _rematch_pending no debe recasar un
beach_id=NULL que un humano desató a propósito.
"""

import pytest
from geoalchemy2.elements import WKTElement

from app.db import SessionLocal
from app.ingest_news import _rematch_pending
from app.models import Beach, NewsItem


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def test_rematch_pending_skips_locked(db):
    """Un NULL curado a mano no se recasa solo; el no-bloqueado sí."""
    beach = Beach(
        name="PLAYA LOCKEDTEST PM1",
        municipality="Garachico",
        monitored=True,
        geom=WKTElement("POINT(-16.76 28.37)", srid=4326),
    )
    db.add(beach)
    db.flush()
    base = dict(
        title="Cierran la playa de Lockedtest por desprendimientos",
        source="test",
        relevant=True,
        beach_id=None,
        event_type="closure",
        extracted_beach="Playa de Lockedtest",
    )
    locked = NewsItem(url="https://test.ci/locked-1", locked=True, **base)
    free = NewsItem(url="https://test.ci/locked-2", **base)
    db.add_all([locked, free])
    db.commit()
    try:
        _rematch_pending(db, db.query(Beach).all(), {})
        db.commit()
        db.refresh(locked)
        db.refresh(free)
        assert locked.beach_id is None
        assert free.beach_id == beach.id
    finally:
        db.query(NewsItem).filter(
            NewsItem.url.like("https://test.ci/locked-%")
        ).delete()
        db.delete(beach)
        db.commit()
