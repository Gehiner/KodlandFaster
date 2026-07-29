// Module to add "Send Credential" button
// This button intercepts the credential copy button and sends the message to WhatsApp

// Function to check if we're on a student page
function isStudentPage() {
  const url = window.location.href;
  return /https?:\/\/bo\.kodland\.org\/students\/\d+/.test(url);
}

// Function to find the credential copy button using multiple strategies
function findCredentialCopyButton() {
  // Strategy 1: Try XPath directly (button without /i)
  const xpath = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div/div[1]/div[4]/div/button[4]';
  
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    const element = result.singleNodeValue;
    
    // If found an <i> element, get its parent button
    if (element && element.tagName === 'I') {
      const button = element.closest('button') || element.parentElement;
      if (button) {
        console.log('✅ Credential copy button found via XPath');
        return button;
      }
    }
    
    if (element) {
      console.log('✅ Credential copy button found via XPath');
      return element;
    }
  } catch (error) {
    console.warn('Error evaluating XPath for credential button:', error);
  }
  
  // Strategy 2: Try XPath with /i (icon inside button)
  try {
    const altXpath = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div/div[1]/div[4]/div/button[4]/i';
    const result = document.evaluate(
      altXpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    const element = result.singleNodeValue;
    if (element && element.tagName === 'I') {
      const button = element.closest('button') || element.parentElement;
      if (button && button.tagName === 'BUTTON') {
        console.log('✅ Credential copy button found via icon XPath');
        return button;
      }
    }
  } catch (error) {
    console.warn('Error evaluating icon XPath:', error);
  }
  
  // Strategy 3: Search by icon class or data attributes (common copy icons)
  try {
    const copyIcons = document.querySelectorAll('i[class*="copy"], i[class*="clipboard"], button i[class*="copy"]');
    for (const icon of copyIcons) {
      const button = icon.closest('button');
      if (button) {
        // Check if button is in the credentials section (div[4])
        const parentDiv = button.closest('div[4]');
        if (parentDiv) {
          console.log('✅ Credential copy button found via icon search');
          return button;
        }
      }
    }
  } catch (error) {
    console.warn('Error searching by icon:', error);
  }
  
  // Strategy 4: Search for buttons in the credentials section
  try {
    const main = document.querySelector('main');
    if (main) {
      const div4 = main.querySelector('div > div > div[1] > div[4]');
      if (div4) {
        const buttons = div4.querySelectorAll('button');
        // Usually the copy button is one of the last buttons
        if (buttons.length >= 4) {
          const copyButton = buttons[buttons.length - 1] || buttons[3];
          console.log('✅ Credential copy button found via section search');
          return copyButton;
        }
      }
    }
  } catch (error) {
    console.warn('Error searching by section:', error);
  }
  
  console.warn('⚠️ Credential copy button not found with any strategy');
  return null;
}

// Function to extract phone number from container (same as Open WA)
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
      if (matchWithGroup && matchWithGroup[1]) {
        phone = matchWithGroup[1];
      }
      phone = phone.replace(/[\s\-()]/g, '').trim();
      phone = phone.replace(/^(Телефон|Phone|Teléfono):/i, '').trim();
      
      if (phone && phone.length >= 10) {
        console.log('Phone number found:', phone);
        return phone;
      }
    }
  }
  
  let parent = containerElement.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    const parentText = parent.textContent || '';
    const matches = parentText.match(/\+?[0-9]{10,15}/g);
    if (matches && matches.length > 0) {
      const phone = matches[0].replace(/[\s\-()]/g, '').trim();
      if (phone && phone.length >= 10) {
        console.log('Phone number found in parent:', phone);
        return phone;
      }
    }
    parent = parent.parentElement;
    depth++;
  }
  
  return null;
}

// Function to format phone number for WhatsApp URL
function formatPhoneForWhatsApp(phone) {
  if (!phone) return null;
  
  let cleanPhone = phone.replace(/[^\d+]/g, '');
  if (cleanPhone.startsWith('+')) {
    cleanPhone = cleanPhone.substring(1);
  }
  cleanPhone = cleanPhone.replace(/\D/g, '');
  
  if (cleanPhone.length < 10) {
    console.warn('Phone number too short:', cleanPhone);
    return null;
  }
  
  return cleanPhone;
}

// Function to read clipboard content
async function readClipboard() {
  try {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        console.log('Clipboard read successfully:', text.substring(0, 100));
        return text;
      }
    }
  } catch (error) {
    console.warn('Clipboard API not available or denied:', error);
  }
  
  // Fallback: use a temporary textarea with execCommand
  try {
    const textarea = document.createElement('textarea');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus();
    
    // Try to paste
    const success = document.execCommand('paste');
    const text = textarea.value;
    document.body.removeChild(textarea);
    
    if (success && text) {
      console.log('Clipboard read via execCommand:', text.substring(0, 100));
      return text;
    }
  } catch (e) {
    console.error('Error reading clipboard via execCommand:', e);
  }
  
  return null;
}

