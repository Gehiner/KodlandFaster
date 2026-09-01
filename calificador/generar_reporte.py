# -*- coding: utf-8 -*-
"""
Generador de "Reporte de Desarrollo" por alumno, con el formato de Kodland.

Toma:
  - una plantilla de curso (reportes/curso_*.json): módulos, aprendizajes,
    proyectos y textos (ver curso.example.json).
  - los datos del alumno: nombre, profesor(a) y el % de aprovechamiento por módulo.

Produce un HTML con el diseño de Kodland y lo convierte a PDF con Playwright
(sin instalar nada extra).

Uso:
  python generar_reporte.py --demo               # muestra de ejemplo (Roblox)
  python generar_reporte.py --curso reportes/curso_python1.json \
      --alumno "Nombre" --profesor "Prof." --pct 65,45,85,100
"""

import argparse
import html as _html
import json
import os
import sys

DIR = os.path.dirname(os.path.abspath(__file__))

# --- textos fijos de la interfaz, por idioma ---
UI = {
    "pt": {
        "titulo": "RELATÓRIO DE DESENVOLVIMENTO",
        "lema": "Transformando alunos em criadores do futuro",
        "aluno": "ALUNO", "curso": "CURSO", "profesor": "PROFESSOR(A)",
        "area": "ÁREA DE INTERESSE", "proximo": "PRÓXIMO NÍVEL RECOMENDADO",
        "aprov": "APROVEITAMENTO MÉDIO", "proyectos": "PROJETOS CONCLUÍDOS",
        "mejor": "MELHOR MÓDULO", "modulos": "MÓDULOS CURSADOS",
        "vision": "VISÃO GERAL DO DESEMPENHO", "media": "Média",
        "bandas": ("Ótimo (≥70%)", "Bom (50–69%)", "Em desenvolvimento (<50%)"),
        "detalle": "DETALHAMENTO POR MÓDULO", "modulo": "MÓDULO",
        "aprendizajes": "PRINCIPAIS APRENDIZADOS", "proyecto": "PROJETO DESENVOLVIDO",
        "consideraciones": "CONSIDERAÇÕES FINAIS",
        "paso": "PRÓXIMO PASSO RECOMENDADO",
        "pie_profesor": "PROFESSOR(A) · EQUIPE KODLAND",
        "pie_lema": "EDUCAR · INSPIRAR · TRANSFORMAR",
        "pagina": "Página", "de": "de",
        "et_otimo": "ÓTIMO", "et_bom": "BOM", "et_dev": "EM DESENVOLVIMENTO",
        "calif": "NOTAS E PRESENÇA", "tareas": "TAREFAS ENVIADAS", "asist": "PRESENÇA",
        "th_modulo": "Módulo", "th_tareas": "Tarefas", "th_puntos": "Pontos", "th_avance": "Progresso",
        "asis_titulo": "PRESENÇA NAS AULAS", "est_pres": "Presente", "est_aus": "Ausente",
        "est_just": "Justif.", "msg": "MENSAGEM PARA VOCÊ",
    },
    "es": {
        "titulo": "REPORTE DE DESARROLLO",
        "lema": "Transformando alumnos en creadores del futuro",
        "aluno": "ALUMNO", "curso": "CURSO", "profesor": "PROFESOR(A)",
        "area": "ÁREA DE INTERÉS", "proximo": "PRÓXIMO NIVEL RECOMENDADO",
        "aprov": "APROVECHAMIENTO PROMEDIO", "proyectos": "PROYECTOS COMPLETADOS",
        "mejor": "MEJOR MÓDULO", "modulos": "MÓDULOS CURSADOS",
        "vision": "VISIÓN GENERAL DEL DESEMPEÑO", "media": "Promedio",
        "bandas": ("Óptimo (≥70%)", "Bueno (50–69%)", "En desarrollo (<50%)"),
        "detalle": "DETALLE POR MÓDULO", "modulo": "MÓDULO",
        "aprendizajes": "PRINCIPALES APRENDIZAJES", "proyecto": "PROYECTO DESARROLLADO",
        "consideraciones": "CONSIDERACIONES FINALES",
        "paso": "PRÓXIMO PASO RECOMENDADO",
        "pie_profesor": "PROFESOR(A) · EQUIPO KODLAND",
        "pie_lema": "EDUCAR · INSPIRAR · TRANSFORMAR",
        "pagina": "Página", "de": "de",
        "et_otimo": "ÓPTIMO", "et_bom": "BUENO", "et_dev": "EN DESARROLLO",
        "calif": "CALIFICACIONES Y ASISTENCIA", "tareas": "TAREAS ENVIADAS", "asist": "ASISTENCIA",
        "th_modulo": "Módulo", "th_tareas": "Tareas", "th_puntos": "Puntos", "th_avance": "Avance",
        "asis_titulo": "ASISTENCIA A CLASES", "est_pres": "Presente", "est_aus": "Ausente",
        "est_just": "Justif.", "msg": "MENSAJE PARA TI",
    },
}


