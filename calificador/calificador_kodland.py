# -*- coding: utf-8 -*-
"""
Calificador automático de tareas — Kodland (bo.kodland.org)

Automatiza la revisión de tareas del panel de profesores de Kodland:

  1. Abre el panel de profesores y recorre todos los grupos (paginador al máximo).
  2. Toma los grupos activos que ya tienen una lección en curso.
  3. En cada grupo entra a la pestaña "Comprobar" y recorre las lecciones.
  4. Detecta el estado de cada tarea por su color, calibrado con la leyenda de la
     página (amarilla = por revisar, naranja = entregada tarde -> se procesan;
     verde/roja/gris -> se ignoran).
  5. Califica las tareas pendientes y, opcionalmente, deja un comentario para el
     estudiante. Nota y comentario se guardan juntos.
  6. Registra en CSV/JSONL todo lo realizado, para auditoría.

Configuración inicial:
  Copia config.example.json a config.json y pon tu ID de profesor
  (el número de la URL de tu panel: https://bo.kodland.org/teachers/<ID>).

Uso:
  python calificador_kodland.py                    # califica las tareas pendientes
  python calificador_kodland.py --dry-run          # simulación: muestra qué haría
  python calificador_kodland.py --grupo COL12345   # solo grupos que contengan ese código
  python calificador_kodland.py --omitir COL12345  # excluye grupos
  python calificador_kodland.py --leccion M2L3     # solo esa lección
  python calificador_kodland.py --max-grupos 3     # limita cuántos grupos procesa

Comentarios y calificación por calidad (opcional):
  --comentar plantillas   # análisis local del código (sin conexión externa)
  --comentar ia           # IA externa (ia_config.json): comentario personalizado
                          # y evaluación real del código; la nota refleja la calidad
  --probar-comentario N   # vista previa de N tareas, sin guardar nada
  --sin-enviar            # con --comentar: solo mostrar, sin guardar en la plataforma
  --probar-ia             # verifica la conexión con la IA configurada

La primera vez se abrirá el navegador para iniciar sesión en Kodland. La sesión
queda guardada en un perfil local y no hay que repetir el proceso.
"""

import argparse
import ast
import csv
import datetime as dt
import difflib
import html as _html
import json
import random
import re
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    print("Falta Playwright. Instálalo con:  py -3 -m pip install playwright")
    sys.exit(1)

# ----------------------------- configuración -----------------------------

BASE = "https://bo.kodland.org"
# El ID de profesor se toma de config.json (ver config.example.json) o de
# --profesor-id. Es el número que aparece en la URL de tu panel:
#   https://bo.kodland.org/teachers/<TU_ID>
URL_PROFES = None  # se completa al arrancar, según la configuración

DIR_BASE = Path(__file__).resolve().parent
DIR_PERFIL = Path.home() / ".kodland_calificador" / "perfil_chrome"
DIR_DEBUG = DIR_BASE / "depuracion"
DIR_REGISTROS = DIR_BASE / "registros"
RUTA_CONFIG = DIR_BASE / "config.json"
RUTA_CONFIG_EJEMPLO = DIR_BASE / "config.example.json"


def cargar_config():
    """Lee config.json (o config.example.json de respaldo). Devuelve un dict."""
    for ruta in (RUTA_CONFIG, RUTA_CONFIG_EJEMPLO):
        try:
            if ruta.exists():
                return json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

# Ojo: en Kodland la "М" de los códigos de lección suele ser CIRÍLICA (U+041C),
# idéntica a simple vista a la M latina. Aceptamos ambas.
PATRON_LECCION = re.compile(r"[MМ](\d+)\D{0,3}?L(\d+)", re.I)
ESTADOS_PENDIENTES = {"por_revisar", "tarde"}

# --------------------------- JavaScript embebido ---------------------------
# Analiza la pestaña "Comprobar": localiza la leyenda de colores, las fichas
# (pastillas) de cada tarea, el alumno de cada fila y la columna T#.
# Marca cada pastilla con data-kbot="N" para poder pulsarla desde Playwright.

JS_ANALIZAR = r"""
() => {
  const salida = { leyenda: {}, fichas: [] };
  const parseColor = (c) => {
    if (!c) return null;
    const m = c.replace(/\s+/g, '').match(/^rgba?\((\d+\.?\d*),(\d+\.?\d*),(\d+\.?\d*)(?:,([\d.]+))?\)$/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a < 0.2) return null;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  };
  const fondo = (el) => parseColor(getComputedStyle(el).backgroundColor);
  const rectDe = (el) => el.getBoundingClientRect();
  const visible = (el) => { const r = rectDe(el); return r.width > 1 && r.height > 1; };
  const todos = Array.from(document.querySelectorAll('body *'));

  // ---- 1. Leyenda: color real de cada estado ----
  const defs = [
    ['revisada',    /tarea\s+revisada/i],
    ['no_enviada',  /tarea\s+no\s+enviada/i],
    ['por_revisar', /por\s+revisar/i],
    ['tarde',       /luego\s+de\s+la\s+fecha|fecha\s+l[ií]mite/i],
    ['sin_tareas',  /no\s+hay\s+tareas/i]
  ];
  for (const par of defs) {
    const clave = par[0], rex = par[1];
    let mejor = null, mejorLen = 1e9;
    for (const el of todos) {
      const t = (el.textContent || '').trim();
      if (t.length > 0 && t.length < 120 && rex.test(t) && visible(el) && t.length < mejorLen) {
        mejor = el; mejorLen = t.length;
      }
    }
    if (!mejor) continue;
    let cont = mejor, encontrado = false;
    for (let sube = 0; sube < 3 && cont && !encontrado; sube++) {
      const cands = [cont].concat(Array.from(cont.querySelectorAll('*')));
      for (const c of cands) {
        const r = rectDe(c);
        if (r.width > 2 && r.width <= 30 && r.height > 2 && r.height <= 30) {
          const col = fondo(c);
          if (col) { salida.leyenda[clave] = col; encontrado = true; break; }
        }
      }
      cont = cont.parentElement;
    }
  }

  // ---- 2. Pastillas de tareas (texto "n/m" o "—") ----
  const rexTxt = /^(\d+\/\d+|—|–|-)$/;
  const setP = new Set();
  for (const el of todos) {
    const t = (el.textContent || '').replace(/\s+/g, '');
    if (!rexTxt.test(t)) continue;
    let p = el;
    for (let sube = 0; sube < 5 && p; sube++) {
      if (fondo(p)) break;
      p = p.parentElement;
    }
    if (!p || !fondo(p)) continue;
    const r = rectDe(p);
    if (r.width < 24 || r.width > 230 || r.height < 14 || r.height > 70) continue;
    setP.add(p);
  }
  const pastillas = Array.from(setP);

  // ---- 3. Encabezados de columna T1..T8 ----
  const cols = [];
  for (const el of todos) {
    const t = (el.textContent || '').trim();
    if (/^T\d+$/.test(t)) {
      const r = rectDe(el);
      if (r.width > 0 && r.width < 140 && r.height < 50) cols.push({ etiqueta: t, cx: r.left + r.width / 2 });
    }
  }

  // ---- 4. Enlaces de alumnos (nombre con espacios, a la izquierda) ----
  const alumnos = [];
  for (const a of Array.from(document.querySelectorAll('a'))) {
    const t = (a.textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length < 6 || t.indexOf(' ') < 0) continue;
    if (/[MМ]\d+\.?L\d+/i.test(t)) continue;
    const r = rectDe(a);
    if (r.width < 10 || r.height < 8) continue;
    alumnos.push({ nombre: t, top: r.top, bottom: r.bottom, left: r.left });
  }

  // ---- 5. Clasificación de color ----
  const distancia = (c1, c2) => Math.sqrt(
    (c1[0]-c2[0])*(c1[0]-c2[0]) + (c1[1]-c2[1])*(c1[1]-c2[1]) + (c1[2]-c2[2])*(c1[2]-c2[2]));
  const hslDe = (rgb) => {
    const r = rgb[0]/255, g = rgb[1]/255, b = rgb[2]/255;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    const l = (mx+mn)/2, d = mx-mn;
    let h = 0, s = 0;
    if (d > 0) {
      s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
      if (mx === r) h = (g-b)/d + (g < b ? 6 : 0);
      else if (mx === g) h = (b-r)/d + 2;
      else h = (r-g)/d + 4;
      h *= 60;
    }
    return [h, s, l];
  };
  const clasificaHue = (col) => {
    const hsl = hslDe(col), h = hsl[0], s = hsl[1], l = hsl[2];
    if (s < 0.15 || l > 0.93) return 'sin_tareas';
    if (h < 15 || h >= 345) return 'no_enviada';
    if (h < 48) return 'tarde';
    if (h < 75) return 'por_revisar';
    if (h < 170) return 'revisada';
    return 'desconocido';
  };
  const clavesLey = Object.keys(salida.leyenda);

  pastillas.forEach((p, i) => {
    p.setAttribute('data-kbot', String(i));
    const r = rectDe(p);
    const col = fondo(p);
    const cx = r.left + r.width/2;
    let estado;
    if (clavesLey.length >= 4) {
      let mejorC = null, mejorD = 1e9;
      for (const k of clavesLey) {
        const d = distancia(col, salida.leyenda[k]);
        if (d < mejorD) { mejorD = d; mejorC = k; }
      }
      estado = (mejorD < 90) ? mejorC : clasificaHue(col);
    } else {
      estado = clasificaHue(col);
    }
    let al = null, mejorSol = 4;
    for (const a of alumnos) {
      if (a.left >= r.left) continue;
      const sol = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
      if (sol > mejorSol) { mejorSol = sol; al = a.nombre; }
    }
    let tarea = null, mejorDx = 1e9;
    for (const c of cols) {
      const dx = Math.abs(c.cx - cx);
      if (dx < mejorDx) { mejorDx = dx; tarea = c.etiqueta; }
    }
    // coordenadas de documento (estables aunque la página haga scroll)
    const docX = r.left + window.scrollX, docY = r.top + window.scrollY;
    if (!tarea) tarea = 'x' + Math.round(docX / 8);
    salida.fichas.push({
      kbot: i,
      texto: (p.textContent || '').replace(/\s+/g, ''),
      estado: estado,
      alumno: al,
      tarea: tarea,
      color: col,
      y: docY, x: docX,
      vy: (r.top + r.bottom) / 2
    });
  });
  // segunda pasada: a las fichas sin nombre se les asigna el alumno cuya fila
  // (centro vertical del enlace) esté más cerca — equivale a repartir por bandas
  if (alumnos.length) {
    const noms = alumnos.slice().sort((a, b) => a.top - b.top);
    const centros = noms.map(n => (n.top + n.bottom) / 2);
    for (const f of salida.fichas) {
      if (f.alumno) continue;
      let mejorI = -1, mejorD = 200;
      for (let i = 0; i < centros.length; i++) {
        const d = Math.abs(f.vy - centros[i]);
        if (d < mejorD) { mejorD = d; mejorI = i; }
      }
      if (mejorI >= 0) f.alumno = noms[mejorI].nombre;
    }
  }
  salida.fichas.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return salida;
}
"""

# Extrae las filas de grupos del panel de profesores por GEOMETRÍA:
# asocia a cada enlace de grupo el código de lección y el estado "Activo"
# que estén en su misma banda vertical, sin depender de la estructura HTML.
JS_GRUPOS = r"""
() => {
  const rexL = /[MМ](\d+)\.?\s*L(\d+)/i;  // M latina o М cirílica
  const enlaces = [];
  for (const a of document.querySelectorAll("a[href*='/groups/']")) {
    const url = (a.href || '').split('?')[0];
    if (!/\/groups\/\d+$/.test(url)) continue;
    const t = (a.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    enlaces.push({ url: url, texto: t, top: r.top, bottom: r.bottom, left: r.left, el: a });
  }
  const lecciones = [];
  const estados = [];
  for (const el of document.querySelectorAll('a, span, div, td, p, button')) {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 120) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const m = t.match(rexL);
    if (m) lecciones.push({ mod: +m[1], lec: +m[2], top: r.top, bottom: r.bottom, area: r.width * r.height });
    if (/^activo$/i.test(t)) estados.push({ top: r.top, bottom: r.bottom });
  }
  const solapa = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4;
  const vistos = {};
  const filas = [];
  for (const e of enlaces) {
    if (rexL.test(e.texto)) continue;  // es el enlace de la lección, no el del código
    if (vistos[e.url]) continue;
    vistos[e.url] = true;
    let mejor = null;
    for (const l of lecciones) {
      if (!solapa(e, l)) continue;
      if (!mejor || l.area < mejor.area) mejor = l;
    }
    const act = estados.some(s => solapa(e, s));
    const fila = e.el.closest('tr') || e.el.closest("[class*='row']") || e.el.parentElement;
    const texto = fila ? (fila.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    filas.push({
      codigo: e.texto,
      url: e.url,
      mod: mejor ? mejor.mod : null,
      lec: mejor ? mejor.lec : null,
      activo: act,
      texto: texto,
      hay_estados: estados.length > 0
    });
  }
  return filas;
}
"""