// Function to encode message for WhatsApp URL
function encodeMessageForWhatsApp(text) {
  if (!text) return '';
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let encoded = encodeURIComponent(normalized);
  encoded = encoded.replace(/%20/g, '+');
  return encoded;
}

// Function to find the container element (same as Open WA button location)
function findContainerElement() {
  const xpath = '//*[@id="app"]/div/div/div/div/div[2]/main/div/div/div[1]/div[2]/div[2]/div/div/div/div[2]/div/div[1]/div/div[2]';
  
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    
    return result.singleNodeValue;
  } catch (error) {
    console.error('Error finding container element:', error);
    return null;
  }
}

// Track if button has been intercepted to avoid duplicate handlers
let buttonIntercepted = false;

// Flag to prevent duplicate execution
let isProcessing = false;

// Flag to indicate click is from our visible button
let clickFromVisibleButton = false;

// Flag to prevent duplicate WhatsApp opening
let isOpeningWhatsApp = false;

// Function to intercept the credential copy button
function interceptCredentialCopyButton() {
  // Check if already intercepted
  if (buttonIntercepted) {
    return true;
  }
  
  const copyButton = findCredentialCopyButton();
  
  if (!copyButton) {
    return false;
  }
  
  // Check if button already has our handler (avoid duplicates)
  if (copyButton.hasAttribute('data-kodland-intercepted')) {
    return true;
  }
  
  // Mark as intercepted
  copyButton.setAttribute('data-kodland-intercepted', 'true');
  buttonIntercepted = true;
  
  // Store original click handler if exists
  const originalOnClick = copyButton.onclick;
  
  // Add our own click handler (use capture phase to intercept first)
  copyButton.addEventListener('click', async function(e) {
    console.log('[Interceptor] Click detected, isProcessing:', isProcessing, 'isOpeningWhatsApp:', isOpeningWhatsApp);
    
    // Set processing flag IMMEDIATELY to prevent duplicate execution
    // Check if it was already set (meaning another handler got here first)
    const wasAlreadyProcessing = isProcessing;
    isProcessing = true;
    
    if (wasAlreadyProcessing) {
      console.log('[Interceptor] Already processing (detected by flag check), skipping duplicate execution');
      return;
    }
    
    console.log('[Interceptor] Credential copy button clicked - intercepting');
    console.log('[Interceptor] Set isProcessing = true');
    
    // Wait for clipboard to be updated - try multiple times with increasing delays
    const checkClipboard = async (attempt = 1, maxAttempts = 5) => {
      const delays = [800, 1200, 1500, 2000, 2500]; // Increasing delays
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const clipboardText = await readClipboard();
      console.log(`[Interceptor] Clipboard attempt ${attempt}:`, clipboardText ? clipboardText.substring(0, 100) : 'empty');
      
      // Check if clipboard contains "Kodland Tutor Assistant" (wrong content)
      if (clipboardText && clipboardText.includes('Kodland Tutor Assistant')) {
        console.warn('[Interceptor] Clipboard contains "Kodland Tutor Assistant", retrying...');
        if (attempt < maxAttempts) {
          return checkClipboard(attempt + 1, maxAttempts);
        } else {
          console.error('[Interceptor] Failed to get credentials after multiple attempts');
          isProcessing = false;
          return;
        }
      }
      
      if (!clipboardText || clipboardText.trim() === '') {
        console.warn(`[Interceptor] No content found in clipboard (attempt ${attempt})`);
        if (attempt < maxAttempts) {
          return checkClipboard(attempt + 1, maxAttempts);
        } else {
          isProcessing = false;
          return;
        }
      }
      
      // Valid credentials should contain login info
      const looksLikeCredentials = clipboardText.includes('Usuario') || 
                                    clipboardText.includes('Password') ||
                                    clipboardText.includes('Login') ||
                                    clipboardText.includes('Username') ||
                                    clipboardText.includes('Contraseña') ||
                                    clipboardText.match(/\d{4,}/) ||
                                    clipboardText.length > 20;
      
      console.log('[Interceptor] Credentials validation:', {
        looksLikeCredentials,
        length: clipboardText.length,
        preview: clipboardText.substring(0, 50),
        attempt,
        maxAttempts
      });
      
      // Only retry if content doesn't look like credentials AND we have more attempts
      // If we've exhausted attempts, process anyway (might be valid credentials in different format)
      if (!looksLikeCredentials && attempt < maxAttempts) {
        console.warn('[Interceptor] Clipboard content does not look like credentials, retrying...');
        return checkClipboard(attempt + 1, maxAttempts);
      }
      
      // Process the message (either looks like credentials or we've exhausted attempts)
      if (!looksLikeCredentials) {
        console.warn('[Interceptor] Processing anyway after max attempts, even if format is unexpected');
      }
      
      console.log('[Interceptor] Calling processCredentialMessage with text:', clipboardText.substring(0, 100));
      await processCredentialMessage(clipboardText);
      console.log('[Interceptor] processCredentialMessage completed');
      isProcessing = false;
    };
    
    checkClipboard();
  }, true); // Use capture phase to intercept before other handlers
  
  console.log('✅ Credential copy button intercepted');
  return true;
}

