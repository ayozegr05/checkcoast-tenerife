"""Tests del parser de la pestaña Muestreos de Náyade."""

from datetime import UTC, date

from app.models import Beach, BeachState
from scripts.ingest_beach_status import (
    _derive_state,
    _foreign_municipality,
    _parse_pms,
)

PM_TMPL = """
<table class="tablaform">
   <tr>
      <td class="apartadotabla" width="20%">Punto Muestreo:</td>
      <td class="nombreCampoNI">{name}  </td>
   </tr>
</table>
<table class="tablaform">
   <tr>
      <td class="apartadotabla">Muestreos:</td>
      <td>&nbsp;</td>
   </tr>
   <tr>
      <td>&nbsp;</td>
      <td class="nombreCampoNI">Fecha Toma</td>
      <td class="nombreCampoNI">Escherichia coli</td>
      <td class="nombreCampoNI">Enterococo</td>
      <td class="nombreCampoNI">Observaciones</td>
      <td>&nbsp;</td>
   </tr>
   {meas_rows}
</table>
<!--INFORMACION INCIDENCIA -->
   <tr><td class="nombreCampoNI">Fecha Apertura Incidente</td>
       <td class="nombreCampoNI">Fecha Cierre Incidente</td>
       <td class="nombreCampoNI">Observaciones</td></tr>
   {rows}
<!--FIN INFORMACION INCIDENCIA -->
"""

ROW = (
    '<tr><td width="5%">&nbsp;</td>'
    '<td class="valorCampoI">{apertura}</td>'
    '<td class="valorCampoI">{cierre}</td>'
    '<td class="valorCampoI">{obs}</td></tr>'
)

MEAS_ROW = (
    '<tr><td width="5%">&nbsp;</td>'
    '<td class="valorCampoI">{fecha}</td>'
    '<td class="valorCampoI">{ecoli}</td>'
    '<td class="valorCampoI">{entero}</td>'
    '<td class="valorCampoI">{obs}</td></tr>'
)


def _html(blocks: list[tuple[str, list[tuple[str, str, str]]]]) -> str:
    parts = []
    for name, rows in blocks:
        body = "".join(
            ROW.format(apertura=a, cierre=c, obs=o) for a, c, o in rows
        )
        parts.append(PM_TMPL.format(name=name, rows=body, meas_rows=""))
    return "\n".join(parts)


def _states(html: str) -> dict[str, BeachState]:
    return {pm: _derive_state(d) for pm, d in _parse_pms(html).items()}


def test_pm_without_incidents_is_open():
    html = _html([("PLAYA TEST PM1", [])])
    assert _states(html) == {"PLAYA TEST PM1": BeachState.open}


def test_closed_incident_is_closed():
    html = _html(
        [
            (
                "PLAYA TEST PM1",
                [
                    (
                        "02/09/2026",
                        "",
                        "Zona donde queda prohibido el baño temporalmente",
                    )
                ],
            )
        ]
    )
    assert _states(html)["PLAYA TEST PM1"] == BeachState.closed


def test_dash_cierre_means_still_open():
    """Náyade muestra '--' en la fecha de cierre de incidentes abiertos."""
    html = _html(
        [("PLAYA TEST PM1", [("02/09/2026", "--", "prohibido el baño")])]
    )
    assert _states(html)["PLAYA TEST PM1"] == BeachState.closed


def test_open_non_prohibition_incident_is_warning():
    html = _html(
        [("PLAYA TEST PM1", [("11/08/2026", "", "Recomendación de no baño")])]
    )
    assert _states(html)["PLAYA TEST PM1"] == BeachState.warning


def test_closed_incident_in_past_is_open():
    html = _html(
        [
            (
                "PLAYA TEST PM1",
                [("02/09/2026", "03/09/2026", "prohibido el baño")],
            )
        ]
    )
    assert _states(html)["PLAYA TEST PM1"] == BeachState.open


def test_multiple_pms_independent_states():
    html = _html(
        [
            ("PLAYA A PM1", [("01/09/2026", "", "prohibido el baño")]),
            ("PLAYA A PM2", []),
        ]
    )
    states = _states(html)
    assert states["PLAYA A PM1"] == BeachState.closed
    assert states["PLAYA A PM2"] == BeachState.open


def test_incident_dates_and_observations_parsed():
    html = _html(
        [
            (
                "PLAYA TEST PM1",
                [("02/09/2026", "03/09/2026", "prohibido el baño")],
            )
        ]
    )
    inc = _parse_pms(html)["PLAYA TEST PM1"].incidents[0]
    assert inc.opened == date(2026, 9, 2)
    assert inc.closed == date(2026, 9, 3)
    assert "prohibido" in inc.observations