# Lee la etiqueta de rango del paginador ("1-10 de 49") y su total.
JS_RANGO = r"""
() => {
  const rex = /^\s*(\d+)\s*[-–]\s*(\d+)\s*(?:de|of)\s*(\d+)\s*$/i;
  let mejor = null, len = 1e9, total = null;
  for (const el of document.querySelectorAll('body *')) {
    const t = (el.textContent || '').trim();
    const m = t.match(rex);
    if (m && t.length < len) { mejor = t; len = t.length; total = parseInt(m[3], 10); }
  }
  return { rango: mejor, total: total };
}
"""

# Localiza el paginador por su etiqueta de rango y pulsa la flecha "siguiente"
# (el penúltimo control de navegación a la derecha del rango). Autoverificable:
# el llamador comprueba después si el rango cambió.
JS_SIGUIENTE = r"""
() => {
  const rex = /^\s*(\d+)\s*[-–]\s*(\d+)\s*(?:de|of)\s*(\d+)\s*$/i;
  let lab = null, len = 1e9, total = null;
  for (const el of document.querySelectorAll('body *')) {
    const t = (el.textContent || '').trim();
    const m = t.match(rex);
    if (m && t.length < len) { lab = el; len = t.length; total = parseInt(m[3], 10); }
  }
  if (!lab) return { ok: false, total: null, rango: null };
  const r = lab.getBoundingClientRect();
  let cont = lab;
  for (let i = 0; i < 4 && cont.parentElement; i++) cont = cont.parentElement;

  const recoger = (sel, exigirPointer) => {
    const res = [];
    for (const el of cont.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect();
      if (b.width < 14 || b.width > 80 || b.height < 14 || b.height > 80) continue;
      if (b.left <= r.right - 5) continue;                      // a la derecha del rango
      if (b.bottom < r.top - 30 || b.top > r.bottom + 30) continue;  // misma línea
      if (exigirPointer && getComputedStyle(el).cursor !== 'pointer') continue;
      res.push({ el: el, x: b.left, area: b.width * b.height });
    }
    return res;
  };
  let navs = recoger("button, a, [role='button']", false);
  if (!navs.length) navs = recoger('*', true);
  if (!navs.length) return { ok: false, total: total, rango: lab.textContent.trim() };

  navs.sort((a, b) => a.x - b.x);
  const grupos = [];
  for (const n of navs) {
    const g = grupos.find(g => Math.abs(g.x - n.x) < 8);
    if (g) { if (n.area < g.area) { g.el = n.el; g.area = n.area; } }
    else grupos.push({ x: n.x, el: n.el, area: n.area });
  }
  const idx = grupos.length >= 3 ? grupos.length - 2 : grupos.length - 1;
  const objetivo = grupos[idx].el;
  const rango = lab.textContent.trim();
  for (const tipo of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    objetivo.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
  }
  return { ok: true, total: total, rango: rango, botones: grupos.length };
}
"""

# ------------------------------- utilidades -------------------------------

def ahora():
    return dt.datetime.now().strftime("%H:%M:%S")


def log(msg):
    print(f"[{ahora()}] {msg}", flush=True)


def dump_debug(page, nombre):
    """Guarda captura y HTML para poder diagnosticar problemas después."""
    try:
        DIR_DEBUG.mkdir(parents=True, exist_ok=True)
        marca = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        base = DIR_DEBUG / f"{marca}_{re.sub(r'[^A-Za-z0-9_-]', '_', nombre)[:60]}"
        page.screenshot(path=str(base) + ".png", full_page=True)
        Path(str(base) + ".html").write_text(page.content(), encoding="utf-8")
        log(f"   (depuración guardada en {base}.png)")
    except Exception:
        pass


