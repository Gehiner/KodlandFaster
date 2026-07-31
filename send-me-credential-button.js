// Al hacer clic, busca el botón NATIVO de "copiar credenciales ME" que ya
// existe en la plataforma, lo clickea, lee el resultado del portapapeles,
// y arma un mensaje de WhatsApp con esas credenciales.
//const ME_CREDENTIAL_BUTTON_XPATH = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div/div[1]/div[4]/div/button[3]' ;

// Función para saber si estamos en una página de estudiante
function isStudentPage() {
  const url = window.location.href;
  return /https?:\/\/bo\.kodland\.org\/students\/\d+/.test(url);
}

// Busca el botón nativo de "copiar credenciales ME" leyendo el texto de
// su tooltip real (vía aria-describedby). Ver findButtonByTooltipText()
// más abajo para el detalle de cómo se identifica el botón correcto.
function findMECredentialCopyButton() {
  try {
    const found = findButtonByTooltipText(/minecraft/i);
    if (found) return found;
  } catch (error) {
    console.warn('[ME Credential] Error buscando por texto de tooltip/hover:', error);
  }
}

function findButtonByTooltipText(pattern) {
  // Candidatos: TODOS los botones de acción de la página (comparten la
  // clase "buttonsAction" con Open WA, Send Credential, etc.), en vez de
  // filtrar por ícono de copiar/clipboard. Confirmamos con el HTML real
  // que el ícono de este botón es "ri-box-3-line" (un ícono de caja, sin
  // relación con "copy"), así que ese filtro nunca lo iba a encontrar.
  const candidates = Array.from(document.querySelectorAll('button[aria-describedby], button.buttonsAction'));
  const uniqueCandidates = Array.from(new Set(candidates));

  for (const button of uniqueCandidates) {
    // El tooltip real vive en un elemento aparte, referenciado por
    // aria-describedby="v-tooltip-XX" (patrón de floating-vue). Esto es
    // lo único que confirmamos que funciona - se quitaron los respaldos
    // de atributos estáticos y simulación de hover porque nunca hacían
    // falta y solo agregaban tiempo de espera y complejidad.
    const describedById = button.getAttribute('aria-describedby');
    if (!describedById) continue;

    const tooltipEl = document.getElementById(describedById);
    if (tooltipEl && pattern.test(tooltipEl.textContent || '')) {
      console.log('✅ [ME Credential] Botón encontrado vía aria-describedby');
      return button;
    }
  }

  return null;
}

// --- Las siguientes funciones son las mismas que en send-credential-button.js ---
// (extracción de teléfono, formateo, lectura de portapapeles, codificación
// del mensaje). Se repiten aquí a propósito para que este archivo funcione
// de forma independiente, igual que hace el proyecto original con sus
// otros módulos.

function extractPhoneNumber(containerElement) {
  if (!containerElement) return null;
  const textContent = containerElement.textContent || '';
  const phonePatterns = [
    /\+?[0-9]{10,15}/g,
    /\+?[0-9]{1,3}[0-9]{8,12}/g,
    /Телефон:\s*([+\d\s\-()]+)/i,
    /Phone:\s*([+\d\s\-()]+)/i,
    /Teléfono:\s*([+\d\s\-()]+)/i
  ];

  for (const pattern of phonePatterns) {
    const matches = textContent.match(pattern);
    if (matches && matches.length > 0) {
      let phone = matches[0];
      const matchWithGroup = textContent.match(pattern);
      if (matchWithGroup && matchWithGroup[1]) phone = matchWithGroup[1];
      phone = phone.replace(/[\s\-()]/g, '').trim();
      phone = phone.replace(/^(Телефон|Phone|Teléfono):/i, '').trim();
      if (phone && phone.length >= 10) return phone;
    }
  }

  let parent = containerElement.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    const matches = (parent.textContent || '').match(/\+?[0-9]{10,15}/g);
    if (matches && matches.length > 0) {
      const phone = matches[0].replace(/[\s\-()]/g, '').trim();
      if (phone && phone.length >= 10) return phone;
    }
    parent = parent.parentElement;
    depth++;
  }
  return null;
}

