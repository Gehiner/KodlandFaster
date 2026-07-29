# 📦 Guía de Instalación - Cargar Extensión sin Empaquetar

## Paso a Paso Detallado

### Paso 1: Preparar los archivos
Asegúrate de que todos los archivos estén en la misma carpeta:
- ✅ `manifest.json`
- ✅ `content.js`
- ✅ `styles.css`

### Paso 2: Abrir Chrome Extensions

**Opción A - Desde la barra de direcciones:**
1. Abre Google Chrome
2. En la barra de direcciones, escribe: `chrome://extensions/`
3. Presiona Enter

**Opción B - Desde el menú:**
1. Abre Google Chrome
2. Haz clic en los **tres puntos** (⋮) en la esquina superior derecha
3. Selecciona **"Más herramientas"**
4. Haz clic en **"Extensiones"**

### Paso 3: Activar el Modo de Desarrollador

1. En la página de extensiones (`chrome://extensions/`), busca el interruptor **"Modo de desarrollador"** en la esquina superior derecha
2. **Actívalo** (el interruptor debe estar en color azul/activado)

### Paso 4: Cargar la Extensión

1. Una vez activado el Modo de Desarrollador, verás nuevos botones en la parte superior
2. Haz clic en el botón **"Cargar extensión sin empaquetar"** o **"Load unpacked"** (en inglés)
3. Se abrirá una ventana de explorador de archivos
4. Navega hasta la carpeta donde está tu proyecto: `C:\Users\Juan Garay\Desktop\KodlandFaster`
5. **Selecciona la carpeta** `KodlandFaster` (NO entres dentro, selecciona la carpeta misma)
6. Haz clic en **"Seleccionar carpeta"** o **"Select Folder"**

### Paso 5: Verificar la Instalación

1. Deberías ver tu extensión aparecer en la lista de extensiones
2. Verifica que el nombre sea: **"Kodland WhatsApp Welcome"**
3. Verifica que el estado sea **"Activada"** (si no lo está, activa el interruptor)

### Paso 6: Probar la Extensión

1. Abre una nueva pestaña
2. Ve a: `https://bo.kodland.org/`
3. Inicia sesión si es necesario
4. El botón **"Enviar bienvenida a WA"** debería aparecer en la ubicación especificada

---

## 🖼️ Visualización de los Pasos Clave

### Interfaz de Chrome Extensions:

```
┌─────────────────────────────────────────────────────┐
│  Extensiones                           [Modo de     │
│                                        Desarrollador]│
│  ┌─────────────────────────────────────────────┐   │
│  │  [Activar]  Kodland WhatsApp Welcome        │   │
│  │            v1.0.0                           │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [+ Cargar extensión sin empaquetar] ← HAZ CLIC    │
│  [Empaquetar extensión]                            │
│  [Actualizar]                                       │
└─────────────────────────────────────────────────────┘
```

---

## ❓ Solución de Problemas

### Error: "No se puede cargar la extensión"
- ✅ Verifica que todos los archivos estén en la misma carpeta
- ✅ Asegúrate de que `manifest.json` no tenga errores de sintaxis
- ✅ Verifica que la carpeta seleccionada contenga `manifest.json`

### Error: "Manifest file is missing or unreadable"
- ✅ Asegúrate de seleccionar la carpeta correcta (donde está `manifest.json`)
- ✅ Verifica que el archivo `manifest.json` exista y no esté corrupto

### El botón no aparece en la página
- ✅ Verifica que estés en la URL correcta: `https://bo.kodland.org/`
- ✅ Recarga la página (F5 o Ctrl+R)
- ✅ Abre la consola del navegador (F12) y revisa si hay errores
- ✅ Verifica que la extensión esté activada en `chrome://extensions/`

### La extensión no se carga
- ✅ Verifica que el Modo de Desarrollador esté activado
- ✅ Intenta actualizar la extensión haciendo clic en el icono de recarga (🔄)
- ✅ Cierra y vuelve a abrir Chrome

---

## 🔄 Actualizar la Extensión Después de Cambios

Si haces cambios en los archivos de la extensión:

1. Ve a `chrome://extensions/`
2. Encuentra tu extensión "Kodland WhatsApp Welcome"
3. Haz clic en el **icono de recarga** (🔄) debajo de la extensión
4. Recarga la página de Kodland para ver los cambios

---

## 📝 Notas Importantes

- ⚠️ **NO elimines** la carpeta `KodlandFaster` mientras uses la extensión
- ⚠️ Si mueves la carpeta, deberás volver a cargar la extensión
- ⚠️ La extensión solo funciona en `https://bo.kodland.org/*`
- ✅ Puedes desactivar la extensión sin eliminarla usando el interruptor
- ✅ Para eliminarla completamente, haz clic en "Eliminar"

---

## 🎯 Resumen Rápido

1. Abre `chrome://extensions/`
2. Activa **"Modo de desarrollador"**
3. Clic en **"Cargar extensión sin empaquetar"**
4. Selecciona la carpeta `KodlandFaster`
5. ¡Listo! 🎉

