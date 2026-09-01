# -*- coding: utf-8 -*-
"""
Boletín de progreso por alumno (calificaciones + asistencia), formato Kodland.

Muestra, para un CORTE dado (por módulo, fin de curso o "al día de hoy"):
  - Tareas enviadas (de las disponibles hasta el corte)
  - Puntos obtenidos, máximo posible y cuántos faltan
  - Asistencia a clases (sesiones asistidas / total)
  - Detalle por módulo y lista de asistencias

Los datos (notas, tareas, asistencia) saldrán de la API de Kodland; aquí, en
modo --demo, se usan datos de ejemplo solo para validar el diseño.

Uso:
  python generar_boletin.py --demo
"""

import argparse
import html as _html
import json
import os

DIR = os.path.dirname(os.path.abspath(__file__))


def esc(s):
    return _html.escape(str(s if s is not None else ""))


def pct(n, d):
    return round(100 * n / d) if d else 0


def banda(p):
    if p >= 70:
        return "otimo"
    if p >= 50:
        return "bom"
    return "dev"


ESTILOS = """
:root{
  --lima:#c8ea4f; --lima-osc:#b6db3f; --oscuro:#1b1b1b; --texto:#2b2b2b;
  --otimo:#a8d84a; --bom:#efb03e; --dev:#ef7373;
  --card:#f5f7ee; --borde:#e4e8d8; --gris:#8a9078;
}
*{box-sizing:border-box; margin:0; padding:0;}
@page{size:A4;}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif; color:var(--texto); font-size:12px;}
.pagina{background:#fff;}
.mut{color:var(--gris); font-size:9px; letter-spacing:.10em; font-weight:700; text-transform:uppercase;}
/* Evitar que las secciones se partan entre páginas */
.fila,.stats,.stat,.tarj,.medidor,.chart,.ses,tr,.mod{break-inside:avoid; page-break-inside:avoid;}
.seccion{break-after:avoid; page-break-after:avoid;}
.pie{break-inside:avoid; page-break-inside:avoid;}

.cab{background:var(--lima); border-radius:16px; padding:18px 22px; display:flex;
  justify-content:space-between; align-items:center;}
.cab .logo{font-size:30px; font-weight:800; color:var(--oscuro); letter-spacing:-.5px;}
.cab .tit{text-align:right; color:var(--oscuro);}
.cab .tit h1{font-size:19px; line-height:1.1;}
.cab .tit p{font-size:10px; font-weight:700; margin-top:3px;}

.corte{display:inline-block; background:var(--oscuro); color:var(--lima); font-weight:800;
  font-size:11px; padding:6px 14px; border-radius:20px; margin-top:12px;}

.fila{display:flex; gap:12px; margin-top:12px;}
.tarj{flex:1; border:1px solid var(--borde); border-radius:12px; padding:12px 14px; background:#fff;}
.tarj.oscuro{background:var(--oscuro); border-color:var(--oscuro);}
.tarj.oscuro .mut{color:var(--lima);}
.tarj.oscuro .val{color:#fff;}
.tarj .val{font-size:15px; font-weight:800; margin-top:4px;}

.stats{display:flex; gap:12px; margin-top:12px;}
.stat{flex:1; border:1px solid var(--borde); border-radius:12px; padding:14px 10px;
  text-align:center; background:var(--card);}
.stat.oscuro{background:var(--oscuro);}
.stat .num{font-size:26px; font-weight:800; color:var(--oscuro);}
.stat.oscuro .num{color:var(--lima);}
.stat .num small{font-size:14px; color:var(--gris); font-weight:700;}
.stat.oscuro .num small{color:#cfe08a;}
.stat .lbl{font-size:8.5px; letter-spacing:.05em; font-weight:700; text-transform:uppercase;
  color:var(--gris); margin-top:3px;}
.stat.oscuro .lbl{color:#c8ea4f;}

.seccion{display:flex; align-items:center; gap:10px; margin:20px 0 10px;}
.seccion .cuad{width:20px; height:20px; background:var(--lima); border-radius:5px;}
.seccion h2{font-size:15px; color:var(--oscuro);}

.medidor{margin:10px 0;}
.medidor .top{display:flex; justify-content:space-between; font-size:11px; margin-bottom:5px;}
.medidor .top b{color:var(--oscuro);}
.barra{height:12px; border-radius:6px; background:#eee; overflow:hidden;}
.barra i{display:block; height:100%; border-radius:6px;}
.barra i.otimo{background:var(--otimo);} .barra i.bom{background:var(--bom);} .barra i.dev{background:var(--dev);}

table{width:100%; border-collapse:collapse; margin-top:6px; font-size:11px;}
th{background:var(--card); color:var(--gris); text-transform:uppercase; font-size:8.5px;
  letter-spacing:.05em; text-align:left; padding:8px 10px; border-bottom:2px solid var(--borde);}
td{padding:9px 10px; border-bottom:1px solid #eef0e6;}
td.n, th.n{text-align:center;}
td.badge{width:30px;}
.bnum{width:26px; height:26px; background:var(--oscuro); color:#fff; border-radius:7px;
  display:inline-flex; align-items:center; justify-content:center; font-weight:800; font-size:12px;}
tr.total td{font-weight:800; background:#fbfdf5; border-top:2px solid var(--borde); border-bottom:none;}
.mini{display:inline-block; height:7px; width:70px; border-radius:4px; background:#eee; overflow:hidden; vertical-align:middle; margin-right:6px;}
.mini i{display:block; height:100%;}
.mini i.otimo{background:var(--otimo);} .mini i.bom{background:var(--bom);} .mini i.dev{background:var(--dev);}

.asis{display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;}
.ses{width:calc(20% - 7px); border:1px solid var(--borde); border-radius:9px; padding:8px 6px;
  text-align:center;}
.ses .f{font-size:9px; color:var(--gris); font-weight:700;}
.ses .e{font-size:10px; font-weight:800; margin-top:3px;}
.ses.pres{background:#eef7d8;} .ses.pres .e{color:#5e7a1a;}
.ses.aus{background:#fbe0e0;} .ses.aus .e{color:#a23434;}
.ses.just{background:#fbecc9;} .ses.just .e{color:#8a5e10;}

.nota{font-size:9.5px; color:var(--gris); margin-top:8px; line-height:1.5;}
.pie{margin-top:24px;}
.pie .barra2{background:var(--oscuro); border-radius:12px; padding:11px 18px; display:flex;
  justify-content:space-between; align-items:center; color:#fff;}
.pie .barra2 .l{color:var(--lima); font-weight:800; font-size:15px;}
.pie .barra2 .c{font-size:10px; letter-spacing:.12em; color:#cfcfcf;}
.pie-num{text-align:center; font-size:8.5px; color:#b8b8b8; margin-top:10px;}
"""


