"""Siembra manual de news_items verificados a mano (sin LLM).

El pipeline de prensa solo ve lo que Google News indexa (reciente).
Para episodios antiguos ya confirmados por búsqueda web manual,
insertamos las noticias ya "extraídas" — event_type/cause/closed_since
los rellenamos nosotros, así que cero cuota de Gemini.

- Una fila por beach_id (replicación por PM, como el pipeline real)
- Upsert por (url, beach_id) — idempotente
- push_pending=False — contexto histórico, nunca notifica
- Solo artículos leídos y verificados a mano (fecha + contenido)

Uso:
    python -m scripts.seed_press            # inserta lo que falta
    python -m scripts.seed_press --dry-run  # solo muestra
"""

import sys
from datetime import datetime, timezone

from app.db import SessionLocal
from app.events import synthesize_events
from app.models import Beach, NewsItem

# (url, titular, fuente, fecha YYYY-MM-DD, tipo, causa, closed_since, beach_ids)
ITEMS = [
    # ── Playa Jardín: megacierre 3-jul-2024 → 17-jun-2025 (349 días) ──
    (
        "https://www.eldiario.es/canariasahora/tenerifeahora/norte/cerrada-indefinidamente-playa-jardin-puerto-cruz-contaminacion-aguas-fecales_1_11499039.html",
        "Puerto de la Cruz pide abstenerse del baño en Playa Jardín por contaminación fecal",
        "eldiario.es", "2024-07-04", "closure", "Contaminación", "2024-07",
        [41, 42, 43],
    ),
    (
        "https://rtvc.es/cerrada-playa-jardin-por-contaminacion-con-aguas-residuales/",
        "Cerrada indefinidamente Playa Jardín por contaminación con aguas residuales",
        "RTVC", "2024-07-04", "closure", "Contaminación", "2024-07",
        [41, 42, 43],
    ),
    (
        "https://www.eldia.es/tenerife/2024/07/23/puerto-cruz-recaba-informes-resolver-105986504.html",
        "Puerto de la Cruz recaba informes para resolver el cierre de Playa Jardín",
        "El Día", "2024-07-23", "closure", "Contaminación", None,
        [41, 42, 43],
    ),
    (
        "https://www.eldiario.es/canariasahora/tenerifeahora/norte/playa-jardin-puerto-cruz-cumple-mes-cerrada-contaminacion-fecal_1_11558052.html",
        "Playa Jardín de Puerto de la Cruz cumple casi un mes cerrada por contaminación fecal",
        "eldiario.es", "2024-07-30", "closure", "Contaminación", "2024-07",
        [41, 42, 43],
    ),
    (
        "https://www.eldia.es/tenerife/2025/01/01/peor-desastre-medioambiental-tenerife-playa-113054303.html",
        "El peor desastre medioambiental de Tenerife: Playa Jardín cumple seis meses cerrada",
        "El Día", "2025-01-01", "closure", "Contaminación", "2024-07",
        [41, 42, 43],
    ),
    (
        "https://www.atlanticohoy.com/tenerife/puerto-de-la-cruz-cuatro-lineas-accion-playa-jardin_1540997_102.html",
        "Puerto de la Cruz prepara cuatro líneas de acción para combatir las aguas fecales en Playa Jardín",
        "Atlántico Hoy", "2025-01-03", "closure", "Contaminación", None,
        [41, 42, 43],
    ),
    (
        "https://elpais.com/espana/2025-01-21/la-contaminacion-fecal-deja-sin-playa-y-negocios-a-miles-de-vecinos-en-el-norte-de-tenerife.html",
        "La contaminación fecal deja sin playa y negocios a miles de vecinos en el norte de Tenerife",
        "El País", "2025-01-21", "closure", "Contaminación", "2024-07",
        [41, 42, 43],
    ),
    (
        "https://elpais.com/clima-y-medio-ambiente/2025-10-02/aguas-fecales-y-turismo-tenerife-el-paraiso-contaminado.html",
        "Aguas fecales y turismo: Tenerife, el paraíso contaminado",
        "El País", "2025-10-02", "closure", "Contaminación", "2024-07",
        [41, 42, 43],
    ),
    # Reapertura oficial 17-jun-2025 (tras 349 días)
    (
        "https://www.eldia.es/tenerife/2025/06/16/playa-jardin-reabre-bano-manana-118684293.html",
        "Playa Jardín se reabre hoy al baño en Puerto de la Cruz tras un año cerrada",
        "El Día", "2025-06-16", "reopening", None, None,
        [41, 42, 43],
    ),
    (
        "https://www.puertodelacruz.es/noticias/2025/06/17/el-gobierno-local-reabre-al-bano-playa-jardin-tras-un-ano-cerrada/",
        "El Gobierno local reabre al baño Playa Jardín tras un año cerrada",
        "Ayto. Puerto de la Cruz", "2025-06-17", "reopening", None, None,
        [41, 42, 43],
    ),
    (
        "https://rtvc.es/reapertura-playa-jardin-17-junio-2025/",
        "Reabren Playa Jardín tras casi un año cerrada por contaminación",
        "RTVC", "2025-06-17", "reopening", None, None,
        [41, 42, 43],
    ),
    (
        "https://www.eldia.es/tenerife/2025/06/17/playa-jardin-reabre-bano-diez-118718127.html",
        "Playa Jardín reabre al baño tras diez meses cerrada por contaminación",
        "El Día", "2025-06-17", "reopening", None, None,
        [41, 42, 43],
    ),
    # ── Jardín sep-2023: solo Playa Grande (PM4) cerró 26→28 sep ──
    (
        "https://www.europapress.es/islas-canarias/noticia-cerrada-bano-playa-grande-conjunto-playa-jardin-puerto-cruz-20230926185151.html",
        "Cerrada al baño la playa Grande del conjunto de Playa Jardín (Puerto de la Cruz)",
        "Europa Press", "2023-09-26", "closure", "Contaminación", None,
        [42],
    ),
    (
        "https://www.eldiario.es/canariasahora/tenerifeahora/sociedad/cerrada-bano-playa-grande-puerto-cruz-detectarse-alteraciones-parametros-biologicos_1_10547409.html",
        "Cerrada al baño la playa Grande de Puerto de la Cruz tras detectarse alteraciones de los parámetros biológicos",
        "eldiario.es", "2023-09-26", "closure", "Contaminación", None,
        [42],
    ),
    (
        "https://www.puertodelacruz.es/noticias/2023/09/28/se-reabre-al-bano-playa-grande-en-playa-jardin/",
        "Se reabre al baño playa Grande en Playa Jardín",
        "Ayto. Puerto de la Cruz", "2023-09-28", "reopening", None, None,
        [42],
    ),
    (
        "https://www.eldia.es/tenerife/2023/09/28/reabre-bano-playa-jardin-calidad-92663233.html",
        "Se reabre al baño Playa Jardín: la calidad del agua ya es apta",
        "El Día", "2023-09-28", "reopening", None, None,
        [42],
    ),
    # ── La Pinta PM3: dos cierres ago-sep 2024 (enterococos) ──
    (
        "https://www.canal4tenerife.tv/cierre-temporal-de-la-playa-de-la-pinta-en-adeje-por-la-deteccion-de-bacterias-del-tipo-enterococos-310/",
        "Cierre temporal de la Playa de La Pinta, en Adeje, por la detección de bacterias del tipo 'enterococos 310'",
        "Canal 4 Tenerife", "2024-08-21", "closure", "Contaminación", None,
        [10],
    ),
    (
        "https://www.eldia.es/tenerife/2024/09/03/vuelve-cerrar-playa-pinta-apenas-107712041.html",
        "Vuelve a cerrar la playa de La Pinta apenas once días después de su reapertura",
        "El Día", "2024-09-03", "closure", "Contaminación", None,
        [10],
    ),
    (
        "https://diariodeavisos.elespanol.com/2024/09/adeje-vuelve-cerrar-playa-de-la-pinta/",
        "Adeje vuelve a cerrar la playa de La Pinta",
        "Diario de Avisos", "2024-09-03", "closure", "Contaminación", None,
        [10],
    ),
    (
        "https://www.eldia.es/tenerife/2024/09/04/reabre-playa-pinta-adeje-segundo-107747957.html",
        "Reabre la playa de La Pinta, en Adeje, tras el segundo cierre del verano",
        "El Día", "2024-09-04", "reopening", None, None,
        [10],
    ),
    # ── Troya I + II: cierre 13-may-2025, reapertura 14-may ──
    (
        "https://www.eldia.es/tenerife/2025/05/13/cerradas-bano-playas-adeje-mala-117354251.html",
        "Cerradas al baño dos playas de Adeje por la mala calidad del agua",
        "El Día", "2025-05-13", "closure", "Contaminación", None,
        [12, 13],
    ),
    (
        "https://www.europapress.es/islas-canarias/noticia-ayuntamiento-adeje-tenerife-reabre-bano-playas-troya-troya-ii-20250514174039.html",
        "El Ayuntamiento de Adeje (Tenerife) reabre al baño las playas Troya I y Troya II",
        "Europa Press", "2025-05-14", "reopening", None, None,
        [12, 13],
    ),
    (
        "https://rtvc.es/cierre-playas-adeje-tenerife-bacterias-fecales-13-mayo-2025/",
        "Reabren las playas de Troya I y II de Adeje",
        "RTVC", "2025-05-14", "reopening", None, None,
        [12, 13],
    ),
    (
        "https://www.eldia.es/tenerife/2025/05/14/reabren-bano-playas-adeje-cerradas-117398797.html",
        "Reabren al baño las dos playas en Adeje cerradas por bacterias fecales",
        "El Día", "2025-05-14", "reopening", None, None,
        [12, 13],
    ),
    # ── El Puertito (OSM, no monitorizada): cerró 8-may-2025 junto a
    # Troya I (mismo suceso; el artículo de El Día lo menciona
    # explícitamente) ──
    (
        "https://www.eldia.es/tenerife/2025/05/13/cerradas-bano-playas-adeje-mala-117354251.html",
        "Cerradas al baño dos playas de Adeje por la mala calidad del agua",
        "El Día", "2025-05-13", "closure", "Contaminación", "2025-05-08",
        [91],
    ),
    # ── Candelaria PM4: vertido por toallitas 21-feb-2025 ──
    (
        "https://www.europapress.es/islas-canarias/noticia-cerradas-bano-dos-playas-contaminacion-candelaria-tenerife-20250221173327.html",
        "Cerradas al baño dos playas por contaminación en Candelaria (Tenerife)",
        "Europa Press", "2025-02-21", "closure", "Contaminación", None,
        [23],
    ),
    (
        "https://rtvc.es/se-prohibe-el-bano-en-dos-playas-de-candelaria-por-contaminacion/",
        "Se prohíbe el baño en dos playas de Candelaria por contaminación",
        "RTVC", "2025-02-21", "closure", "Contaminación", None,
        [23],
    ),
    (
        "https://www.candelaria.es/las-playas-de-los-guanches-y-el-alcalde-permaneceran-cerradas-hasta-manana-a-la-espera-de-nuevos-analisis-de-agua/",
        "Las playas de Los Guanches y El Alcalde permanecerán cerradas hasta mañana, a la espera de nuevos análisis de agua",
        "Ayto. Candelaria", "2025-02-24", "closure", "Contaminación", None,
        [23],
    ),
    (
        "https://diariodeavisos.elespanol.com/2025/02/toallitas-en-la-red-de-saneamiento-la-causa-del-ultimo-vertido-en-candelaria-que-mantiene-dos-playas-cerradas/",
        "Toallitas en la red de saneamiento: la causa del último vertido en Candelaria que mantiene dos playas cerradas",
        "Diario de Avisos", "2025-02-24", "closure", "Contaminación", None,
        [23],
    ),
    # ── El Pris PM1: reapertura oficial 13-abr-2026 (corrige el fin
    # del episodio sep-25→may-26) ──
    (
        "https://www.tacoronte.es/reabierta-al-bano-la-piscina-natural-de-el-pris-tras-confirmarse-la-calidad-de-sus-aguas-en-los-analisis-de-los-ultimos-dias/",
        "Reabierta al baño la piscina natural de El Pris tras confirmarse la calidad de sus aguas en los análisis de los últimos días",
        "Ayto. Tacoronte", "2026-04-13", "reopening", None, None,
        [63],
    ),
]

