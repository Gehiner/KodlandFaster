# Calificador automático de tareas — Kodland

Automatiza tu flujo de calificación en `bo.kodland.org`:

1. Abre el panel de profesores y lista **todos tus grupos** (ajusta el paginador a 50 y recorre las páginas).
2. Toma solo los grupos **Activos** que ya tienen al menos una lección dada (columna con código `M#L#`).
3. En cada grupo abre la pestaña **Comprobar** (`?tab=3`).
4. Revisa las lecciones **desde M1L1 hasta la lección actual** del grupo.
5. Detecta las fichas por color usando la **leyenda de la propia página** (se autocalibra):
   - 🟡 amarilla — *Tarea por revisar* → **la califica**
   - 🟠 naranja — *Enviada después de la fecha límite* → **la califica**
   - 🟢 verde / 🔴 roja / ⚪ gris → las deja en paz
6. Al abrir cada tarea pendiente pulsa **«Nota Max.»**, verifica y sigue con la siguiente.
7. Guarda un registro CSV de todo en la carpeta `registros/`.

## Cómo usarlo

| Acción | Cómo |
|---|---|
| Probar sin calificar nada | Doble clic en **`1 - Probar (simulacion).bat`** |
| Calificar todo | Doble clic en **`2 - Calificar TODO.bat`** |
| Recopilar datos si algo falla | Doble clic en **`3 - Diagnostico (si algo falla).bat`** |
| Probar comentarios (no envía) | Doble clic en **`4 - Probar comentarios (no envia).bat`** |
| Calificar todo + comentar | Doble clic en **`5 - Calificar TODO y comentar.bat`** |
| Comentar un grupo concreto (envía) | Doble clic en **`6 - Comentar UN grupo (envia).bat`** |
| Probar la conexión con la IA | Doble clic en **`7 - Probar conexion IA.bat`** |

**Configuración inicial (una sola vez):** copia `config.example.json` a `config.json`
y pon tu **ID de profesor** (el número de la URL de tu panel:
`https://bo.kodland.org/teachers/<ID>`). También puedes pasarlo al ejecutar con
`--profesor-id 123456`.

**La primera vez**: se abrirá una ventana de Chrome con la página de login de Kodland.
Inicia sesión manualmente (el script espera hasta 10 minutos). La sesión queda guardada
en un perfil local (`C:\Users\<tu usuario>\.kodland_calificador`) y no tendrás que
volver a loguearte, salvo que la sesión caduque.

⚠️ **No cierres la ventana de Chrome ni la ventana negra mientras trabaja.**
Para detenerlo: `Ctrl+C` en la ventana negra.

## Opciones avanzadas (línea de comandos)

```
py -3 calificador_kodland.py [opciones]

  --dry-run               solo muestra qué calificaría, no toca nada
  --max-grupos N          procesa como máximo N grupos
  --grupo TEXTO           solo grupos cuyo código contenga TEXTO (ej: --grupo COL12345)
  --todas-las-lecciones   revisa todas las lecciones del desplegable, no solo hasta la actual
  --incluir-no-activos    incluye también grupos que no estén en estado "Activo"
  --lento                 modo lento, útil para observar qué hace
```

Ejemplo para probar con un solo grupo real:

```
py -3 calificador_kodland.py --grupo COL12345 --dry-run
py -3 calificador_kodland.py --grupo COL12345
```

## Comentarios automáticos (opcional)

Después de calificar cada tarea, el script puede dejar un comentario en el chat
del alumno. **Gratis y sin programas extra**: usa la API de la propia plataforma.

Hay dos motores de comentario:

- `--comentar plantillas` — sin internet: compara el código con la **Solución**
  (similitud, sintaxis, construcciones que faltan) y elige una frase de
  `plantillas_comentarios.json`. **Edita ese archivo** para tus propias frases.