def build_html(d):
    mods = d["modulos"]
    t_env = sum(m["tareas_enviadas"] for m in mods)
    t_tot = sum(m["tareas_total"] for m in mods)
    p_obt = sum(m["puntos"] for m in mods)
    p_max = sum(m["puntos_max"] for m in mods)
    p_falt = p_max - p_obt
    asi = d["asistencia"]
    a_si, a_tot = asi["asistidas"], asi["total"]

    p_tareas = pct(t_env, t_tot)
    p_punt = pct(p_obt, p_max)
    p_asis = pct(a_si, a_tot)

    filas = ""
    for m in mods:
        pm = pct(m["puntos"], m["puntos_max"])
        cls = banda(pm)
        filas += f"""<tr>
      <td class="badge"><span class="bnum">{m['numero']:02d}</span></td>
      <td>{esc(m['titulo'])}</td>
      <td class="n">{m['tareas_enviadas']}/{m['tareas_total']}</td>
      <td class="n">{m['puntos']}/{m['puntos_max']}</td>
      <td><span class="mini"><i class="{cls}" style="width:{pm}%"></i></span>{pm}%</td>
    </tr>"""
    filas += f"""<tr class="total">
      <td></td><td>TOTAL</td>
      <td class="n">{t_env}/{t_tot}</td>
      <td class="n">{p_obt}/{p_max}</td>
      <td>{p_punt}%</td>
    </tr>"""

    ses_html = ""
    et = {"presente": ("pres", "Presente"), "ausente": ("aus", "Ausente"),
          "justificada": ("just", "Justif.")}
    for s in asi["sesiones"]:
        cls, txt = et.get(s["estado"], ("aus", s["estado"]))
        ses_html += f'<div class="ses {cls}"><div class="f">{esc(s["fecha"])}</div><div class="e">{txt}</div></div>'

    def medidor(lbl, obt, tot, unidad=""):
        p = pct(obt, tot)
        return f"""<div class="medidor">
      <div class="top"><span>{lbl}</span><b>{obt}/{tot}{unidad} · {p}%</b></div>
      <div class="barra"><i class="{banda(p)}" style="width:{p}%"></i></div>
    </div>"""

    return f"""<!doctype html><html><head><meta charset='utf-8'><style>{ESTILOS}</style></head><body>
<div class="pagina">
  <div class="cab">
    <div class="logo">kodland</div>
    <div class="tit"><h1>BOLETÍN DE PROGRESO</h1><p>Calificaciones y asistencia</p></div>
  </div>
  <div class="corte">◷ Corte: {esc(d['corte'])}</div>

  <div class="fila">
    <div class="tarj oscuro"><div class="mut">Alumno</div><div class="val">{esc(d['alumno'])}</div></div>
    <div class="tarj"><div class="mut">Curso</div><div class="val">{esc(d['curso'])}</div></div>
    <div class="tarj"><div class="mut">Profesor(a)</div><div class="val">{esc(d['profesor'])}</div></div>
  </div>

  <div class="stats">
    <div class="stat"><div class="num">{t_env}<small>/{t_tot}</small></div><div class="lbl">Tareas enviadas</div></div>
    <div class="stat oscuro"><div class="num">{p_obt}<small>/{p_max}</small></div><div class="lbl">Puntos obtenidos</div></div>
    <div class="stat"><div class="num">{p_falt}</div><div class="lbl">Puntos por obtener</div></div>
    <div class="stat"><div class="num">{a_si}<small>/{a_tot}</small></div><div class="lbl">Asistencias ({p_asis}%)</div></div>
  </div>

  <div class="seccion"><div class="cuad"></div><h2>Resumen</h2></div>
  {medidor("Tareas enviadas", t_env, t_tot)}
  {medidor("Puntaje", p_obt, p_max, " pts")}
  {medidor("Asistencia", a_si, a_tot, " clases")}

  <div class="seccion"><div class="cuad"></div><h2>Detalle por módulo</h2></div>
  <table>
    <tr><th class="badge"></th><th>Módulo</th><th class="n">Tareas</th><th class="n">Puntos</th><th>Avance</th></tr>
    {filas}
  </table>

  <div class="seccion"><div class="cuad"></div><h2>Asistencia a clases</h2></div>
  <div class="asis">{ses_html}</div>
  <div class="nota">Puntos = suma de las notas de cada tarea (obtenido / máximo de la tarea). «Puntos por obtener» =
    lo que falta para el máximo hasta este corte. La asistencia se toma del registro de clases del grupo.</div>

  <div class="pie">
    <div class="barra2"><span class="l">kodland</span><span class="c">EDUCAR · INSPIRAR · TRANSFORMAR</span><span style="color:#fff;font-weight:700;font-size:11px">kodland.com.br</span></div>
  </div>
  <div class="pie-num">Kodland · Boletín de progreso</div>
</div>
</body></html>"""