# Contexto sin episodio: una noticia de prensa solo corrobora la
# ventana de analítica si cae dentro de ella; fuera crea un episodio
# de prensa paralelo que duplicaría el mismo cierre real. Estos items
# se guardan con event_type=None: aparecen en la caja "En la prensa"
# como contexto pero no generan episodios:
# - El País 2-oct-2025 (reportaje retrospectivo posterior a la
#   reapertura): fuera de la ventana jul-24→jun-25 en los 3 PMs
# - Todo lo anterior a ene-2025 para PM5: su ventana de analítica no
#   empieza hasta el 20-ene-2025 (sin muestras anteriores), así que
#   esos items no tienen ventana que corroborar ahí
_OTHER = {
    (
        "https://elpais.com/clima-y-medio-ambiente/2025-10-02/aguas-fecales-y-turismo-tenerife-el-paraiso-contaminado.html",
        41,
    ),
    (
        "https://elpais.com/clima-y-medio-ambiente/2025-10-02/aguas-fecales-y-turismo-tenerife-el-paraiso-contaminado.html",
        42,
    ),
    (
        "https://elpais.com/clima-y-medio-ambiente/2025-10-02/aguas-fecales-y-turismo-tenerife-el-paraiso-contaminado.html",
        43,
    ),
    (
        "https://www.eldiario.es/canariasahora/tenerifeahora/norte/cerrada-indefinidamente-playa-jardin-puerto-cruz-contaminacion-aguas-fecales_1_11499039.html",
        43,
    ),
    ("https://rtvc.es/cerrada-playa-jardin-por-contaminacion-con-aguas-residuales/", 43),
    (
        "https://www.eldia.es/tenerife/2024/07/23/puerto-cruz-recaba-informes-resolver-105986504.html",
        43,
    ),
    (
        "https://www.eldiario.es/canariasahora/tenerifeahora/norte/playa-jardin-puerto-cruz-cumple-mes-cerrada-contaminacion-fecal_1_11558052.html",
        43,
    ),
    (
        "https://www.eldia.es/tenerife/2025/01/01/peor-desastre-medioambiental-tenerife-playa-113054303.html",
        43,
    ),
    (
        "https://www.atlanticohoy.com/tenerife/puerto-de-la-cruz-cuatro-lineas-accion-playa-jardin_1540997_102.html",
        43,
    ),
}