def mensaje_desempeno(promedio, nombre, mods, pcts, ui):
    """Mensaje cálido de felicitación / oportunidad de mejora según el %."""
    n = len(pcts)
    mejor = mods[max(range(n), key=lambda i: pcts[i])]["titulo"] if n else ""
    peor_i = min(range(n), key=lambda i: pcts[i]) if n else 0
    peor = mods[peor_i]["titulo"] if n else ""
    peor_pct = pcts[peor_i] if n else 0
    if promedio >= 85:
        base = (f"¡Felicitaciones, {nombre}! Tu desempeño es excelente: demuestras dominio "
                f"y constancia a lo largo del curso. Destacas especialmente en «{mejor}». "
                f"¡Sigue así, vas por un camino sobresaliente!")
    elif promedio >= 70:
        base = (f"¡Muy bien, {nombre}! Tienes un desempeño sólido y parejo. Tu mejor módulo "
                f"fue «{mejor}». Con un poco más de práctica en los temas que se te resistieron, "
                f"llegarás al nivel más alto.")
    elif promedio >= 50:
        base = (f"¡Buen trabajo, {nombre}! Vas construyendo una base firme. Brillaste en "
                f"«{mejor}». Hay una buena oportunidad de mejorar reforzando «{peor}» "
                f"({peor_pct}%); ¡con dedicación lo vas a lograr!")
    else:
        base = (f"{nombre}, estás dando tus primeros pasos y cada avance cuenta. Tu punto más "
                f"fuerte fue «{mejor}». Te animamos a reforzar los módulos con menor avance, "
                f"sobre todo «{peor}» ({peor_pct}%). ¡Con práctica y apoyo vas a progresar mucho!")
    if ui.get("titulo", "").startswith("RELAT"):  # portugués
        base = base.replace("¡", "").replace("Felicitaciones", "Parabéns")
    return base


def banda(pct, ui):
    """Devuelve (etiqueta, clase_css) según el aprovechamiento."""
    if pct >= 70:
        return ui["et_otimo"], "otimo"
    if pct >= 50:
        return ui["et_bom"], "bom"
    return ui["et_dev"], "dev"


def esc(s):
    return _html.escape(str(s if s is not None else ""))


def sustituir(texto, alumno):
    return (texto or "").replace("{alumno}", alumno)


