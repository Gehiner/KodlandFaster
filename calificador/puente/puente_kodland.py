# -*- coding: utf-8 -*-
"""
Puente local (Native Messaging) entre la extensión de Chrome y el calificador.

Cómo funciona:
  Chrome lanza este script y se comunica con él por stdin/stdout usando el
    protocolo de Native Messaging (4 bytes de longitud + JSON UTF-8). Para las
    acciones existentes la extensión envía solo una etiqueta permitida. La acción
    de reporte envía datos tipados del alumno, nunca comandos ni rutas libres.

Seguridad:
  - Solo se ejecutan los .bat de ACCIONES (lista blanca fija). Nunca rutas ni
    comandos que vengan del mensaje.
    - El reporte solo puede cargar una plantilla local curso_<slug>.json dentro
        de reportes/.
  - En el manifest del host, "allowed_origins" limita QUÉ extensión puede hablar
    con este puente (por su ID). Lo configura el instalador.
  - Nada de esto usa internet: todo ocurre en tu computadora.
"""

import json
import os
import struct
import subprocess
import sys
import datetime
import math
import re
import glob
import tempfile
import uuid

PUENTE_DIR = os.path.dirname(os.path.abspath(__file__))
CALIFICADOR_DIR = os.path.dirname(PUENTE_DIR)   # aquí están los .bat
LOG = os.path.join(PUENTE_DIR, "puente.log")

# --- LISTA BLANCA: etiqueta -> archivo .bat a ejecutar (en CALIFICADOR_DIR) ---
ACCIONES = {
    "simular":            "1 - Probar (simulacion).bat",
    "calificar":          "2 - Calificar TODO.bat",
    "diagnostico":        "3 - Diagnostico (si algo falla).bat",
    "probar_comentarios": "4 - Probar comentarios (no envia).bat",
    "calificar_comentar": "5 - Calificar TODO y comentar.bat",
    "comentar_grupo":     "6 - Comentar UN grupo (envia).bat",
    "probar_ia":          "7 - Probar conexion IA.bat",
}

CREATE_NEW_CONSOLE = 0x00000010  # abre el .bat en su propia ventana visible


def log(texto):
    """Escribe en un archivo de log. NUNCA en stdout (ahí va el protocolo)."""
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(f"{datetime.datetime.now().isoformat(timespec='seconds')}  {texto}\n")
    except Exception:
        pass


def leer_mensaje():
    """Lee un mensaje del protocolo de Native Messaging. None si Chrome cerró."""
    encabezado = sys.stdin.buffer.read(4)
    if len(encabezado) < 4:
        return None
    largo = struct.unpack("=I", encabezado)[0]
    cuerpo = sys.stdin.buffer.read(largo)
    if len(cuerpo) < largo:
        return None
    try:
        return json.loads(cuerpo.decode("utf-8"))
    except Exception as e:
        log(f"mensaje ilegible: {e}")
        return {}


def enviar_mensaje(obj):
    """Envía una respuesta JSON usando el protocolo de Native Messaging."""
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def texto_seguro(value, max_length=300):
    if not isinstance(value, (str, int, float)):
        return ""
    return str(value).strip()[:max_length]


def numero_seguro(value, default=0, minimo=0, maximo=1000000):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return max(minimo, min(maximo, number))