def codigo_leccion(texto):
    """'M1.L2 Introducción...' -> (1, 2) o None."""
    m = PATRON_LECCION.search(texto or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


# ------------------------------ navegación -------------------------------

def esperar_sesion(page):
    """Va al panel de profesores; si hace falta login, espera a que el usuario lo haga."""
    page.goto(URL_PROFES, wait_until="domcontentloaded")
    time.sleep(3)
    if page.locator("a[href*='/groups/']").count() > 0:
        return
    print()
    print("=" * 62)
    print("  No veo tus grupos todavía.")
    print("  Si aparece la página de login, inicia sesión en la ventana")
    print("  de Chrome. El script continuará solo al detectar tus grupos.")
    print("=" * 62)
    print()
    limite = time.time() + 600  # 10 minutos para loguearse
    while time.time() < limite:
        time.sleep(5)
        try:
            if page.locator("a[href*='/groups/']").count() > 0:
                log("Sesión detectada, continuamos.")
                time.sleep(1)
                return
            # si el login ya terminó y quedó en otra página del backoffice,
            # volvemos al panel; nunca recargamos mientras se está logueando
            u = page.url
            host = urlparse(u).netloc.lower()
            if host == "bo.kodland.org" and "login" not in u.lower() and "/teachers/" not in u:
                page.goto(URL_PROFES, wait_until="domcontentloaded")
        except Exception:
            pass
    raise RuntimeError("No se detectó la sesión tras 10 minutos. Vuelve a ejecutar el script.")


def _caja_texto_mas_pequena(page, rex):
    """Bounding box del elemento MÁS PEQUEÑO cuyo texto coincide (evita contenedores)."""
    loc = page.get_by_text(rex)
    mejor = None
    for i in range(min(loc.count(), 12)):
        try:
            b = loc.nth(i).bounding_box()
        except Exception:
            continue
        if not b:
            continue
        if mejor is None or b["width"] * b["height"] < mejor["width"] * mejor["height"]:
            mejor = b
    return mejor


def _elegir_opcion_numerica_maxima(page):
    """En un menú desplegable abierto, pulsa la opción numérica más alta."""
    ops = page.locator("mat-option, [role='option'], .v-overlay .v-list-item")
    candidato, valor = None, -1
    for i in range(ops.count()):
        o = ops.nth(i)
        try:
            if not o.is_visible():
                continue
            t = (o.inner_text() or "").strip()
        except Exception:
            continue
        if t.isdigit() and int(t) > valor:
            candidato, valor = o, int(t)
    if candidato:
        candidato.click()
        time.sleep(2)
        return True
    return False


def ampliar_paginador(page):
    """Intenta poner 'Elementos por página' en el valor máximo (50)."""
    # La tabla es un v-data-table de Vuetify: hay que esperar a que exista el pie
    try:
        page.locator(".v-data-table-footer").first.wait_for(state="visible", timeout=12000)
    except Exception:
        pass
    try:
        rango_antes = (page.evaluate(JS_RANGO) or {}).get("rango")
    except Exception:
        rango_antes = None
    # el selector de tamaño es un .v-select cuyo campo muestra solo un número
    try:
        selectores = [
            ".v-data-table-footer__items-per-page .v-select .v-field",
            ".v-data-table-footer .v-select .v-field",
            ".v-select .v-field",
        ]
        for sel in selectores:
            campos = page.locator(sel)
            for i in range(campos.count()):
                c = campos.nth(i)
                try:
                    if not c.is_visible():
                        continue
                    texto = (c.inner_text() or "").strip()
                    if not texto.isdigit():
                        continue
                    c.click()
                    time.sleep(1.0)
                    if _elegir_opcion_numerica_maxima(page):
                        # verificar que el rango cambió (p. ej. "1-10 de 49" → "1-49 de 49")
                        for _ in range(6):
                            time.sleep(1)
                            try:
                                r = (page.evaluate(JS_RANGO) or {}).get("rango")
                            except Exception:
                                r = None
                            if r and r != rango_antes:
                                return True
                        return True
                    page.keyboard.press("Escape")
                except Exception:
                    try:
                        page.keyboard.press("Escape")
                    except Exception:
                        pass
            if campos.count():
                break  # ya probamos los campos numéricos del selector más específico
    except Exception:
        pass

    intentos = [
        "mat-paginator mat-select",
        ".mat-mdc-paginator mat-select",
        "mat-paginator select",
        ".mat-mdc-paginator select",
    ]
    # selects nativos primero
    for sel in intentos:
        loc = page.locator(sel)
        if loc.count() == 0:
            continue
        el = loc.first
        try:
            if sel.endswith("select") and not sel.endswith("mat-select"):
                opciones = el.locator("option").all_inner_texts()
                numeros = [t.strip() for t in opciones if t.strip().isdigit()]
                if numeros:
                    el.select_option(label=max(numeros, key=int))
                    time.sleep(2)
                    return True
            else:
                el.click()
                time.sleep(0.8)
                ops = page.locator("mat-option, [role='option']")
                mejor, valor = None, -1
                for i in range(ops.count()):
                    o = ops.nth(i)
                    if not o.is_visible():
                        continue
                    t = (o.inner_text() or "").strip()
                    if t.isdigit() and int(t) > valor:
                        mejor, valor = o, int(t)
                if mejor:
                    mejor.click()
                    time.sleep(2)
                    return True
                page.keyboard.press("Escape")
        except Exception:
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
    # genérico: cualquier control cercano al texto "Elementos por página"
    try:
        et = page.get_by_text(re.compile("elementos por p|items? per page|por p[aá]gina", re.I))
        if et.count():
            caja = et.first.bounding_box()
            combos = page.locator("select, mat-select, [role='combobox'], [role='listbox']")
            mejor, dist = None, 1e9
            for i in range(combos.count()):
                c = combos.nth(i)
                try:
                    b = c.bounding_box()
                except Exception:
                    continue
                if not b or not caja:
                    continue
                d = abs(b["y"] - caja["y"]) + abs(b["x"] - (caja["x"] + caja["width"]))
                if d < dist:
                    mejor, dist = c, d
            if mejor and dist < 400:
                tag = mejor.evaluate("el => el.tagName.toLowerCase()")
                if tag == "select":
                    opciones = mejor.locator("option").all_inner_texts()
                    numeros = [t.strip() for t in opciones if t.strip().isdigit()]
                    if numeros:
                        mejor.select_option(label=max(numeros, key=int))
                        time.sleep(2)
                        return True
                else:
                    mejor.click()
                    time.sleep(0.8)
                    ops = page.locator("mat-option, [role='option'], li")
                    candidato, valor = None, -1
                    for i in range(ops.count()):
                        o = ops.nth(i)
                        try:
                            if not o.is_visible():
                                continue
                            t = (o.inner_text() or "").strip()
                        except Exception:
                            continue
                        if t.isdigit() and int(t) > valor:
                            candidato, valor = o, int(t)
                    if candidato:
                        candidato.click()
                        time.sleep(2)
                        return True
                    page.keyboard.press("Escape")
    except Exception:
        pass
    return False


def _mejor_version(a, b):
    """Combina dos lecturas de la misma fila, prefiriendo la que tiene lección."""
    if (a["mod"] is None) != (b["mod"] is None):
        elegido = a if a["mod"] is not None else b
    else:
        elegido = a if len(a.get("texto") or "") >= len(b.get("texto") or "") else b
    elegido = dict(elegido)
    elegido["activo"] = bool(a["activo"] or b["activo"])
    return elegido


def escanear_pagina(page, acumulado, max_seg=9):
    """Escanea la página actual repetidamente hasta que los datos se estabilicen.

    Las celdas de la tabla se rellenan en diferido, así que una sola lectura
    suele llegar antes de tiempo. Devuelve True si se vio la columna de estado.
    """
    quieto = 0
    hay_estados = False
    fin = time.time() + max_seg
    while time.time() < fin:
        cambio = False
        for g in page.evaluate(JS_GRUPOS):
            hay_estados = hay_estados or g.get("hay_estados", False)
            antes = acumulado.get(g["url"])
            nuevo = g if antes is None else _mejor_version(antes, g)
            if antes != nuevo:
                acumulado[g["url"]] = nuevo
                cambio = True
        if cambio:
            quieto = 0
        else:
            quieto += 1
            if quieto >= 2:
                break
        time.sleep(1.0)
    return hay_estados


def listar_grupos(page):
    """Recorre el paginador y devuelve la lista completa de grupos."""
    if ampliar_paginador(page):
        log("Paginador ajustado al máximo de elementos por página.")
    else:
        log("No pude ajustar el paginador; recorreré las páginas con la flecha.")

    acumulado = {}
    total_esperado = None
    hay_estados = False
    for _pagina in range(40):
        time.sleep(1.2)
        hay_estados = escanear_pagina(page, acumulado) or hay_estados
        info = page.evaluate(JS_RANGO)
        if info.get("total"):
            total_esperado = info["total"]
        if total_esperado and len(acumulado) >= total_esperado:
            break
        paso = page.evaluate(JS_SIGUIENTE)
        if not paso.get("ok"):
            break
        time.sleep(2)
        despues = page.evaluate(JS_RANGO)
        if despues.get("rango") == paso.get("rango"):
            break  # el rango no cambió: era la última página

    grupos = list(acumulado.values())
    if grupos and not hay_estados:
        log("⚠ No vi la columna de estado 'Activo' en la tabla; asumiré todos activos.")
        for g in grupos:
            g["activo"] = True
    if total_esperado:
        log(f"Grupos leídos: {len(grupos)} de {total_esperado} según el paginador.")
        if len(grupos) < total_esperado:
            log("⚠ Faltaron grupos por leer; guardo depuración para ajustar el script.")
            dump_debug(page, "paginacion_incompleta")
    # si la mayoría quedó sin lección, guardamos el panel para poder analizarlo
    sin_lec = sum(1 for g in grupos if g["mod"] is None)
    if grupos and sin_lec > len(grupos) * 0.6:
        log("(guardo una copia del panel en 'depuracion' para análisis)")
        dump_debug(page, "panel_grupos")
    return grupos


# --------------------------- pestaña "Comprobar" ---------------------------

def _select_nativo_lecciones(page):
    sels = page.locator("select")
    for i in range(sels.count()):
        s = sels.nth(i)
        try:
            textos = s.locator("option").all_inner_texts()
        except Exception:
            continue
        if any(PATRON_LECCION.search(t) for t in textos):
            return s, [t.strip() for t in textos]
    return None, None


def _combo_lecciones(page):
    # Vuetify 3 (.v-select .v-field) primero; Material y ARIA como respaldo
    cand = page.locator(".v-select .v-field, mat-select, [role='combobox']")
    n = cand.count()
    # 1) el que ya muestra una lección seleccionada
    for i in range(n):
        c = cand.nth(i)
        try:
            if c.is_visible() and PATRON_LECCION.search(c.inner_text() or ""):
                return c
        except Exception:
            continue
    # 2) el más cercano a la etiqueta "Seleccione una lección"
    try:
        caja = _caja_texto_mas_pequena(page, re.compile("seleccione una lecci", re.I))
        if caja:
            mejor, dist = None, 1e9
            for i in range(n):
                c = cand.nth(i)
                try:
                    if not c.is_visible():
                        continue
                    b = c.bounding_box()
                except Exception:
                    continue
                if not b:
                    continue
                d = abs(b["y"] - caja["y"]) + abs(b["x"] - caja["x"])
                if d < dist:
                    mejor, dist = c, d
            if mejor:
                return mejor
    except Exception:
        pass
    # 3) el único combo visible que haya
    for i in range(n):
        c = cand.nth(i)
        try:
            if c.is_visible():
                return c
        except Exception:
            continue
    return None


def _opciones_visibles(page):
    # opciones de menú: Vuetify las pinta dentro de un .v-overlay
    ops = page.locator("mat-option, [role='option'], .v-overlay .v-list-item")
    vis = []
    for i in range(ops.count()):
        o = ops.nth(i)
        try:
            if o.is_visible():
                vis.append((o, (o.inner_text() or "").strip()))
        except Exception:
            continue
    return vis


def obtener_lecciones(page):
    """Devuelve ('select'|'combo', [etiquetas]) del desplegable de lecciones."""
    s, textos = _select_nativo_lecciones(page)
    if s:
        return "select", textos
    combo = _combo_lecciones(page)
    if not combo:
        return None, []
    for _intento in range(2):
        try:
            combo.click()
            # con el menú abierto, esperar a que lleguen las opciones (cargan del servidor)
            vis = []
            for _ in range(8):
                time.sleep(0.8)
                vis = _opciones_visibles(page)
                if vis:
                    break
            page.keyboard.press("Escape")
            time.sleep(0.4)
            if vis:
                return "combo", [t for _o, t in vis]
        except Exception:
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
        time.sleep(1.5)
    return "combo", []


def seleccionar_leccion(page, modo, indice):
    if modo == "select":
        s, _ = _select_nativo_lecciones(page)
        if not s:
            return False
        s.select_option(index=indice)
    else:
        combo = _combo_lecciones(page)
        if not combo:
            return False
        combo.click()
        vis = []
        for _ in range(8):
            time.sleep(0.7)
            vis = _opciones_visibles(page)
            if vis:
                break
        if indice >= len(vis):
            page.keyboard.press("Escape")
            return False
        vis[indice][0].click()
    time.sleep(1.8)
    return True


def analizar_fichas(page):
    """Ejecuta el JS de análisis; reintenta si aún no cargó o faltan nombres."""
    datos = page.evaluate(JS_ANALIZAR)
    if not datos["fichas"]:
        time.sleep(2.5)
        return page.evaluate(JS_ANALIZAR)
    nulos = sum(1 for f in datos["fichas"] if not f.get("alumno"))
    if nulos > len(datos["fichas"]) * 0.4:
        time.sleep(2.5)
        d2 = page.evaluate(JS_ANALIZAR)
        if d2["fichas"]:
            n2 = sum(1 for f in d2["fichas"] if not f.get("alumno"))
            if n2 < nulos:
                return d2
    return datos


# ------------------------------ calificación ------------------------------

REX_NOTA_MAX = re.compile(r"nota\s*m[aá]x", re.I)


def pulsar_nota_max(pagina, ficha):
    """En la página de la tarea, pulsa 'Nota Max.' y verifica suavemente."""
    pagina.wait_for_load_state("domcontentloaded", timeout=45000)
    boton = None
    try:
        loc = pagina.get_by_text(REX_NOTA_MAX)
        loc.first.wait_for(state="visible", timeout=30000)
        boton = loc.first
    except Exception:
        for marco in pagina.frames[1:]:
            try:
                l = marco.get_by_text(REX_NOTA_MAX)
                l.first.wait_for(state="visible", timeout=4000)
                boton = l.first
                break
            except Exception:
                continue
    if boton is None:
        raise RuntimeError("no encontré el botón 'Nota Max.' en la página de la tarea")
    boton.click()
    time.sleep(1.8)

    verificado = False
    m = re.match(r"(\d+)/(\d+)", ficha.get("texto") or "")
    if m:
        maximo = m.group(2)
        rexv = re.compile(r"\b" + re.escape(maximo) + r"\s*/\s*" + re.escape(maximo) + r"\b")
        try:
            verificado = pagina.get_by_text(rexv).count() > 0
        except Exception:
            pass
    return verificado


# ------------------------------ comentarios ------------------------------
#
# La página de calificación carga sus datos desde la API v2 de Kodland
# (backoffice.kodland.org/api/v2, swagger público). Capturamos esas respuestas
# para conocer: el código que entregó el alumno (StudentProgressByTask.solution),
# la solución esperada (Task.solution) y el chat de la tarea (conversation_node).
# Con eso generamos un comentario (plantillas locales con análisis del código, o
# el endpoint de IA interno de Kodland) y lo dejamos con el modal «Evalúe»
# (nota + comentario, como lo hace el profesor a mano); el chat de la tarea
# queda como respaldo. Nada de IA de pago ni programas externos.

API_BASE_V2 = "https://backoffice.kodland.org/api/v2"
# la v1 es la que usa el modal «Evalúe» para guardar nota+comentario:
#   PUT /api/v1/grade/{progress_id}/  cuerpo {"grade": int, "comment": str}
API_BASE_V1 = "https://backoffice.kodland.org/api/v1"
CAPTURA_API = {"progreso": None, "tarea": None, "auth": None, "urls": []}
REX_API_PROGRESO = re.compile(r"/students/(\d+)/get_progress_by_task/(\d+)/")
REX_API_TAREA = re.compile(r"/api/v\d+/tasks/(\d+)/(?:\?|$)")
# la página de calificación vive en learn.kodland.org/es/task/<tarea>/check/<id>
REX_URL_CHECK = re.compile(r"/task/(\d+)/check/(\d+)")

PAGINA_PRINCIPAL = None  # la pestaña de bo.kodland.org (sesión buena para la API)

_dump_comentario_hecho = False


def instalar_captura(pagina):
    """Escucha las llamadas API que hace la propia página de Kodland."""
    def al_responder(resp):
        try:
            u = resp.url
            try:
                if resp.request.resource_type in ("xhr", "fetch"):
                    reg = CAPTURA_API["urls"]
                    reg.append(f"{resp.status} {resp.request.method} {u[:140]}")
                    if len(reg) > 40:
                        del reg[: len(reg) - 40]
            except Exception:
                pass
            m = REX_API_PROGRESO.search(u)
            if m and resp.status == 200:
                CAPTURA_API["progreso"] = {
                    "student": int(m.group(1)), "task": int(m.group(2)),
                    "resp": resp, "base": u.split("/students/")[0],
                }
                return
            m = REX_API_TAREA.search(u)
            if m and resp.status == 200:
                CAPTURA_API["tarea"] = {
                    "task": int(m.group(1)), "resp": resp,
                    "base": u[: u.index("/tasks/")],
                }
        except Exception:
            pass

    def al_pedir(req):
        try:
            if CAPTURA_API["auth"] is None and "/api/" in req.url:
                h = req.headers.get("authorization")
                if h:
                    CAPTURA_API["auth"] = h
        except Exception:
            pass

    try:
        pagina.on("response", al_responder)
        pagina.on("request", al_pedir)
    except Exception:
        pass


def _json_capturado(clave):
    """Devuelve la captura con su JSON ya leído, o None."""
    cap = CAPTURA_API.get(clave)
    if not cap:
        return None
    if "json" not in cap:
        try:
            cap["json"] = cap["resp"].json()
        except Exception:
            cap["json"] = None
    return cap if cap.get("json") is not None else None


def api_llamar(pagina, base, ruta, metodo="GET", datos=None):
    """Llama a la API v2 desde el contexto de la página (misma sesión/cookies)."""
    js = """
    async (args) => {
      const cab = {'Accept': 'application/json'};
      const m = document.cookie.match(/csrftoken=([^;]+)/);
      if (m) cab['X-CSRFToken'] = m[1];
      if (args.auth) cab['Authorization'] = args.auth;
      if (args.datos) cab['Content-Type'] = 'application/json';
      try {
        const r = await fetch(args.url, {
          method: args.metodo, credentials: 'include', headers: cab,
          body: args.datos ? JSON.stringify(args.datos) : undefined,
        });
        let cuerpo = null;
        try { cuerpo = await r.json(); } catch (e) {}
        return {status: r.status, cuerpo: cuerpo};
      } catch (e) {
        return {status: -1, cuerpo: String(e)};
      }
    }
    """
    try:
        return pagina.evaluate(js, {"url": base + ruta, "metodo": metodo,
                                    "datos": datos, "auth": CAPTURA_API.get("auth")})
    except Exception as e:
        return {"status": -2, "cuerpo": str(e)}


def api_llamar_multi(paginas, ruta, metodo="GET", datos=None, bases=None):
    """Prueba la llamada desde varias páginas y bases hasta que responda.

    Devuelve (respuesta, [intentos "status base+ruta"]).
    """
    if bases is None:
        bases = []
        for cap in (CAPTURA_API.get("progreso"), CAPTURA_API.get("tarea")):
            if cap and cap.get("base") and cap["base"] not in bases:
                bases.append(cap["base"])
        if API_BASE_V2 not in bases:
            bases.append(API_BASE_V2)
    intentos = []
    for pagina in paginas:
        if pagina is None:
            continue
        for base in bases:
            r = api_llamar(pagina, base, ruta, metodo, datos)
            intentos.append(f"{r.get('status')} {base}{ruta}")
            if r.get("status") in (200, 201):
                return r, intentos
    return {"status": -3, "cuerpo": None}, intentos


def _limpiar_invisibles(s):
    """Quita caracteres que el transporte HTML mete y rompen el análisis."""
    if not s:
        return s
    s = s.replace(" ", " ")                      # espacio duro (&nbsp;)
    s = s.replace("​", "").replace("﻿", "")  # ancho cero / BOM
    s = s.replace("‘", "'").replace("’", "'")  # comillas tipográficas
    s = s.replace("“", '"').replace("”", '"')
    return s


def _texto_plano(v):
    """Convierte HTML/None a texto plano utilizable."""
    if v is None:
        return None
    s = str(v)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|li)\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = _html.unescape(s)
    s = _limpiar_invisibles(s)
    s = s.strip()
    return s or None


