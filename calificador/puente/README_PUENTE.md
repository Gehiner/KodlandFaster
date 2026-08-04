# Puente extensión ⇄ calificador (Native Messaging)

Este puente permite lanzar el **calificador de Python** desde los botones de la
**extensión de Chrome**, sin salir de la página de Kodland.

## ¿Cómo funciona?

Una extensión de Chrome **no puede** ejecutar programas de tu computadora por
seguridad. La forma oficial de permitirlo es **Native Messaging**: un pequeño
programa local (el "puente") que Chrome puede lanzar y con el que se comunica.

```
  Botón en Kodland
        │  (envía solo una ETIQUETA, ej. "simular")
        ▼
  Service worker de la extensión
        │  chrome.runtime.sendNativeMessage
        ▼
  Puente en Python (puente_kodland.py)
        │  busca la etiqueta en su LISTA BLANCA
        ▼
  Ejecuta el .bat correspondiente (en una ventana nueva)
```

La extensión **nunca** manda comandos ni rutas: solo etiquetas (`simular`,
`calificar`, `probar_ia`, …). El puente tiene una lista fija de etiquetas
permitidas y rechaza cualquier otra. Todo ocurre en tu PC, sin internet.

## Instalación (una sola vez)

1. **Carga la extensión** en Chrome:
   - Abre `chrome://extensions`, activa **Modo de desarrollador**.
   - **Cargar extensión sin empaquetar** → selecciona la carpeta raíz del repo.
   - Copia el **ID** de la extensión (32 letras, aparece bajo su nombre).

2. **Instala el puente**: doble clic en **`instalar_puente.bat`** (en esta carpeta)
   y pega el ID cuando lo pida. Esto:
   - genera `com.kodland.puente.json` con la ruta a tu puente y tu ID, y
   - lo registra en Windows (Chrome y Edge), solo para tu usuario.

3. **Recarga la extensión** en `chrome://extensions` (botón ↻).

4. Entra a `https://bo.kodland.org/`, pulsa el botón flotante **🎓 Calificador**
   (abajo a la derecha) y luego **🔌 Probar puente**. Debe responder
   *"puente activo"*.

## Uso

En el panel **🎓 Calificador** tienes un botón por cada acción. Cada uno abre el
`.bat` correspondiente en su propia ventana (donde ves el progreso y, si hace
falta, escribes datos como el código de un grupo):

| Botón | Qué hace |
|---|---|
| 🔌 Probar puente | Comprueba que la conexión funciona |
| 👁 Simular | Muestra qué calificaría, sin tocar nada |
| 💬 Vista previa comentarios | Muestra nota y comentario sin guardarlos |
| 🤖 Probar IA | Verifica la conexión con la IA |
| ✅ Calificar TODO | Califica las tareas pendientes (pide confirmación) |
| ✅💬 Calificar + comentar | Califica y deja comentarios (pide confirmación) |
| 📝 Comentar un grupo | Un grupo concreto (pide confirmación) |
| 🛠 Diagnóstico | Guarda datos para diagnosticar problemas |

## Seguridad

- El puente solo ejecuta los `.bat` de su **lista blanca** (`ACCIONES` en
  `puente_kodland.py`). Nunca ejecuta rutas ni comandos que lleguen en el mensaje.
- `allowed_origins` en el manifest limita **qué extensión** puede usar el puente
  (por su ID). Solo tu extensión puede hablar con él.
- Se registra en `HKCU` (tu usuario), no requiere permisos de administrador.

## Desinstalar

Doble clic en **`desinstalar_puente.bat`** (quita el registro; los archivos se
quedan por si quieres reinstalarlo).

## Si no conecta

- Revisa que el ID que pusiste coincida con el de `chrome://extensions`
  (si recargas la extensión sin empaquetar desde otra carpeta, el ID cambia).
- Vuelve a correr `instalar_puente.bat` con el ID correcto y recarga la extensión.
- Mira `puente.log` (se crea en esta carpeta) para ver qué recibió el puente.
- Confirma que Python está instalado (`python --version`).
