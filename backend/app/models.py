import enum
from datetime import date, datetime

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class OutfallStatus(str, enum.Enum):
    legal = "legal"
    illegal = "illegal"
    unknown = "unknown"


class BeachState(str, enum.Enum):
    open = "open"
    closed = "closed"
    warning = "warning"


class Outfall(Base):
    __tablename__ = "outfalls"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str | None] = mapped_column(
        String(80), unique=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    municipality: Mapped[str | None] = mapped_column(String(120))
    kind: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[OutfallStatus] = mapped_column(
        Enum(OutfallStatus), default=OutfallStatus.unknown
    )
    geom: Mapped[WKBElement] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    source_url: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Beach(Base):
    __tablename__ = "beaches"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str | None] = mapped_column(
        String(80), unique=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    municipality: Mapped[str | None] = mapped_column(String(120))
    geom: Mapped[WKBElement] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    source_url: Mapped[str | None] = mapped_column(Text)

    statuses: Mapped[list["BeachStatus"]] = relationship(
        back_populates="beach",
        order_by="desc(BeachStatus.reported_at)",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    incidents: Mapped[list["BeachIncident"]] = relationship(
        back_populates="beach",
        order_by="desc(BeachIncident.opened_at)",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class BeachStatus(Base):
    __tablename__ = "beach_statuses"

    id: Mapped[int] = mapped_column(primary_key=True)
    beach_id: Mapped[int] = mapped_column(
        ForeignKey("beaches.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[BeachState] = mapped_column(Enum(BeachState))
    reported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    source_url: Mapped[str | None] = mapped_column(Text)

    beach: Mapped[Beach] = relationship(back_populates="statuses")


class BeachIncident(Base):
    """Incidente oficial de una zona de baño (cierre, aviso...).

    Registrado en Náyade con fecha de apertura y de cierre; un incidente
    sin `closed_at` está activo ahora mismo.
    """

    __tablename__ = "beach_incidents"
    __table_args__ = (
        UniqueConstraint("beach_id", "opened_at", "observations"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    beach_id: Mapped[int] = mapped_column(
        ForeignKey("beaches.id", ondelete="CASCADE"), index=True
    )
    opened_at: Mapped[date] = mapped_column(Date)
    closed_at: Mapped[date | None] = mapped_column(Date)
    observations: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)

    beach: Mapped[Beach] = relationship(
        back_populates="incidents", passive_deletes=True
    )
