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
    .page{width:210mm;height:297mm;min-height:297mm;padding:14mm 13mm 16mm;position:relative;page-break-after:always;background:#fff;overflow:hidden}
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
    .progress{height:7px;border-radius:5px;background:#eee;margin:8px 0;overflow:hidden}.progress i{display:block;height:100%;background:var(--green)}.progress i.good,.mini i.good{background:var(--green)}.progress i.mid,.mini i.mid{background:var(--yellow)}.progress i.low,.mini i.low{background:var(--red)}
    .module-cols{display:flex;gap:16px}.module-cols>div{flex:1}.subhead{font-size:8px;letter-spacing:.08em;font-weight:700;color:#8a9078;text-transform:uppercase;margin-bottom:4px}
    .learn{list-style:none}.learn li{font-size:10px;padding:2px 0 2px 13px;position:relative}.learn li:before{content:"›";position:absolute;left:0;color:#9bbd32;font-weight:800}.project{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;font-weight:800;color:#4d6a12;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10px}th{background:var(--card);color:#8a9078;text-transform:uppercase;font-size:8px;text-align:left;padding:7px 8px;border-bottom:2px solid var(--line)}td{padding:8px;border-bottom:1px solid #eef0e6}td.center{text-align:center}
    .session-grid{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.session{width:calc(20% - 6px);border:1px solid var(--line);border-radius:7px;padding:7px 4px;text-align:center;font-size:9px}.session.present{background:#eef7d8;color:#5e7a1a}.session.absent{background:#fbe0e0;color:#a23434}.session.justified{background:#fbecc9;color:#8a5e10}
    .cover-table{width:100%;border:1px solid var(--line);border-radius:10px;overflow:hidden;border-spacing:0;font-size:10px}.cover-table th{width:20%;background:#f0f3e6;color:#6a7358;border:1px solid var(--line);text-align:left;padding:8px;font-size:8px}.cover-table td{width:30%;background:#fff;color:var(--dark);border:1px solid var(--line);padding:8px;font-weight:700;overflow-wrap:anywhere}.cover-table td.empty{color:#aeb39f;font-weight:600}
    .mini{display:inline-block;width:48px;height:7px;margin-right:5px;vertical-align:middle;background:#eee;border-radius:4px;overflow:hidden}.mini i{display:block;height:100%}
    .mode{background:var(--card);border-left:5px solid var(--lime);border-radius:0 9px 9px 0;padding:11px 14px}.mode ol{padding-left:18px}.mode li{font-size:10px;line-height:1.55;margin:2px 0}.mode .mode-foot{margin-top:8px;padding-top:7px;border-top:1px dashed #cdd6b8;font-size:10px;line-height:1.5}
    .message,.next{background:var(--dark);color:#eee;border-radius:12px;padding:14px 17px;margin-top:13px;line-height:1.5}.message strong,.next strong{color:var(--lime)}.next h2{font-size:18px;color:var(--lime);margin:4px 0}
    .average-line{position:absolute;left:0;right:0;border-top:2px dashed #aaa}.average-label{position:absolute;right:1px;background:#fff;padding:0 3px;font-size:9px;font-weight:800;color:#555}
    .footer{position:absolute;left:13mm;right:13mm;bottom:8mm;background:var(--dark);border-radius:10px;padding:10px 15px;display:flex;justify-content:space-between;color:#fff;font-size:9px}.footer b{color:var(--lime);font-size:14px}
    .page-number{position:absolute;bottom:4mm;left:0;right:0;text-align:center;font-size:8px;color:#b8b8b8}
    .signatures{display:flex;justify-content:space-around;align-items:flex-end;gap:28px;margin:22px 0}.signature{flex:1;max-width:290px;text-align:center;border-top:1px solid var(--dark);padding-top:6px;font-weight:700}.seal{width:90px;height:90px;border:2px dashed #c4c8b4;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;color:#aeb39f;font-size:8px;font-weight:700}
    @page{size:A4;margin:0}
  `;

  const labels = {
    es: {
      report: 'REPORTE DE DESARROLLO', summary: 'VISIÓN GENERAL DEL DESEMPEÑO', details: 'DETALLE POR MÓDULO',
      grade: 'CALIFICACIONES Y ASISTENCIA', learn: 'PRINCIPALES APRENDIZAJES', project: 'PROYECTO DESARROLLADO',
      student: 'ALUMNO', course: 'CURSO', teacher: 'PROFESOR(A)', average: 'APROVECHAMIENTO PROMEDIO',
      tasks: 'TAREAS ENVIADAS', attendance: 'ASISTENCIA', module: 'MÓDULO', final: 'CONSIDERACIONES FINALES',
      next: 'PRÓXIMO PASO RECOMENDADO', message: 'MENSAJE PARA TI', data: 'DATOS BÁSICOS DEL ESTUDIANTE',
      guardian: 'ACUDIENTE', groupCode: 'CÓDIGO DEL GRUPO', groupType: 'TIPO DE GRUPO', email: 'E-MAIL',
      dayTime: 'DÍA Y HORA DE CLASE', phone: 'TELÉFONO', country: 'PAÍS', objective: 'OBJETIVO DEL INFORME',
      interpret: 'CÓMO INTERPRETAR ESTE INFORME', averageLabel: 'Promedio', best: 'MEJOR MÓDULO',
      projectCount: 'PROYECTOS COMPLETADOS', modules: 'MÓDULOS CURSADOS',
      bands: ['Óptimo (≥70%)', 'Bueno (50–69%)', 'En desarrollo (<50%)'],
      modeItems: [
        ['Aprovechamiento', 'porcentaje alcanzado en cada módulo sobre el puntaje máximo.'],
        ['Bandas de color', 'Óptimo (≥70%), Bueno (50–69%) y En desarrollo (<50%).'],
        ['Visión general', 'gráfico comparativo con todos los módulos del curso.'],
        ['Calificaciones y asistencia', 'tareas enviadas, puntos obtenidos y asistencia por módulo.'],
        ['Detalle por módulo', 'principales aprendizajes y proyecto desarrollado.'],
        ['Consideraciones finales', 'valoración del proceso y próximo paso recomendado.']
      ]
    },
    pt: {
      report: 'RELATÓRIO DE DESENVOLVIMENTO', summary: 'VISÃO GERAL DO DESEMPENHO', details: 'DETALHAMENTO POR MÓDULO',
      grade: 'NOTAS E PRESENÇA', learn: 'PRINCIPAIS APRENDIZADOS', project: 'PROJETO DESENVOLVIDO',
      student: 'ALUNO', course: 'CURSO', teacher: 'PROFESSOR(A)', average: 'APROVEITAMENTO MÉDIO',
      tasks: 'TAREFAS ENVIADAS', attendance: 'PRESENÇA', module: 'MÓDULO', final: 'CONSIDERAÇÕES FINAIS',
      next: 'PRÓXIMO PASSO RECOMENDADO', message: 'MENSAGEM PARA VOCÊ', data: 'DADOS BÁSICOS DO ESTUDANTE',
      guardian: 'RESPONSÁVEL', groupCode: 'CÓDIGO DO GRUPO', groupType: 'TIPO DE GRUPO', email: 'E-MAIL',
      dayTime: 'DIA E HORÁRIO DA AULA', phone: 'TELEFONE', country: 'PAÍS DE RESIDÊNCIA', objective: 'OBJETIVO DO RELATÓRIO',
      interpret: 'COMO INTERPRETAR ESTE RELATÓRIO', averageLabel: 'Média', best: 'MELHOR MÓDULO',
      projectCount: 'PROJETOS CONCLUÍDOS', modules: 'MÓDULOS CURSADOS',
      bands: ['Ótimo (≥70%)', 'Bom (50–69%)', 'Em desenvolvimento (<50%)'],
      modeItems: [
        ['Aproveitamento', 'porcentagem alcançada em cada módulo sobre a pontuação máxima.'],
        ['Faixas de cor', 'Ótimo (≥70%), Bom (50–69%) e Em desenvolvimento (<50%).'],
        ['Visão geral', 'gráfico comparativo com todos os módulos do curso.'],
        ['Notas e presença', 'tarefas enviadas, pontos obtidos e presença por módulo.'],
        ['Detalhamento por módulo', 'principais aprendizados e projeto desenvolvido.'],
        ['Considerações finais', 'avaliação do processo e próximo passo recomendado.']
      ]
    }
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
    const allModules = report.modules || [];
    const modules = selectedModule == null
      ? allModules
      : allModules.filter(item => Number(item.numero) === Number(selectedModule));
    if (!modules.length) throw new Error('El reporte no contiene módulos para generar.');

    const pcts = modules.map(item => clampPct(item.pct));
    const cursados = pcts.map((pct, index) => pct > 0 ? index : -1).filter(index => index >= 0);
    const indices = cursados.length ? cursados : modules.map((_module, index) => index);
    const average = Math.round(indices.reduce((sum, index) => sum + pcts[index], 0) / (indices.length || 1));
    const bestIndex = indices.reduce((best, index) => pcts[index] > pcts[best] ? index : best, indices[0] || 0);
    const worstIndex = indices.reduce((worst, index) => pcts[index] < pcts[worst] ? index : worst, indices[0] || 0);
    const best = modules[bestIndex];
    const worst = modules[worstIndex];
    const totalTasksSent = modules.reduce((sum, item) => sum + (Number(item.tasksSent) || 0), 0);
    const totalTasks = modules.reduce((sum, item) => sum + (Number(item.tasksTotal) || 0), 0);
    const totalPoints = modules.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
    const maxPoints = modules.reduce((sum, item) => sum + (Number(item.maxPoints) || 0), 0);
    const sessions = selectedModule == null
      ? report.attendance.sessions
      : (modules[0].attendance?.sessions || report.attendance.sessions.filter(item => item.moduleNumber === Number(selectedModule)));
    const attended = selectedModule == null
      ? report.attendance.attended
      : (modules[0].attendance?.attended ?? sessions.filter(item => item.status === 'present').length);
    const courseName = course.curso || '';
    const studentName = report.studentName || 'Alumno';
    const data = report.data || {};
    const visionText = selectedModule == null
      ? (course.vision_general || '').replaceAll('{alumno}', studentName)
      : `En el módulo ${modules[0].numero}, ${studentName} trabajó ${modules[0].titulo}. El avance registrado es ${pcts[0]}%, con ${modules[0].tasksSent || 0} de ${modules[0].tasksTotal || 0} tareas enviadas.`;

    let message;
    if (average >= 85) {
      message = `¡Felicitaciones, ${studentName}! Tu desempeño es excelente: demuestras dominio y constancia a lo largo del curso. Destacas especialmente en «${best.titulo}». ¡Sigue así, vas por un camino sobresaliente!`;
    } else if (average >= 70) {
      message = `¡Muy bien, ${studentName}! Tienes un desempeño sólido y parejo. Tu mejor módulo fue «${best.titulo}». Con un poco más de práctica en los temas que se te resistieron, llegarás al nivel más alto.`;
    } else if (average >= 50) {
      message = `¡Buen trabajo, ${studentName}! Vas construyendo una base firme. Brillaste en «${best.titulo}». Hay una buena oportunidad de mejorar reforzando «${worst.titulo}» (${pcts[worstIndex]}%); ¡con dedicación lo vas a lograr!`;
    } else {
      message = `${studentName}, estás dando tus primeros pasos y cada avance cuenta. Tu punto más fuerte fue «${best.titulo}». Te animamos a reforzar los módulos con menor avance, sobre todo «${worst.titulo}» (${pcts[worstIndex]}%). ¡Con práctica y apoyo vas a progresar mucho!`;
    }
    if (course.idioma === 'pt') message = message.replaceAll('¡', '').replace('Felicitaciones', 'Parabéns');

    const escapeReplace = text => String(text || '').replaceAll('{alumno}', studentName).replaceAll('{curso}', courseName);
    const pageNum = number => `<div class="page-number">Kodland · ${esc(ui.report)} · Página ${number}</div>`;
    const sectionTitle = text => `<div class="section"><i class="square"></i><h2>${esc(text)}</h2></div>`;
    const cell = value => {
      const text = String(value || '').trim();
      return text ? `<td>${esc(text)}</td>` : '<td class="empty">—</td>';
    };
    const banner = report.bannerUrl ? `<img class="banner" src="${esc(report.bannerUrl)}">` : '';
    const moduleLabel = selectedModule == null ? (data.modulo_informe || `M${modules[cursados.at(-1) ?? 0]?.numero || ''}`) : `M${selectedModule}`;
    const moduleModes = ui.modeItems.map(([title, description]) => `<li><b>${esc(title)}</b> — ${esc(description)}</li>`).join('');

    const coverRows = [
      [ui.student, studentName, ui.groupCode, data.codigo_grupo || report.groupCode],
      [ui.guardian, data.acudiente, ui.groupType, data.tipo_grupo],
      [ui.email, data.email, ui.dayTime, data.dia_hora],
      [ui.phone, data.telefono, ui.module, moduleLabel],
      [ui.country, data.pais, ui.course, courseName]
    ].map(row => `<tr><th>${esc(row[0])}</th>${cell(row[1])}<th>${esc(row[2])}</th>${cell(row[3])}</tr>`).join('');

    const pageOne = `<section class="page">${banner}${sectionTitle(ui.data)}<table class="cover-table">${coverRows}</table>${sectionTitle(ui.objective)}<div class="intro">${esc(escapeReplace(course.objetivo_informe || `Presentar de forma clara el avance de {alumno} en el curso {curso}, describiendo los aprendizajes alcanzados en cada módulo, su nivel de aprovechamiento y los aspectos a reforzar.`))}</div>${sectionTitle(ui.interpret)}<div class="mode"><ol>${moduleModes}</ol><div class="mode-foot">${course.idioma === 'pt' ? 'Ao final' : 'Al final'} ${course.idioma === 'pt' ? 'inclui-se uma avaliação' : 'se incluye una valoración'} ${course.idioma === 'pt' ? 'do processo formativo de' : 'del proceso formativo de'} ${esc(studentName)}, ${course.idioma === 'pt' ? 'destacando aspectos relevantes do seu desempenho.' : 'destacando aspectos relevantes de su desempeño.'}</div></div>${pageNum(1)}</section>`;

    const header = `<div class="header"><div class="logo">kodland</div><div class="title"><h1>${esc(ui.report)}</h1><p>${esc(studentName)} · ${esc(courseName)}</p></div></div>`;
    const statHtml = `<div class="stats"><div class="stat dark"><div class="number">${average}<small>%</small></div><div class="label">${esc(ui.average)}</div></div><div class="stat"><div class="number">${totalTasksSent}<small>/${totalTasks}</small></div><div class="label">${esc(ui.tasks)}</div></div><div class="stat"><div class="number">${attended}<small>/${sessions.length}</small></div><div class="label">${esc(ui.attendance)}</div></div><div class="stat"><div class="number">${pcts[bestIndex]}<small>%</small></div><div class="label">${esc(ui.best)} · M${best.numero}</div></div></div>`;
    const maxBarHeight = 160;
    const bars = modules.map((item, index) => `<div class="bar-col ${scoreClass(pcts[index])}"><span class="pct">${pcts[index]}%</span><i class="bar" style="height:${Math.round(maxBarHeight * pcts[index] / 100)}px"></i></div>`).join('');
    const axes = modules.map(item => `<span>M${item.numero}</span>`).join('');
    const averageTop = 180 - (maxBarHeight * average / 100);
    const overview = `<section class="page">${header}<div class="row"><div class="tile"><div class="mut">${course.idioma === 'pt' ? 'ÁREA DE INTERESSE' : 'ÁREA DE INTERÉS'}</div><div class="value">${esc(course.area_interes || '')}</div></div><div class="tile"><div class="mut">${course.idioma === 'pt' ? 'PRÓXIMO NÍVEL RECOMENDADO' : 'PRÓXIMO NIVEL RECOMENDADO'}</div><div class="value">${esc(course.proximo_nivel || '')}</div></div></div>${statHtml}${sectionTitle(ui.summary)}<div class="intro">${esc(visionText)}</div><div class="chart"><div class="bars">${bars}<div class="average-line" style="top:${averageTop}px"></div><div class="average-label" style="top:${averageTop - 14}px">${esc(ui.averageLabel)} ${average}%</div></div><div class="axes">${axes}</div><div class="legend"><span><i class="good"></i>${esc(ui.bands[0])}</span><span><i class="mid"></i>${esc(ui.bands[1])}</span><span><i class="low"></i>${esc(ui.bands[2])}</span></div></div><div class="message"><strong>${esc(ui.message)}</strong><p>${esc(message)}</p></div>${pageNum(2)}</section>`;

    const gradeRows = modules.map((item, index) => `<tr><td>M${item.numero} · ${esc(item.titulo)}</td><td class="center">${Number(item.tasksSent) || 0}/${Number(item.tasksTotal) || 0}</td><td class="center">${Number(item.points) || 0}/${Number(item.maxPoints) || 0}</td><td><span class="mini"><i class="${scoreClass(pcts[index])}" style="width:${pcts[index]}%"></i></span>${pcts[index]}%</td></tr>`).join('');
    const gradePage = `<section class="page">${sectionTitle(ui.grade)}<table><tr><th>${esc(ui.module)}</th><th class="center">${esc(ui.tasks)}</th><th class="center">${course.idioma === 'pt' ? 'PONTOS' : 'PUNTOS'}</th><th>${course.idioma === 'pt' ? 'PROGRESSO' : 'AVANCE'}</th></tr>${gradeRows}<tr><td><b>TOTAL</b></td><td class="center"><b>${totalTasksSent}/${totalTasks}</b></td><td class="center"><b>${totalPoints}/${maxPoints}</b></td><td><b>${average}%</b></td></tr></table>${sectionTitle(course.idioma === 'pt' ? 'PRESENÇA NAS AULAS' : 'ASISTENCIA A CLASES')}<div class="session-grid">${sessions.map(item => `<div class="session ${esc(item.status)}">${esc(item.label)}<br>${esc(item.text)}</div>`).join('') || '<div class="intro">No hay datos de asistencia disponibles.</div>'}</div>${pageNum(3)}</section>`;

    const estimateModuleHeight = item => {
      const lineCount = (text, width) => Math.max(1, Math.ceil(String(text || '').length / width));
      return 125 + 18 * lineCount(item.descripcion, 128) + 18 * (item.aprendizajes || []).reduce((sum, learning) => sum + lineCount(learning, 46), 0);
    };
    const heights = modules.map(estimateModuleHeight);
    const modulePages = [];
    let moduleGroup = [];
    let usedHeight = 0;
    modules.forEach((module, index) => {
      const limit = modulePages.length ? 995 : 943;
      if (moduleGroup.length && usedHeight + heights[index] > limit) {
        modulePages.push(moduleGroup);
        moduleGroup = [];
        usedHeight = 0;
      }
      moduleGroup.push(index);
      usedHeight += heights[index];
    });
    if (moduleGroup.length) modulePages.push(moduleGroup);
    for (let pageIndex = modulePages.length - 1; pageIndex > 0; pageIndex--) {
      const previous = modulePages[pageIndex - 1];
      const current = modulePages[pageIndex];
      while (previous.length - current.length >= 2) {
        const moveIndex = previous[previous.length - 1];
        if (current.reduce((sum, index) => sum + heights[index], 0) + heights[moveIndex] > 995) break;
        current.unshift(previous.pop());
      }
    }
    let pageNumber = 4;
    const modulePageHtml = modulePages.map(group => {
      const cards = group.map(index => {
        const item = modules[index];
        const pct = pcts[index];
        return `<article class="module"><div class="module-head"><div class="badge">${String(item.numero).padStart(2, '0')}</div><div class="module-name"><div class="mut">${esc(ui.module)} ${item.numero}</div><h3>${esc(item.titulo)}</h3></div><div class="module-score">${pct}<small>%</small><br><span class="mut">${pct >= 70 ? 'ÓPTIMO' : pct >= 50 ? 'BUENO' : 'EN DESARROLLO'}</span></div></div><div class="progress"><i class="${scoreClass(pct)}" style="width:${pct}%"></i></div><p class="intro">${esc(escapeReplace(item.descripcion || ''))}</p><div class="module-cols"><div><div class="subhead">${esc(ui.learn)}</div><ul class="learn">${(item.aprendizajes || []).map(value => `<li>${esc(value)}</li>`).join('')}</ul></div><div><div class="subhead">${esc(ui.project)}</div><div class="project">${esc(item.proyecto || '')}</div></div></div></article>`;
      }).join('');
      const page = `<section class="page">${pageNumber === 4 ? sectionTitle(ui.details) : ''}${cards}${pageNum(pageNumber++)}</section>`;
      return page;
    }).join('');

    const competencies = (course.competencias || []).map(item => `<div class="tile">✓ ${esc(item)}</div>`).join('');
    const next = course.proximo_paso || {};
    const finalPageNumber = 4 + modulePages.length;
    const closing = `<section class="page">${sectionTitle(ui.final)}<div class="intro">${esc(escapeReplace(course.consideraciones || ''))}</div>${sectionTitle('COMPETENCIAS DESARROLLADAS')}<div class="row" style="flex-wrap:wrap">${competencies}</div><div class="next"><strong>${esc(ui.next)}</strong><h2>${esc(next.titulo || '')}</h2><p>${esc(escapeReplace(next.texto || ''))}</p></div><div class="signatures"><div class="signature">${esc(report.teacher || '')}<br><span class="mut">PROFESOR(A) · EQUIPO KODLAND</span></div><div class="seal">SELLO<br>KODLAND</div></div><div class="footer"><b>kodland</b><span>EDUCAR · INSPIRAR · TRANSFORMAR</span><span>kodland.com.br</span></div>${pageNum(finalPageNumber)}</section>`;
    const pages = [pageOne, overview];
    if (report.includeDetails) pages.push(gradePage);
    pages.push(modulePageHtml, closing);
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