# --- plantillas de comentarios (editables en plantillas_comentarios.json) ---

PLANTILLAS_DEFECTO = {
    "bien": [
        "¡Excelente trabajo, {nombre}! 🎉 Tu código hace justo lo que pedía la tarea. ¡Sigue así!",
        "¡Muy bien, {nombre}! 👏 Tu solución está correcta y bien escrita. ¡Felicitaciones!",
        "¡Genial, {nombre}! ✨ Resolviste la tarea tal como se esperaba. ¡Buen trabajo!",
    ],
    "con_detalles": [
        "¡Buen trabajo, {nombre}! 💪 Tu tarea está aprobada. Un consejo para mejorarla: {detalle}.",
        "¡Bien hecho, {nombre}! 👍 Ya quedó calificada. Para la próxima, {detalle}.",
    ],
    "sintaxis": [
        "¡Buen intento, {nombre}! 💪 Tu tarea quedó calificada, pero ojo: tu código tiene un error de sintaxis ({detalle}). Revísalo para que corra perfecto.",
        "¡Gracias por tu entrega, {nombre}! Quedó calificada 👍. Detalle a revisar: hay un error de sintaxis ({detalle}).",
    ],
    "neutro": [
        "¡Gracias por tu entrega, {nombre}! 🙌 Ya quedó calificada. Compárala con la solución de la tarea para ver otro enfoque 😊",
        "¡Buen trabajo, {nombre}! 👍 Tarea calificada. Si quieres, revisa la solución del curso para comparar ideas.",
    ],
    "sin_codigo": [
        "¡Gracias por tu entrega, {nombre}! 🙌 ¡Buen trabajo, sigue así!",
        "¡Muy bien, {nombre}! 👏 Tu tarea quedó revisada y calificada. ¡Ánimo con la siguiente!",
    ],
    "incompleto": [
        "¡Gracias por tu entrega, {nombre}! 🙌 Aunque no encuentro tu código completo en la respuesta. Envíalo por el chat cuando puedas y así te doy una mejor revisión. ¡Tú puedes! 💪",
        "¡Hola, {nombre}! Recibí tu entrega, pero parece que el código falta o está incompleto. Mándalo completo cuando puedas para revisarlo mejor 😊",
    ],
}

RUTA_PLANTILLAS = DIR_BASE / "plantillas_comentarios.json"
_plantillas_cache = None


def cargar_plantillas():
    global _plantillas_cache
    if _plantillas_cache is not None:
        return _plantillas_cache
    try:
        if RUTA_PLANTILLAS.exists():
            _plantillas_cache = json.loads(RUTA_PLANTILLAS.read_text(encoding="utf-8"))
            # si añadimos categorías nuevas, completarlas en el archivo del usuario
            faltan = [k for k in PLANTILLAS_DEFECTO if k not in _plantillas_cache]
            if faltan:
                for k in faltan:
                    _plantillas_cache[k] = list(PLANTILLAS_DEFECTO[k])
                RUTA_PLANTILLAS.write_text(
                    json.dumps(_plantillas_cache, ensure_ascii=False, indent=2),
                    encoding="utf-8")
        else:
            RUTA_PLANTILLAS.write_text(
                json.dumps(PLANTILLAS_DEFECTO, ensure_ascii=False, indent=2),
                encoding="utf-8")
            _plantillas_cache = dict(PLANTILLAS_DEFECTO)
    except Exception:
        _plantillas_cache = dict(PLANTILLAS_DEFECTO)
    return _plantillas_cache


def _normalizar_codigo(txt):
    lineas = []
    for ln in (txt or "").replace("\r", "").split("\n"):
        ln = re.sub(r"#.*", "", ln).rstrip()
        if ln.strip():
            lineas.append(re.sub(r"\s+", " ", ln.strip()))
    return "\n".join(lineas)


CONSTRUCTOS = [
    ("for ", "un ciclo for"), ("while ", "un ciclo while"),
    ("def ", "una función (def)"), ("if ", "condicionales (if)"),
    ("input(", "input()"), ("int(", "conversión con int()"),
    ("append(", "append() para la lista"), ("import ", "el import que pide la tarea"),
]


def analizar_codigo(codigo, solucion):
    """Comparación local, sin IA: sintaxis (ast) + similitud (difflib) + constructos."""
    det = {"similitud": None, "error_sintaxis": None, "faltantes": [],
           "es_python": False, "sol_es_python": False, "incompleto": False}
    cod = _limpiar_invisibles((codigo or "")).strip()
    sol = _limpiar_invisibles((solucion or "")).strip()
    rex_py = r"\b(print|def|for|while|input|import|if)\b|="
    det["es_python"] = bool(re.search(rex_py, cod))
    det["sol_es_python"] = bool(re.search(rex_py, sol))
    if cod and det["es_python"]:
        try:
            ast.parse(cod)
        except SyntaxError as e:
            msg = (e.msg or "").lower()
            # La plataforma entrega el código APLANADO (sin indentación fiable,
            # viene de HTML): los errores de indentación o de caracteres raros
            # NO son atribuibles al alumno y no deben reportarse.
            transporte = (isinstance(e, (IndentationError, TabError))
                          or "indent" in msg or "non-printable" in msg)
            if not transporte:
                det["error_sintaxis"] = (f"cerca de la línea {e.lineno}" if e.lineno
                                         else "revisa paréntesis y comillas")
        except Exception:
            pass
    if cod and sol:
        ncod = _normalizar_codigo(cod)
        nsol = _normalizar_codigo(sol)
        det["similitud"] = difflib.SequenceMatcher(None, ncod, nsol).ratio()
        for aguja, nombre in CONSTRUCTOS:
            if aguja in nsol and aguja not in ncod:
                det["faltantes"].append(nombre)
        if det["sol_es_python"]:
            # "incompleta" solo si es DIMINUTA en términos absolutos, o si es mucho
            # más corta que la solución Y le faltan ≥2 construcciones clave. Así NO
            # se castiga el código correcto pero conciso (más corto pero completo).
            diminuta = len(ncod) < 20
            mucho_menor = len(ncod) < 0.25 * len(nsol)
            det["incompleto"] = diminuta or (mucho_menor and len(det["faltantes"]) >= 2)
    return det


# Fracción del rango [mínimo, máximo] que se otorga en cada caso (modo conservador).
# 1.0 = nota máxima de la tarea; 0.0 = nota mínima que permite la plataforma.
# Editable si quieres ser más o menos estricto.
FRACCION_NOTA = {
    "incompleto": 0.0,   # entrega vacía o claramente incompleta
    "sintaxis": 0.5,     # el código no corre por un error de sintaxis real
    "ok": 1.0,           # parece correcto, o no es una tarea de código evaluable
}


def calcular_nota(det, maximo, minimo):
    """Nota CONSERVADORA dentro de [minimo, maximo] según el análisis del código.

    Solo baja de la máxima ante problemas de alta confianza (sintaxis rota o
    entrega incompleta); nunca castiga por 'código distinto a la solución'.
    Devuelve (nota_int, motivo) o (None, motivo) si no se conoce el máximo.
    """
    if maximo is None:
        return None, "no conozco la nota máxima de la tarea"
    maximo = int(maximo)
    if minimo is None:
        minimo = round(maximo * 0.4)   # respaldo si la API no da el mínimo
    minimo = int(min(minimo, maximo))
    rango = maximo - minimo

    def nota(frac):
        return int(round(minimo + frac * rango))

    if not det.get("sol_es_python"):
        return maximo, "tarea sin código evaluable → nota máxima"
    if not det.get("es_python"):
        return nota(FRACCION_NOTA["incompleto"]), "no hay código en la entrega → nota mínima"
    if det.get("incompleto"):
        return nota(FRACCION_NOTA["incompleto"]), "entrega incompleta → nota mínima"
    if det.get("error_sintaxis"):
        return (nota(FRACCION_NOTA["sintaxis"]),
                f"error de sintaxis ({det['error_sintaxis']}) → nota parcial")
    return maximo, "sin problemas detectables → nota máxima"


def comentario_local(quien, codigo, solucion, det=None):
    """Comentario a partir de plantillas + análisis local del código."""
    nombre = ""
    if quien and not quien.startswith("("):
        nombre = quien.split()[0]
    if det is None:
        det = analizar_codigo(codigo, solucion)
    if not (codigo or "").strip() or not det["es_python"]:
        # tarea de código sin código en la entrega → pedirlo; si no es de código → elogio
        cat, detalle = ("incompleto", "") if det["sol_es_python"] else ("sin_codigo", "")
    elif det["error_sintaxis"]:
        cat, detalle = "sintaxis", det["error_sintaxis"]
    elif det["incompleto"]:
        cat, detalle = "incompleto", ""
    elif det["similitud"] is not None and det["similitud"] >= 0.75:
        cat, detalle = "bien", ""
    elif det["faltantes"]:
        cat, detalle = "con_detalles", "podrías intentar usar " + " y ".join(det["faltantes"][:2])
    elif det["similitud"] is not None:
        cat, detalle = "neutro", ""
    else:
        cat, detalle = "sin_codigo", ""
    plantillas = cargar_plantillas()
    opciones = plantillas.get(cat) or PLANTILLAS_DEFECTO[cat]
    txt = random.choice(opciones)
    if nombre:
        txt = txt.replace("{nombre}", nombre)
    else:
        txt = txt.replace(", {nombre}", "").replace("{nombre}", "")
    txt = txt.replace("{detalle}", detalle)
    txt = re.sub(r"\s+([!?.,])", r"\1", txt)
    return re.sub(r"\s{2,}", " ", txt).strip()


def comentario_ia(paginas, task_id, student_id, codigo_alumno):
    """Pide el comentario al endpoint de IA interno de Kodland (experimental)."""
    r, _ = api_llamar_multi(paginas, "/ai_task_review/", "POST", {
        "task": task_id, "student": student_id,
        "student_solution": codigo_alumno or "", "is_student": False,
    })
    if r["status"] in (200, 201) and isinstance(r["cuerpo"], dict):
        c = _texto_plano(r["cuerpo"].get("ai_comment"))
        if c:
            return c, r["cuerpo"].get("ai_rating")
    return None, None


# ----- IA externa (Groq u otro endpoint OpenAI-compatible) para comentarios -----
#
# Config en ia_config.json (se crea solo). Por defecto apunta a Groq, que da una
# clave GRATIS en https://console.groq.com/keys. Sirve igual para Gemini o un
# modelo propio en Colab: solo cambia endpoint / api_key / modelo.

RUTA_IA_CONFIG = DIR_BASE / "ia_config.json"
IA_CONFIG_DEFECTO = {
    "_ayuda": "Consigue una clave GRATIS en https://console.groq.com/keys y pégala en api_key.",
    "endpoint": "https://api.groq.com/openai/v1/chat/completions",
    "api_key": "PEGA_AQUI_TU_CLAVE_DE_GROQ",
    "modelo": "llama-3.3-70b-versatile",
    "temperatura": 0.4,
}
_ia_config_cache = None


def cargar_ia_config():
    global _ia_config_cache
    if _ia_config_cache is not None:
        return _ia_config_cache
    try:
        if RUTA_IA_CONFIG.exists():
            _ia_config_cache = json.loads(RUTA_IA_CONFIG.read_text(encoding="utf-8"))
        else:
            RUTA_IA_CONFIG.write_text(
                json.dumps(IA_CONFIG_DEFECTO, ensure_ascii=False, indent=2), encoding="utf-8")
            _ia_config_cache = dict(IA_CONFIG_DEFECTO)
    except Exception:
        _ia_config_cache = dict(IA_CONFIG_DEFECTO)
    return _ia_config_cache


