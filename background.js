// Generates and applies a blue icon with a bold white "K" for the extension.

function createIcon(size, bgColor = '#0d6efd', textColor = '#ffffff') {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  // Text
  ctx.fillStyle = textColor;
  ctx.font = `bold ${Math.floor(size * 0.6)}px "Inter", "Segoe UI", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Slight vertical tweak so optical center looks balanced
  ctx.fillText('K', size / 2, size / 2 + size * 0.04);

  return ctx.getImageData(0, 0, size, size);
}

function applyIcons() {
  const sizes = [16, 32, 48, 128];
  const imageData = {};
  for (const size of sizes) {
    imageData[size] = createIcon(size);
  }

  chrome.action.setIcon({ imageData }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[Kodland Tutor Assistant] Unable to set icon:', chrome.runtime.lastError);
    } else {
      console.log('[Kodland Tutor Assistant] Icon applied');
    }
  });
}

chrome.runtime.onInstalled.addListener(applyIcons);
chrome.runtime.onStartup.addListener(applyIcons);

