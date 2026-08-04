# KodlandFaster — Herramientas de automatización para profesores de Kodland

Conjunto de herramientas que agilizan tareas repetitivas del panel de profesores
de Kodland. Incluye dos componentes independientes que se pueden usar por separado:

| Herramienta | Qué hace | Tecnología |
|---|---|---|
| **Extensión de Chrome** (raíz del repo) | Botón de bienvenida por WhatsApp, envío de credenciales e info de grupos, integrados en la interfaz de Kodland | JavaScript (extensión de Chrome) |
| **Calificador de tareas** ([`calificador/`](calificador/)) | Califica automáticamente las tareas pendientes y deja comentarios personalizados con IA que revisan el código del alumno | Python + Playwright |

---

# 1) Extensión de Chrome — Kodland WhatsApp Welcome

Extensión de Chrome que agrega un botón para enviar un mensaje de bienvenida a WhatsApp desde la plataforma Kodland.

## Características

- ✅ Botón integrado en la interfaz de Kodland
- ✅ Mensaje de bienvenida predefinido
- ✅ Abre WhatsApp Web automáticamente
- ✅ Diseño moderno y responsive

## Instalación

> 📖 **¿Necesitas ayuda detallada?** Consulta el archivo [INSTALACION.md](INSTALACION.md) para una guía paso a paso con capturas y solución de problemas.

### Instalación Manual (Resumen)

1. **Abrir Chrome Extensions**
   - Abre Chrome y escribe en la barra de direcciones: `chrome://extensions/`
   - O ve a: Menú (⋮) → Más herramientas → Extensiones

2. **Activar Modo de Desarrollador**
   - En la esquina superior derecha, activa el interruptor **"Modo de desarrollador"**

3. **Cargar la extensión sin empaquetar**
   - Haz clic en el botón **"Cargar extensión sin empaquetar"** (aparece arriba)
   - En la ventana que se abre, navega hasta: `C:\Users\Juan Garay\Desktop\KodlandFaster`
   - **Selecciona la carpeta** `KodlandFaster` (no entres dentro, selecciona la carpeta)
   - Haz clic en **"Seleccionar carpeta"**

4. **Verificar**
   - La extensión "Kodland WhatsApp Welcome" debería aparecer en la lista
   - Asegúrate de que esté **Activada** (interruptor azul)

## Uso

1. Navega a https://bo.kodland.org/
2. El botón "Enviar bienvenida a WA" aparecerá automáticamente en la ubicación especificada
3. Haz clic en el botón para abrir WhatsApp Web con el mensaje de bienvenida predefinido
4. Selecciona el contacto o grupo al que deseas enviar el mensaje y envía

## Personalización del Mensaje

Para cambiar el mensaje de bienvenida, edita el archivo `content.js` y modifica la línea:

```javascript
const message = encodeURIComponent('¡Bienvenido/a al curso! 🎉 Estamos muy contentos de tenerte aquí. ¡Comencemos juntos este increíble viaje de aprendizaje!');
```

## Estructura del Proyecto

```
KodlandFaster/
├── manifest.json       # Configuración de la extensión de Chrome
├── content.js          # Script que inyecta el botón
├── styles.css          # Estilos del botón
├── ...                 # Resto de scripts de la extensión
├── README.md           # Este archivo
└── calificador/        # Herramienta de calificación en Python (ver sección 2)
```

## Iconos (Opcional)

Los iconos (`icon16.png`, `icon48.png`, `icon128.png`) son opcionales. Si deseas agregarlos:
- Crea imágenes PNG con los tamaños especificados
- Colócalas en la raíz del proyecto
- O edita el `manifest.json` para remover la sección de iconos

## Notas

- La extensión funciona solo en `https://bo.kodland.org/*`
- El botón se inyecta automáticamente cuando se carga la página
- Si el elemento objetivo no aparece inmediatamente, la extensión intentará encontrarlo durante 30 segundos

## Solución de Problemas

**El botón no aparece:**
- Verifica que estés en la URL correcta: `https://bo.kodland.org/`
- Recarga la página
- Verifica que la extensión esté activada en `chrome://extensions/`
- Abre la consola del navegador (F12) para ver posibles errores

**El botón aparece pero no funciona:**
- Verifica que no tengas bloqueadores de pop-ups activos
- Asegúrate de que WhatsApp Web esté permitido en tu navegador

---

# 2) Calificador de tareas (Python)

Herramienta de escritorio que **automatiza la revisión y calificación de tareas**
del panel de profesores, reduciendo de horas a minutos un proceso manual.

## Qué hace

- Recorre todos los grupos y detecta las tareas pendientes de revisar (por color).
- Califica las tareas pendientes (amarillas y naranjas).
- Opcional: deja un **comentario personalizado** para cada estudiante con **IA**,
  que además **revisa el código de verdad** (detecta errores de lógica, no solo de
  sintaxis) y ajusta la nota según la calidad de la entrega.
- Modos de **simulación** y **vista previa** para revisar antes de aplicar nada.
- Registra todo lo realizado para auditoría.

## Tecnologías

- **Python 3** + **Playwright** (automatización del navegador con sesión persistente)
- **API REST de Kodland** para leer entregas y guardar notas/comentarios
- **IA** vía endpoint OpenAI-compatible (Groq gratis por defecto; configurable a
  Gemini u otro), con análisis local (`ast`, `difflib`) como respaldo

## Puesta en marcha

1. Instala Python 3 y Playwright:
   ```bash
   pip install playwright
   python -m playwright install chromium
   ```
2. Copia `calificador/config.example.json` a `config.json` y pon tu **ID de profesor**
   (el número de la URL de tu panel: `https://bo.kodland.org/teachers/<ID>`).
3. (Opcional, para comentarios con IA) copia `ia_config.example.json` a `ia_config.json`
   y pega tu clave gratuita de [Groq](https://console.groq.com/keys).
4. Ejecuta desde la carpeta `calificador/`:
   ```bash
   python calificador_kodland.py --dry-run   # simulación, no toca nada
   ```

📖 Guía completa de uso, opciones y lanzadores `.bat` en
[`calificador/INSTRUCCIONES.md`](calificador/INSTRUCCIONES.md).

> Nota: `config.json`, `ia_config.json` y las carpetas de datos generados
> (`depuracion/`, `registros/`) se excluyen del repositorio (ver `.gitignore`)
> porque contienen datos personales o credenciales.

---

## Licencia

Este proyecto es de uso personal/educacional. Ver [LICENSE](LICENSE) (MIT).