ESTILOS = """
:root{
  --lima:#c8ea4f; --lima-osc:#b6db3f; --oscuro:#1b1b1b; --texto:#2b2b2b;
  --otimo:#a8d84a; --bom:#efb03e; --dev:#ef7373;
  --card:#f5f7ee; --card2:#f0f3e6; --borde:#e4e8d8;
}
*{box-sizing:border-box; margin:0; padding:0;}
body{font-family:"Segoe UI",Arial,Helvetica,sans-serif; color:var(--texto); font-size:12px;}
.pagina{width:210mm; min-height:297mm; padding:14mm 13mm 16mm; position:relative;
  page-break-after:always; background:#fff;}
.pagina:last-child{page-break-after:auto;}
h1,h2,h3{font-weight:800;}
.mut{color:#8a9078; font-size:9px; letter-spacing:.10em; font-weight:700; text-transform:uppercase;}

/* encabezado */
.cab{background:var(--lima); border-radius:16px; padding:18px 22px; display:flex;
  justify-content:space-between; align-items:center;}
.cab .logo{font-size:30px; font-weight:800; color:var(--oscuro); letter-spacing:-.5px;}
.cab .tit{text-align:right; color:var(--oscuro);}
.cab .tit h1{font-size:20px; line-height:1.1;}
.cab .tit p{font-size:10px; font-weight:700; margin-top:3px;}

.fila{display:flex; gap:12px; margin-top:12px;}
.tarj{flex:1; border:1px solid var(--borde); border-radius:12px; padding:12px 14px; background:#fff;}
.tarj.oscuro{background:var(--oscuro); border-color:var(--oscuro);}
.tarj.oscuro .mut{color:#c8ea4f;}
.tarj.oscuro .val{color:#fff;}
.tarj .val{font-size:15px; font-weight:800; margin-top:4px;}

.stats{display:flex; gap:12px; margin-top:12px;}
.stat{flex:1; border:1px solid var(--borde); border-radius:12px; padding:14px 8px;
  text-align:center; background:var(--card);}
.stat.oscuro{background:var(--oscuro);}
.stat .num{font-size:30px; font-weight:800; color:var(--oscuro);}
.stat.oscuro .num{color:var(--lima);}
.stat .num small{font-size:15px;}
.stat .lbl{font-size:8.5px; letter-spacing:.06em; font-weight:700; text-transform:uppercase;
  color:#8a9078; margin-top:2px;}
.stat.oscuro .lbl{color:#c8ea4f;}

.seccion{display:flex; align-items:center; gap:10px; margin:20px 0 10px;}
.seccion .cuad{width:20px; height:20px; background:var(--lima); border-radius:5px;}
.seccion h2{font-size:15px; color:var(--oscuro); letter-spacing:.02em;}

.intro{background:var(--card); border-left:5px solid var(--lima); border-radius:0 10px 10px 0;
  padding:12px 16px; font-size:11.5px; line-height:1.55;}
.intro b{color:var(--oscuro);}

/* gráfico */
.chart{margin-top:16px; border:1px solid var(--borde); border-radius:12px; padding:16px 14px 8px;}
.barras{display:flex; align-items:flex-end; gap:10px; height:210px; position:relative;
  border-bottom:1px solid #ddd;}
.col{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;}
.col .pct{font-size:11px; font-weight:800; margin-bottom:4px; color:var(--oscuro);}
.col .barra{width:70%; border-radius:6px 6px 0 0;}
.col.otimo .barra{background:var(--otimo);}
.col.bom .barra{background:var(--bom);}
.col.dev .barra{background:var(--dev);}
.ejes{display:flex; gap:10px; margin-top:6px;}
.ejes .e{flex:1; text-align:center; font-size:10px; font-weight:700; color:#6a6a6a;}
.media-linea{position:absolute; left:0; right:0; border-top:2px dashed #b9b9b9;}
.media-lbl{position:absolute; right:2px; font-size:10px; font-weight:800; color:#555;
  background:#fff; padding:0 3px;}
.leyenda{display:flex; gap:18px; justify-content:center; margin-top:12px; font-size:10px; color:#555;}
.leyenda span{display:inline-flex; align-items:center; gap:6px;}
.punto{width:10px; height:10px; border-radius:50%; display:inline-block;}
.punto.otimo{background:var(--otimo);} .punto.bom{background:var(--bom);} .punto.dev{background:var(--dev);}

/* módulos */
.mod{border:1px solid var(--borde); border-radius:14px; padding:16px 18px; margin-bottom:14px;
  page-break-inside:avoid;}
.mod-cab{display:flex; align-items:center; gap:12px;}
.badge{width:34px; height:34px; background:var(--oscuro); color:#fff; border-radius:8px;
  display:flex; align-items:center; justify-content:center; font-weight:800; font-size:15px; flex:none;}
.mod-cab .t{flex:1;}
.mod-cab .t .n{font-size:9px; letter-spacing:.1em; color:#9aa08c; font-weight:700;}
.mod-cab .t h3{font-size:15px; color:var(--oscuro); margin-top:1px;}
.mod-cab .p{text-align:right;}
.mod-cab .p .g{font-size:24px; font-weight:800; color:var(--oscuro);}
.mod-cab .p .g small{font-size:13px;}
.pill{display:inline-block; font-size:9px; font-weight:800; padding:3px 9px; border-radius:20px;
  letter-spacing:.03em; margin-top:2px;}
.pill.otimo{background:#e7f6c8; color:#5e7a1a;}
.pill.bom{background:#fbecc9; color:#8a5e10;}
.pill.dev{background:#fbd7d7; color:#a23434;}
.progreso{height:7px; border-radius:5px; background:#eee; margin:12px 0 12px; overflow:hidden;}
.progreso i{display:block; height:100%; border-radius:5px;}
.progreso i.otimo{background:var(--otimo);} .progreso i.bom{background:var(--bom);} .progreso i.dev{background:var(--dev);}
.mod .desc{font-size:11px; margin-bottom:10px;}
.mod-cols{display:flex; gap:18px;}
.mod-cols .izq{flex:1.3;}
.mod-cols .der{flex:1;}
.sublbl{font-size:9px; letter-spacing:.08em; font-weight:700; color:#9aa08c; text-transform:uppercase; margin-bottom:6px;}
.apr{list-style:none;}
.apr li{font-size:10.5px; padding:3px 0 3px 16px; position:relative;}
.apr li:before{content:"▸"; position:absolute; left:0; color:var(--lima-osc); font-weight:800;}
.proy{background:var(--card); border:1px solid var(--borde); border-radius:10px; padding:14px;
  font-weight:800; color:#4d6a12; font-size:12px;}

/* cierre */
.comp{display:flex; flex-wrap:wrap; gap:10px; margin-top:12px;}
.comp .c{width:calc(50% - 5px); background:var(--card); border:1px solid var(--borde); border-radius:10px;
  padding:11px 14px; font-weight:700; font-size:11px; color:var(--oscuro);}
.comp .c b{color:var(--otimo); margin-right:6px;}
.paso{background:var(--oscuro); border-radius:14px; padding:18px 20px; margin-top:16px; color:#eee;}
.paso .k{font-size:9px; letter-spacing:.1em; color:var(--lima); font-weight:700;}
.paso h2{font-size:20px; color:var(--lima); margin:2px 0 8px;}
.paso p{font-size:11px; line-height:1.55;}
.pie{position:absolute; left:13mm; right:13mm; bottom:8mm;}
.pie .barra{background:var(--oscuro); border-radius:12px; padding:12px 18px; display:flex;
  justify-content:space-between; align-items:center; color:#fff;}
.pie .barra .l{color:var(--lima); font-weight:800; font-size:16px;}
.pie .barra .c{font-size:10px; letter-spacing:.15em; color:#cfcfcf;}
.pie-num{text-align:center; font-size:8.5px; color:#b8b8b8; position:absolute;
  left:0; right:0; bottom:4mm;}
.mensaje{background:var(--oscuro); color:#eee; border-radius:14px; padding:16px 20px; margin-top:14px;}
.mensaje .k{font-size:9px; letter-spacing:.1em; color:var(--lima); font-weight:700;}
.mensaje p{font-size:12px; line-height:1.6; margin-top:6px;}
table.calif{width:100%; border-collapse:collapse; margin-top:6px; font-size:11px;}
table.calif th{background:var(--card); color:#8a9078; text-transform:uppercase; font-size:8.5px;
  letter-spacing:.05em; text-align:left; padding:8px 10px; border-bottom:2px solid var(--borde);}
table.calif td{padding:9px 10px; border-bottom:1px solid #eef0e6;}
table.calif td.n, table.calif th.n{text-align:center;}
table.calif tr.total td{font-weight:800; background:#fbfdf5; border-top:2px solid var(--borde);}
.mini{display:inline-block; height:7px; width:56px; border-radius:4px; background:#eee;
  overflow:hidden; vertical-align:middle; margin-right:6px;}
.mini i{display:block; height:100%;}
.mini i.otimo{background:var(--otimo);} .mini i.bom{background:var(--bom);} .mini i.dev{background:var(--dev);}
.asis-grid{display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;}
.ses{width:calc(20% - 7px); border:1px solid var(--borde); border-radius:9px; padding:8px 6px; text-align:center;}
.ses .f{font-size:9px; color:#8a9078; font-weight:700;}
.ses .e{font-size:10px; font-weight:800; margin-top:3px;}
.ses.pres{background:#eef7d8;} .ses.pres .e{color:#5e7a1a;}
.ses.aus{background:#fbe0e0;} .ses.aus .e{color:#a23434;}
.ses.just{background:#fbecc9;} .ses.just .e{color:#8a5e10;}
"""


