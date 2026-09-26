import enum
from datetime import date, datetime

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    ARRAY,
    Date,
    DateTime,
    Enum,
    Float,
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
    monitored: Mapped[bool] = mapped_column(default=True)
    # Nombres populares que usa la prensa ("Los Guanches" → PLAYA
    # CANDELARIA): el matching de noticias los consulta además del
    # nombre oficial del censo
    press_aliases: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
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
    measurements: Mapped[list["BeachMeasurement"]] = relationship(
        back_populates="beach",
        order_by="desc(BeachMeasurement.sampled_at)",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    news_items: Mapped[list["NewsItem"]] = relationship(
        back_populates="beach",
        order_by="desc(NewsItem.published_at)",
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


class BeachMeasurement(Base):
    """Resultado de un muestreo de calidad del agua en una playa.

    Náyade publica por cada punto de muestreo: fecha de toma, E. coli,
    enterococo y observación ("Zona Apta para el baño", etc.).
    """

    __tablename__ = "beach_measurements"
    __table_args__ = (
        UniqueConstraint("beach_id", "sampled_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    beach_id: Mapped[int] = mapped_column(
        ForeignKey("beaches.id", ondelete="CASCADE"), index=True
    )
    sampled_at: Mapped[date] = mapped_column(Date)
    ecoli: Mapped[str | None] = mapped_column(String(80))
    enterococci: Mapped[str | None] = mapped_column(String(80))
    evaluation: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)

    beach: Mapped[Beach] = relationship(
        back_populates="measurements", passive_deletes=True
    )


class NewsItem(Base):
    """Noticia de prensa que menciona un evento en una playa.

    Contexto secundario ("según prensa"): NUNCA alimenta el estado
    oficial de la playa, que solo sale de Náyade. `beach_id` es None
    cuando el matching conservador no logra ligarla a una playa con
    confianza alta; `relevant` es False cuando el LLM descarta el
    titular (ruido, otra isla, meta-noticia) — se guarda igualmente
    para deduplicar por `url` y no volver a gastar llamadas LLM.
    """

    __tablename__ = "news_items"
    # Una misma playa puede tener varios PMs: la noticia se replica por
    # beach_id para verse en cada ficha; la dedup real va por url
    __table_args__ = (
        UniqueConstraint(
            "url", "beach_id", postgresql_nulls_not_distinct=True
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(120))
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    relevant: Mapped[bool] = mapped_column(default=False)
    beach_id: Mapped[int | None] = mapped_column(
        ForeignKey("beaches.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str | None] = mapped_column(String(20))
    cause: Mapped[str | None] = mapped_column(Text)
    # Inicio REAL del evento según el propio texto ("cerrada desde
    # julio de 2024"), no la fecha de publicación. ISO parcial:
    # "YYYY-MM-DD", "YYYY-MM" o "YYYY" según lo que afirme la fuente
    closed_since: Mapped[str | None] = mapped_column(String(10))
    extracted_beach: Mapped[str | None] = mapped_column(String(255))
    extracted_municipality: Mapped[str | None] = mapped_column(String(120))
    confidence: Mapped[float | None] = mapped_column(Float)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Push: el envío es fire-and-forget en la ingesta — estas marcas
    # permiten reintentar en la siguiente pasada lo que no salió
    push_pending: Mapped[bool] = mapped_column(default=False)
    pushed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    beach: Mapped[Beach] = relationship(
        back_populates="news_items", passive_deletes=True
    )


class DeviceToken(Base):
    """Expo push token de un dispositivo con la app instalada.

    Se registra al arrancar la app y se usa para avisar de cambios de
    estado de playas vía Expo Push Service.
    """

    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    platform: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