// Function to process and send credential message (moved outside for reuse)
async function processCredentialMessage(clipboardText) {
  console.log('[processCredentialMessage] Called with text length:', clipboardText ? clipboardText.length : 0);
  
  // Prevent duplicate execution
  if (isOpeningWhatsApp) {
    console.log('[processCredentialMessage] WhatsApp already opening, skipping duplicate call');
    return;
  }
  
  isOpeningWhatsApp = true;
  console.log('[processCredentialMessage] Flag set, processing...');
  
  console.log('[processCredentialMessage] Processing credential message:', clipboardText.substring(0, 100));
  
  // Find container to extract phone number
  const container = findContainerElement();
  console.log('[processCredentialMessage] Container found:', !!container);
  
  const phoneNumber = extractPhoneNumber(container);
  console.log('[processCredentialMessage] Phone number extracted:', phoneNumber);
  
  if (!phoneNumber) {
    console.warn('[processCredentialMessage] No phone number found, opening generic WhatsApp');
    // Still open WhatsApp but without phone number
    const encodedMessage = encodeMessageForWhatsApp(clipboardText);
    const whatsappUrl = `https://api.whatsapp.com`;
    console.log('[processCredentialMessage] Opening:', whatsappUrl);
    window.open(whatsappUrl, '_blank');
    setTimeout(() => { 
      isOpeningWhatsApp = false;
      console.log('[processCredentialMessage] Flag reset');
    }, 1000);
    return;
  }
  
  // Format phone number
  const formattedPhone = formatPhoneForWhatsApp(phoneNumber);
  console.log('[processCredentialMessage] Formatted phone:', formattedPhone);
  
  if (formattedPhone) {
    // Encode message for WhatsApp URL
    const encodedMessage = encodeMessageForWhatsApp(clipboardText);
    
    // Open WhatsApp with phone number and message
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedMessage}`;
    console.log('[processCredentialMessage] Opening WhatsApp URL:', whatsappUrl.substring(0, 100) + '...');
    console.log('[processCredentialMessage] Full URL length:', whatsappUrl.length);
    
    try {
      // Try window.open first
      const newWindow = window.open(whatsappUrl, '_blank');
      
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        // Pop-up blocked, try alternative method
        console.warn('[processCredentialMessage] Pop-up blocked, trying alternative method');
        // Create a temporary link and click it
        const link = document.createElement('a');
        link.href = whatsappUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('[processCredentialMessage] Alternative method used (link click)');
      } else {
        console.log('[processCredentialMessage] window.open called successfully');
      }
    } catch (error) {
      console.error('[processCredentialMessage] Error opening WhatsApp:', error);
      // Fallback: try direct navigation
      try {
        window.location.href = whatsappUrl;
        console.log('[processCredentialMessage] Fallback: using window.location.href');
      } catch (e) {
        console.error('[processCredentialMessage] All methods failed:', e);
      }
    }
  } else {
    console.warn('[processCredentialMessage] Could not format phone number, opening generic WhatsApp');
    // Fallback: open generic WhatsApp
    const encodedMessage = encodeMessageForWhatsApp(clipboardText);
    const whatsappUrl = `https://api.whatsapp.com`;
    console.log('[processCredentialMessage] Opening fallback:', whatsappUrl);
    window.open(whatsappUrl, '_blank');
  }
  
  // Reset flag after a delay
  setTimeout(() => { 
    isOpeningWhatsApp = false;
    console.log('[processCredentialMessage] Flag reset after delay');
  }, 2000);
}