function formatPhoneForWhatsApp(phone) {
  if (!phone) return null;
  let cleanPhone = phone.replace(/[^\d+]/g, '');
  if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
  cleanPhone = cleanPhone.replace(/\D/g, '');
  if (cleanPhone.length < 10) return null;
  return cleanPhone;
}

async function readClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) return text;
    }
  } catch (error) {
    console.warn('[ME Credential] Clipboard API no disponible o denegada:', error);
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus();
    const success = document.execCommand('paste');
    const text = textarea.value;
    document.body.removeChild(textarea);
    if (success && text) return text;
  } catch (e) {
    console.error('[ME Credential] Error leyendo portapapeles vía execCommand:', e);
  }

  return null;
}

function encodeMessageForWhatsApp(text) {
  if (!text) return '';
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let encoded = encodeURIComponent(normalized);
  return encoded.replace(/%20/g, '+');
}

// Mismo contenedor que usan open-wa-button.js / send-credential-button.js
// para ubicar el teléfono del alumno.
function findContainerElement() {
  const xpath = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div/div[1]/div[2]/div[2]/div/div/div/div[2]/div/div[1]/div/div[2]';
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
  } catch (error) {
    console.error('[ME Credential] Error buscando el contenedor:', error);
    return null;
  }
}

// --- Lógica propia de este botón ---

let isProcessingME = false;
let isOpeningWhatsAppME = false;

// Arma el mensaje final para WhatsApp, etiquetando claramente que son
// credenciales de Minecraft Education (para no confundirlas con las
// credenciales normales de la plataforma).
function buildMEMessage(rawClipboardText) {
  return `🎮 Credenciales de acceso - Minecraft Education\n\n${rawClipboardText}\n 
Aquí esta una guía de como realizar el proceso para ME: https://www.canva.com/design/DAGyhDQPPAg/Cpq7QxQNbtCwYRKj0C4wOQ/view?utm_content=DAGyhDQPPAg&utm_campaign=designshare&utm_medium=link&utm_source=viewer \n 
🔗 Enlaces de descarga de Minecraft Education: 

MacOS: https://aka.ms/meeclientmacos

Windows: https://aka.ms/downloadmee

Chromebook: https://play.google.com/store/apps/details?id=com.mojang.minecraftedu`;
}