def _show_events(db, beach_ids):
    for bid in sorted(set(beach_ids)):
        b = db.get(Beach, bid)
        if not b:
            continue
        for ev in synthesize_events(b):
            print(
                f"  {b.name[:38]:38} {ev.via:11} {ev.opened_at} -> "
                f"{ev.closed_at} press={ev.press_count} "
                f"{'fin_prensa' if ev.end_from_press else ''}"
                f"{'fin_aprox' if ev.end_estimated else ''}"
            )


def main():
    dry = "--dry-run" in sys.argv
    db = SessionLocal()
    inserted = skipped = 0
    touched = set()
    for url, title, source, pub, etype, cause, since, beach_ids in ITEMS:
        published = datetime.fromisoformat(pub).replace(tzinfo=timezone.utc)
        for bid in beach_ids:
            touched.add(bid)
            if (url, bid) in _OTHER:
                etype, cause, since = None, None, None
            exists = (
                db.query(NewsItem)
                .filter(NewsItem.url == url, NewsItem.beach_id == bid)
                .first()
            )
            if exists:
                # La curación manual manda sobre lo que el pipeline
                # decidiera antes (p.ej. relevant=False por un match
                # antiguo): corregimos los campos y el flag
                if not dry and (
                    not exists.relevant
                    or exists.event_type != etype
                    or exists.cause != cause
                    or exists.closed_since != since
                ):
                    exists.relevant = True
                    exists.event_type = etype
                    exists.cause = cause
                    exists.closed_since = since
                    inserted += 1
                else:
                    skipped += 1
                continue
            if dry:
                inserted += 1
                continue
            db.add(
                NewsItem(
                    url=url,
                    title=title,
                    source=source,
                    published_at=published,
                    relevant=True,
                    beach_id=bid,
                    event_type=etype,
                    cause=cause,
                    closed_since=since,
                    confidence=1.0,
                    push_pending=False,
                )
            )
            inserted += 1
    if not dry:
        db.commit()
    print(f"{'[DRY] ' if dry else ''}insertadas={inserted} ya_existian={skipped}")
    print("\nEpisodios resultantes:")
    _show_events(db, touched)
    db.close()


if __name__ == "__main__":
    main()
