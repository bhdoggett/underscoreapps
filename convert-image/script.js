const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('file-input');
const browseBtn    = document.getElementById('browse-btn');
const previewSection = document.getElementById('preview-section');
const preview      = document.getElementById('preview');
const fileInfo     = document.getElementById('file-info');
const errorMsg     = document.getElementById('error-msg');
const resetBtn     = document.getElementById('reset-btn');

let currentImage = null;
let currentName  = '';

// ---- Load file ----

browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => {
  if (e.target !== browseBtn) fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  if (!file.type.startsWith('image/')) {
    showError('unsupported file type — try exporting as jpg or png first');
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    currentImage = img;
    currentName  = file.name.replace(/\.[^.]+$/, '');
    preview.src  = url;
    fileInfo.textContent = `${file.name}  ·  ${img.naturalWidth} × ${img.naturalHeight}`;
    hideError();
    dropZone.classList.add('hidden');
    previewSection.classList.remove('hidden');
  };

  img.onerror = () => showError('could not load image — unsupported format');
  img.src = url;
}

// ---- Convert + download ----

document.querySelectorAll('.convert-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentImage) return;
    const format = btn.dataset.format; // 'png' | 'jpeg' | 'webp'
    const ext    = format === 'jpeg' ? 'jpg' : format;

    const canvas = document.createElement('canvas');
    canvas.width  = currentImage.naturalWidth;
    canvas.height = currentImage.naturalHeight;
    const ctx = canvas.getContext('2d');

    // JPG doesn't support transparency — fill white
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(currentImage, 0, 0);

    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = `${currentName}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, `image/${format}`);
  });
});

// ---- Reset ----

resetBtn.addEventListener('click', () => {
  currentImage = null;
  currentName  = '';
  preview.src  = '';
  fileInput.value = '';
  previewSection.classList.add('hidden');
  dropZone.classList.remove('hidden');
  hideError();
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}
