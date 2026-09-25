# KodlandFaster

Extensión de Chrome y herramientas Python para apoyar tareas habituales de los tutores en el backoffice de Kodland.

El release publicado es [Kodland Tutor Assistant v1.0.0](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.0.0). El `manifest.json` de la rama actual declara la versión `1.1.0`; consulta el release para conocer exactamente qué archivos y funciones incluye cada versión.

## Componentes

| Componente | Función | Tecnología |
|---|---|---|
| Extensión de Chrome | Acciones para alumnos y grupos: WhatsApp, credenciales, recordatorios, grabaciones, progreso y configuración de mensajes | JavaScript, Manifest V3 |
| Calificador | Simulación/calificación de tareas y comentarios con plantillas o IA | Python, Playwright |
| Generador de reportes | Reportes de desarrollo y boletines PDF a partir del progreso de Kodland | Python, Playwright |

## Instalar la extensión

1. Descarga el ZIP del [release v1.0.0](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.0.0) o clona/descarga este repositorio.
2. Descomprime el proyecto si descargaste un ZIP.
3. Abre `chrome://extensions` en Chrome y activa **Modo de desarrollador**.
4. Pulsa **Cargar extensión sin empaquetar** y selecciona la carpeta raíz que contiene `manifest.json`.
5. Abre o recarga `https://bo.kodland.org/` e inicia sesión.

La guía de instalación paso a paso está en [INSTALACION.md](INSTALACION.md).

## Extensión

En páginas de grupos, la extensión puede mostrar botones junto a cada alumno y acciones grupales. Entre las funciones disponibles en el código actual están:

- Abrir WhatsApp del acudiente y preparar mensajes de bienvenida, ausencia, tareas pendientes y grabación.
- Consultar progreso de tareas, exportar contactos y revisar tareas pendientes de calificación.
- Enviar avisos grupales para la clase, graduación, bienvenida y grabaciones.
- Configurar el nombre del tutor y las plantillas de mensajes desde el botón de configuración.
- Abrir un modal de reportes con generación general o por módulo mediante Python.

Los mensajes de WhatsApp quedan preparados para que el tutor los revise y los envíe. El PDF generado por Python se abre localmente; para compartirlo hay que adjuntarlo manualmente al chat.

### Reportes Python desde la extensión

La generación de reportes desde el modal necesita Python, Playwright y el puente Native Messaging instalado. En el botón de instalación del puente, pega el ID actual de la extensión. Si reinstalas la extensión sin empaquetar y cambia su ID, vuelve a instalar el puente con el nuevo ID.

La acción de reporte individual envía al puente una plantilla permitida y datos del reporte; el puente no acepta comandos ni rutas arbitrarias. Los PDF se guardan bajo `calificador/reportes/salida/desde_modal_python/`.

Para preparar el entorno Python, consulta [README_PUENTE.md](calificador/puente/README_PUENTE.md) y [INSTRUCCIONES.md](calificador/INSTRUCCIONES.md). Playwright debe estar instalado en el mismo Python que ejecuta el puente. Si hace falta, instala la librería y el navegador Chromium:

```bat
py -3 -m pip install playwright
py -3 -m playwright install chromium
```

Las plantillas de cursos están en `calificador/reportes/curso_*.json`. Los datos opcionales de carátula pueden definirse en `calificador/reportes/datos_<CODIGO_DEL_GRUPO>.json`, siguiendo el formato de `datos.example.json`. Estos archivos pueden contener datos personales; no los publiques.

## Calificador de tareas

El calificador de Python automatiza la revisión de entregas. Incluye modo de simulación, opciones de calificación, comentarios con plantillas o IA y registros de ejecución. Empieza con una simulación antes de usar acciones que modifiquen tareas.

Para una ejecución manual, instala Playwright, configura `calificador/config.json` a partir de `config.example.json` y sigue [INSTRUCCIONES.md](calificador/INSTRUCCIONES.md). La guía también documenta los lanzadores `.bat` y las opciones disponibles.

## Configuración y datos privados

- `calificador/config.json` y `calificador/ia_config.json` son locales y no deben publicarse.
- Los reportes, depuraciones y registros pueden contener datos de alumnos; mantenlos fuera del repositorio.
- No compartas enlaces de inicio de Zoom que incluyan tokens de anfitrión.

## Licencia

Uso personal/educativo. Consulta [LICENSE](LICENSE) (MIT).