def render_pdf(html, salida):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        nav = None
        for canal in ("chrome", "msedge", None):
            try:
                nav = pw.chromium.launch(channel=canal, headless=True) if canal else pw.chromium.launch(headless=True)
                break
            except Exception:
                nav = None
        if nav is None:
            raise RuntimeError("No pude abrir Chrome/Edge/Chromium para el PDF.")
        page = nav.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=salida, format="A4", print_background=True,
                 margin={"top": "12mm", "bottom": "14mm", "left": "12mm", "right": "12mm"})
        nav.close()


# asistencia: entero de la API → estado del boletín (confirmado con el usuario)
ATT_MAP = {2: "presente", 1: "justificada", 0: "ausente"}


def datos_desde_api(resp, corte="actual", alumno="", profesor="", curso=""):
    """Convierte las respuestas de la API de Kodland en la estructura del boletín.

    resp: dict con las claves get_progress_for_class_modules,
    get_progress_for_homework_modules, homeworks, attendances.
    corte: "actual" (lecciones ya dadas), "curso" (todas) o un nº de módulo.
    """
    clase = resp.get("get_progress_for_class_modules") or []
    deber = resp.get("get_progress_for_homework_modules") or []
    homew = resp.get("homeworks") or []
    att = resp.get("attendances") or []

    att_by_lid = {a.get("lesson_id"): a for a in att}
    hw_by_ml = {(h.get("module"), h.get("number")): h for h in homew}
    hwg_by_lid = {}
    for m in deber:
        for l in m.get("lessons_data", []):
            hwg_by_lid[l.get("lesson_id")] = l

    def dada(lid):
        a = att_by_lid.get(lid)
        return bool(a) and a.get("timetable_status") == "Открыт"

    def en_alcance(mn, lid):
        if corte == "curso":
            return True
        if isinstance(corte, int):
            return mn == corte
        return dada(lid)  # "actual"

    modulos, ses = [], []
    for m in clase:
        mn = m.get("module_number")
        t_env = t_tot = pts = pmax = lecc = 0
        for l in m.get("lessons_data", []):
            lid = l.get("lesson_id")
            if not en_alcance(mn, lid):
                continue
            lecc += 1
            pts += (l.get("lesson_current_grade") or 0)
            pmax += (l.get("lesson_max_grade") or 0)
            hg = hwg_by_lid.get(lid, {})
            pts += (hg.get("lesson_current_grade") or 0)
            pmax += (hg.get("lesson_max_grade") or 0)
            hwc = hw_by_ml.get((mn, l.get("lesson_number")), {})
            t_env += (hwc.get("homework_task_done") or 0)
            t_tot += (hwc.get("homework_task_all") or 0)
            a = att_by_lid.get(lid, {})
            st = a.get("attendance_status")
            if a.get("timetable_status") == "Открыт" and st in ATT_MAP:
                ses.append({"fecha": f"M{mn} L{l.get('lesson_number')}",
                            "estado": ATT_MAP[st]})
        if lecc:
            modulos.append({"numero": mn, "titulo": f"Módulo {mn}",
                            "tareas_enviadas": t_env, "tareas_total": t_tot,
                            "puntos": pts, "puntos_max": pmax})

    asis = {"asistidas": sum(1 for s in ses if s["estado"] == "presente"),
            "total": len(ses), "sesiones": ses}
    etq = {"actual": "Al día de hoy", "curso": "Fin de curso"}.get(corte, f"Módulo {corte}")
    return {"alumno": alumno or "Alumno", "curso": curso or "Curso",
            "profesor": profesor or "", "corte": etq,
            "modulos": modulos, "asistencia": asis}


