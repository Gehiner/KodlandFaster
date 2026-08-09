# -*- coding: utf-8 -*-
"""
Instalador del puente de Native Messaging (Windows).

Qué hace:
  1. Genera com.kodland.puente.json con la ruta ABSOLUTA a puente_kodland.bat
     y el ID de tu extensión (en allowed_origins).
  2. Registra el puente en el registro de Windows para Chrome y Edge, para que
     el navegador sepa dónde encontrarlo.

Uso:
  python instalar_puente.py               (te pedirá el ID de la extensión)
  python instalar_puente.py <ID_EXTENSION>

El ID de la extensión se ve en chrome://extensions (activa "Modo de desarrollador";
es la cadena larga de 32 letras debajo del nombre de la extensión).
"""

import json
import os
import re
import sys

# Salida robusta: evita que un símbolo raro rompa la consola de Windows.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import winreg
except ImportError:
    print("Este instalador es solo para Windows.")
    sys.exit(1)

NOMBRE_HOST = "com.kodland.puente"
PUENTE_DIR = os.path.dirname(os.path.abspath(__file__))
RUTA_BAT = os.path.join(PUENTE_DIR, "puente_kodland.bat")
RUTA_MANIFEST = os.path.join(PUENTE_DIR, "com.kodland.puente.json")

# Dónde registra cada navegador sus hosts de Native Messaging (por usuario)
CLAVES_REGISTRO = {
    "Chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "Edge":   r"Software\Microsoft\Edge\NativeMessagingHosts",
}


def pedir_id():
    if len(sys.argv) > 1:
        return sys.argv[1].strip()
    print("Pega el ID de tu extension (chrome://extensions -> Modo desarrollador):")
    return input("  ID: ").strip()


def main():
    if not os.path.isfile(RUTA_BAT):
        print(f"ERROR: no encuentro {RUTA_BAT}")
        sys.exit(1)

    ext_id = pedir_id()
    if not re.fullmatch(r"[a-p]{32}", ext_id):
        print(f"\n[!] El ID '{ext_id}' no tiene el formato habitual (32 letras a-p).")
        print("    Continuo de todos modos, pero revisalo si el puente no conecta.")

    # 1) Escribir el manifest del host con rutas reales
    manifest = {
        "name": NOMBRE_HOST,
        "description": "Puente local para el calificador de Kodland",
        "path": RUTA_BAT,
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{ext_id}/"],
    }
    with open(RUTA_MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print(f"\n[OK] Manifest escrito: {RUTA_MANIFEST}")
    print(f"     path      -> {RUTA_BAT}")
    print(f"     extension -> {ext_id}")

    # 2) Registrar en Chrome y Edge (HKCU: solo tu usuario, no requiere admin)
    ok = 0
    for navegador, base in CLAVES_REGISTRO.items():
        try:
            clave = winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + "\\" + NOMBRE_HOST)
            winreg.SetValueEx(clave, None, 0, winreg.REG_SZ, RUTA_MANIFEST)
            winreg.CloseKey(clave)
            print(f"[OK] Registrado para {navegador}")
            ok += 1
        except Exception as e:
            print(f"[!] No se pudo registrar para {navegador}: {e}")

    if ok:
        print("\n[LISTO] Puente instalado.")
        print("   Siguiente paso: cierra Chrome por completo, vuelve a abrirlo y")
        print("   prueba el boton 'Probar puente' en la pagina de Kodland.")
    else:
        print("\n[X] No se pudo registrar en ningun navegador.")


if __name__ == "__main__":
    main()