async function processMECredentialMessage(clipboardText) {
  if (isOpeningWhatsAppME) {
    console.log('[ME Credential] Ya se está abriendo WhatsApp, ignorando clic duplicado');
    return;
  }
  isOpeningWhatsAppME = true;

  const container = findContainerElement();
  const phoneNumber = extractPhoneNumber(container);

  const message = buildMEMessage(clipboardText);
  const encodedMessage = encodeMessageForWhatsApp(message);

  if (!phoneNumber) {
    console.warn('[ME Credential] No se encontró teléfono, abriendo WhatsApp genérico');
    window.open('https://api.whatsapp.com', '_blank');
    setTimeout(() => { isOpeningWhatsAppME = false; }, 1000);
    return;
  }

  const formattedPhone = formatPhoneForWhatsApp(phoneNumber);
  if (!formattedPhone) {
    window.open('https://api.whatsapp.com', '_blank');
    setTimeout(() => { isOpeningWhatsAppME = false; }, 1000);
    return;
  }

  const whatsappUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedMessage}`;

  try {
    const newWindow = window.open(whatsappUrl, '_blank');
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      const link = document.createElement('a');
      link.href = whatsappUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (error) {
    console.error('[ME Credential] Error abriendo WhatsApp:', error);
    window.location.href = whatsappUrl;
  }

  setTimeout(() => { isOpeningWhatsAppME = false; }, 2000);
}


function createSendMECredentialButton() {
  const button = document.createElement('button');
  button.id = 'kodland-send-me-credential-button';
  button.className = 'kodland-wa-btn kodland-send-me-btn';
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
    </svg>
    Send ME Credential
  `;

  button.addEventListener('click', async function (e) {
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (isProcessingME || isOpeningWhatsAppME) return;
    isProcessingME = true;

    const originalText = button.innerHTML;
    button.innerHTML = '⏳ Sending...';
    button.disabled = true;

    const finish = () => {
      isProcessingME = false;
      button.innerHTML = originalText;
      button.disabled = false;
    };

    const copyButton = findMECredentialCopyButton();
    if (!copyButton) {
      console.error('[ME Credential] No se encontró el botón nativo de "copiar credenciales de Minecraft" en esta página.');
      alert('No encontré el botón nativo de credenciales de Minecraft Education en esta página.\n\nPuede ser que este estudiante no tenga el curso de ME.\n\nRevisa la consola (F12) para más detalles.');
      finish();
      return;
    }

    // Foto del portapapeles ANTES de clickear el botón nativo. Como ahora
    // esto solo se busca/clickea al hacer clic aquí (y no al cargar la
    // página), esta foto sí refleja el estado justo antes de la copia.
    const clipboardBefore = await readClipboard(); //SOLO ES INFORMATIVO 

    copyButton.click();

    let credentials = null;
    const delays = [800, 1200, 1500, 2000, 2500];

    for (let attempt = 1; attempt <= delays.length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt - 1]));

      const clipboardText = await readClipboard();

      // NOTA de seguridad: nunca logueamos clipboardText completo, ni
      // siquiera truncado, porque puede contener la contraseña en texto
      // plano. Solo logueamos longitud y si "parece" válido.
      const clipboardChangedForLogging = !!clipboardText && clipboardText !== clipboardBefore; //SOLO ES INFORMATIVO  

    /*"Minecraft" es obligatorio: confirmamos que el formato real
    siempre lo incluye ("Inicio de sesión de Minecraft:" /
    "Contraseña de Minecraft:"), y así descartamos el contenido del
    botón de credenciales normales si por error se clickeó ese.

    OJO: a propósito NO exigimos que "cambió respecto a antes" -
    el botón nativo copia el mismo texto exacto cada vez para el
    mismo estudiante, así que si se prueba dos veces seguidas el
    texto "antes" y "después" son idénticos aunque el copiado sí
    funcionó. Confiar en que diga "Minecraft" + no sea basura ya es
    suficiente validación.*/

      const looksLikeCredentials = !!clipboardText && clipboardText.includes('Minecraft');

      console.log('[ME Credential] Intento', attempt, '- longitud:', clipboardText ? clipboardText.length : 0, '- cambió:', clipboardChangedForLogging, '- parece válido:', !!looksLikeCredentials);

      if (looksLikeCredentials) {
        credentials = clipboardText;
        break;
      }
    }

     if (credentials) {
      await processMECredentialMessage(credentials);
    } else {
      console.error('[ME Credential] No se detectó contenido válido en el portapapeles después de varios intentos. El botón nativo puede no haber copiado nada, o encontramos el botón equivocado.');
    } 

    finish();
  });

  return button;
}

let meContainerWarned = false; // para no repetir el mismo warning en cada reintento

function injectSendMECredentialButton() {
  if (!isStudentPage()) return;
  if (document.getElementById('kodland-send-me-credential-button')) return;

  const container = findContainerElement();
  if (container) {
    container.appendChild(createSendMECredentialButton());
    console.log('✅ [ME Credential] Botón visible inyectado');
    meContainerWarned = false; // por si la página se recarga después
  } else if (!meContainerWarned) {
    // Solo se avisa la primera vez: mientras la página (SPA) sigue
    // montando su DOM, es normal que los primeros intentos fallen - los
    // otros scripts (Open WA, Send Credential) tienen el mismo
    // comportamiento. Repetir el mismo warning cada 2 segundos solo
    // llena la consola sin aportar información nueva.
    console.warn('⚠️ [ME Credential] No se encontró el contenedor todavía (reintentando en silencio). Si nunca aparece el botón, el XPath puede estar desactualizado.');
    meContainerWarned = true;
  }
}

function initSendMECredential() {
  if (!isStudentPage()) return;

  injectSendMECredentialButton();

  const observer = new MutationObserver(() => {
    if (!document.getElementById('kodland-send-me-credential-button')) {
      injectSendMECredentialButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let attempts = 0;
  const maxAttempts = 15;
  const intervalId = setInterval(() => {
    if (!isStudentPage()) {
      clearInterval(intervalId);
      return;
    }
    attempts++;
    if (!document.getElementById('kodland-send-me-credential-button')) {
      injectSendMECredentialButton();
    }
    if (attempts >= maxAttempts) clearInterval(intervalId);
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSendMECredential);
} else {
  initSendMECredential();
}