def test_measurements_parsed():
    meas = MEAS_ROW.format(
        fecha="09/09/2026",
        ecoli="40 UFC/100 mL",
        entero="9 UFC/100 mL",
        obs="Zona Apta para el baño",
    )
    html = PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    m = _parse_pms(html)["PLAYA TEST PM1"].measurements[0]
    assert m.sampled == date(2026, 9, 9)
    assert m.ecoli == "40 UFC/100 mL"
    assert m.enterococci == "9 UFC/100 mL"
    assert m.evaluation == "Zona Apta para el baño"


def test_latest_measurement_prohibition_closes_beach():
    """Un análisis con evaluación 'prohibido' cierra la playa aunque no
    exista incidente (caso real: El Cabezo PM1, 09/09/2026)."""
    meas = MEAS_ROW.format(
        fecha="09/09/2026",
        ecoli="30 UFC/100 mL",
        entero="410 UFC/100 mL",
        obs="Zona donde queda prohibido el baño temporalmente",
    )
    html = PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    assert _states(html)["PLAYA TEST PM1"] == BeachState.closed


def test_apta_measurement_is_open():
    meas = MEAS_ROW.format(
        fecha="09/09/2026",
        ecoli="40 UFC/100 mL",
        entero="9 UFC/100 mL",
        obs="Zona Apta para el baño",
    )
    html = PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    assert _states(html)["PLAYA TEST PM1"] == BeachState.open


def test_ungraded_latest_measurement_is_not_an_alert():
    """'Sin Calificar' = no pudieron evaluar la muestra — registro
    administrativo, no aviso (San Marcos: 57 días de 'aviso' sin que
    el agua estuviera mal)."""
    meas = MEAS_ROW.format(
        fecha="09/09/2026", ecoli="--", entero="--", obs="Sin Calificar"
    )
    html = PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    assert _states(html)["PLAYA TEST PM1"] == BeachState.open


def test_ungraded_open_incident_is_not_an_alert():
    """Una incidencia abierta con solo 'Sin Calificar' tampoco alerta:
    es la traza administrativa de una muestra sin evaluar (o de una
    playa cerrada por el municipio — Gaviotas), no un aviso de agua."""
    html = _html([("PLAYA TEST PM1", [("11/08/2026", "", "Sin Calificar")])])
    assert _states(html)["PLAYA TEST PM1"] == BeachState.open


def test_incident_closed_after_measurement_wins():
    """Si el incidente se cerró después de la última medición mala,
    la playa está abierta (la medición quedó superada)."""
    meas = MEAS_ROW.format(
        fecha="02/09/2026",
        ecoli="800 UFC/100 mL",
        entero="80 UFC/100 mL",
        obs="Zona donde queda prohibido el baño temporalmente",
    )
    inc = ROW.format(
        apertura="02/09/2026", cierre="03/09/2026", obs="prohibido el baño"
    )
    html = PM_TMPL.format(name="PLAYA TEST PM1", rows=inc, meas_rows=meas)
    assert _states(html)["PLAYA TEST PM1"] == BeachState.open


def test_incident_rows_are_not_measurements():
    """Las filas de incidentes (también con fecha) no deben colarse como
    muestreos — el parser de muestreos se acota a antes de INCIDENCIA."""
    inc = ROW.format(
        apertura="02/09/2026", cierre="--", obs="prohibido el baño"
    )
    html = PM_TMPL.format(name="PLAYA TEST PM1", rows=inc, meas_rows="")
    assert _parse_pms(html)["PLAYA TEST PM1"].measurements == []


def test_foreign_municipality_rejects_same_named_pm():
    """Un PM homónimo de otra zona no casa con la playa: evita que
    'Caleta de Negros' de otro municipio sobreescriba su estado."""
    beach = Beach(
        name="Caleta de Negros", municipality="Santa Cruz de Tenerife"
    )
    assert _foreign_municipality(beach, "Granadilla de Abona") is True
    assert _foreign_municipality(beach, "Santa Cruz de Tenerife") is False


def test_foreign_municipality_normalizes_article_forms():
    """'Orotava (La)' (grafía censo) casa con 'La Orotava' (grafía Náyade)."""
    beach = Beach(name="X", municipality="Orotava (La)")
    assert _foreign_municipality(beach, "La Orotava") is False


def test_foreign_municipality_unknown_side_does_not_filter():
    """Sin municipio en la playa o en la zona no se puede discriminar."""
    assert (
        _foreign_municipality(Beach(name="X", municipality=None), "Adeje")
        is False
    )
    assert (
        _foreign_municipality(Beach(name="X", municipality="Adeje"), "")
        is False
    )


