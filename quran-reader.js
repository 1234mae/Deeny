import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

let pdfDocument = null;
let currentPage = 1;
let zoom = 1;
let renderTask = null;
let activeViewer = null;
let loadingTask = null;
const skippedPages = 3;
const storageKey = 'islamicAppQuranBookmark';

const translations = {
    ar: {
        previous: 'السابق',
        next: 'التالي',
        zoomOut: 'تصغير',
        zoomIn: 'تكبير',
        bookmark: 'حفظ الصفحة',
        bookmarked: 'تم حفظ الصفحة',
        loading: 'جارٍ تحميل القرآن الكريم...',
        loadingPage: 'جارٍ تحميل الصفحة...',
        loadError: 'تعذر تحميل ملف القرآن. تأكد من وجود الملف ثم أعد تشغيل التطبيق.'
    },
    en: {
        previous: 'Previous',
        next: 'Next',
        zoomOut: 'Zoom out',
        zoomIn: 'Zoom in',
        bookmark: 'Save page',
        bookmarked: 'Page saved',
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
    viewer.querySelector('[data-quran-bookmark]').setAttribute('aria-label', labels.bookmark);
    viewer.querySelector('[data-quran-bookmark]').title = labels.bookmark;
    viewer.querySelector('.quran-zoom-status').textContent = `${Math.round(zoom * 100)}%`;
    viewer.querySelector('.quran-page-status').textContent = pdfDocument
        ? `${currentPage} / ${Math.max(1, pdfDocument.numPages - skippedPages)}`
        : '';
    previousButton.disabled = !pdfDocument || currentPage <= 1;
    nextButton.disabled = !pdfDocument || currentPage >= pdfDocument.numPages - skippedPages;
}

function saveBookmark(showConfirmation = false) {
    if (!activeViewer || !pdfDocument) return;
    try {
        localStorage.setItem(storageKey, JSON.stringify({ page: currentPage, zoom }));
        if (showConfirmation) {
            const button = activeViewer.querySelector('[data-quran-bookmark]');
            button.textContent = '✓';
            button.setAttribute('aria-label', getTranslations().bookmarked);
            button.title = getTranslations().bookmarked;
            window.setTimeout(() => {
                if (!activeViewer?.isConnected) return;
                button.textContent = '🔖';
                button.setAttribute('aria-label', getTranslations().bookmark);
                button.title = getTranslations().bookmark;
            }, 1500);
        }
    } catch (error) {
        console.error('Unable to save Quran page.', error);
    }
}

function restoreBookmark() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (!saved) return false;
        if (Number.isInteger(saved.page) && saved.page >= 1) currentPage = saved.page;
        if (Number.isFinite(saved.zoom)) zoom = Math.min(2.5, Math.max(0.5, saved.zoom));
        return true;
    } catch (error) {
        console.error('Unable to restore Quran page.', error);
        return false;
    }
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
        const physicalPage = currentPage + skippedPages;
        const page = await pdfDocument.getPage(physicalPage);
        if (!viewer.isConnected) return;
        const canvas = viewer.querySelector('.quran-page-canvas');
        const surface = viewer.querySelector('.quran-page-surface');
        const pageViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(180, surface.clientWidth - 24);
        const availableHeight = Math.max(360, window.innerHeight - 220);
        const widthScale = availableWidth / pageViewport.width;
        const heightScale = availableHeight / pageViewport.height;
        const fitScale = Math.max(0.1, Math.min(widthScale, heightScale));
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
        restoreBookmark();
        currentPage = Math.min(currentPage, Math.max(1, pdfDocument.numPages - skippedPages));
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

document.addEventListener('islamic-app-quran-close', () => {
    saveBookmark();
});

document.addEventListener('click', event => {
    if (!activeViewer?.contains(event.target)) return;
    const pageButton = event.target.closest('[data-page-step]');
    if (pageButton && !pageButton.disabled) {
        currentPage = Math.min(
            Math.max(1, pdfDocument.numPages - skippedPages),
            Math.max(1, currentPage + Number(pageButton.dataset.pageStep))
        );
        saveBookmark();
        renderCurrentPage(activeViewer);
        return;
    }
    const zoomButton = event.target.closest('[data-zoom-step]');
    if (zoomButton) {
        zoom = Math.min(2.5, Math.max(0.5, zoom + Number(zoomButton.dataset.zoomStep) * 0.1));
        saveBookmark();
        renderCurrentPage(activeViewer);
        return;
    }
    const bookmarkButton = event.target.closest('[data-quran-bookmark]');
    if (bookmarkButton) {
        saveBookmark(true);
    }
});

window.addEventListener('resize', () => {
    if (activeViewer?.isConnected && pdfDocument) renderCurrentPage(activeViewer);
});

window.addEventListener('pagehide', () => saveBookmark());
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveBookmark();
});