def ia_configurada(cfg=None):
    cfg = cfg or cargar_ia_config()
    clave = (cfg or {}).get("api_key") or ""
    return bool(clave) and "PEGA" not in clave.upper()


def _http_post_json(url, headers, payload, timeout=45):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": str(e)}
    except Exception as e:
        return -1, {"error": str(e)}


def _extraer_json(texto):
    """Extrae el primer objeto JSON de un texto (por si el modelo añade envoltura)."""
    if not texto:
        return None
    try:
        return json.loads(texto)
    except Exception:
        pass
    m = re.search(r"\{.*\}", texto, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def _llm_chat(cfg, system, user):
    """Manda system+user a un endpoint OpenAI-compatible; devuelve el texto o None."""
    headers = {}
    if cfg.get("api_key"):
        headers["Authorization"] = "Bearer " + cfg["api_key"]
    payload = {
        "model": cfg.get("modelo") or "llama-3.3-70b-versatile",
        "temperature": cfg.get("temperatura", 0.4),
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
    }
    status, cuerpo = _http_post_json(cfg.get("endpoint", ""), headers, payload)
    if status == 200 and isinstance(cuerpo, dict):
        try:
            return cuerpo["choices"][0]["message"]["content"]
        except Exception:
            return None
    detalle = ""
    if isinstance(cuerpo, dict):
        detalle = str(cuerpo.get("error") or cuerpo)[:140]
    log(f"      (la IA no respondió: status {status} {detalle})")
    return None


def nota_desde_fraccion(fraccion, maximo, minimo):
    """Convierte una fracción de calidad (0..1) en nota dentro de [minimo, maximo]."""
    if maximo is None or fraccion is None:
        return None
    maximo = int(maximo)
    if minimo is None:
        minimo = round(maximo * 0.4)
    minimo = int(min(minimo, maximo))
    fraccion = max(0.0, min(1.0, float(fraccion)))
    return int(round(minimo + fraccion * (maximo - minimo)))


def construir_prompt_ia(enunciado, solucion, codigo, nombre):
    system = ("Eres un profesor de programación de Kodland: cálido, motivador y cercano. "
              "Revisas tareas de Python de adolescentes (13-17 años) y respondes en español "
              "latinoamericano neutro. Devuelves SIEMPRE un único objeto JSON válido, sin texto extra.")
    user = f"""ENUNCIADO DE LA TAREA:
{(enunciado or '(sin enunciado)')[:2500]}

SOLUCIÓN ESPERADA (referencia del profesor):
{(solucion or '(no hay solución de referencia)')[:2500]}

CÓDIGO ENVIADO POR {nombre.upper()}:
{(codigo or '(el estudiante no envió código)')[:2500]}

Evalúa el código del estudiante comparándolo con el enunciado y la solución esperada.
Fíjate en si REALMENTE resuelve lo que pide la tarea (errores de lógica, condiciones mal
puestas, textos equivocados), no solo en la sintaxis. El código pudo perder el formato al
copiarse, así que NO penalices la indentación ni los espacios.

Responde SOLO con este JSON:
{{
  "correcto": true,
  "errores": [],
  "comentario": "comentario cálido y personalizado para {nombre}, de 2 a 4 frases, en español, que mencione algo específico de SU código; si hay errores, explícalos con amabilidad y una pista para corregir (sin dar la solución completa); incluye 1 o 2 emojis",
  "fraccion": 1.0
}}
- "correcto": true si cumple lo que pide la tarea, false si no.
- "errores": lista breve de problemas concretos (vacía si está bien).
- "fraccion": número entre 0 y 1 según qué tan correcta y completa está (1 = perfecta)."""
    return system, user


def comentario_llm(enunciado, solucion, codigo, quien):
    """Comentario personalizado + evaluación con un LLM externo.

    Devuelve {comentario, fraccion, correcto, errores} o None si no disponible.
    """
    cfg = cargar_ia_config()
    if not ia_configurada(cfg):
        if not getattr(comentario_llm, "_avisado", False):
            comentario_llm._avisado = True
            log("      (IA sin configurar: pega tu clave en ia_config.json → por ahora uso plantillas)")
        return None
    nombre = quien.split()[0] if quien and not quien.startswith("(") else "el estudiante"
    system, user = construir_prompt_ia(enunciado, solucion, codigo, nombre)
    texto = _llm_chat(cfg, system, user)
    datos = _extraer_json(texto)
    if not datos or not datos.get("comentario"):
        return None
    com = _texto_plano(str(datos.get("comentario")))
    if not com:
        return None
    try:
        fr = max(0.0, min(1.0, float(datos.get("fraccion"))))
    except Exception:
        fr = None
    return {"comentario": com, "fraccion": fr,
            "correcto": datos.get("correcto"), "errores": datos.get("errores")}


def autotest_ia():
    """Prueba la conexión con la IA usando una tarea de ejemplo. No usa el navegador."""
    print()
    cfg = cargar_ia_config()
    print(f"Config: {RUTA_IA_CONFIG}")
    print(f"  endpoint: {cfg.get('endpoint')}")
    print(f"  modelo:   {cfg.get('modelo')}")
    if not ia_configurada(cfg):
        print("\n❌ Falta tu clave. Abre ia_config.json y pega tu clave de Groq")
        print("   (gratis en https://console.groq.com/keys) en 'api_key'.")
        return
    print("  clave:    ✔ configurada")
    print("\nEnviando una tarea de ejemplo a la IA…")
    res = comentario_llm(
        "Pide la edad al usuario e imprime si es mayor o menor de 18 años.",
        "edad = int(input('Edad: '))\nif edad >= 18:\n    print('Mayor')\nelse:\n    print('Menor')",
        "edad = int(input('Edad: '))\nif edad > 18:\n    print('Mayor')\nelse:\n    print('Menor')",
        "Sofía Ejemplo")
    if not res:
        print("\n❌ La IA no respondió. Revisa la clave, el modelo y tu conexión.")
        return
    print("\n✅ ¡La IA respondió correctamente!")
    print(f"   correcto: {res.get('correcto')}")
    print(f"   errores:  {res.get('errores')}")
    print(f"   fracción: {res.get('fraccion')}")
    print(f"   💬 comentario: {res.get('comentario')}")
    print("\nTodo listo. Ya puedes usar --comentar ia.")


def enviar_chat(paginas, conversacion, mensaje):
    r, _ = api_llamar_multi(paginas, "/chat_messages/", "POST",
                            {"to_conversation": conversacion, "message": mensaje})
    return r["status"] in (200, 201)


# --- entrega del comentario por el modal «Evalúe» (nota + comentario) ---
#
# Estructura real (leída de depuracion/*evalue_fallo.html, learn.kodland.org):
#   botón:  <button class="… button-evaluate"><span>Evalúe|Modifique</span></button>
#   modal:  .rate-modal  con  input.rate-modal-rating_input  (type=number),
#           textarea.rate-modal-comment_area  (placeholder "Deja un comentario"),
#           .rate-modal-buttons > button.kodland-btn--primary  («Evalúe») y
#           button.rate-modal-cancel («Cancelar»).
# El texto del botón de apertura cambia según la tarea (sin nota → «Evalúe»,
# ya calificada → «Modifique»), la clase button-evaluate es estable.

REX_EVALUE = re.compile(r"eval[úu]|modifi", re.I)
_dump_evalue_hecho = False


def _clicable_evalue(pagina, y_minima=None):
    """El control clicable con texto «Evalúe» (el más pequeño visible).

    Con y_minima: solo los que estén por debajo (botón de confirmar del modal).
    """
    cand = pagina.locator("button, [role='button'], a, input[type='submit']")
    mejor, area_mejor = None, 1e18
    for i in range(cand.count()):
        c = cand.nth(i)
        try:
            if not c.is_visible():
                continue
            if not REX_EVALUE.search(c.inner_text() or ""):
                continue
            b = c.bounding_box()
        except Exception:
            continue
        if not b:
            continue
        if y_minima is not None and b["y"] < y_minima:
            continue
        a = b["width"] * b["height"]
        if a < area_mejor:
            mejor, area_mejor = c, a
    return mejor


def _cuadro_comentario_modal(pagina):
    """El textarea del modal Evalúe (por placeholder tipo 'Deja un comentario')."""
    cand = pagina.locator("textarea, [contenteditable='true']")
    respaldo = None
    for i in range(cand.count()):
        c = cand.nth(i)
        try:
            if not c.is_visible():
                continue
            ph = (c.get_attribute("placeholder") or "") + " " + (c.get_attribute("aria-label") or "")
            if re.search(r"coment", ph, re.I):
                return c
            respaldo = c  # el último visible (los modales se pintan al final)
        except Exception:
            continue
    return respaldo


def _primero_visible(locator):
    try:
        for i in range(locator.count()):
            e = locator.nth(i)
            if e.is_visible():
                return e
    except Exception:
        pass
    return None


def pulsar_evalue(pagina, comentario, nota):
    """Abre el modal «Evalúe»/«Modifique», escribe la nota (si se conoce) y el
    comentario, y confirma. Lanza RuntimeError si algo no aparece."""
    boton = _primero_visible(pagina.locator("button.button-evaluate"))
    if not boton:
        boton = _clicable_evalue(pagina)  # respaldo por texto
    if not boton:
        raise RuntimeError("no encontré el botón «Evalúe/Modifique»")
    boton.click()

    # esperar el modal: primero el selector exacto, luego el genérico
    area = None
    for _ in range(12):
        time.sleep(0.5)
        area = _primero_visible(pagina.locator("textarea.rate-modal-comment_area"))
        if not area:
            area = _cuadro_comentario_modal(pagina)
        if area:
            break
    if not area:
        raise RuntimeError("no apareció el cuadro de comentario del modal Evalúe")
    caja = area.bounding_box() or {}

    # nota
    if nota is not None:
        entrada = _primero_visible(pagina.locator("input.rate-modal-rating_input"))
        if not entrada and caja:
            # respaldo: el input visible más cercano POR ENCIMA del comentario
            try:
                ins = pagina.locator("input:visible")
                mejor, dist = None, 1e9
                for i in range(ins.count()):
                    e = ins.nth(i)
                    try:
                        b = e.bounding_box()
                    except Exception:
                        continue
                    if not b or b["y"] >= caja["y"]:
                        continue
                    d = caja["y"] - b["y"]
                    if d < 400 and d < dist:
                        mejor, dist = e, d
                entrada = mejor
            except Exception:
                entrada = None
        if entrada:
            try:
                entrada.fill(str(int(nota)))
            except Exception:
                pass  # si no se puede, se respeta la nota que muestre el modal

    # escribir con teclas reales para que Vue registre el cambio
    try:
        area.click()
        area.fill("")
        area.press_sequentially(comentario, delay=8)
    except Exception:
        try:
            area.fill(comentario)
        except Exception:
            area.click()
            pagina.keyboard.type(comentario)
    try:
        if (area.input_value() or "").strip() != comentario.strip():
            area.fill(comentario)
    except Exception:
        pass

    confirmar = _primero_visible(
        pagina.locator(".rate-modal-buttons button.kodland-btn--primary"))
    if not confirmar:
        confirmar = _clicable_evalue(pagina, y_minima=(caja.get("y", 0) + caja.get("height", 0) - 10))
    if not confirmar:
        pagina.keyboard.press("Escape")
        raise RuntimeError("no encontré el botón de confirmar del modal Evalúe")

    def _modal_cerrado():
        try:
            return not area.is_visible()
        except Exception:
            return True  # desmontado = cerrado

    confirmar.click()
    cerrado = False
    for _ in range(6):
        time.sleep(0.7)
        if _modal_cerrado():
            cerrado = True
            break
    if not cerrado:
        try:
            confirmar.click(force=True)
        except Exception:
            pass
        for _ in range(4):
            time.sleep(0.7)
            if _modal_cerrado():
                cerrado = True
                break
    if not cerrado:
        pagina.keyboard.press("Escape")
        raise RuntimeError("el modal Evalúe no se cerró tras confirmar")
    return True


def verificar_comentario_guardado(paginas, student_id, task_id, comentario):
    """Comprueba contra la API si el comentario quedó guardado en el progreso.

    Devuelve (True/False/None, detalle). None = no se pudo verificar.
    """
    time.sleep(1.5)
    r, _ = api_llamar_multi(paginas, f"/students/{student_id}/get_progress_by_task/{task_id}/")
    if r["status"] == 200 and isinstance(r["cuerpo"], dict):
        guardado = _texto_plano(r["cuerpo"].get("comment")) or ""
        firma = comentario.strip()[:40].lower()
        if firma and firma in guardado.lower():
            return True, "el campo comment de la API coincide"
        return False, f"la API devuelve comment={guardado[:80]!r}"
    return None, f"no pude consultar (status {r.get('status')})"


def _volcar_estudio_comentario(datos):
    """Guarda una radiografía (una por ejecución) para poder afinar el sistema."""
    global _dump_comentario_hecho
    if _dump_comentario_hecho:
        return
    _dump_comentario_hecho = True
    try:
        DIR_DEBUG.mkdir(parents=True, exist_ok=True)
        marca = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        ruta = DIR_DEBUG / f"comentario_estudio_{marca}.json"
        ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2, default=str),
                        encoding="utf-8")
        log(f"      (radiografía del comentario guardada en {ruta.name})")
    except Exception:
        pass