def procesar_reporte_python(payload):
    """Genera un PDF individual con el renderer Python existente."""
    if not isinstance(payload, dict):
        return {"ok": False, "error": "Faltan los datos del reporte."}

    course_file = texto_seguro(payload.get("course_file"), 100)
    if not re.fullmatch(r"curso_[A-Za-z0-9_-]+\.json", course_file):
        return {"ok": False, "error": "La plantilla indicada no está permitida."}
    course_path = os.path.join(CALIFICADOR_DIR, "reportes", course_file)
    if not os.path.isfile(course_path) or course_path not in glob.glob(
            os.path.join(CALIFICADOR_DIR, "reportes", "curso_*.json")):
        return {"ok": False, "error": "No encontré la plantilla local del curso."}

    source = payload.get("student")
    if not isinstance(source, dict):
        return {"ok": False, "error": "Los datos del alumno no son válidos."}

    try:
        with open(course_path, "r", encoding="utf-8") as fh:
            course = json.load(fh)
        original_modules = course.get("modulos") or []
        if not isinstance(original_modules, list) or not original_modules:
            return {"ok": False, "error": "La plantilla no contiene módulos."}

        module_rows = source.get("modules")
        if not isinstance(module_rows, list) or not module_rows or len(module_rows) > 50:
            return {"ok": False, "error": "No hay módulos válidos para generar el reporte."}
        rows_by_number = {}
        for row in module_rows:
            if not isinstance(row, dict):
                continue
            try:
                number = int(row.get("numero"))
            except (TypeError, ValueError):
                continue
            rows_by_number[number] = row

        module_number = payload.get("module_number")
        if module_number is not None:
            try:
                module_number = int(module_number)
            except (TypeError, ValueError):
                return {"ok": False, "error": "El número de módulo no es válido."}
            original_modules = [m for m in original_modules if int(m.get("numero", 0)) == module_number]
            if not original_modules or module_number not in rows_by_number:
                return {"ok": False, "error": "El módulo seleccionado no está en este reporte."}
            course["modulos"] = original_modules
            module = original_modules[0]
            module_row = rows_by_number[module_number]
            student_name = texto_seguro(source.get("alumno"), 200) or "Alumno"
            course["vision_general"] = (
                f"En el módulo {module_number}, {{alumno}} trabajó {texto_seguro(module.get('titulo'), 200)}. "
                f"El aprovechamiento registrado fue {numero_seguro(module_row.get('pct')):.0f}%."
            )
            course["consideraciones"] = (
                f"Durante el módulo {module_number}, {{alumno}} trabajó los aprendizajes descritos "
                "en este informe y desarrolló el proyecto correspondiente."
            )
            course["competencias"] = [texto_seguro(item, 300) for item in module.get("aprendizajes", [])]
            course["proximo_paso"] = {
                "titulo": f"Continuar con el módulo {module_number + 1}",
                "texto": f"Consolidar lo aprendido en el módulo {module_number} y continuar con el siguiente proyecto del curso."
            }
            module_rows = [module_row]
            source["datos"] = dict(source.get("datos")) if isinstance(source.get("datos"), dict) else {}
            source["datos"]["modulo_informe"] = f"M{module_number}"
        else:
            course["modulos"] = [
                module for module in original_modules
                if int(module.get("numero", 0)) in rows_by_number
            ]

        modules = course["modulos"]
        pct = []
        points = []
        tasks = []
        attendance_sessions = []
        for module in modules:
            row = rows_by_number.get(int(module.get("numero", 0)), {})
            pct.append(numero_seguro(row.get("pct"), maximo=100))
            points.append((numero_seguro(row.get("points")), numero_seguro(row.get("maxPoints"))))
            tasks.append((int(numero_seguro(row.get("tasksSent"))), int(numero_seguro(row.get("tasksTotal")))))
            attendance = row.get("attendance") if isinstance(row.get("attendance"), dict) else {}
            sessions = attendance.get("sessions") or []
            if isinstance(sessions, list):
                for session in sessions[:100]:
                    if not isinstance(session, dict):
                        continue
                    status = session.get("status")
                    if status not in ("present", "absent", "justified"):
                        continue
                    attendance_sessions.append({
                        "fecha": texto_seguro(session.get("label"), 80),
                        "estado": {"present": "presente", "absent": "ausente", "justified": "justificada"}[status]
                    })

        attendance = source.get("attendance") if isinstance(source.get("attendance"), dict) else {}
        if module_number is None:
            sessions = attendance.get("sessions") or []
            attendance_sessions = []
            if isinstance(sessions, list):
                for session in sessions[:300]:
                    if not isinstance(session, dict):
                        continue
                    status = session.get("status")
                    if status not in ("present", "absent", "justified"):
                        continue
                    attendance_sessions.append({
                        "fecha": texto_seguro(session.get("label"), 80),
                        "estado": {"present": "presente", "absent": "ausente", "justified": "justificada"}[status]
                    })

        pupil_data = source.get("datos") if isinstance(source.get("datos"), dict) else {}
        pupil = {
            "alumno": texto_seguro(source.get("alumno"), 200) or "Alumno",
            "profesor": texto_seguro(source.get("profesor"), 200),
            "pct": pct,
            "puntos": points,
            "tareas": tasks,
            "asistencia": {
                "asistidas": sum(1 for item in attendance_sessions if item["estado"] == "presente"),
                "total": len(attendance_sessions),
                "sesiones": attendance_sessions
            },
            "datos": {
                key: texto_seguro(pupil_data.get(key), 300)
                for key in ("acudiente", "email", "telefono", "pais", "codigo_grupo", "tipo_grupo", "dia_hora", "modulo_informe")
            }
        }
        group_code = re.sub(r"[^A-Za-z0-9_-]+", "_", texto_seguro(pupil["datos"].get("codigo_grupo"), 100)) or "grupo"
        output_dir = os.path.join(CALIFICADOR_DIR, "reportes", "salida", "desde_modal_python", group_code)
        sys.path.insert(0, CALIFICADOR_DIR)
        import generar_reporte
        pdf_path = generar_reporte.generar(course, pupil, output_dir)
        opened = False
        try:
            os.startfile(pdf_path)
            opened = True
        except (AttributeError, OSError) as error:
            log(f"PDF generado; no se pudo abrir automáticamente: {error}")
        log(f"reporte Python generado: {pdf_path}")
        return {"ok": True, "path": pdf_path, "opened": opened, "module": module_number}
    except Exception as error:
        log(f"error generando reporte Python: {error}")
        return {"ok": False, "error": str(error)}


