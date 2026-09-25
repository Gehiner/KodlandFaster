(() => {
  const COURSE_FILES = [
    'curso_creatividad.json', 'curso_creatividad_2.json', 'curso_drawing.json',
    'curso_funtech.json', 'curso_fwd_pro.json', 'curso_graphic_design.json',
    'curso_illustration.json', 'curso_minecraft.json', 'curso_minecraft_2.json',
    'curso_python.json', 'curso_python_pro.json', 'curso_roblox.json',
    'curso_roblox_2.json', 'curso_scratch.json', 'curso_unity.json', 'curso_web.json'
  ];

  const STYLE = `
    :root{--lime:#c8ea4f;--dark:#1b1b1b;--text:#2b2b2b;--green:#a8d84a;--yellow:#efb03e;--red:#ef7373;--card:#f5f7ee;--line:#e4e8d8}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Segoe UI",Arial,sans-serif;color:var(--text);font-size:12px;background:#fff}
    .page{width:210mm;min-height:297mm;padding:14mm 13mm 16mm;position:relative;page-break-after:always;background:#fff;overflow:hidden}
    .page:last-child{page-break-after:auto}
    h1,h2,h3{font-weight:800}.mut{color:#8a9078;font-size:9px;letter-spacing:.1em;font-weight:700;text-transform:uppercase}
    .banner{width:100%;display:block;border-radius:14px;max-height:86px;object-fit:cover}
    .header{background:var(--lime);border-radius:14px;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}
    .logo{font-size:30px;font-weight:800;color:var(--dark)}.title{text-align:right;color:var(--dark)}.title h1{font-size:20px;line-height:1.1}.title p{font-size:10px;font-weight:700;margin-top:3px}
    .row,.stats{display:flex;gap:12px;margin-top:12px}.tile,.stat{flex:1;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:#fff}
    .tile .value{font-size:15px;font-weight:800;margin-top:4px;color:var(--dark)}.stat{text-align:center;background:var(--card);padding:12px 8px}.stat.dark{background:var(--dark)}
    .stat .number{font-size:27px;font-weight:800;color:var(--dark)}.stat.dark .number{color:var(--lime)}.stat small{font-size:13px}
    .stat .label{font-size:8px;letter-spacing:.05em;font-weight:700;text-transform:uppercase;color:#8a9078;margin-top:2px}.stat.dark .label{color:var(--lime)}
    .section{display:flex;align-items:center;gap:10px;margin:18px 0 9px}.square{width:18px;height:18px;background:var(--lime);border-radius:4px;flex:none}.section h2{font-size:14px;color:var(--dark)}
    .intro{background:var(--card);border-left:5px solid var(--lime);border-radius:0 9px 9px 0;padding:11px 14px;font-size:11px;line-height:1.5}
    .chart{margin-top:14px;border:1px solid var(--line);border-radius:10px;padding:14px 12px 8px}.bars{display:flex;align-items:flex-end;gap:9px;height:180px;position:relative;border-bottom:1px solid #ddd}
    .bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}.bar-col .pct{font-size:10px;font-weight:800;margin-bottom:4px;color:var(--dark)}
    .bar{width:68%;border-radius:5px 5px 0 0}.bar-col.good .bar{background:var(--green)}.bar-col.mid .bar{background:var(--yellow)}.bar-col.low .bar{background:var(--red)}
    .axes{display:flex;gap:9px;margin-top:6px}.axes span{flex:1;text-align:center;font-size:9px;font-weight:700;color:#666}.legend{display:flex;justify-content:center;gap:16px;margin-top:10px;font-size:9px;color:#555}
    .legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}.legend .good{background:var(--green)}.legend .mid{background:var(--yellow)}.legend .low{background:var(--red)}
    .module{border:1px solid var(--line);border-radius:12px;padding:10px 13px;margin:10px 0;page-break-inside:avoid}.module-head{display:flex;align-items:center;gap:10px}
    .badge{width:32px;height:32px;background:var(--dark);color:#fff;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex:none}
    .module-name{flex:1}.module-name h3{font-size:14px;color:var(--dark);margin-top:2px}.module-score{text-align:right;font-size:21px;font-weight:800;color:var(--dark)}.module-score small{font-size:12px}
    .progress{height:7px;border-radius:5px;background:#eee;margin:8px 0;overflow:hidden}.progress i{display:block;height:100%;background:var(--green)}
    .module-cols{display:flex;gap:16px}.module-cols>div{flex:1}.subhead{font-size:8px;letter-spacing:.08em;font-weight:700;color:#8a9078;text-transform:uppercase;margin-bottom:4px}
    .learn{list-style:none}.learn li{font-size:10px;padding:2px 0 2px 13px;position:relative}.learn li:before{content:"›";position:absolute;left:0;color:#9bbd32;font-weight:800}.project{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;font-weight:800;color:#4d6a12;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10px}th{background:var(--card);color:#8a9078;text-transform:uppercase;font-size:8px;text-align:left;padding:7px 8px;border-bottom:2px solid var(--line)}td{padding:8px;border-bottom:1px solid #eef0e6}td.center{text-align:center}
    .session-grid{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.session{width:calc(20% - 6px);border:1px solid var(--line);border-radius:7px;padding:7px 4px;text-align:center;font-size:9px}.session.present{background:#eef7d8;color:#5e7a1a}.session.absent{background:#fbe0e0;color:#a23434}.session.justified{background:#fbecc9;color:#8a5e10}
    .message,.next{background:var(--dark);color:#eee;border-radius:12px;padding:14px 17px;margin-top:13px;line-height:1.5}.message strong,.next strong{color:var(--lime)}.next h2{font-size:18px;color:var(--lime);margin:4px 0}
    .footer{position:absolute;left:13mm;right:13mm;bottom:8mm;background:var(--dark);border-radius:10px;padding:10px 15px;display:flex;justify-content:space-between;color:#fff;font-size:9px}.footer b{color:var(--lime);font-size:14px}
    .page-number{position:absolute;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#b8b8b8}
    .signatures{display:flex;justify-content:space-around;align-items:flex-end;gap:28px;margin:22px 0}.signature{flex:1;max-width:290px;text-align:center;border-top:1px solid var(--dark);padding-top:6px;font-weight:700}.seal{width:90px;height:90px;border:2px dashed #c4c8b4;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;color:#aeb39f;font-size:8px;font-weight:700}
    @page{size:A4;margin:0}
  `;

  const labels = {
    es: { report: 'REPORTE DE DESARROLLO', summary: 'VISIÓN GENERAL DEL DESEMPEÑO', details: 'DETALLE POR MÓDULO', grade: 'CALIFICACIONES Y ASISTENCIA', learn: 'PRINCIPALES APRENDIZAJES', project: 'PROYECTO DESARROLLADO', student: 'ALUMNO', course: 'CURSO', teacher: 'PROFESOR(A)', average: 'APROVECHAMIENTO PROMEDIO', tasks: 'TAREAS ENVIADAS', attendance: 'ASISTENCIA', module: 'MÓDULO', final: 'CONSIDERACIONES FINALES', next: 'PRÓXIMO PASO RECOMENDADO', message: 'MENSAJE PARA TI' },
    pt: { report: 'RELATÓRIO DE DESENVOLVIMENTO', summary: 'VISÃO GERAL DO DESEMPENHO', details: 'DETALHAMENTO POR MÓDULO', grade: 'NOTAS E PRESENÇA', learn: 'PRINCIPAIS APRENDIZADOS', project: 'PROJETO DESENVOLVIDO', student: 'ALUNO', course: 'CURSO', teacher: 'PROFESSOR(A)', average: 'APROVEITAMENTO MÉDIO', tasks: 'TAREFAS ENVIADAS', attendance: 'PRESENÇA', module: 'MÓDULO', final: 'CONSIDERAÇÕES FINAIS', next: 'PRÓXIMO PASSO RECOMENDADO', message: 'MENSAGEM PARA VOCÊ' }
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const clampPct = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const scoreClass = value => value >= 70 ? 'good' : value >= 50 ? 'mid' : 'low';
  const cleanName = value => String(value || 'alumno').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'alumno';

  async function loadCourse(courseTitle) {
    const normalize = value => String(value || '').toLowerCase()
      .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
      .split(/[^a-z0-9]+/).filter(Boolean);
    const titleWords = new Set(normalize(courseTitle));
    const isDigitalCreativity = titleWords.has('digital') && titleWords.has('creativity');
    const titleWordList = [...titleWords];
    const levelMarkerIndex = titleWordList.findIndex(word => word === 'lvl' || word === 'level');
    const level = levelMarkerIndex >= 0 ? titleWordList[levelMarkerIndex + 1] : null;
    const aliasFile = isDigitalCreativity && levelMarkerIndex >= 0
      ? ({ '1': 'curso_creatividad.json', '2': 'curso_creatividad_2.json' })[level]
      : null;
    const candidates = COURSE_FILES.map(file => ({ file, words: normalize(file.replace(/^curso_|\.json$/g, '').replace(/_/g, ' ')) }))
      .filter(item => item.words.length && item.words.every(word => titleWords.has(word)))
      .sort((a, b) => b.words.length - a.words.length);
    const selectedFile = aliasFile || candidates[0]?.file;
    if (!selectedFile) throw new Error(`No encontré una plantilla para el curso «${courseTitle}».`);
    const url = chrome.runtime.getURL(`calificador/reportes/${selectedFile}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo cargar la plantilla ${selectedFile}.`);
    return response.json();
  }

  function buildHtml(course, report, selectedModule = null) {
    const ui = labels[course.idioma] || labels.es;
    const modules = selectedModule ? report.modules.filter(item => item.numero === selectedModule) : report.modules;
    if (!modules.length) throw new Error('El reporte no contiene módulos para generar.');
    const average = Math.round(modules.reduce((sum, item) => sum + clampPct(item.pct), 0) / modules.length);
    const best = modules.reduce((item, current) => clampPct(current.pct) > clampPct(item.pct) ? current : item, modules[0]);
    const classPct = value => clampPct(value);
    const banner = report.bannerUrl ? `<img class="banner" src="${esc(report.bannerUrl)}">` : '';
    const pageNum = number => `<div class="page-number">Kodland · ${ui.report} · Página ${number}</div>`;
    const header = `<div class="header"><div class="logo">kodland</div><div class="title"><h1>${ui.report}</h1><p>${esc(report.studentName)} · ${esc(course.curso)}</p></div></div>`;
    const pages = [];

    pages.push(`<section class="page">${banner}<div class="section"><i class="square"></i><h2>DATOS BÁSICOS DEL ESTUDIANTE</h2></div><table><tr><th>${ui.student}</th><td>${esc(report.studentName)}</td><th>${ui.course}</th><td>${esc(course.curso)}</td></tr><tr><th>ACUDIENTE</th><td>${esc(report.data.acudiente || '—')}</td><th>CÓDIGO DEL GRUPO</th><td>${esc(report.groupCode || '—')}</td></tr><tr><th>E-MAIL</th><td>${esc(report.data.email || '—')}</td><th>TIPO DE GRUPO</th><td>${esc(report.data.tipo_grupo || '—')}</td></tr><tr><th>TELÉFONO</th><td>${esc(report.data.telefono || '—')}</td><th>DÍA Y HORA</th><td>${esc(report.data.dia_hora || '—')}</td></tr></table><div class="section"><i class="square"></i><h2>OBJETIVO DEL INFORME</h2></div><div class="intro">${esc((course.objetivo_informe || `Presentar de forma clara el avance de {alumno} en el curso {curso}, describiendo los aprendizajes alcanzados y los aspectos a reforzar.`).replaceAll('{alumno}', report.studentName).replaceAll('{curso}', course.curso))}</div><div class="section"><i class="square"></i><h2>CÓMO INTERPRETAR ESTE INFORME</h2></div><div class="intro">El porcentaje refleja el aprovechamiento registrado en cada módulo. El reporte muestra los módulos impartidos hasta la fecha.</div>${pageNum(1)}</section>`);

    const bars = modules.map(item => `<div class="bar-col ${scoreClass(item.pct)}"><span class="pct">${clampPct(item.pct)}%</span><i class="bar" style="height:${Math.round(160 * clampPct(item.pct) / 100)}px"></i></div>`).join('');
    const axes = modules.map(item => `<span>M${item.numero}</span>`).join('');
    const stats = `<div class="stats"><div class="stat dark"><div class="number">${average}<small>%</small></div><div class="label">${ui.average}</div></div><div class="stat"><div class="number">${report.tasksSent}<small>/${report.tasksTotal}</small></div><div class="label">${ui.tasks}</div></div><div class="stat"><div class="number">${report.attendance.attended}<small>/${report.attendance.total}</small></div><div class="label">${ui.attendance}</div></div><div class="stat"><div class="number">${clampPct(best.pct)}<small>%</small></div><div class="label">MEJOR MÓDULO · M${best.numero}</div></div></div>`;
    const message = average >= 85
      ? `¡Felicitaciones, ${report.studentName}! Demuestras dominio y constancia a lo largo del curso. ¡Sigue así!`
      : average >= 70
        ? `¡Muy bien, ${report.studentName}! Tienes un desempeño sólido. Con un poco más de práctica llegarás al nivel más alto.`
        : average >= 50
          ? `¡Buen trabajo, ${report.studentName}! Vas construyendo una base firme. Sigue practicando los temas que presentan más reto.`
          : `${report.studentName}, cada avance cuenta. Te animamos a reforzar los temas vistos y continuar practicando.`;
    pages.push(`<section class="page">${header}<div class="row"><div class="tile"><div class="mut">ÁREA DE INTERÉS</div><div class="value">${esc(course.area_interes || '')}</div></div><div class="tile"><div class="mut">PRÓXIMO NIVEL RECOMENDADO</div><div class="value">${esc(course.proximo_nivel || '')}</div></div></div>${stats}<div class="section"><i class="square"></i><h2>${ui.summary}</h2></div><div class="intro">${esc((course.vision_general || '').replaceAll('{alumno}', report.studentName))}</div><div class="chart"><div class="bars">${bars}</div><div class="axes">${axes}</div><div class="legend"><span><i class="good"></i>Óptimo (≥70%)</span><span><i class="mid"></i>Bueno (50–69%)</span><span><i class="low"></i>En desarrollo (&lt;50%)</span></div></div><div class="message"><strong>${ui.message}</strong><p>${esc(message)}</p></div>${pageNum(2)}</section>`);

    if (report.includeDetails) {
      const rows = modules.map(item => `<tr><td>M${item.numero} · ${esc(item.titulo)}</td><td class="center">${item.tasksSent}/${item.tasksTotal}</td><td class="center">${item.points}/${item.maxPoints}</td><td>${clampPct(item.pct)}%</td></tr>`).join('');
      const sessions = report.attendance.sessions.map(item => `<div class="session ${item.status}">${esc(item.label)}<br>${esc(item.text)}</div>`).join('');
      pages.push(`<section class="page"><div class="section"><i class="square"></i><h2>${ui.grade}</h2></div><table><tr><th>Módulo</th><th class="center">Tareas</th><th class="center">Puntos</th><th>Avance</th></tr>${rows}</table><div class="section"><i class="square"></i><h2>ASISTENCIA A CLASES</h2></div><div class="session-grid">${sessions || '<div class="intro">No hay datos de asistencia disponibles.</div>'}</div>${pageNum(3)}</section>`);
    }

    modules.forEach((item, index) => {
      const learnings = (item.aprendizajes || []).map(value => `<li>${esc(value)}</li>`).join('');
      pages.push(`<section class="page">${index === 0 ? `<div class="section"><i class="square"></i><h2>${ui.details}</h2></div>` : ''}<article class="module"><div class="module-head"><div class="badge">${String(item.numero).padStart(2, '0')}</div><div class="module-name"><div class="mut">${ui.module} ${item.numero}</div><h3>${esc(item.titulo)}</h3></div><div class="module-score">${clampPct(item.pct)}<small>%</small></div></div><div class="progress"><i style="width:${clampPct(item.pct)}%"></i></div><p class="intro">${esc((item.descripcion || '').replaceAll('{alumno}', report.studentName))}</p><div class="module-cols"><div><div class="subhead">${ui.learn}</div><ul class="learn">${learnings}</ul></div><div><div class="subhead">${ui.project}</div><div class="project">${esc(item.proyecto || '')}</div></div></div></article>${pageNum(index + (report.includeDetails ? 4 : 3))}</section>`);
    });

    const competencies = (course.competencias || []).map(item => `<li>${esc(item)}</li>`).join('');
    const next = course.proximo_paso || {};
    pages.push(`<section class="page"><div class="section"><i class="square"></i><h2>${ui.final}</h2></div><div class="intro">${esc((course.consideraciones || '').replaceAll('{alumno}', report.studentName))}</div><div class="section"><i class="square"></i><h2>COMPETENCIAS DESARROLLADAS</h2></div><ul class="learn">${competencies}</ul><div class="next"><strong>${ui.next}</strong><h2>${esc(next.titulo || '')}</h2><p>${esc((next.texto || '').replaceAll('{alumno}', report.studentName))}</p></div><div class="signatures"><div class="signature">${esc(report.teacher || '')}<br><span class="mut">PROFESOR(A) · EQUIPO KODLAND</span></div><div class="seal">SELLO<br>KODLAND</div></div><div class="footer"><b>kodland</b><span>EDUCAR · INSPIRAR · TRANSFORMAR</span><span>kodland.com.br</span></div>${pageNum(pages.length + 1)}</section>`);
    return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${pages.join('')}</body></html>`;
  }

  async function download(course, report, selectedModule = null) {
    if (typeof globalThis.html2pdf !== 'function') throw new Error('No se cargó el generador PDF. Recarga la extensión en chrome://extensions.');
    if (typeof globalThis.jspdf?.jsPDF !== 'function') throw new Error('No se cargó jsPDF. Reinstala las dependencias con npm install y recarga la extensión.');
    const html = buildHtml(course, report, selectedModule);
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;left:-100vw;top:0;width:210mm;background:#fff;';
    wrapper.innerHTML = `<style>${STYLE}</style>${html.replace(/^.*?<body>/s, '').replace(/<\/body>.*$/s, '')}`;
    document.body.appendChild(wrapper);
    const filename = `Reporte ${cleanName(report.studentName)}${selectedModule ? ` M${selectedModule}` : ' general'}.pdf`;
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(wrapper.querySelectorAll('img'), image =>
        image.decode().catch(() => undefined)
      ));
      const sections = Array.from(wrapper.querySelectorAll('.page'));
      if (!sections.length) throw new Error('El reporte no contiene páginas para exportar.');

      const pdf = new globalThis.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      for (const [index, section] of sections.entries()) {
        section.style.pageBreakAfter = 'auto';
        section.style.breakAfter = 'auto';
        const worker = globalThis.html2pdf().set({
          margin: 0,
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          pagebreak: { mode: [] }
        }).from(section);
        const canvas = await worker.toCanvas().get('canvas');
        if (!canvas.width || !canvas.height) {
          throw new Error('Una página del reporte se renderizó vacía. No se descargó el PDF.');
        }

        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let visibleSamples = 0;
        const sampleStep = Math.max(4, Math.floor(pixels.length / 40000 / 4) * 4);
        for (let pixel = 0; pixel < pixels.length; pixel += sampleStep) {
          if (pixels[pixel] < 245 || pixels[pixel + 1] < 245 || pixels[pixel + 2] < 245) {
            visibleSamples += 1;
            if (visibleSamples >= 20) break;
          }
        }
        if (visibleSamples < 20) throw new Error(`La página ${index + 1} salió en blanco. No se descargó el PDF.`);

        if (index > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 210, 297);
      }

      if (pdf.internal.getNumberOfPages() !== sections.length) {
        throw new Error('El PDF no contiene todas las páginas del reporte. Inténtalo de nuevo.');
      }

      const blob = pdf.output('blob');
      if (blob.size < 10000) throw new Error('El PDF generado parece estar vacío; no se descargó.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      wrapper.remove();
    }
    return filename;
  }

  globalThis.KodlandReportGenerator = { loadCourse, buildHtml, download };
})();