# libro local de comentarios ya enviados (evita duplicados entre ejecuciones)
RUTA_COMENTADAS = DIR_REGISTROS / "comentarios_enviados.txt"
_comentadas_cache = None


def _ledger_cargar():
    global _comentadas_cache
    if _comentadas_cache is None:
        try:
            _comentadas_cache = set(RUTA_COMENTADAS.read_text(encoding="utf-8").split())
        except Exception:
            _comentadas_cache = set()
    return _comentadas_cache


def _ledger_agregar(clave):
    _ledger_cargar().add(clave)
    try:
        DIR_REGISTROS.mkdir(parents=True, exist_ok=True)
        with open(RUTA_COMENTADAS, "a", encoding="utf-8") as fh:
            fh.write(clave + "\n")
    except Exception:
        pass


def comentar_tarea(pagina, quien, args, registro, grupo, etiqueta, ficha=None):
    """Genera y (si procede) envía el comentario de la tarea recién calificada.

    Nunca lanza excepciones: cualquier problema se registra y se continúa.
    """
    global _dump_evalue_hecho
    try:
        paginas = [pagina, PAGINA_PRINCIPAL]
        consultas = []
        pj = {}
        task_id = student_id = None

        prog = _json_capturado("progreso")
        if prog:
            student_id, task_id = prog["student"], prog["task"]
            pj = prog["json"] or {}
        else:
            # la URL de learn.kodland.org trae los ids: /task/<tarea>/check/<id>
            m = REX_URL_CHECK.search(pagina.url)
            if m:
                task_id, id2 = int(m.group(1)), int(m.group(2))
                r, li = api_llamar_multi(paginas, f"/progress/{id2}/")
                consultas += li
                cuerpo = r.get("cuerpo")
                if r["status"] == 200 and isinstance(cuerpo, dict) and cuerpo.get("task") == task_id:
                    pj = cuerpo
                    student_id = pj.get("student")
                else:
                    r, li = api_llamar_multi(paginas, f"/students/{id2}/get_progress_by_task/{task_id}/")
                    consultas += li
                    cuerpo = r.get("cuerpo")
                    if r["status"] == 200 and isinstance(cuerpo, dict):
                        pj = cuerpo
                        student_id = cuerpo.get("student") or id2

        if not pj or task_id is None:
            log("      (comentario omitido: no pude obtener los datos de la tarea)")
            _volcar_estudio_comentario({
                "motivo": "sin_datos", "url": pagina.url, "consultas": consultas,
                "auth_capturada": bool(CAPTURA_API.get("auth")),
                "ultimas_llamadas_api": list(CAPTURA_API.get("urls", []))[-30:],
            })
            return

        codigo_alumno = _texto_plano(pj.get("solution"))
        conversacion = pj.get("conversation_node")

        def _enunciado(d):
            return _texto_plano(d.get("unescaped_text_of_task") or d.get("text_of_task"))

        solucion = None
        enunciado = None
        max_grade_api = None
        min_grade_api = None
        cap_tarea = _json_capturado("tarea")
        if cap_tarea and cap_tarea.get("task") == task_id:
            tj = cap_tarea["json"] or {}
            solucion = _texto_plano(tj.get("solution"))
            enunciado = _enunciado(tj)
            max_grade_api = tj.get("max_grade")
            min_grade_api = tj.get("min_grade")
        # con IA siempre necesitamos el enunciado; sin ella basta solución+máximo
        necesita_tarea = (solucion is None or max_grade_api is None
                          or (args.comentar == "ia" and enunciado is None))
        if necesita_tarea:
            r, li = api_llamar_multi(paginas, f"/tasks/{task_id}/")
            consultas += li
            if r["status"] == 200 and isinstance(r["cuerpo"], dict):
                if solucion is None:
                    solucion = _texto_plano(r["cuerpo"].get("solution"))
                if enunciado is None:
                    enunciado = _enunciado(r["cuerpo"])
                max_grade_api = r["cuerpo"].get("max_grade")
                min_grade_api = r["cuerpo"].get("min_grade")

        # un solo análisis del código para nota y comentario (coherentes entre sí)
        det_codigo = analizar_codigo(codigo_alumno, solucion)

        # la IA puede sugerir la fracción de nota (calidad real, 0..1)
        origen = "plantillas"
        comentario = None
        fraccion_ia = None
        ia_eval = None
        if args.comentar == "ia":
            res = comentario_llm(enunciado, solucion, codigo_alumno, quien)
            if res and res.get("comentario"):
                comentario = res["comentario"]
                fraccion_ia = res.get("fraccion")
                ia_eval = {"correcto": res.get("correcto"), "errores": res.get("errores")}
                origen = "ia"
        if not comentario:
            comentario = comentario_local(quien, codigo_alumno, solucion, det_codigo)

        # máximo de la tarea (de la ficha "0/40" o de la API)
        maximo = max_grade_api
        if maximo is None and ficha:
            m = re.match(r"\s*\d+\s*/\s*(\d+)", ficha.get("texto") or "")
            if m:
                maximo = int(m.group(1))

        # nota que quedará: revisada → conserva la suya; pendiente → según calidad
        nota_final, motivo_nota = None, ""
        es_revisada = bool(ficha and ficha.get("estado") == "revisada")
        try:
            if es_revisada:
                nota_final = pj.get("grade")
                if nota_final is None and ficha:
                    m = re.match(r"\s*(\d+)\s*/", ficha.get("texto") or "")
                    if m:
                        nota_final = int(m.group(1))
                motivo_nota = "tarea ya calificada: se conserva su nota"
            elif fraccion_ia is not None and maximo is not None:
                # la IA evaluó la correctitud real → su fracción define la nota
                nota_final = nota_desde_fraccion(fraccion_ia, maximo, min_grade_api)
                motivo_nota = f"evaluada por IA (calidad {round(float(fraccion_ia) * 100)}%)"
            else:
                nota_final, motivo_nota = calcular_nota(det_codigo, maximo, min_grade_api)
        except Exception as e:
            nota_final, motivo_nota = (maximo if not es_revisada else None), f"nota por defecto ({e})"

        progress_id = pj.get("progress_id") or pj.get("id")

        enviado = "no (modo prueba)"
        clave_envio = f"{task_id}:{student_id}"
        if args.enviar_comentarios and comentario:
            if nota_final is None:
                # la plataforma no guarda comentario sin calificación: mejor no intentarlo
                enviado = "omitido (no pude determinar la nota, y sin nota el comentario no se guarda)"
            elif clave_envio in _ledger_cargar():
                enviado = "omitido (ya se comentó antes)"
            else:
                exito = False
                # 1) directo por la API v1 (lo mismo que hace el modal al confirmar)
                if progress_id and nota_final is not None:
                    r, li = api_llamar_multi(
                        paginas, f"/grade/{int(progress_id)}/", "PUT",
                        {"grade": int(nota_final), "comment": comentario},
                        bases=[API_BASE_V1])
                    consultas += li
                    if r["status"] in (200, 201, 204):
                        verif, det_verif = verificar_comentario_guardado(
                            paginas, student_id, task_id, comentario)
                        if verif:
                            enviado = "sí (API, verificado)"
                            exito = True
                        elif verif is None:
                            enviado = f"sí (API; {det_verif})"
                            exito = True
                # 2) respaldo: el modal «Evalúe»/«Modifique» de la página
                if not exito:
                    try:
                        pulsar_evalue(pagina, comentario, nota_final)
                        verif, det_verif = verificar_comentario_guardado(
                            paginas, student_id, task_id, comentario)
                        if verif is False:
                            raise RuntimeError(
                                f"el modal se cerró pero el comentario NO quedó guardado; {det_verif}")
                        if verif:
                            enviado = "sí (modal Evalúe, verificado)"
                        else:
                            enviado = f"sí (modal Evalúe; {det_verif})"
                        exito = True
                    except Exception as e_modal:
                        if not _dump_evalue_hecho:
                            _dump_evalue_hecho = True
                            dump_debug(pagina, "evalue_fallo")
                        if conversacion and enviar_chat(paginas, conversacion, comentario):
                            enviado = "sí (chat, respaldo)"
                            exito = True
                        else:
                            enviado = f"FALLÓ ({str(e_modal)[:70]})"
                if exito and enviado.startswith("sí"):
                    _ledger_agregar(clave_envio)

        if maximo is not None and nota_final is not None:
            marca = "" if es_revisada else "  (esta es la nota que se pondría)"
            log(f"      📊 nota {int(nota_final)}/{int(maximo)} — {motivo_nota}{marca}")
        if ia_eval and ia_eval.get("errores"):
            errs = [str(e) for e in ia_eval["errores"] if e][:3]
            if errs:
                log(f"      🔎 IA detectó: {'; '.join(errs)}")
        log(f"      💬 [{origen}] {comentario[:110]}{'…' if len(comentario) > 110 else ''}")
        log(f"         → enviado: {enviado}")
        registro.escribir(grupo["codigo"], etiqueta, quien, "",
                          (f"{int(nota_final)}/{int(maximo)}" if nota_final is not None and maximo else ""),
                          f"comentario ({origen})", f"[{enviado}] {motivo_nota} | {comentario}")
        # bitácora detallada por tarea (código y solución incluidos) para auditar
        try:
            DIR_REGISTROS.mkdir(parents=True, exist_ok=True)
            with open(DIR_REGISTROS / "comentarios_detalle.jsonl", "a", encoding="utf-8") as fh:
                fh.write(json.dumps({
                    "hora": dt.datetime.now().isoformat(timespec="seconds"),
                    "grupo": grupo["codigo"], "leccion": etiqueta[:50], "alumno": quien,
                    "task_id": task_id, "student_id": student_id,
                    "estado": (ficha or {}).get("estado"),
                    "nota": nota_final, "maximo": maximo, "motivo_nota": motivo_nota,
                    "origen": origen, "ia_eval": ia_eval,
                    "similitud": det_codigo.get("similitud"),
                    "error_sintaxis": det_codigo.get("error_sintaxis"),
                    "incompleto": det_codigo.get("incompleto"),
                    "enviado": enviado, "comentario": comentario,
                    "codigo": (codigo_alumno or "")[:400],
                    "solucion": (solucion or "")[:400],
                }, ensure_ascii=False, default=str) + "\n")
        except Exception:
            pass
        _volcar_estudio_comentario({
            "motivo": "ok", "url": pagina.url, "consultas": consultas,
            "task_id": task_id, "student_id": student_id,
            "progress_id": progress_id,
            "conversation_node": conversacion,
            "auth_capturada": bool(CAPTURA_API.get("auth")),
            "codigo_alumno_recorte": (codigo_alumno or "")[:600],
            "solucion_recorte": (solucion or "")[:600],
            "origen": origen, "comentario": comentario, "enviado": enviado,
            "nota_final": nota_final, "maximo": maximo, "minimo": min_grade_api,
            "motivo_nota": motivo_nota,
            "analisis": {k: det_codigo.get(k) for k in
                         ("similitud", "error_sintaxis", "incompleto", "es_python", "sol_es_python")},
            "estado_ficha": (ficha or {}).get("estado"),
            "puntos_ficha": (ficha or {}).get("texto"),
            "ultimas_llamadas_api": list(CAPTURA_API.get("urls", []))[-30:],
        })
    except Exception as e:
        log(f"      (comentario omitido por error: {e})")