// Function to create visible "Send Credential" button
function createSendCredentialButton() {
  const button = document.createElement('button');
  button.id = 'kodland-send-credential-button';
  button.className = 'kodland-wa-btn kodland-send-btn';
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
    </svg>
    Send Credential
  `;
  
  // Add a flag to prevent multiple clicks on this button
  let buttonClickInProgress = false;
  
  button.addEventListener('click', async function(e) {
    // Prevent event bubbling to avoid triggering other handlers
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Skip if already processing (prevent duplicate execution)
    if (isProcessing || isOpeningWhatsApp || buttonClickInProgress) {
      console.log('[Send Credential Button] Already processing or click in progress, skipping duplicate click');
      console.log('[Send Credential Button] State - isProcessing:', isProcessing, 'isOpeningWhatsApp:', isOpeningWhatsApp, 'buttonClickInProgress:', buttonClickInProgress);
      return;
    }
    
    console.log('[Send Credential Button] Send Credential button clicked');
    buttonClickInProgress = true;
    
    // Visual feedback
    const originalText = button.innerHTML;
    button.innerHTML = '⏳ Sending...';
    button.disabled = true;
    
    try {
      // Find the credential copy button
      const copyButton = findCredentialCopyButton();
      
      if (copyButton) {
        // Simply click the copy button - the interceptor will handle everything
        // DO NOT set isProcessing here - let the interceptor set it
        // The isOpeningWhatsApp flag will prevent duplicate opening
        console.log('[Send Credential Button] Current state - isProcessing:', isProcessing, 'isOpeningWhatsApp:', isOpeningWhatsApp);
        console.log('[Send Credential Button] Clicking copy button, interceptor will handle processing');
        copyButton.click();
        console.log('[Send Credential Button] Copy button clicked');
        
        // Reset buttonClickInProgress after a delay
        setTimeout(() => {
          buttonClickInProgress = false;
        }, 5000);
        
        // The interceptor will handle processing and set isProcessing
        // Monitor when processing is done to reset UI state
        const checkProcessing = setInterval(() => {
          if (!isProcessing && !isOpeningWhatsApp) {
            clearInterval(checkProcessing);
            buttonClickInProgress = false;
            button.innerHTML = originalText;
            button.disabled = false;
            console.log('[Send Credential Button] UI reset after processing');
          }
        }, 100);
        
        // Timeout after 15 seconds to ensure UI resets
        setTimeout(() => {
          clearInterval(checkProcessing);
          isProcessing = false;
          isOpeningWhatsApp = false;
          buttonClickInProgress = false;
          button.innerHTML = originalText;
          button.disabled = false;
          console.log('[Send Credential Button] UI reset after timeout');
        }, 15000);
      } else {
        // If copy button not found, try to read clipboard directly
        const clipboardText = await readClipboard();
        if (clipboardText) {
          await processCredentialMessage(clipboardText);
        } else {
          alert('Please copy the credentials first, then click this button.');
        }
        isProcessing = false;
        clickFromVisibleButton = false;
        button.innerHTML = originalText;
        button.disabled = false;
      }
    } catch (error) {
      console.error('Error in Send Credential button:', error);
      isProcessing = false;
      clickFromVisibleButton = false;
      button.innerHTML = originalText;
      button.disabled = false;
    }
  });
  
  return button;
}

// Function to inject the visible button
function injectSendCredentialButton() {
  // Only run on student pages
  if (!isStudentPage()) {
    return;
  }
  
  // Check if button already exists
  if (document.getElementById('kodland-send-credential-button')) {
    return;
  }
  
  // Find container element (same location as Open WA button)
  const container = findContainerElement();
  
  if (container) {
    const button = createSendCredentialButton();
    container.appendChild(button);
    console.log('✅ "Send Credential" button injected successfully');
  } else {
    console.warn('⚠️ Could not find container element for Send Credential button');
  }
}


// Main function to initialize
function initSendCredential() {
  // Only run on student pages
  if (!isStudentPage()) {
    return;
  }
  
  // Inject visible button
  injectSendCredentialButton();
  
  // Also intercept the original copy button
  if (interceptCredentialCopyButton()) {
    return;
  }
  
  // If button not found, try again when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectSendCredentialButton();
      interceptCredentialCopyButton();
    });
  }
  
  // Use MutationObserver to detect when elements load dynamically
  const observer = new MutationObserver(function(mutations) {
    // Inject visible button if not exists
    if (!document.getElementById('kodland-send-credential-button')) {
      injectSendCredentialButton();
    }
    
    // Try to intercept copy button if not intercepted yet
    if (!buttonIntercepted) {
      interceptCredentialCopyButton();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Try to inject and intercept every 2 seconds for the first 30 seconds
  let attempts = 0;
  const maxAttempts = 15;
  const intervalId = setInterval(() => {
    if (isStudentPage()) {
      attempts++;
      
      // Inject visible button
      if (!document.getElementById('kodland-send-credential-button')) {
        injectSendCredentialButton();
      }
      
      // Try to intercept copy button
      if (!buttonIntercepted) {
        interceptCredentialCopyButton();
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
      }
    } else {
      clearInterval(intervalId);
    }
  }, 2000);
}

// Initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSendCredential);
} else {
  initSendCredential();
}

// Export functions for external use
if (typeof window !== 'undefined') {
  window.KodlandSendCredential = {
    interceptCredentialCopyButton,
    initSendCredential,
    extractPhoneNumber,
    readClipboard
  };
}