def _cargar_captura(ruta):
    """Lee un JSON de descubrimiento (consultas_directas) para pruebas reales."""
    d = json.load(open(ruta, encoding="utf-8"))
    cd = d.get("consultas_directas", {})
    resp = {k: v.get("cuerpo") for k, v in cd.items()}
    return resp, d.get("alumno_detectado"), d.get("grupo_detectado")


def _contable(t):
    """La tarea cuenta si tiene puntos posibles (excluye 'no se evalúa')."""
    return (t.get("task_max_grade") or 0) > 0 and t.get("task_status_key") != "TASK_NOT_GRADED"


def _enviada(t):
    """Enviada = el alumno la entregó (revisada o pendiente), no 'no enviada'."""
    return t.get("task_status_key") not in (None, "TASK_NOT_SUBMITTED")


def contar_tareas(*listas):
    """Cuenta (enviadas, total) sobre listas de tareas (clase y/o deberes)."""
    env = tot = 0
    for lst in listas:
        for t in (lst or []):
            if _contable(t):
                tot += 1
                if _enviada(t):
                    env += 1
    return env, tot


def datos_desde_smd(main, progress, tareas_by_lid, corte="actual", curso="", profesor=""):
    """Arma el boletín desde get_students_main_data (main_info + progress_info)
    y un dict {lesson_id: (enviadas, total)} de conteo de tareas.

    corte: 'actual' (hasta la última lección dada = last_lesson_id), 'curso'
    (todas) o un nº de módulo.
    """
    nombre = main.get("full_name") or "Alumno"
    last = main.get("last_lesson_id")
    orden = [l.get("lesson_id") for m in progress for l in m.get("lessons_data", [])]
    corte_idx = orden.index(last) if last in orden else (len(orden) - 1 if orden else -1)

    def en_scope(mn, lid):
        if corte == "curso":
            return True
        if isinstance(corte, int):
            return mn == corte
        return lid in orden and orden.index(lid) <= corte_idx  # "actual"

    modulos, ses = [], []
    for m in progress:
        mn = m.get("module_number")
        pts = pmax = t_env = t_tot = lecc = 0
        for l in m.get("lessons_data", []):
            lid = l.get("lesson_id")
            if not en_scope(mn, lid):
                continue
            lecc += 1
            pts += (l.get("lesson_current_grade") or 0)
            pmax += (l.get("lesson_max_grade") or 0)
            e, tt = tareas_by_lid.get(lid, (0, 0))
            t_env += e
            t_tot += tt
            st = l.get("attendance_status")
            if st in ATT_MAP:
                ses.append({"fecha": f"M{mn} L{l.get('lesson_number')}",
                            "estado": ATT_MAP[st]})
        if lecc:
            modulos.append({"numero": mn, "titulo": f"Módulo {mn}",
                            "tareas_enviadas": t_env, "tareas_total": t_tot,
                            "puntos": pts, "puntos_max": pmax})

    asis = {"asistidas": sum(1 for s in ses if s["estado"] == "presente"),
            "total": len(ses), "sesiones": ses}
    etq = {"actual": "Al día de hoy", "curso": "Fin de curso"}.get(corte, f"Módulo {corte}")
    return {"alumno": nombre, "curso": curso or "Curso", "profesor": profesor,
            "corte": etq, "modulos": modulos, "asistencia": asis}


