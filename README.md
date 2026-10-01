<div align="center">

# ⚡ KodlandFaster

**Extensión de Chrome y herramientas Python para automatizar el trabajo diario de los tutores en el backoffice de Kodland**

[![Release](https://img.shields.io/badge/release-v1.1.0-blue?style=for-the-badge&logo=github)](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.1.0)
[![Manifest](https://img.shields.io/badge/manifest-v1.1.0-orange?style=for-the-badge)](manifest.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#)
[![Python](https://img.shields.io/badge/Python-Playwright-3776AB?style=for-the-badge&logo=python&logoColor=white)](#)



---

## 📑 Tabla de contenidos

- [Componentes](#-componentes)
- [Instalar la extensión](#-instalar-la-extensión)
- [Funciones de la extensión](#-funciones-de-la-extensión)
  - [Calificar desde el reporte del grupo](#calificar-desde-el-reporte-del-grupo)
  - [Reportes Python desde la extensión](#reportes-python-desde-la-extensión)
- [Calificador de tareas](#-calificador-de-tareas)
- [Configuración y datos privados](#-configuración-y-datos-privados)
- [Licencia](#-licencia)

---

## 🧩 Componentes

| Componente | Función | Tecnología |
|---|---|---|
| 🧭 **Extensión de Chrome** | Acciones para alumnos y grupos: WhatsApp, credenciales, recordatorios, grabaciones, progreso y configuración de mensajes | `JavaScript` · `Manifest V3` |
| ✅ **Calificador** | Simulación/calificación de tareas y comentarios con plantillas o IA | `Python` · `Playwright` |
| 📄 **Generador de reportes** | Reportes de desarrollo y boletines PDF a partir del progreso de Kodland | `Python` · `Playwright` |

> El release publicado es [**Kodland Tutor Assistant v1.1.0**](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.1.0). El `manifest.json` declara esta versión.

---

## 🚀 Instalar la extensión

1. Descarga el ZIP del [release v1.1.0](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.1.0) o clona/descarga este repositorio.
2. Descomprime el proyecto si descargaste un ZIP.
3. Abre `chrome://extensions` en Chrome y activa **Modo de desarrollador**.
4. Pulsa **Cargar extensión sin empaquetar** y selecciona la carpeta raíz que contiene `manifest.json`.
5. Abre o recarga `https://bo.kodland.org/` e inicia sesión.

📘 La guía de instalación paso a paso está en [**INSTALACION.md**](INSTALACION.md).

---

## ✨ Funciones de la extensión

En páginas de grupos, la extensión muestra botones junto a cada alumno y acciones grupales:

- 💬 Abrir WhatsApp del acudiente y preparar mensajes de bienvenida, ausencia, tareas pendientes y grabación.
- 📊 Consultar progreso de tareas, exportar contactos y revisar tareas pendientes de calificación.
- 📢 Enviar avisos grupales para la clase, graduación, bienvenida y grabaciones.
- ⚙️ Configurar el nombre del tutor y las plantillas de mensajes desde el botón de configuración.
- 📄 Abrir un modal de reportes con generación general o por módulo mediante Python.
- ✅ Calificar únicamente las tareas pendientes listadas en el reporte grupal, con verificación de estado y seguimiento del lote.

> Los mensajes de WhatsApp quedan preparados para que el tutor los revise y los envíe. El PDF generado por Python se abre localmente; para compartirlo hay que adjuntarlo manualmente al chat.

### Calificar desde el reporte del grupo

1. En una página de grupo, pulsa **Reporte calificación** para listar las tareas pendientes por alumno.
2. Revisa la selección y pulsa **Calificar las tareas del reporte (N)**. El botón actúa solo sobre las tareas mostradas en ese reporte; no ejecuta **Calificar TODO**.
3. Confirma la acción. Python vuelve a consultar cada tarea en Kodland y solo aplica **Nota Max.** si todavía aparece pendiente. Si ya cambió de estado, la omite.

La calificación se procesa en segundo plano, sin abrir una pestaña visible. El modal muestra cuántas tareas están procesadas, calificadas, omitidas o con error. El log detallado queda en `calificador/registros/calificacion_reporte_<job_id>.log`.

> Esta acción usa **Nota Max.** para las tareas seleccionadas. Revisa el reporte antes de confirmar y comprueba el resultado del lote en el progreso o en su log.

<details>
<summary><strong>🐍 Reportes Python desde la extensión</strong> (haz clic para expandir)</summary>

La generación de reportes desde el modal necesita **Python**, **Playwright** y el **puente Native Messaging** instalado. En el botón de instalación del puente, pega el ID actual de la extensión. Si reinstalas la extensión sin empaquetar y cambia su ID, vuelve a instalar el puente con el nuevo ID.

El botón **Calificar las tareas del reporte** envía a Python solo las tareas listadas. Python vuelve a comprobar que cada tarea siga pendiente antes de aplicar **Nota Max.**; omite las que hayan cambiado de estado. El modal muestra el avance y el resultado detallado se guarda en `calificador/registros/calificacion_reporte_<job_id>.log`.

La acción de reporte individual envía al puente una plantilla permitida y datos del reporte; **el puente no acepta comandos ni rutas arbitrarias**. Los PDF se guardan bajo:

```
calificador/reportes/salida/desde_modal_python/
```

Para preparar el entorno Python, consulta [README_PUENTE.md](calificador/puente/README_PUENTE.md) y [INSTRUCCIONES.md](calificador/INSTRUCCIONES.md). Playwright debe estar instalado en el mismo Python que ejecuta el puente. Si hace falta, instala la librería y el navegador Chromium:

```bat
py -3 -m pip install playwright
py -3 -m playwright install chromium
```

Las plantillas de cursos están en `calificador/reportes/curso_*.json`. Los datos opcionales de carátula pueden definirse en `calificador/reportes/datos_<CODIGO_DEL_GRUPO>.json`, siguiendo el formato de `datos.example.json`.

⚠️ **Estos archivos pueden contener datos personales; no los publiques.**

</details>

---

## ✅ Calificador de tareas

El calificador de Python automatiza la revisión de entregas. Incluye:

- 🧪 Modo de simulación
- 🎯 Opciones de calificación
- 💬 Comentarios con plantillas o IA
- 🗂️ Registros de ejecución

> 🔒 Empieza siempre con una simulación antes de usar acciones que modifiquen tareas.

Para una ejecución manual, instala Playwright, configura `calificador/config.json` a partir de `config.example.json` y sigue [INSTRUCCIONES.md](calificador/INSTRUCCIONES.md). La guía también documenta los lanzadores `.bat` y las opciones disponibles.

---

## 🔐 Configuración y datos privados

| Archivo / dato | Cuidado |
|---|---|
| `calificador/config.json`, `calificador/ia_config.json` | Locales, no publicar |
| Reportes, depuraciones y registros | Pueden contener datos de alumnos |
| Enlaces de inicio de Zoom | No compartir con tokens de anfitrión |

---

## 📄 Licencia

Uso personal/educativo. Consulta [LICENSE](LICENSE) — **MIT**.

<div align="center">

---

Hecho con 🧠 y ☕ para tutores de Kodland

</div>