def test_superseded_by_reopening_stale_sample():
    """Muestra mala tomada ANTES de la reapertura de prensa: mismo
    episodio que Náyade publica tarde -> no cambia el estado."""
    from datetime import datetime
    from types import SimpleNamespace

    from scripts.ingest_beach_status import _superseded_by_reopening

    beach = SimpleNamespace(
        news_items=[
            SimpleNamespace(
                relevant=True,
                event_type="reopening",
                published_at=datetime(2026, 9, 20, tzinfo=UTC),
            )
        ]
    )
    meas = MEAS_ROW.format(
        fecha="15/09/2026",
        ecoli="900",
        entero="500",
        obs="Zona donde queda prohibido el baño temporalmente",
    )
    pm = _parse_pms(
        PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    )["PLAYA TEST PM1"]
    assert _superseded_by_reopening(beach, pm) is True


def test_superseded_by_reopening_fresh_sample_closes():
    """Muestra mala tomada DESPUÉS de la reapertura: contaminación
    nueva, no es rezago -> el estado cambia a cerrada."""
    from datetime import datetime
    from types import SimpleNamespace

    from scripts.ingest_beach_status import _superseded_by_reopening

    beach = SimpleNamespace(
        news_items=[
            SimpleNamespace(
                relevant=True,
                event_type="reopening",
                published_at=datetime(2026, 9, 20, tzinfo=UTC),
            )
        ]
    )
    meas = MEAS_ROW.format(
        fecha="25/09/2026",
        ecoli="900",
        entero="500",
        obs="Zona donde queda prohibido el baño temporalmente",
    )
    pm = _parse_pms(
        PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    )["PLAYA TEST PM1"]
    assert _superseded_by_reopening(beach, pm) is False


def test_open_incident_single_source_not_stale():
    """Incidencia ABIERTA anterior a la reapertura + UNA sola fuente:
    un titular no puede abrir una prohibición vigente (Gaviotas:
    'obras PARA reabrir' mal clasificada)."""
    from datetime import datetime
    from types import SimpleNamespace

    from scripts.ingest_beach_status import _superseded_by_reopening

    beach = SimpleNamespace(
        news_items=[
            SimpleNamespace(
                relevant=True,
                event_type="reopening",
                source="El Día",
                published_at=datetime(2026, 9, 20, tzinfo=UTC),
            )
        ]
    )
    inc = ROW.format(apertura="15/09/2026", cierre="--", obs="prohibido")
    pm = _parse_pms(
        PM_TMPL.format(name="PLAYA TEST PM1", rows=inc, meas_rows="")
    )["PLAYA TEST PM1"]
    assert _superseded_by_reopening(beach, pm) is False


def test_open_incident_corroborated_reopening_is_stale():
    """Incidencia ABIERTA anterior a la reapertura + >=2 medios
    distintos reportándola: reapertura corroborada, la incidencia es
    papeleo rezagado del mismo episodio -> se suprime."""
    from datetime import datetime
    from types import SimpleNamespace

    from scripts.ingest_beach_status import _superseded_by_reopening

    beach = SimpleNamespace(
        news_items=[
            SimpleNamespace(
                relevant=True,
                event_type="reopening",
                source="El Día",
                published_at=datetime(2026, 9, 20, tzinfo=UTC),
            ),
            SimpleNamespace(
                relevant=True,
                event_type="reopening",
                source="Diario de Avisos",
                published_at=datetime(2026, 9, 19, tzinfo=UTC),
            ),
        ]
    )
    inc = ROW.format(apertura="15/09/2026", cierre="--", obs="prohibido")
    pm = _parse_pms(
        PM_TMPL.format(name="PLAYA TEST PM1", rows=inc, meas_rows="")
    )["PLAYA TEST PM1"]
    assert _superseded_by_reopening(beach, pm) is True


def test_open_incident_after_reopening_is_new_event():
    """Incidencia abierta DESPUÉS de la reapertura de prensa: evento
    nuevo, sí cambia el estado."""
    from datetime import datetime
    from types import SimpleNamespace

    from scripts.ingest_beach_status import _superseded_by_reopening

    beach = SimpleNamespace(
        news_items=[
            SimpleNamespace(
                relevant=True,
                event_type="reopening",
                published_at=datetime(2026, 9, 20, tzinfo=UTC),
            )
        ]
    )
    inc = ROW.format(apertura="25/09/2026", cierre="--", obs="prohibido")
    pm = _parse_pms(
        PM_TMPL.format(name="PLAYA TEST PM1", rows=inc, meas_rows="")
    )["PLAYA TEST PM1"]
    assert _superseded_by_reopening(beach, pm) is False


def test_no_reopening_no_suppression():
    """Sin reapertura de prensa no hay supresión."""
    from types import SimpleNamespace

    from scripts.ingest_beach_status import _superseded_by_reopening

    beach = SimpleNamespace(news_items=[])
    meas = MEAS_ROW.format(
        fecha="15/09/2026",
        ecoli="900",
        entero="500",
        obs="prohibido",
    )
    pm = _parse_pms(
        PM_TMPL.format(name="PLAYA TEST PM1", rows="", meas_rows=meas)
    )["PLAYA TEST PM1"]
    assert _superseded_by_reopening(beach, pm) is False