def abrir_y_comentar(ctx, page, ficha, url_leccion_restore, comentador):
    """Abre una ficha SIN calificarla, ejecuta el comentador y vuelve.

    Para tareas ya revisadas (verdes) o para el modo de prueba.
    Devuelve True si hay que re-detectar la página del grupo.
    """
    CAPTURA_API["progreso"] = None
    CAPTURA_API["tarea"] = None
    selector = f"[data-kbot='{ficha['kbot']}']"
    url_antes = page.url
    popup = None
    try:
        with ctx.expect_page(timeout=5000) as info:
            page.locator(selector).first.click()
        popup = info.value
    except PWTimeout:
        popup = None

    if popup is not None:
        try:
            time.sleep(4)  # dejar que la página de la tarea llame a su API
            comentador(popup)
            return False
        finally:
            try:
                popup.close()
            except Exception:
                pass

    time.sleep(2.5)
    if page.url != url_antes:
        try:
            time.sleep(2)
            comentador(page)
        finally:
            url_leccion_restore()
        return True

    raise RuntimeError("al pulsar la ficha no se abrió la página de la tarea")


def calificar_ficha(ctx, page, ficha, url_leccion_restore, comentador=None):
    """Pulsa una ficha pendiente, califica y deja la página de grupo lista.

    Si se pasa `comentador`, se invoca con la página de la tarea aún abierta
    (después de calificar) para generar/enviar el comentario.
    Devuelve (resultado, necesita_redeteccion).
    """
    CAPTURA_API["progreso"] = None
    CAPTURA_API["tarea"] = None
    selector = f"[data-kbot='{ficha['kbot']}']"
    url_antes = page.url
    popup = None
    try:
        with ctx.expect_page(timeout=5000) as info:
            page.locator(selector).first.click()
        popup = info.value
    except PWTimeout:
        popup = None

    if popup is not None:
        try:
            verificado = pulsar_nota_max(popup, ficha)
            if comentador:
                comentador(popup)
            return ("calificada" if verificado else "calificada_sin_verificar"), False
        finally:
            try:
                popup.close()
            except Exception:
                pass

    # sin popup: ¿navegó la misma pestaña?
    time.sleep(2.5)
    if page.url != url_antes:
        try:
            verificado = pulsar_nota_max(page, ficha)
            resultado = "calificada" if verificado else "calificada_sin_verificar"
            if comentador:
                comentador(page)
        finally:
            url_leccion_restore()
        return resultado, True

    # ¿se abrió un modal en la misma página?
    try:
        loc = page.get_by_text(REX_NOTA_MAX)
        loc.first.wait_for(state="visible", timeout=5000)
        verificado = pulsar_nota_max(page, ficha)
        if comentador:
            comentador(page)
        page.keyboard.press("Escape")
        time.sleep(1)
        url_leccion_restore()
        return ("calificada" if verificado else "calificada_sin_verificar"), True
    except Exception:
        pass

    raise RuntimeError("al pulsar la ficha no se abrió ninguna página de calificación")


# ------------------------------ por grupo ------------------------------

_dump_sin_nombre_hecho = False  # un solo volcado por ejecución si faltan nombres


def procesar_grupo(ctx, page, grupo, args, registro):
    global _dump_sin_nombre_hecho
    stats = {"calificadas": 0, "errores": 0, "pendientes_detectadas": 0}
    url_tab = grupo["url"] + "?tab=3"
    page.goto(url_tab, wait_until="domcontentloaded")
    time.sleep(2.5)

    modo, lecciones = obtener_lecciones(page)
    if modo is None:
        log("   ⚠ No encontré el desplegable de lecciones (guardo depuración).")
        dump_debug(page, f"sin_desplegable_{grupo['codigo']}")
        stats["errores"] += 1
        return stats
    if not lecciones:
        log("   (el desplegable no tiene lecciones — nada que revisar en este grupo)")
        return stats

    # hasta qué lección revisar
    objetivo = (grupo["mod"], grupo["lec"])
    limite = None
    for i, etq in enumerate(lecciones):
        if codigo_leccion(etq) == objetivo:
            limite = i
            break
    if args.todas_las_lecciones or limite is None:
        indices = range(len(lecciones))
        if limite is None and not args.todas_las_lecciones:
            log(f"   ⚠ No ubiqué la lección actual {objetivo} en el desplegable; reviso todas ({len(lecciones)}).")
    else:
        indices = range(limite + 1)

    if args.leccion:
        solo = codigo_leccion(args.leccion)
        indices = [i for i in indices if i < len(lecciones) and codigo_leccion(lecciones[i]) == solo]
        if not indices:
            log(f"   (la lección {args.leccion} no está en el rango de este grupo; "
                f"añade --todas-las-lecciones si es futura)")

    estados_objetivo = set(ESTADOS_PENDIENTES)
    if args.comentar and getattr(args, "comentar_tambien_revisadas", False):
        estados_objetivo.add("revisada")

    lecciones_muertas = 0
    for i in indices:
        etiqueta = lecciones[i] if i < len(lecciones) else f"lección {i + 1}"
        if not seleccionar_leccion(page, modo, i):
            log(f"   ⚠ No pude seleccionar «{etiqueta}»")
            stats["errores"] += 1
            continue

        def restaurar(idx=i):
            page.goto(url_tab, wait_until="domcontentloaded")
            time.sleep(2)
            seleccionar_leccion(page, modo, idx)

        procesadas = set()
        avisado_leyenda = False
        con_senal = False
        primera_pasada = True
        while True:
            datos = analizar_fichas(page)
            if primera_pasada:
                primera_pasada = False
                # ¿hay señales de vida en esta lección? (entregas o notas)
                if any(f["estado"] in ("revisada", "por_revisar", "tarde") for f in datos["fichas"]):
                    con_senal = True
            if len(datos["leyenda"]) < 4 and not avisado_leyenda and datos["fichas"]:
                log("   (aviso: no leí la leyenda completa; clasifico por tono de color)")
                avisado_leyenda = True
            if (not _dump_sin_nombre_hecho and datos["fichas"]
                    and any(not f.get("alumno") for f in datos["fichas"])):
                _dump_sin_nombre_hecho = True
                dump_debug(page, f"alumnos_sin_nombre_{grupo['codigo']}")
            pendientes = [
                f for f in datos["fichas"]
                if f["estado"] in estados_objetivo
                and (f.get("alumno") or f"y{round(f['y'] / 40)}", f.get("tarea"), ) not in procesadas
            ]
            if not pendientes:
                break
            if args.dry_run:
                # en simulación nada cambia en la página: listamos todo de una vez
                for f in pendientes:
                    clave = (f.get("alumno") or f"y{round(f['y'] / 40)}", f.get("tarea"))
                    procesadas.add(clave)
                    stats["pendientes_detectadas"] += 1
                    quien = f.get("alumno") or "(alumno sin identificar)"
                    accion = "comentaría (ya revisada)" if f["estado"] == "revisada" else "calificaría"
                    log(f"   [simulación] {accion}: {quien} · {f.get('tarea') or '?'} · {f['texto']} · {f['estado']}")
                    registro.escribir(grupo["codigo"], etiqueta, quien, f.get("tarea"), f["texto"], "simulada", "")
                break

            f = pendientes[0]
            clave = (f.get("alumno") or f"y{round(f['y'] / 40)}", f.get("tarea"))
            procesadas.add(clave)
            stats["pendientes_detectadas"] += 1
            quien = f.get("alumno") or "(alumno sin identificar)"
            desc = f"{quien} · {f.get('tarea') or '?'} · {f['texto']} · {f['estado']}"

            try:
                if args.comentar:
                    # nota (conservadora) + comentario se guardan juntos por API;
                    # NO se usa el botón «Nota Max.» (lo sobrescribiría)
                    comentador = (lambda pagina_tarea, _q=quien, _f=f: comentar_tarea(
                        pagina_tarea, _q, args, registro, grupo, etiqueta, _f))
                    log(f"   • {desc}")
                    abrir_y_comentar(ctx, page, f, restaurar, comentador)
                    if f["estado"] != "revisada" and args.enviar_comentarios:
                        stats["calificadas"] += 1
                else:
                    # modo clásico: pulsar «Nota Max.» (siempre la máxima)
                    resultado, redetectar = calificar_ficha(ctx, page, f, restaurar, None)
                    stats["calificadas"] += 1
                    log(f"   ✔ {desc} → {resultado}")
                    registro.escribir(grupo["codigo"], etiqueta, quien, f.get("tarea"), f["texto"], resultado, "")
            except Exception as e:
                stats["errores"] += 1
                log(f"   ✘ {desc} → error: {e}")
                registro.escribir(grupo["codigo"], etiqueta, quien, f.get("tarea"), f["texto"], "error", str(e)[:200])
                dump_debug(page, f"error_{grupo['codigo']}_{etiqueta[:12]}")
                try:
                    restaurar()
                except Exception:
                    break
            time.sleep(0.6)

        if con_senal:
            lecciones_muertas = 0
        else:
            lecciones_muertas += 1
            if lecciones_muertas >= 3:
                log("   (3 lecciones seguidas sin entregas ni notas: fin del grupo)")
                break
    return stats


# --------------------------------- registro ---------------------------------

class Registro:
    def __init__(self, dry_run):
        DIR_REGISTROS.mkdir(parents=True, exist_ok=True)
        marca = dt.datetime.now().strftime("%Y%m%d_%H%M")
        sufijo = "_simulacion" if dry_run else ""
        self.ruta = DIR_REGISTROS / f"calificaciones_{marca}{sufijo}.csv"
        self._f = open(self.ruta, "w", newline="", encoding="utf-8-sig")
        self._w = csv.writer(self._f, delimiter=";")
        self._w.writerow(["fecha_hora", "grupo", "leccion", "alumno", "tarea", "puntos_antes", "resultado", "detalle"])

    def escribir(self, *campos):
        self._w.writerow([dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *campos])
        self._f.flush()

    def cerrar(self):
        try:
            self._f.close()
        except Exception:
            pass


# ------------------------- prueba de comentario -------------------------

def probar_comentario(ctx, page, elegidos, args, registro):
    """Abre N tareas SIN calificar (amarillas/naranjas) y genera sus comentarios.
    No pulsa «Nota Max.»; no envía salvo --enviar-comentarios."""
    if not args.comentar:
        args.comentar = "plantillas"
    objetivo_n = max(1, int(args.probar_comentario or 1))
    # por defecto solo tareas pendientes (amarillas/naranjas); las verdes
    # (ya calificadas) solo si se pide explícitamente
    acepta = set(ESTADOS_PENDIENTES)
    if getattr(args, "comentar_tambien_revisadas", False):
        acepta.add("revisada")
    tipos = "amarillas/naranjas" + (" y verdes" if "revisada" in acepta else "")
    log(f"PRUEBA DE COMENTARIO: buscaré {objetivo_n} tarea(s) {tipos}.")
    if not args.enviar_comentarios:
        log("(sin --enviar-comentarios: los comentarios solo se mostrarán)")
    hechas = 0

    for grupo in elegidos:
        log(f"Buscando en {grupo['codigo']}…")
        url_tab = grupo["url"] + "?tab=3"
        page.goto(url_tab, wait_until="domcontentloaded")
        time.sleep(2.5)
        modo, lecciones = obtener_lecciones(page)
        if not modo or not lecciones:
            continue
        objetivo = (grupo["mod"], grupo["lec"])
        limite = None
        for j, etq in enumerate(lecciones):
            if codigo_leccion(etq) == objetivo:
                limite = j
                break
        indices = list(range((limite + 1) if limite is not None else len(lecciones)))
        indices.reverse()  # la lección más reciente suele tener entregas frescas
        if args.leccion:
            solo = codigo_leccion(args.leccion)
            indices = [i for i in indices if i < len(lecciones) and codigo_leccion(lecciones[i]) == solo]

        for i in indices:
            if not seleccionar_leccion(page, modo, i):
                continue
            etiqueta = lecciones[i] if i < len(lecciones) else f"lección {i + 1}"

            def restaurar(idx=i):
                page.goto(url_tab, wait_until="domcontentloaded")
                time.sleep(2)
                seleccionar_leccion(page, modo, idx)

            vistas = set()
            while hechas < objetivo_n:
                datos = analizar_fichas(page)
                cand = [
                    f for f in datos["fichas"]
                    if f["estado"] in acepta
                    and (f.get("alumno") or f"y{round(f['y'] / 40)}", f.get("tarea")) not in vistas
                ]
                if not cand:
                    break
                f = cand[0]
                vistas.add((f.get("alumno") or f"y{round(f['y'] / 40)}", f.get("tarea")))
                quien = f.get("alumno") or "(alumno sin identificar)"
                log(f"   [{hechas + 1}/{objetivo_n}] {quien} · {f.get('tarea')} · {f['texto']} · {f['estado']}")
                try:
                    abrir_y_comentar(ctx, page, f, restaurar,
                                     lambda pt, _f=f, _q=quien: comentar_tarea(
                                         pt, _q, args, registro, grupo, etiqueta, _f))
                    hechas += 1
                except Exception as e:
                    log(f"   ⚠ No pude abrir esa tarea ({e}); pruebo con otra…")
            if hechas >= objetivo_n:
                log("Prueba terminada. Revisa arriba los comentarios y la radiografía en 'depuracion'.")
                return
    if hechas:
        log(f"Prueba terminada: solo encontré {hechas} tarea(s) con entrega.")
    else:
        log("No encontré ninguna tarea con entrega para probar. Prueba con --todas-las-lecciones.")