def build_html(curso, alumno):
    idioma = curso.get("idioma", "es")
    ui = UI.get(idioma, UI["es"])
    nombre = alumno["alumno"]
    pcts = alumno["pct"]
    mods = curso["modulos"]
    n = min(len(mods), len(pcts))
    mods = mods[:n]
    pcts = [max(0, min(100, int(round(p)))) for p in pcts[:n]]

    promedio = round(sum(pcts) / n) if n else 0
    mejor_i = max(range(n), key=lambda i: pcts[i]) if n else 0
    mejor_pct = pcts[mejor_i] if n else 0
    mejor_mod = mods[mejor_i]["numero"] if n else 0

    # datos cuantitativos opcionales (boletín integrado en el mismo documento)
    tareas = alumno.get("tareas")    # [(env,tot)] por módulo
    puntos = alumno.get("puntos")    # [(cur,max)] por módulo
    asis = alumno.get("asistencia")  # {asistidas,total,sesiones}
    combinado = bool(asis or tareas)
    t_env = sum(e for e, _ in tareas) if tareas else 0
    t_tot = sum(t for _, t in tareas) if tareas else 0
    a_si = asis["asistidas"] if asis else 0
    a_tot = asis["total"] if asis else 0

    if combinado:
        stats_html = (
            f'<div class="stat oscuro"><div class="num">{promedio}<small>%</small></div><div class="lbl">{ui["aprov"]}</div></div>'
            f'<div class="stat"><div class="num">{t_env}<small>/{t_tot}</small></div><div class="lbl">{ui["tareas"]}</div></div>'
            f'<div class="stat"><div class="num">{a_si}<small>/{a_tot}</small></div><div class="lbl">{ui["asist"]}</div></div>'
            f'<div class="stat"><div class="num">{mejor_pct}<small>%</small></div><div class="lbl">{ui["mejor"]} (M{mejor_mod})</div></div>')
    else:
        stats_html = (
            f'<div class="stat oscuro"><div class="num">{promedio}<small>%</small></div><div class="lbl">{ui["aprov"]}</div></div>'
            f'<div class="stat"><div class="num">{n}</div><div class="lbl">{ui["proyectos"]}</div></div>'
            f'<div class="stat"><div class="num">{mejor_pct}<small>%</small></div><div class="lbl">{ui["mejor"]} (M{mejor_mod})</div></div>'
            f'<div class="stat"><div class="num">{n}</div><div class="lbl">{ui["modulos"]}</div></div>')

    _msg = mensaje_desempeno(promedio, nombre, mods, pcts, ui) if n else ""
    mensaje_html = (f'<div class="mensaje"><div class="k">{ui["msg"]}</div><p>{esc(_msg)}</p></div>'
                    if _msg else "")

    # --- portada ---
    barras = ""
    max_alto = 175  # px para 100%
    for i, m in enumerate(mods):
        p = pcts[i]
        _lbl, cls = banda(p, ui)
        alto = int(max_alto * p / 100)
        barras += (f'<div class="col {cls}"><div class="pct">{p}%</div>'
                   f'<div class="barra" style="height:{alto}px"></div></div>')
    ejes = "".join(f'<div class="e">M{m["numero"]}</div>' for m in mods)
    media_top = int(210 - (175 * promedio / 100))  # posición de la línea de promedio

    portada = f"""
<div class="pagina">
  <div class="cab">
    <div class="logo">kodland</div>
    <div class="tit"><h1>{ui['titulo']}</h1><p>{ui['lema']}</p></div>
  </div>

  <div class="fila">
    <div class="tarj oscuro"><div class="mut">{ui['aluno']}</div><div class="val">{esc(nombre)}</div></div>
    <div class="tarj"><div class="mut">{ui['curso']}</div><div class="val">{esc(curso['curso'])}</div></div>
    <div class="tarj"><div class="mut">{ui['profesor']}</div><div class="val">{esc(alumno.get('profesor',''))}</div></div>
  </div>
  <div class="fila">
    <div class="tarj"><div class="mut">{ui['area']}</div><div class="val">{esc(curso.get('area_interes',''))}</div></div>
    <div class="tarj"><div class="mut">{ui['proximo']}</div><div class="val">{esc(curso.get('proximo_nivel',''))}</div></div>
  </div>

  <div class="stats">{stats_html}</div>

  <div class="seccion"><div class="cuad"></div><h2>{ui['vision']}</h2></div>
  <div class="intro">{esc(sustituir(curso.get('vision_general',''), nombre)).replace(esc(nombre), '<b>'+esc(nombre)+'</b>')}</div>

  <div class="chart">
    <div class="barras">
      {barras}
      <div class="media-linea" style="top:{media_top}px"></div>
      <div class="media-lbl" style="top:{media_top-14}px">{ui['media']} {promedio}%</div>
    </div>
    <div class="ejes">{ejes}</div>
    <div class="leyenda">
      <span><i class="punto otimo"></i>{ui['bandas'][0]}</span>
      <span><i class="punto bom"></i>{ui['bandas'][1]}</span>
      <span><i class="punto dev"></i>{ui['bandas'][2]}</span>
    </div>
  </div>
  {mensaje_html}
  <div class="pie-num">Kodland · {ui['titulo'].title()} · {ui['pagina']} 1</div>
</div>
"""

    # --- calificaciones y asistencia (si hay datos cuantitativos) ---
    calif_html = ""
    if combinado:
        filas = ""
        for i, m in enumerate(mods):
            p = pcts[i]
            _l, cls = banda(p, ui)
            te, tt = tareas[i] if tareas and i < len(tareas) else (0, 0)
            pc, px = puntos[i] if puntos and i < len(puntos) else (0, 0)
            filas += (f'<tr><td>M{m["numero"]} · {esc(m["titulo"])}</td>'
                      f'<td class="n">{te}/{tt}</td><td class="n">{pc}/{px}</td>'
                      f'<td><span class="mini"><i class="{cls}" style="width:{p}%"></i></span>{p}%</td></tr>')
        tot_pc = sum(pc for pc, _ in puntos) if puntos else 0
        tot_px = sum(px for _, px in puntos) if puntos else 0
        filas += (f'<tr class="total"><td>TOTAL</td><td class="n">{t_env}/{t_tot}</td>'
                  f'<td class="n">{tot_pc}/{tot_px}</td><td>{promedio}%</td></tr>')
        et = {"presente": ("pres", ui["est_pres"]), "ausente": ("aus", ui["est_aus"]),
              "justificada": ("just", ui["est_just"])}
        ses_html = ""
        for s in (asis["sesiones"] if asis else []):
            c, txt = et.get(s["estado"], ("aus", s["estado"]))
            ses_html += f'<div class="ses {c}"><div class="f">{esc(s["fecha"])}</div><div class="e">{txt}</div></div>'
        asis_bloque = (f'<div class="seccion"><div class="cuad"></div><h2>{ui["asis_titulo"]}</h2></div>'
                       f'<div class="asis-grid">{ses_html}</div>') if asis else ""
        calif_html = f"""
<div class="pagina">
  <div class="seccion"><div class="cuad"></div><h2>{ui['calif']}</h2></div>
  <table class="calif">
    <tr><th>{ui['th_modulo']}</th><th class="n">{ui['th_tareas']}</th><th class="n">{ui['th_puntos']}</th><th>{ui['th_avance']}</th></tr>
    {filas}
  </table>
  {asis_bloque}
  <div class="pie-num">Kodland · {ui['pagina']}</div>
</div>
"""

    # --- detalle por módulo (varias páginas: ~3 módulos por página) ---
    paginas_mod = ""
    por_pagina = 3
    primera = True
    for inicio in range(0, n, por_pagina):
        grupo = list(range(inicio, min(inicio + por_pagina, n)))
        cuerpo = ""
        if primera:
            cuerpo += f'<div class="seccion"><div class="cuad"></div><h2>{ui["detalle"]}</h2></div>'
            primera = False
        for i in grupo:
            m = mods[i]
            p = pcts[i]
            lbl, cls = banda(p, ui)
            aprs = "".join(f"<li>{esc(a)}</li>" for a in m.get("aprendizajes", []))
            desc = esc(sustituir(m.get("descripcion", ""), nombre))
            cuerpo += f"""
  <div class="mod">
    <div class="mod-cab">
      <div class="badge">{m['numero']:02d}</div>
      <div class="t"><div class="n">{ui['modulo']} {m['numero']}</div><h3>{esc(m['titulo'])}</h3></div>
      <div class="p"><div class="g">{p}<small>%</small></div><span class="pill {cls}">{lbl}</span></div>
    </div>
    <div class="progreso"><i class="{cls}" style="width:{p}%"></i></div>
    <div class="desc">{desc}</div>
    <div class="mod-cols">
      <div class="izq"><div class="sublbl">{ui['aprendizajes']}</div><ul class="apr">{aprs}</ul></div>
      <div class="der"><div class="sublbl">{ui['proyecto']}</div><div class="proy">{esc(m.get('proyecto',''))}</div></div>
    </div>
  </div>"""
        paginas_mod += f'<div class="pagina">{cuerpo}<div class="pie-num">Kodland · {ui["pagina"]}</div></div>'

    # --- cierre ---
    comp = ""
    for c in curso.get("competencias", []):
        comp += f'<div class="c"><b>✓</b>{esc(c)}</div>'
    paso = curso.get("proximo_paso", {})
    cierre = f"""
<div class="pagina">
  <div class="seccion"><div class="cuad"></div><h2>{ui['consideraciones']}</h2></div>
  <div class="intro">{esc(sustituir(curso.get('consideraciones',''), nombre)).replace(esc(nombre), '<b>'+esc(nombre)+'</b>')}</div>
  <div class="comp">{comp}</div>

  <div class="paso">
    <div class="k">{ui['paso']}</div>
    <h2>→ {esc(paso.get('titulo',''))}</h2>
    <p>{esc(sustituir(paso.get('texto',''), nombre))}</p>
  </div>

  <div class="pie">
    <div style="font-size:9px;letter-spacing:.08em;color:#8a9078;font-weight:700;margin-bottom:10px">{esc(alumno.get('profesor',''))} · {ui['pie_profesor']}</div>
    <div class="barra"><span class="l">kodland</span><span class="c">{ui['pie_lema']}</span><span style="color:#fff;font-weight:700;font-size:11px">kodland.com.br</span></div>
  </div>
  <div class="pie-num">Kodland · {ui['pagina']}</div>
</div>
"""

    return f"<!doctype html><html><head><meta charset='utf-8'><style>{ESTILOS}</style></head><body>{portada}{calif_html}{paginas_mod}{cierre}</body></html>"


