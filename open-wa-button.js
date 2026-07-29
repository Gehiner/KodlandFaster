// Module to add "Open WA" button at the specified XPath
// XPath: //*[@id="app"]/div/div/div/div/div[2]/main/div/div/div[1]/div[2]/div[2]/div/div/div/div[2]/div/div[1]/div/div[2]

// Locate the target element using document.evaluate() with the XPath
// above. (There used to be a second, manual `.children[N]` fallback here
// that duplicated this exact path step by step - it was dead weight: this
// version already handles the "structure changed" case fine by returning
// null, and having two ways to fail just doubled the code to maintain.)
function findElementByXPathDirect() {
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
    console.error('Error evaluating XPath:', error);
    return null;
  }
}

// Function to extract phone number from the container
function extractPhoneNumber(containerElement) {
  if (!containerElement) return null;
  
  // Get all text content from the container
  const textContent = containerElement.textContent || '';
  
  // Look for phone number patterns
  // Pattern: +56986183234 or similar formats
  const phonePatterns = [
    /\+?[0-9]{10,15}/g,  // General phone pattern
    /\+?[0-9]{1,3}[0-9]{8,12}/g,  // International format
    /Телефон:\s*([+\d\s\-()]+)/i,  // Russian "Телефон:" label
    /Phone:\s*([+\d\s\-()]+)/i,  // English "Phone:" label
    /Teléfono:\s*([+\d\s\-()]+)/i  // Spanish "Teléfono:" label
  ];
  
  for (const pattern of phonePatterns) {
    const matches = textContent.match(pattern);
    if (matches && matches.length > 0) {
      // Get the first match and clean it
      let phone = matches[0];
      
      // If pattern has capture group, use that
      const matchWithGroup = textContent.match(pattern);
      if (matchWithGroup && matchWithGroup[1]) {
        phone = matchWithGroup[1];
      }
      
      // Clean the phone number (remove spaces, dashes, parentheses)
      phone = phone.replace(/[\s\-()]/g, '').trim();
      
      // Remove label if present
      phone = phone.replace(/^(Телефон|Phone|Teléfono):/i, '').trim();
      
      if (phone && phone.length >= 10) {
        console.log('Phone number found:', phone);
        return phone;
      }
    }
  }
  
  // Also check parent elements
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
  
  console.warn('No phone number found in container');
  return null;
}

// Function to format phone number for WhatsApp URL
function formatPhoneForWhatsApp(phone) {
  if (!phone) return null;
  
  // Remove all non-digit characters except +
  let cleanPhone = phone.replace(/[^\d+]/g, '');
  
  // Remove leading + if present (WhatsApp URL doesn't use it)
  if (cleanPhone.startsWith('+')) {
    cleanPhone = cleanPhone.substring(1);
  }
  
  // Remove any remaining non-digit characters
  cleanPhone = cleanPhone.replace(/\D/g, '');
  
  // Ensure minimum length
  if (cleanPhone.length < 10) {
    console.warn('Phone number too short:', cleanPhone);
    return null;
  }
  
  return cleanPhone;
}

// Function to create the "Open WA" button
function createOpenWAButton(containerElement) {
  const button = document.createElement('button');
  button.id = 'kodland-open-wa-button';
  button.className = 'kodland-wa-btn kodland-open-btn';
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="currentColor"/>
    </svg>
    Open WA
  `;
  
  button.addEventListener('click', function() {
    // Extract phone number from container
    const phoneNumber = extractPhoneNumber(containerElement);
    
    if (phoneNumber) {
      // Format phone number for WhatsApp
      const formattedPhone = formatPhoneForWhatsApp(phoneNumber);
      
      if (formattedPhone) {
        // Open WhatsApp Web with specific phone number (without message)
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}`;
        console.log('Opening WhatsApp for phone:', formattedPhone);
        window.open(whatsappUrl, '_blank');
        
        // Visual feedback
        const originalText = button.innerHTML;
        button.innerHTML = '✓ Opening...';
        button.disabled = true;
        setTimeout(() => {
          button.innerHTML = originalText;
          button.disabled = false;
        }, 2000);
      } else {
        console.error('Could not format phone number:', phoneNumber);
        // Fallback: open generic WhatsApp
        window.open('https://api.whatsapp.com', '_blank');
      }
    } else {
      console.warn('No phone number found, opening generic WhatsApp');
      // Fallback: open generic WhatsApp
      window.open('https://web.whatsapp.com', '_blank');
    }
  });
  
  return button;
}

// Function to check if we're on a student page
function isStudentPage() {
  const url = window.location.href;
  // Check if URL matches pattern: https://bo.kodland.org/students/{id}
  return /https?:\/\/bo\.kodland\.org\/students\/\d+/.test(url);
}

// Main function to inject the button
function injectOpenWAButton() {
  // Only run on student pages
  if (!isStudentPage()) {
    return;
  }
  
  // Check if button already exists
  if (document.getElementById('kodland-open-wa-button')) {
    return;
  }
  
  // Find the target element via XPath
  const targetElement = findElementByXPathDirect();
  
  if (targetElement) {
    const button = createOpenWAButton(targetElement);
    targetElement.appendChild(button);
    console.log('✅ "Open WA" button injected successfully at XPath');
  } else {
    console.warn('⚠️ Could not find target element. Retrying...');
  }
}

// Try to inject when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectOpenWAButton);
} else {
  injectOpenWAButton();
}

// Use MutationObserver to detect when element loads dynamically
const observer = new MutationObserver(function(mutations) {
  // Only observe if we're on a student page
  if (isStudentPage() && !document.getElementById('kodland-open-wa-button')) {
    injectOpenWAButton();
  }
});

// Start observation only if on student page
if (isStudentPage()) {
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Try to inject every 2 seconds for the first 30 seconds (only on student pages)
let attempts = 0;
const maxAttempts = 15;
const intervalId = setInterval(() => {
  if (isStudentPage()) {
    attempts++;
    if (!document.getElementById('kodland-open-wa-button')) {
      injectOpenWAButton();
    }
    if (attempts >= maxAttempts) {
      clearInterval(intervalId);
    }
  } else {
    // Stop interval if we're not on a student page
    clearInterval(intervalId);
  }
}, 2000);

// Export function for external use
if (typeof window !== 'undefined') {
  window.KodlandOpenWA = {
    injectOpenWAButton,
    findElementByXPathDirect
  };
}

