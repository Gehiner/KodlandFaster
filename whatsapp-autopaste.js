// Runs on web.whatsapp.com. Looks for a message the tutor queued up from
// the Kodland backoffice extension and pastes it into the currently open
// chat's compose box automatically, so all that's left is hitting "Enviar".
//
// The message is left there for the tutor to review before sending - we
// never auto-click send, on purpose.

const STORAGE_KEY = 'kodland_pending_wa_message';
const MAX_AGE_MS = 3 * 60 * 1000; // ignore anything older than 3 minutes
const LOG_PREFIX = '[Kodland WA Autopaste]';

console.log(`${LOG_PREFIX} Script loaded (${location.href})`);

// WhatsApp Web redesigns its DOM every few months (React -> Lexical editor,
// class names that change on every release, etc.), so instead of one
// selector we try a list of them, most-specific/most-current first, and
// fall back down the list. Whatever matches first wins.
//
// We deliberately scope everything to #main (the open chat panel) so we
// never accidentally grab the search box on the left, which is also a
// contenteditable div.
const COMPOSE_BOX_SELECTORS = [
  '#main [data-testid="conversation-compose-box-input"]',
  '#main div[aria-label="Escribe un mensaje"][contenteditable="true"]',
  '#main div[aria-label="Type a message"][contenteditable="true"]',
  '#main footer div[contenteditable="true"][data-lexical-editor="true"]',
  '#main footer div[contenteditable="true"][role="textbox"]',
  '#main footer div[contenteditable="true"]',
  'footer div[contenteditable="true"][data-tab]',
  'footer div[contenteditable="true"]'
];

function findComposeBox() {
  for (const selector of COMPOSE_BOX_SELECTORS) {
    try {
      const el = document.querySelector(selector);
      if (el) return { el, selector };
    } catch (error) {
      // Selector syntax issue (shouldn't happen, but don't let one bad
      // selector stop us from trying the rest).
    }
  }
  return null;
}

function pasteIntoComposeBox(box, text) {
  box.focus();

  // execCommand is deprecated but still the most reliable way to insert
  // text into a contenteditable that a framework (React/Lexical) is
  // watching, since it fires the input events those frameworks expect.
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch (error) {
    inserted = false;
  }

  if (!inserted) {
    // Fallback: dispatch a paste event with clipboard-like data
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    box.dispatchEvent(pasteEvent);
  }

  // Last-resort verification: if neither approach actually put text in the
  // box (e.g. WhatsApp intercepted/ignored both), tell the console loudly
  // instead of failing silently - the clipboard still has the message as a
  // manual Ctrl+V fallback either way.
  setTimeout(() => {
    if (!box.textContent || box.textContent.trim().length === 0) {
      console.warn(`${LOG_PREFIX} ⚠️ Se intentó pegar pero el cuadro de texto sigue vacío. El mensaje quedó copiado en el portapapeles - pégalo manualmente con Ctrl+V.`);
    }
  }, 300);
}

async function tryPastePendingMessage(attemptLabel) {
  let stored;
  try {
    stored = await chrome.storage.local.get([STORAGE_KEY]);
  } catch (error) {
    console.warn(`${LOG_PREFIX} No se pudo leer chrome.storage:`, error);
    return;
  }

  const pending = stored[STORAGE_KEY];
  if (!pending || !pending.message) {
    return; // nothing queued - normal, not an error
  }

  const age = Date.now() - (pending.timestamp || 0);
  if (age > MAX_AGE_MS) {
    console.log(`${LOG_PREFIX} Había un mensaje en cola pero ya expiró (${Math.round(age / 1000)}s), lo descarto.`);
    chrome.storage.local.remove([STORAGE_KEY]);
    return;
  }

  const found = findComposeBox();
  if (!found) {
    console.log(`${LOG_PREFIX} ${attemptLabel}: hay un mensaje en cola pero todavía no encuentro el cuadro de texto (¿ya tienes un chat abierto?).`);
    return; // keep waiting, chat might not be loaded yet
  }

  const { el: composeBox, selector } = found;

  // Don't paste over something the tutor already started typing
  if (composeBox.textContent && composeBox.textContent.trim().length > 0) {
    console.log(`${LOG_PREFIX} Encontré el cuadro de texto (via "${selector}") pero ya tiene contenido escrito - no lo piso.`);
    return;
  }

  pasteIntoComposeBox(composeBox, pending.message);
  console.log(`${LOG_PREFIX} ✅ Mensaje pegado automáticamente (cuadro encontrado via "${selector}")`);

  // Consume it so it doesn't get pasted again on the next chat/reload
  chrome.storage.local.remove([STORAGE_KEY]);
}

// Keep checking for a while after the page loads, since WhatsApp Web takes
// a few seconds to render the chat and its compose box.
let attempts = 0;
const maxAttempts = 45; // ~45 seconds - a bit more slack, since sometimes
                         // this tab still has to redirect through a group
                         // invite link before the actual chat loads
const intervalId = setInterval(async () => {
  attempts++;
  await tryPastePendingMessage(`intento ${attempts}/${maxAttempts}`);

  // Stop once we've either pasted (storage cleared) or run out of attempts
  const stored = await chrome.storage.local.get([STORAGE_KEY]).catch(() => ({}));
  if (!stored[STORAGE_KEY]) {
    clearInterval(intervalId);
  } else if (attempts >= maxAttempts) {
    console.warn(`${LOG_PREFIX} Se acabaron los ${maxAttempts} intentos (~45s) y no logré pegar el mensaje. Sigue en el portapapeles para pegarlo manualmente (Ctrl+V).`);
    clearInterval(intervalId);
  }
}, 1000);

// Also try immediately in case everything is already loaded
tryPastePendingMessage('intento inicial');