def render_pdf(html, salida):
    """Convierte el HTML a PDF usando Playwright (Chrome/Edge del sistema)."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        navegador = None
        for canal in ("chrome", "msedge", None):
            try:
                navegador = (pw.chromium.launch(channel=canal, headless=True)
                             if canal else pw.chromium.launch(headless=True))
                break
            except Exception:
                navegador = None
        if navegador is None:
            raise RuntimeError("No pude abrir Chrome/Edge/Chromium para generar el PDF.")
        page = navegador.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=salida, format="A4", print_background=True,
                 margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        navegador.close()


def pct_por_modulo(progress):
    """% de aprovechamiento por módulo desde datos reales de Kodland.

    progress: lista de módulos con module_current_grade/module_max_grade (ya
    combinados clase+deberes, como en get_students_main_data.progress_info).
    Devuelve [% por módulo] TRUNCADO hasta el último módulo con progreso (>0),
    para no mostrar módulos futuros vacíos en un alumno a mitad de curso.
    """
    pares = sorted(
        ((m.get("module_number", i + 1),
          m.get("module_current_grade", 0) or 0,
          m.get("module_max_grade", 0) or 0)
         for i, m in enumerate(progress or [])),
        key=lambda x: x[0])
    alcanzado = 0
    for i, (_mn, cur, _mx) in enumerate(pares):
        if cur > 0:
            alcanzado = i + 1
    if alcanzado == 0:
        alcanzado = len(pares)  # sin datos: mostrar todo
    return [round(100 * cur / mx) if mx else 0 for (_mn, cur, mx) in pares[:alcanzado]]


def generar(curso, alumno, carpeta_salida):
    os.makedirs(carpeta_salida, exist_ok=True)
    base = "".join(ch for ch in alumno["alumno"] if ch.isalnum() or ch in " _-").strip() or "alumno"
    html = build_html(curso, alumno)
    ruta_html = os.path.join(carpeta_salida, base + ".html")
    ruta_pdf = os.path.join(carpeta_salida, base + ".pdf")
    with open(ruta_html, "w", encoding="utf-8") as fh:
        fh.write(html)
    render_pdf(html, ruta_pdf)
    return ruta_pdf


def main():
    ap = argparse.ArgumentParser(description="Generador de reporte de desarrollo por alumno")
    ap.add_argument("--curso", help="ruta a la plantilla de curso (JSON)")
    ap.add_argument("--alumno", default="")
    ap.add_argument("--profesor", default="")
    ap.add_argument("--pct", default="", help="porcentajes por módulo separados por coma")
    ap.add_argument("--demo", action="store_true", help="genera una muestra con el ejemplo (Roblox)")
    ap.add_argument("--salida", default=os.path.join(DIR, "reportes", "salida"))
    args = ap.parse_args()

    if args.demo:
        curso = json.load(open(os.path.join(DIR, "reportes", "curso.example.json"), encoding="utf-8"))
        alumno = {"alumno": "Ana Sofía Ejemplo", "profesor": "Prof. Jaime Narváez",
                  "pct": [65, 45, 85, 100, 65, 40, 39, 67, 98, 100]}
    else:
        if not args.curso or not args.alumno or not args.pct:
            print("Faltan --curso, --alumno y --pct (o usa --demo).")
            sys.exit(1)
        curso = json.load(open(args.curso, encoding="utf-8"))
        alumno = {"alumno": args.alumno, "profesor": args.profesor,
                  "pct": [float(x) for x in args.pct.split(",") if x.strip()]}

    ruta = generar(curso, alumno, args.salida)
    print("Reporte generado:")
    print("  " + ruta)


if __name__ == "__main__":
    main()