def iniciar_reporte_python(payload):
    """Guarda la petición validada y arranca el render fuera de Native Messaging."""
    if not isinstance(payload, dict):
        return {"ok": False, "error": "Faltan los datos del reporte."}
    course_file = texto_seguro(payload.get("course_file"), 100)
    if not re.fullmatch(r"curso_[A-Za-z0-9_-]+\.json", course_file):
        return {"ok": False, "error": "La plantilla indicada no está permitida."}
    course_path = os.path.join(CALIFICADOR_DIR, "reportes", course_file)
    if not os.path.isfile(course_path):
        return {"ok": False, "error": "No encontré la plantilla local del curso."}
    student = payload.get("student")
    if not isinstance(student, dict) or not isinstance(student.get("modules"), list):
        return {"ok": False, "error": "Los datos del alumno no son válidos."}

    job_id = uuid.uuid4().hex
    job_dir = os.path.join(tempfile.gettempdir(), "kodland_report_jobs")
    os.makedirs(job_dir, exist_ok=True)
    job_path = os.path.join(job_dir, job_id + ".json")
    try:
        with open(job_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "--generar-reporte-job", job_id],
            cwd=CALIFICADOR_DIR,
            creationflags=CREATE_NEW_CONSOLE,
            close_fds=True,
        )
        log(f"reporte Python encolado: {job_id}")
        return {"ok": True, "queued": True, "job_id": job_id, "mensaje": "Python inició la generación del PDF."}
    except Exception as error:
        try:
            os.remove(job_path)
        except OSError:
            pass
        log(f"error iniciando reporte Python {job_id}: {error}")
        return {"ok": False, "error": str(error)}


def ejecutar_reporte_job(job_id):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id or ""):
        print("ID de trabajo no válido.")
        return 1
    job_path = os.path.join(tempfile.gettempdir(), "kodland_report_jobs", job_id + ".json")
    try:
        with open(job_path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        print("Generando reporte PDF con Python…")
        result = procesar_reporte_python(payload)
        if not result.get("ok"):
            print("No se pudo generar el reporte:")
            print("  " + result.get("error", "Error desconocido"))
            return 1
        print("Reporte Python generado correctamente:")
        print("  " + result["path"])
        print("El PDF se abrió en el lector predeterminado." if result.get("opened") else "El PDF quedó guardado en la ruta indicada.")
        return 0
    except Exception as error:
        log(f"error ejecutando reporte Python {job_id}: {error}")
        print(f"Error generando el reporte: {error}")
        return 1
    finally:
        try:
            os.remove(job_path)
        except OSError:
            pass


def ejecutar_accion(accion, mensaje=None):
    """Ejecuta el .bat de una etiqueta permitida. Devuelve el dict de respuesta."""
    if accion == "ping":
        return {"ok": True, "mensaje": "puente activo"}
    if accion == "generar_reporte_python":
        return iniciar_reporte_python((mensaje or {}).get("payload"))
    if accion not in ACCIONES:
        log(f"acción NO permitida: {accion!r}")
        return {"ok": False, "error": f"acción no permitida: {accion}"}

    bat = os.path.join(CALIFICADOR_DIR, ACCIONES[accion])
    if not os.path.isfile(bat):
        log(f"no existe el .bat: {bat}")
        return {"ok": False, "error": f"no encuentro el archivo: {ACCIONES[accion]}"}

    try:
        # Abre el .bat en una ventana nueva (sin heredar los pipes de Chrome).
        subprocess.Popen(
            [bat],
            cwd=CALIFICADOR_DIR,
            creationflags=CREATE_NEW_CONSOLE,
            close_fds=True,
        )
        log(f"lanzado: {ACCIONES[accion]}")
        return {"ok": True, "accion": accion, "mensaje": f"Ejecutando: {ACCIONES[accion]}"}
    except Exception as e:
        log(f"error al lanzar {ACCIONES[accion]}: {e}")
        return {"ok": False, "error": str(e)}


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--generar-reporte-job":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        result = ejecutar_reporte_job(sys.argv[2])
        try:
            input("\nPresiona Enter para cerrar esta ventana…")
        except EOFError:
            pass
        raise SystemExit(result)

    log("puente iniciado")
    while True:
        try:
            mensaje = leer_mensaje()
        except Exception as e:
            log(f"error leyendo: {e}")
            break
        if mensaje is None:
            break  # Chrome cerró la conexión
        accion = (mensaje or {}).get("action", "")
        log(f"recibido: {accion!r}")
        respuesta = ejecutar_accion(accion, mensaje)
        try:
            enviar_mensaje(respuesta)
        except Exception as e:
            log(f"error respondiendo: {e}")
            break
    log("puente terminado")


if __name__ == "__main__":
    main()
