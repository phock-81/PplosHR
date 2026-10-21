/**
 * Client-Side Image Compression Utility
 * Prevents "Upload document is too long" errors by scaling down high-resolution
 * phone camera photos to a crisp, bandwidth-friendly receipt format (< 200KB / ~250k chars).
 */
export async function compressImageToDataUrl(file, options = {}) {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.6,
    maxChars = 42000
  } = options;

  if (!file) return '';

  // If not an image (e.g. PDF document), read directly via FileReader
  if (file.type && !file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // If running in an environment without DOM/Canvas (e.g. Node tests), fallback to FileReader
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.createElement) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (loadEvt) => {
      const img = new Image();
      img.onerror = () => {
        // Fallback to original data URL if image parsing fails
        resolve(loadEvt.target.result);
      };
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;

          // Scale down proportionally
          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          let currentQuality = quality;
          let dataUrl = canvas.toDataURL('image/jpeg', currentQuality);

          // If still exceeds max character count, step down quality
          while (dataUrl.length > maxChars && currentQuality > 0.25) {
            currentQuality -= 0.15;
            dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
          }

          // If still exceeds, reduce canvas dimensions further
          if (dataUrl.length > maxChars) {
            const smallCanvas = document.createElement('canvas');
            smallCanvas.width = Math.round(width * 0.7);
            smallCanvas.height = Math.round(height * 0.7);
            const sCtx = smallCanvas.getContext('2d');
            sCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
            dataUrl = smallCanvas.toDataURL('image/jpeg', 0.5);
          }

          resolve(dataUrl);
        } catch (err) {
          // Fallback to raw data URL if canvas manipulation errors
          resolve(loadEvt.target.result);
        }
      };
      img.src = loadEvt.target.result;
    };
    reader.readAsDataURL(file);
  });
}
