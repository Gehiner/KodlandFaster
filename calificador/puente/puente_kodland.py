# -*- coding: utf-8 -*-
"""
Puente local (Native Messaging) entre la extensión de Chrome y el calificador.

Cómo funciona:
  Chrome lanza este script y se comunica con él por stdin/stdout usando el
  protocolo de Native Messaging (4 bytes de longitud + JSON UTF-8). La extensión
  NO envía comandos ni rutas: solo envía una ETIQUETA de acción (ej. "simular").
  Este puente busca la etiqueta en una LISTA BLANCA y ejecuta el .bat que le
  corresponde, en una ventana nueva. Cualquier etiqueta desconocida se rechaza.

Seguridad:
  - Solo se ejecutan los .bat de ACCIONES (lista blanca fija). Nunca rutas ni
    comandos que vengan del mensaje.
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


def ejecutar_accion(accion):
    """Ejecuta el .bat de una etiqueta permitida. Devuelve el dict de respuesta."""
    if accion == "ping":
        return {"ok": True, "mensaje": "puente activo"}
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
        respuesta = ejecutar_accion(accion)
        try:
            enviar_mensaje(respuesta)
        except Exception as e:
            log(f"error respondiendo: {e}")
            break
    log("puente terminado")


if __name__ == "__main__":
    main()