DEMO = {
    "alumno": "Ana Sofía Ejemplo",
    "curso": "Python 1",
    "profesor": "Prof. Jaime Narváez",
    "corte": "Al día de hoy — Módulo 4, Lección 2",
    "modulos": [
        {"numero": 1, "titulo": "Primeros pasos con Python", "tareas_enviadas": 6, "tareas_total": 6, "puntos": 80, "puntos_max": 84},
        {"numero": 2, "titulo": "Variables y operaciones", "tareas_enviadas": 5, "tareas_total": 6, "puntos": 58, "puntos_max": 84},
        {"numero": 3, "titulo": "Condicionales", "tareas_enviadas": 6, "tareas_total": 6, "puntos": 76, "puntos_max": 84},
        {"numero": 4, "titulo": "Bucles (en curso)", "tareas_enviadas": 2, "tareas_total": 3, "puntos": 22, "puntos_max": 42},
    ],
    "asistencia": {
        "asistidas": 9, "total": 11,
        "sesiones": [
            {"fecha": "03 jun", "estado": "presente"}, {"fecha": "10 jun", "estado": "presente"},
            {"fecha": "17 jun", "estado": "ausente"}, {"fecha": "24 jun", "estado": "presente"},
            {"fecha": "01 jul", "estado": "presente"}, {"fecha": "08 jul", "estado": "justificada"},
            {"fecha": "15 jul", "estado": "presente"}, {"fecha": "22 jul", "estado": "presente"},
            {"fecha": "29 jul", "estado": "presente"}, {"fecha": "05 ago", "estado": "presente"},
            {"fecha": "12 ago", "estado": "presente"},
        ],
    },
}


def main():
    ap = argparse.ArgumentParser(description="Boletín de progreso por alumno")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--desde-captura", default="", help="ruta a un JSON de descubrimiento (datos reales)")
    ap.add_argument("--corte", default="actual", help="'actual', 'curso' o nº de módulo")
    ap.add_argument("--alumno", default="")
    ap.add_argument("--curso", default="")
    ap.add_argument("--profesor", default="")
    ap.add_argument("--salida", default=os.path.join(DIR, "reportes", "salida"))
    args = ap.parse_args()

    if args.desde_captura:
        resp, sid, gid = _cargar_captura(args.desde_captura)
        corte = int(args.corte) if args.corte.isdigit() else args.corte
        datos = datos_desde_api(resp, corte,
                                alumno=args.alumno or f"Alumno {sid}",
                                profesor=args.profesor,
                                curso=args.curso or f"Grupo {gid}")
    else:
        datos = DEMO  # en real: se arma desde la API de Kodland
    os.makedirs(args.salida, exist_ok=True)
    base = "Boletin " + "".join(c for c in datos["alumno"] if c.isalnum() or c in " _-").strip()
    html = build_html(datos)
    ruta_html = os.path.join(args.salida, base + ".html")
    ruta_pdf = os.path.join(args.salida, base + ".pdf")
    with open(ruta_html, "w", encoding="utf-8") as fh:
        fh.write(html)
    render_pdf(html, ruta_pdf)
    print("Boletín generado:\n  " + ruta_pdf)


if __name__ == "__main__":
    main()
