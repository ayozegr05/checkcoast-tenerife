"""Tests del parser de la pestaña Muestreos de Náyade."""

from app.models import BeachState
from scripts.ingest_beach_status import _parse_zone_status

PM_TMPL = """
<table class="tablaform">
   <tr>
      <td class="apartadotabla" width="20%">Punto Muestreo:</td>
      <td class="nombreCampoNI">{name}  </td>
   </tr>
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


def _html(blocks: list[tuple[str, list[tuple[str, str, str]]]]) -> str:
    parts = []
    for name, rows in blocks:
        body = "".join(
            ROW.format(apertura=a, cierre=c, obs=o) for a, c, o in rows
        )
        parts.append(PM_TMPL.format(name=name, rows=body))
    return "\n".join(parts)


def test_pm_without_incidents_is_open():
    html = _html([("PLAYA TEST PM1", [])])
    assert _parse_zone_status(html) == {
        "PLAYA TEST PM1": ("PLAYA TEST PM1", BeachState.open)
    }


def test_closed_incident_is_closed():
    html = _html(
        [
            (
                "PLAYA TEST PM1",
                [("02/09/2026", "", "Zona donde queda prohibido el baño temporalmente")],
            )
        ]
    )
    assert _parse_zone_status(html)["PLAYA TEST PM1"][1] == BeachState.closed


def test_open_non_prohibition_incident_is_warning():
    html = _html(
        [("PLAYA TEST PM1", [("11/08/2026", "", "Recomendación de no baño")])]
    )
    assert _parse_zone_status(html)["PLAYA TEST PM1"][1] == BeachState.warning


def test_closed_incident_in_past_is_open():
    html = _html(
        [("PLAYA TEST PM1", [("02/09/2026", "03/09/2026", "prohibido el baño")])]
    )
    assert _parse_zone_status(html)["PLAYA TEST PM1"][1] == BeachState.open


def test_multiple_pms_independent_states():
    html = _html(
        [
            ("PLAYA A PM1", [("01/09/2026", "", "prohibido el baño")]),
            ("PLAYA A PM2", []),
        ]
    )
    states = _parse_zone_status(html)
    assert states["PLAYA A PM1"][1] == BeachState.closed
    assert states["PLAYA A PM2"][1] == BeachState.open
