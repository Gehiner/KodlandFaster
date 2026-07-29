# Kodland WhatsApp Welcome - Extensión de Chrome

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
├── manifest.json       # Configuración de la extensión
├── content.js          # Script que inyecta el botón
├── styles.css          # Estilos del botón
└── README.md          # Este archivo
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

## Licencia

Este proyecto es de uso personal/educacional.

