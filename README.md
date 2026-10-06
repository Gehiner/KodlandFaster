<div align="center">

# ⚡ KodlandFaster

**Extensión de Chrome y herramientas Python para automatizar tareas repetitivas de los tutores en el backoffice de Kodland**

[![Release](https://img.shields.io/badge/release-v1.1.0-blue?style=for-the-badge\&logo=github)](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.1.0)
[![Manifest](https://img.shields.io/badge/manifest-v1.1.0-orange?style=for-the-badge)](manifest.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
![Chrome](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=for-the-badge\&logo=googlechrome\&logoColor=white)
![Python](https://img.shields.io/badge/Python-Playwright-3776AB?style=for-the-badge\&logo=python\&logoColor=white)

</div>

---

## 📑 Tabla de contenidos

* [Componentes](#-componentes)
* [Arquitectura](#-arquitectura)
* [Requisitos](#-requisitos)
* [Instalar la extensión](#-instalar-la-extensión)
* [Funciones de la extensión](#-funciones-de-la-extensión)
* [Calificar desde el reporte del grupo](#calificar-desde-el-reporte-del-grupo)
* [Reportes Python desde la extensión](#-reportes-python-desde-la-extensión)
* [Calificador de tareas](#-calificador-de-tareas)
* [Configuración y datos privados](#-configuración-y-datos-privados)
* [Colaboradores](#-colaboradores)
* [Estado del proyecto](#-estado-del-proyecto)
* [Licencia](#-licencia)

---

## 🧩 Componentes

| Componente                     | Función                                                                                                                  | Tecnología                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 🧭 **Extensión de Chrome**     | Acciones para alumnos y grupos: WhatsApp, credenciales, recordatorios, grabaciones, progreso y configuración de mensajes | `JavaScript` · `Manifest V3`         |
| 🔌 **Puente Native Messaging** | Comunicación entre la extensión de Chrome y las herramientas Python                                                      | `Chrome Native Messaging` · `Python` |
| ✅ **Calificador**              | Automatización de revisión y calificación de tareas, con comentarios mediante plantillas o IA                            | `Python` · `Playwright`              |
| 📄 **Generador de reportes**   | Generación de reportes de desarrollo y boletines PDF a partir del progreso de Kodland                                    | `Python` · `Playwright`              |

> **KodlandFaster** es el proyecto que contiene la extensión **Kodland Tutor Assistant** y las herramientas Python asociadas.
>
> El release publicado actualmente es [**Kodland Tutor Assistant v1.1.0**](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.1.0). El `manifest.json` declara esta versión.

---

## 🏗️ Arquitectura

El proyecto está compuesto por una extensión de Chrome que puede comunicarse con herramientas Python mediante **Native Messaging**.

```text
┌──────────────────────────────┐
│      Chrome Extension        │
│   Kodland Tutor Assistant    │
└──────────────┬───────────────┘
               │
               │ Native Messaging
               ▼
┌──────────────────────────────┐
│       Python Bridge          │
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌──────────────┐ ┌──────────────┐
│  Calificador │ │   Reportes   │
│   Playwright │ │   Playwright │
└──────────────┘ └──────────────┘
```

La extensión se encarga principalmente de las acciones dentro del backoffice y de proporcionar la interfaz al tutor. Las tareas que requieren Python se delegan mediante el puente Native Messaging.

---

## 📋 Requisitos

### Extensión de Chrome

* Google Chrome.
* Cuenta de tutor de Kodland con acceso al backoffice.
* Acceso a `https://bo.kodland.org/`.

### Funciones Python

* Python 3.x.
* Playwright.
* Navegador Chromium instalado mediante Playwright.
* Native Messaging Host configurado.
* Windows para los lanzadores y configuración documentados actualmente.

> Algunas funciones dependen de la estructura interna del backoffice de Kodland y pueden requerir actualizaciones si dicha plataforma cambia.

---

## 🚀 Instalar la extensión

1. Descarga el ZIP del [release v1.1.0](https://github.com/Gehiner/KodlandFaster/releases/tag/v1.1.0) o clona/descarga este repositorio.
2. Si descargaste un ZIP, descomprímelo.
3. Abre `chrome://extensions` en Chrome.
4. Activa **Modo de desarrollador**.
5. Pulsa **Cargar extensión sin empaquetar**.
6. Selecciona la carpeta raíz del proyecto que contiene `manifest.json`.
7. Abre o recarga `https://bo.kodland.org/` e inicia sesión.

📘 La guía de instalación paso a paso está disponible en [**INSTALACION.md**](INSTALACION.md).

### ID de la extensión

Para utilizar las funciones Python mediante Native Messaging necesitas el ID de la extensión.

Puedes encontrarlo en:

```text
chrome://extensions
```

Busca **Kodland Tutor Assistant** y copia el valor mostrado en **ID**.

> Si reinstalas la extensión sin empaquetar y cambia su ID, tendrás que actualizar la configuración del Native Messaging Host.

---

## ✨ Funciones de la extensión

En las páginas de grupos, la extensión proporciona botones individuales para alumnos y acciones grupales.

### 👤 Acciones para alumnos

* 💬 Abrir WhatsApp del acudiente y preparar mensajes de bienvenida, ausencia, tareas pendientes y grabación.
* 📊 Consultar progreso de tareas.
* 📇 Exportar contactos.
* 📋 Revisar tareas pendientes de calificación.
* 🎮 Enviar credenciales relacionadas con Minecraft Education.
* 📹 Acceder a información relacionada con grabaciones.

### 👥 Acciones grupales

* 📢 Preparar avisos grupales para clases.
* 🎓 Preparar mensajes relacionados con graduaciones.
* 👋 Preparar mensajes de bienvenida.
* 📹 Preparar avisos relacionados con grabaciones.
* ✅ Calificar las tareas pendientes mostradas en el reporte del grupo.

### ⚙️ Configuración

* Configurar el nombre del tutor.
* Configurar plantillas de mensajes.
* Acceder a las funciones Python disponibles desde la extensión.

> Los mensajes de WhatsApp quedan preparados para que el tutor los revise y los envíe.
>
> Los PDF generados por Python se guardan localmente. Para compartirlos mediante WhatsApp u otro medio, el tutor debe adjuntarlos manualmente.

---

## ✅ Calificar desde el reporte del grupo

La extensión permite seleccionar y calificar únicamente las tareas pendientes que aparecen en el reporte de calificación de un grupo.

### Flujo

1. En una página de grupo, pulsa **Reporte calificación** para listar las tareas pendientes por alumno.
2. Revisa las tareas seleccionadas.
3. Pulsa **Calificar las tareas del reporte (N)**.
4. Confirma la acción.
5. Python vuelve a consultar cada tarea en Kodland.
6. Si la tarea continúa pendiente, se aplica **Nota Max.**
7. Si la tarea ya cambió de estado, se omite.
8. El modal muestra el resultado del procesamiento.

La acción se ejecuta en segundo plano y no requiere abrir una pestaña visible del navegador.

El resultado detallado queda registrado en:

```text
calificador/registros/calificacion_reporte_<job_id>.log
```

El resultado puede incluir:

* Tareas procesadas.
* Tareas calificadas.
* Tareas omitidas.
* Tareas con error.

> ⚠️ Esta acción utiliza **Nota Max.** para las tareas seleccionadas. Revisa siempre el reporte antes de confirmar la operación.

> **Importante:** esta función actúa únicamente sobre las tareas incluidas en el reporte. No equivale a **Calificar TODO**.

---

## 🐍 Reportes Python desde la extensión

La extensión puede utilizar el puente **Native Messaging** para solicitar a las herramientas Python la generación de determinados reportes y documentos.

Estas funciones requieren:

* Python.
* Playwright.
* Chromium instalado para Playwright.
* Native Messaging Host correctamente configurado.

Consulta:

* [README_PUENTE.md](calificador/puente/README_PUENTE.md)
* [INSTRUCCIONES.md](calificador/INSTRUCCIONES.md)

### Instalación de Playwright

Si Python y el puente ya están configurados, instala Playwright en el mismo entorno de Python utilizado por las herramientas:

```bat
py -3 -m pip install playwright
py -3 -m playwright install chromium
```

### Generación de reportes

La acción de reporte individual envía al puente una plantilla permitida y los datos necesarios para generar el documento.

El puente no acepta comandos ni rutas arbitrarias.

Los PDF generados desde el modal se guardan en:

```text
calificador/reportes/salida/desde_modal_python/
```

Las plantillas de cursos se encuentran en:

```text
calificador/reportes/curso_*.json
```

Los datos opcionales de la carátula pueden definirse en:

```text
calificador/reportes/datos_<CODIGO_DEL_GRUPO>.json
```

utilizando como referencia:

```text
datos.example.json
```

> ⚠️ Los archivos de datos, reportes y registros pueden contener información personal de estudiantes. No deben publicarse ni incluirse accidentalmente en commits.

---

## 🎯 Calificador de tareas

El calificador Python automatiza parte del proceso de revisión de entregas.

Incluye:

* 🧪 Modo de simulación.
* 🎯 Opciones de calificación.
* 💬 Comentarios mediante plantillas.
* 🤖 Evaluación mediante IA opcional.
* 🗂️ Registros de ejecución.
* 🔄 Integración con la extensión mediante Native Messaging.

> 🔒 Se recomienda comenzar siempre con una simulación antes de ejecutar acciones que modifiquen tareas.

Para una ejecución manual:

1. Instala Python.
2. Instala Playwright.
3. Configura `calificador/config.json` a partir de `config.example.json`.
4. Si utilizas IA, configura `calificador/ia_config.json`.
5. Sigue las instrucciones de [INSTRUCCIONES.md](calificador/INSTRUCCIONES.md).

La documentación también incluye los lanzadores `.bat` y las opciones disponibles.

### Evaluación mediante IA

La evaluación mediante IA es opcional y requiere configurar el proveedor correspondiente.

Actualmente, la integración utiliza **Groq** cuando el tutor configura su clave en:

```text
calificador/ia_config.json
```

> ⚠️ Antes de utilizar servicios externos de IA, verifica que su uso esté permitido por las políticas aplicables y evita enviar datos personales o información confidencial de estudiantes que no sean necesarios para la evaluación.

---

## 🔐 Configuración y datos privados

Algunos archivos generados o configurados localmente pueden contener credenciales, información de estudiantes u otros datos que no deben publicarse.

| Archivo / dato               | Cuidado                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `calificador/config.json`    | Configuración local; no publicar si contiene información privada |
| `calificador/ia_config.json` | Puede contener claves de servicios externos; no publicar         |
| `datos_*.json`               | Puede contener información personal de estudiantes               |
| Reportes generados           | Pueden contener datos personales                                 |
| Logs y registros             | Pueden contener información de ejecución o datos de estudiantes  |
| Enlaces de inicio de Zoom    | No compartir enlaces que contengan tokens de anfitrión           |

Antes de realizar un `git push`, revisa los archivos modificados y el estado del repositorio para evitar subir información privada accidentalmente.

---

## 👥 Colaboradores

KodlandFaster nació como una extensión de Chrome creada por [@Gehiner](https://github.com/Gehiner), quien mantiene el proyecto, y ha crecido con aportes de otros tutores.

### [@JaimeNarvaez](https://github.com/JaimeNarvaez)

Contribuciones principales:

* Calificador de tareas en Python.
* Integración con la extensión mediante Native Messaging.
* Evaluación con IA.
* Reportes de desarrollo.
* Generación de boletines.

### [@josetobar-UAO](https://github.com/josetobar-UAO)

Contribución principal:

* Botón **Send ME Credential** para Minecraft Education.

Las contribuciones son bienvenidas mediante pull request.

---

## 📌 Estado del proyecto

**Versión actual:** `1.1.0`

KodlandFaster se encuentra en desarrollo y sus funciones dependen parcialmente de la estructura y comportamiento del backoffice de Kodland.

Los cambios realizados por Kodland en sus interfaces, endpoints o mecanismos de autenticación pueden requerir actualizaciones de la extensión y de las herramientas Python.

---

## 📄 Licencia

Este proyecto se distribuye bajo la [licencia MIT](LICENSE).

---

<div align="center">

Hecho con 🧠 y ☕ para tutores de Kodland

</div>
