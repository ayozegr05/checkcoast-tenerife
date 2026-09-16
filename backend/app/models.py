import enum
from datetime import datetime

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
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
    name: Mapped[str] = mapped_column(String(255))
    municipality: Mapped[str | None] = mapped_column(String(120))
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
