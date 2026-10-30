import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

let pdfDocument = null;
let currentPage = 1;
let zoom = 1;
let renderTask = null;
let activeViewer = null;
let loadingTask = null;

const translations = {
    ar: {
        previous: 'السابق',
        next: 'التالي',
        zoomOut: 'تصغير',
        zoomIn: 'تكبير',
        loading: 'جارٍ تحميل القرآن الكريم...',
        loadingPage: 'جارٍ تحميل الصفحة...',
        loadError: 'تعذر تحميل ملف القرآن. تأكد من وجود الملف ثم أعد تشغيل التطبيق.'
    },
    en: {
        previous: 'Previous',
        next: 'Next',
        zoomOut: 'Zoom out',
        zoomIn: 'Zoom in',
        loading: 'Loading the Holy Quran...',
        loadingPage: 'Loading page...',
        loadError: 'Unable to load the Quran PDF. Check that the file exists, then restart the app.'
    }
};

function getTranslations() {
    return translations[document.documentElement.lang === 'en' ? 'en' : 'ar'];
}

function updateToolbar(viewer) {
    if (!viewer.isConnected) return;
    const labels = getTranslations();
    const previousButton = viewer.querySelector('[data-page-step="-1"]');
    const nextButton = viewer.querySelector('[data-page-step="1"]');
    previousButton.textContent = labels.previous;
    nextButton.textContent = labels.next;
    previousButton.setAttribute('aria-label', labels.previous);
    nextButton.setAttribute('aria-label', labels.next);
    viewer.querySelector('[data-zoom-step="-1"]').setAttribute('aria-label', labels.zoomOut);
    viewer.querySelector('[data-zoom-step="1"]').setAttribute('aria-label', labels.zoomIn);
    viewer.querySelector('.quran-zoom-status').textContent = `${Math.round(zoom * 100)}%`;
    viewer.querySelector('.quran-page-status').textContent = pdfDocument
        ? `${currentPage} / ${pdfDocument.numPages}`
        : '';
    previousButton.disabled = !pdfDocument || currentPage <= 1;
    nextButton.disabled = !pdfDocument || currentPage >= pdfDocument.numPages;
}

async function renderCurrentPage(viewer) {
    if (!pdfDocument || !viewer.isConnected) return;
    if (renderTask) {
        renderTask.cancel();
        renderTask = null;
    }
    const status = viewer.querySelector('.quran-reader-status');
    status.textContent = getTranslations().loadingPage;
    updateToolbar(viewer);

    try {
        const page = await pdfDocument.getPage(currentPage);
        if (!viewer.isConnected) return;
        const canvas = viewer.querySelector('.quran-page-canvas');
        const surface = viewer.querySelector('.quran-page-surface');
        const pageViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.1, (surface.clientWidth - 24) / pageViewport.width);
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        renderTask = null;
        if (viewer.isConnected) status.textContent = '';
        updateToolbar(viewer);
    } catch (error) {
        if (error.name === 'RenderingCancelledException') return;
        console.error('Unable to render Quran PDF page.', error);
        status.textContent = getTranslations().loadError;
        renderTask = null;
    }
}

async function openViewer(viewer) {
    if (activeViewer === viewer) return;
    if (renderTask) renderTask.cancel();
    if (loadingTask) loadingTask.destroy();
    activeViewer = viewer;
    pdfDocument = null;
    renderTask = null;
    const status = viewer.querySelector('.quran-reader-status');
    status.textContent = getTranslations().loading;
    updateToolbar(viewer);

    try {
        loadingTask = pdfjsLib.getDocument({
            url: new URL(viewer.dataset.pdfUrl, document.baseURI).href,
            rangeChunkSize: 65536
        });
        pdfDocument = await loadingTask.promise;
        loadingTask = null;
        currentPage = Math.min(currentPage, pdfDocument.numPages);
        if (activeViewer === viewer && viewer.isConnected) await renderCurrentPage(viewer);
    } catch (error) {
        if (error.name === 'AbortException') return;
        console.error('Unable to load Quran PDF.', error);
        if (viewer.isConnected) status.textContent = getTranslations().loadError;
        loadingTask = null;
    }
}

document.addEventListener('islamic-app-quran-open', () => {
    const viewer = document.querySelector('.quran-viewer');
    if (viewer) openViewer(viewer);
});

document.addEventListener('click', event => {
    if (!activeViewer?.contains(event.target)) return;
    const pageButton = event.target.closest('[data-page-step]');
    if (pageButton && !pageButton.disabled) {
        currentPage += Number(pageButton.dataset.pageStep);
        renderCurrentPage(activeViewer);
        return;
    }
    const zoomButton = event.target.closest('[data-zoom-step]');
    if (zoomButton) {
        zoom = Math.min(2.5, Math.max(0.5, zoom + Number(zoomButton.dataset.zoomStep) * 0.1));
        renderCurrentPage(activeViewer);
    }
});

window.addEventListener('resize', () => {
    if (activeViewer?.isConnected && pdfDocument) renderCurrentPage(activeViewer);
});
