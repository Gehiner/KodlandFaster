// Panel flotante para lanzar el calificador de Python desde la extensión.
// Solo envía ETIQUETAS al service worker, que las reenvía al puente local
// (Native Messaging). No ejecuta nada por sí mismo.

(function () {
  if (window.__kfCalificadorPanel) return;   // evitar duplicados
  window.__kfCalificadorPanel = true;

  // Etiqueta -> texto del botón. "confirmar" pide confirmación (acciones que
  // califican/comentan de verdad).
  const ACCIONES = [
    { id: 'ping',               texto: '🔌 Probar puente',         confirmar: false },
    { id: 'simular',            texto: '👁 Simular (no califica)',  confirmar: false },
    { id: 'probar_comentarios', texto: '💬 Vista previa comentarios', confirmar: false },
    { id: 'probar_ia',          texto: '🤖 Probar IA',             confirmar: false },
    { id: 'calificar',          texto: '✅ Calificar TODO',         confirmar: true },
    { id: 'calificar_comentar', texto: '✅💬 Calificar + comentar', confirmar: true },
    { id: 'comentar_grupo',     texto: '📝 Comentar un grupo',      confirmar: true },
    { id: 'diagnostico',        texto: '🛠 Diagnóstico',            confirmar: false },
  ];

  function estilo(el, obj) { Object.assign(el.style, obj); }

  function crearPanel() {
    if (document.getElementById('kf-cal-launcher')) return;

    // Botón lanzador (siempre visible, abajo a la derecha)
    const lanzador = document.createElement('button');
    lanzador.id = 'kf-cal-launcher';
    lanzador.textContent = '🎓 Calificador';
    estilo(lanzador, {
      position: 'fixed', bottom: '18px', right: '18px', zIndex: 2147483646,
      background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '24px',
      padding: '10px 16px', fontWeight: '600', cursor: 'pointer',
      boxShadow: '0 2px 10px rgba(0,0,0,.25)', fontFamily: 'Segoe UI, system-ui, sans-serif',
    });

    // Panel con los botones
    const panel = document.createElement('div');
    panel.id = 'kf-cal-panel';
    estilo(panel, {
      position: 'fixed', bottom: '64px', right: '18px', zIndex: 2147483646,
      background: '#fff', border: '1px solid #dde', borderRadius: '12px',
      padding: '12px', width: '250px', display: 'none',
      boxShadow: '0 6px 24px rgba(0,0,0,.2)', fontFamily: 'Segoe UI, system-ui, sans-serif',
    });

    const titulo = document.createElement('div');
    titulo.textContent = 'Calificador de tareas';
    estilo(titulo, { fontWeight: '700', fontSize: '14px', color: '#223',
      marginBottom: '8px' });
    panel.appendChild(titulo);

    const estado = document.createElement('div');
    estado.id = 'kf-cal-estado';
    estilo(estado, { fontSize: '12px', color: '#556', minHeight: '16px',
      marginBottom: '8px', whiteSpace: 'pre-wrap' });
    estado.textContent = 'Listo.';

    ACCIONES.forEach((a) => {
      const b = document.createElement('button');
      b.textContent = a.texto;
      estilo(b, {
        display: 'block', width: '100%', textAlign: 'left', margin: '4px 0',
        padding: '8px 10px', border: '1px solid #e3e6ef', borderRadius: '8px',
        background: a.confirmar ? '#fff5f5' : '#f6f8ff', color: '#223',
        cursor: 'pointer', fontSize: '13px',
      });
      b.addEventListener('click', () => lanzar(a, estado, panel));
      panel.appendChild(b);
    });

    panel.appendChild(estado);

    lanzador.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.body.appendChild(lanzador);
    document.body.appendChild(panel);
  }

  function lanzar(accion, estado, panel) {
    if (accion.confirmar) {
      const ok = window.confirm(
        `"${accion.texto}"\n\nEsto va a CALIFICAR/COMENTAR de verdad en Kodland.\n¿Continuar?`);
      if (!ok) return;
    }
    estado.textContent = '⏳ Enviando al puente…';
    try {
      chrome.runtime.sendMessage({ tipo: 'calificador', action: accion.id }, (resp) => {
        if (chrome.runtime.lastError) {
          estado.textContent = '❌ ' + chrome.runtime.lastError.message;
          return;
        }
        if (resp && resp.ok) {
          estado.textContent = '✅ ' + (resp.mensaje || 'Acción enviada.');
        } else {
          estado.textContent = '❌ ' + ((resp && resp.error) || 'El puente no respondió. ¿Está instalado?');
        }
      });
    } catch (e) {
      estado.textContent = '❌ ' + e;
    }
  }

  // Inyectar cuando el DOM esté listo, y reintentar por si la SPA recarga
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', crearPanel);
  } else {
    crearPanel();
  }
  let intentos = 0;
  const t = setInterval(() => {
    crearPanel();
    if (++intentos > 10) clearInterval(t);
  }, 2000);
})();