# -------------------------------- diagnóstico --------------------------------

def modo_diagnostico(page):
    """No califica nada: recopila capturas, HTML y datos de detección clave."""
    log("MODO DIAGNÓSTICO: guardaré capturas y HTML en la carpeta 'depuracion'.")
    dump_debug(page, "diag_1_panel_inicial")

    if ampliar_paginador(page):
        log("Paginador: ajustado al máximo.")
    else:
        log("Paginador: NO se pudo ajustar.")
    time.sleep(2)
    dump_debug(page, "diag_2_panel_tras_paginador")

    info = page.evaluate(JS_RANGO)
    log(f"Etiqueta de rango del paginador: {info.get('rango')!r} (total: {info.get('total')})")

    grupos = page.evaluate(JS_GRUPOS)
    log(f"Grupos visibles en esta página: {len(grupos)}")
    for g in grupos[:8]:
        cod = f"M{g['mod']}L{g['lec']}" if g["mod"] else "—"
        log(f"   · {g['codigo']}: lección={cod} activo={g['activo']} fila={g['texto'][:70]!r}")

    con_leccion = [g for g in grupos if g["mod"] is not None]
    objetivo = (con_leccion or grupos)[-1] if grupos else None
    if not objetivo:
        log("No hay grupos que abrir; fin del diagnóstico.")
        return

    log(f"Abriendo {objetivo['codigo']} en la pestaña Comprobar…")
    page.goto(objetivo["url"] + "?tab=3", wait_until="domcontentloaded")
    time.sleep(3.5)
    dump_debug(page, "diag_3_grupo_comprobar")

    modo, lecciones = obtener_lecciones(page)
    log(f"Desplegable de lecciones: modo={modo} opciones={len(lecciones)}")
    for etq in lecciones[:6]:
        log(f"   · {etq[:70]}")

    if modo and lecciones:
        seleccionar_leccion(page, modo, 0)
        datos = analizar_fichas(page)
        log(f"Leyenda detectada ({len(datos['leyenda'])}/5): {sorted(datos['leyenda'].keys())}")
        log(f"Fichas detectadas: {len(datos['fichas'])}")
        for f in datos["fichas"][:10]:
            log(f"   · {f.get('alumno')} | {f.get('tarea')} | {f['texto']} -> {f['estado']}")
        dump_debug(page, "diag_4_leccion_analizada")
    else:
        combo = _combo_lecciones(page)
        if combo:
            try:
                combo.click()
                time.sleep(1)
                dump_debug(page, "diag_4_combo_abierto")
                page.keyboard.press("Escape")
            except Exception:
                pass

    log("Diagnóstico terminado. Revisa la carpeta 'depuracion'.")


# ----------------------------------- main -----------------------------------

def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Calificador automático de tareas Kodland")
    ap.add_argument("--profesor-id", default="", help="tu ID de profesor (número de la URL de tu panel); "
                    "si no lo pasas, se lee de config.json")
    ap.add_argument("--dry-run", action="store_true", help="solo mostrar qué calificaría, sin tocar nada")
    ap.add_argument("--max-grupos", type=int, default=0, help="procesar como máximo N grupos")
    ap.add_argument("--grupo", default="", help="procesar solo grupos cuyo código contenga este texto")
    ap.add_argument("--omitir", default="", help="códigos (o partes) a excluir, separados por comas: --omitir COL12345,CHI678")
    ap.add_argument("--leccion", default="", help="procesar solo la lección con ese código (ej: --leccion M2L3)")
    ap.add_argument("--todas-las-lecciones", action="store_true", help="revisar todas las lecciones del desplegable")
    ap.add_argument("--incluir-no-activos", action="store_true", help="incluir grupos que no estén 'Activo'")
    ap.add_argument("--lento", action="store_true", help="modo lento (más pausas, útil para observar)")
    ap.add_argument("--diagnostico", action="store_true",
                    help="no califica: guarda capturas y HTML de las páginas clave en depuracion/")
    ap.add_argument("--comentar", choices=["plantillas", "ia"], default=None,
                    help="tras calificar cada tarea, generar un comentario: "
                         "'plantillas' (análisis local del código, sin internet) o "
                         "'ia' (IA externa configurable en ia_config.json — Groq gratis; "
                         "revisa el código de verdad y sugiere la nota). Si la IA falla, "
                         "cae a plantillas.")
    ap.add_argument("--enviar-comentarios", action="store_true",
                    help="dejar los comentarios de verdad (solo hace falta en "
                         "--probar-comentario; en el modo normal --comentar ya los deja)")
    ap.add_argument("--sin-enviar", action="store_true",
                    help="con --comentar: solo mostrar los comentarios, sin dejarlos en la plataforma")
    ap.add_argument("--probar-comentario", nargs="?", const=1, default=0, type=int, metavar="N",
                    help="abre N tareas ya entregadas (1 si no se indica), genera sus "
                         "comentarios y termina; no pulsa «Nota Max.»")
    ap.add_argument("--comentar-tambien-revisadas", action="store_true",
                    help="con --comentar: comentar también las tareas verdes ya calificadas "
                         "(las ya comentadas antes se omiten gracias al registro local)")
    ap.add_argument("--probar-ia", action="store_true",
                    help="prueba la conexión con la IA (ia_config.json) y termina; no abre el navegador")
    args = ap.parse_args()

    if args.probar_ia:
        autotest_ia()
        return

    # ID de profesor: --profesor-id gana sobre config.json
    cfg = cargar_config()
    profesor_id = str(args.profesor_id or cfg.get("profesor_id") or "").strip()
    if not profesor_id.isdigit():
        print("\n⚠ Falta tu ID de profesor.")
        print("  Es el número de la URL de tu panel: https://bo.kodland.org/teachers/<ID>")
        print("  Configúralo de una de estas formas:")
        print("   • copia 'config.example.json' a 'config.json' y pon tu ID, o")
        print("   • pásalo al ejecutar:  --profesor-id 123456")
        return
    global URL_PROFES
    URL_PROFES = f"{BASE}/teachers/{profesor_id}"

    # en el modo normal, --comentar deja los comentarios por defecto;
    # la vista previa queda para --sin-enviar y para --probar-comentario
    if args.comentar and not args.probar_comentario and not args.sin_enviar:
        args.enviar_comentarios = True
    if args.sin_enviar:
        args.enviar_comentarios = False

    print()
    print("──────────────────────────────────────────────────")
    print("  Calificador automático Kodland")
    if args.dry_run:
        print("  MODO SIMULACIÓN: no se calificará nada.")
    else:
        print("  Se pulsará «Nota Max.» en tareas amarillas/naranjas.")
    print("  Pulsa Ctrl+C para detener en cualquier momento.")
    print("──────────────────────────────────────────────────")
    print()

    DIR_PERFIL.mkdir(parents=True, exist_ok=True)
    registro = Registro(args.dry_run)
    inicio = time.time()
    total = {"grupos": 0, "calificadas": 0, "errores": 0, "pendientes": 0}

    with sync_playwright() as pw:
        ctx = None
        ultimo_error = None
        for canal in ("chrome", "msedge"):
            try:
                ctx = pw.chromium.launch_persistent_context(
                    str(DIR_PERFIL),
                    channel=canal,
                    headless=False,
                    no_viewport=True,
                    args=["--start-maximized"],
                    slow_mo=250 if args.lento else 0,
                )
                log(f"Navegador iniciado ({canal}). Perfil: {DIR_PERFIL}")
                break
            except Exception as e:
                ultimo_error = e
        if ctx is None:
            print(f"No pude iniciar Chrome ni Edge: {ultimo_error}")
            sys.exit(1)

        ctx.set_default_timeout(20000)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        # capturar las llamadas API de la propia web (datos para los comentarios)
        global PAGINA_PRINCIPAL
        PAGINA_PRINCIPAL = page
        instalar_captura(page)
        try:
            ctx.on("page", instalar_captura)
        except Exception:
            pass

        try:
            esperar_sesion(page)
            if args.diagnostico:
                modo_diagnostico(page)
                return
            log("Cargando la lista de grupos…")
            grupos = listar_grupos(page)
            log(f"Grupos encontrados: {len(grupos)}")

            elegidos, ilegibles = [], 0
            for g in grupos:
                if g["mod"] is None:
                    if len(g.get("texto") or "") < 25:
                        ilegibles += 1
                        log(f" · {g['codigo']}: no pude leer su fila → se omite")
                    else:
                        log(f" · {g['codigo']}: sin lección dada → se omite")
                    continue
                if not g["activo"] and not args.incluir_no_activos:
                    log(f" · {g['codigo']}: no está Activo → se omite")
                    continue
                if args.grupo and args.grupo.upper() not in g["codigo"].upper():
                    continue
                omitidos = [t.strip().upper() for t in args.omitir.split(",") if t.strip()]
                if any(t in g["codigo"].upper() for t in omitidos):
                    log(f" · {g['codigo']}: excluido con --omitir")
                    continue
                elegidos.append(g)
            if grupos and (ilegibles > len(grupos) / 2 or not elegidos):
                log("⚠ Casi nada quedó seleccionado; guardo depuración del panel por si hay que ajustar.")
                dump_debug(page, "panel_sin_seleccion")
            elegidos.reverse()  # primero los grupos más recientes (los del día a día)
            if args.max_grupos > 0:
                elegidos = elegidos[: args.max_grupos]

            log(f"Grupos a revisar: {len(elegidos)} (empezando por los más recientes)")
            print()

            if args.probar_comentario:
                probar_comentario(ctx, page, elegidos, args, registro)
                return

            for n, g in enumerate(elegidos, 1):
                log(f"[{n}/{len(elegidos)}] Grupo {g['codigo']} (lección actual M{g['mod']}L{g['lec']})")
                total["grupos"] += 1
                try:
                    stats = procesar_grupo(ctx, page, g, args, registro)
                    total["calificadas"] += stats["calificadas"]
                    total["errores"] += stats["errores"]
                    total["pendientes"] += stats["pendientes_detectadas"]
                    if stats["pendientes_detectadas"] == 0:
                        log("   (nada pendiente en este grupo)")
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    total["errores"] += 1
                    log(f"   ✘ Error en el grupo: {e}")
                    dump_debug(page, f"error_grupo_{g['codigo']}")
                    traceback.print_exc(limit=1)
        except KeyboardInterrupt:
            print()
            log("Detenido por el usuario (Ctrl+C).")
        finally:
            registro.cerrar()
            try:
                ctx.close()
            except Exception:
                pass

    dur = int(time.time() - inicio)
    print()
    print("────────────────── RESUMEN ──────────────────")
    print(f"  Grupos revisados:      {total['grupos']}")
    print(f"  Tareas pendientes:     {total['pendientes']}")
    if args.dry_run:
        print("  (simulación: no se calificó ninguna)")
    else:
        print(f"  Tareas calificadas:    {total['calificadas']}")
    print(f"  Errores:               {total['errores']}")
    print(f"  Duración:              {dur // 60} min {dur % 60} s")
    print(f"  Registro CSV:          {registro.ruta}")
    print("──────────────────────────────────────────────")


if __name__ == "__main__":
    main()