- `--comentar ia` — **recomendado**: una IA lee el enunciado, la solución y el
  código del alumno, y genera un comentario **personalizado** y una revisión de
  verdad (detecta también errores de lógica). Configúrala una vez (ver abajo). Si
  la IA falla o no está configurada, cae solo a las plantillas.

Reglas comunes:

- **Solo se tocan tareas SIN calificar** (amarillas = por revisar, naranjas =
  entregadas tarde). Las verdes no se tocan salvo `--comentar-tambien-revisadas`.
- La nota y el comentario se guardan **juntos**, igual que a mano en «Evalúe».
  Si la API fallara, se usa el modal de la página y el chat como respaldo.

### Configurar la IA (Groq, gratis) — una sola vez

1. Entra a **https://console.groq.com/keys**, crea una cuenta gratis y pulsa
   **Create API Key**. Copia la clave (empieza con `gsk_...`).
2. Copia **`ia_config.example.json`** a **`ia_config.json`**, ábrelo y pega tu clave
   entre las comillas de `api_key`. Guarda.
3. Doble clic en **`7 - Probar conexion IA.bat`** para comprobar que funciona.

Groq es gratis con límites amplios (de sobra para calificar). El código de los
alumnos se envía a Groq para revisarlo. Para cambiar a otra IA (Gemini, un modelo
en Colab, etc.), solo cambia `endpoint`, `api_key` y `modelo` en ese archivo.

### Cómo se decide la nota

**Con IA** (`--comentar ia`): la IA evalúa qué tan correcta y completa está la
tarea (incluidos errores de lógica) y de ahí sale la nota, entre el mínimo y el
máximo de la tarea.

**Con plantillas** (sin IA), la nota es **conservadora** — solo baja de la máxima
ante un problema seguro:

| Caso | Nota |
|---|---|
| Código correcto (o tarea sin código: Unity, capturas) | **Máxima** |
| Error de sintaxis real (paréntesis/comillas sin cerrar) | **Parcial** |
| Entrega vacía o claramente incompleta | **Mínima** |

Sin IA, **no se detectan errores de lógica** (un umbral mal puesto, un texto
equivocado) → esas tareas reciben máxima; para eso está la IA. La nota nunca baja
del mínimo que fija la plataforma (~40% del máximo).

⚠️ **Recomendación**: la primera vez, usa el bat 4 (vista previa) con la IA sobre
varias tareas y revisa que las notas y comentarios te parezcan justos **antes** de
enviarlos. La IA es buena pero no infalible; tú tienes la última palabra.

### Vista previa y envío

- En el modo normal, `--comentar` **deja nota + comentario directamente**. Para
  solo verlos sin guardarlos: añade `--sin-enviar`.
- `--probar-comentario N` — muestra qué haría con N tareas sin calificar, **sin
  guardar nada** (bat 4). Verás la nota que pondría y el comentario.
- Cada tarea comentada queda en `registros/comentarios_detalle.jsonl` con su nota,
  motivo, código y solución — para que audites las decisiones.

Flujo recomendado: bat 4 (vista previa) → revisa notas y comentarios → bat 6 (un grupo).

## Si algo falla

- El script guarda capturas de pantalla y HTML en la carpeta `depuracion/` cada vez
  que algo no coincide con lo esperado. Esos archivos permiten diagnosticar y ajustar
  los selectores si la plataforma cambia su interfaz.
- Los registros de cada ejecución quedan en `registros/` (CSV y JSONL) para auditar
  qué se calificó y comentó.

## Advertencias

- Empieza siempre con la **simulación** (bat 1) y la **vista previa** de comentarios
  (bat 4) para confirmar que todo se detecta bien antes de calificar de verdad.
- El perfil en `~\.kodland_calificador` guarda tu **sesión iniciada** de Kodland.
  No compartas esa carpeta con nadie.
- La calificación y los comentarios los decide el profesor: revisa los registros de
  `registros/` para saber exactamente qué se hizo en cada ejecución.
