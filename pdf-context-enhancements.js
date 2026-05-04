// Extracts richer PDF context for AI mapping: page text and low-resolution page screenshots.
// This improves mapping when PDF field names are vague but the visible labels are clear.

window.mediqoPdfContext = {
  documentContext: "",
  pageThumbnails: [],
  isReady: false,
  error: null
};

function configurePdfJsWorker() {
  if (!window.pdfjsLib) return;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
}

async function buildPdfContextForAI(pdfBytes) {
  configurePdfJsWorker();
  if (!window.pdfjsLib || !pdfBytes) {
    return { documentContext: "", pageThumbnails: [], error: "pdf.js is not available" };
  }

  const loadingTask = window.pdfjsLib.getDocument({ data: pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes });
  const pdf = await loadingTask.promise;
  const pageTextParts = [];
  const pageThumbnails = [];
  const maxPages = Math.min(pdf.numPages, 8);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => item.str)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    pageTextParts.push(`Page ${pageNumber}: ${text || "No extractable text"}`);

    const thumbnail = await renderPageThumbnail(page, pageNumber);
    if (thumbnail) pageThumbnails.push(thumbnail);
  }

  return {
    documentContext: pageTextParts.join("\n\n"),
    pageThumbnails,
    error: null
  };
}

async function renderPageThumbnail(page, pageNumber) {
  try {
    const viewport = page.getViewport({ scale: 1 });
    const maxWidth = 900;
    const scale = Math.min(maxWidth / viewport.width, 1.15);
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.floor(scaledViewport.width);
    canvas.height = Math.floor(scaledViewport.height);

    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.45);

    return {
      page: pageNumber,
      mimeType: "image/jpeg",
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      quality: "low"
    };
  } catch (error) {
    console.warn("Unable to render PDF thumbnail", pageNumber, error);
    return null;
  }
}

async function refreshPdfContextForAI() {
  window.mediqoPdfContext = { documentContext: "", pageThumbnails: [], isReady: false, error: null };
  if (!currentPdfBytes) return window.mediqoPdfContext;

  try {
    setStatus("Reading PDF context…");
    const result = await buildPdfContextForAI(currentPdfBytes);
    window.mediqoPdfContext = {
      documentContext: result.documentContext,
      pageThumbnails: result.pageThumbnails,
      isReady: true,
      error: result.error
    };
    setStatus("PDF context ready");
  } catch (error) {
    console.error(error);
    window.mediqoPdfContext = { documentContext: "", pageThumbnails: [], isReady: false, error: error.message };
    setStatus("PDF context partial", "error");
  }

  return window.mediqoPdfContext;
}

function getPdfDocumentContextForAI() {
  return window.mediqoPdfContext && window.mediqoPdfContext.documentContext
    ? window.mediqoPdfContext.documentContext
    : "Not provided";
}

function getPdfPageThumbnailsForAI() {
  return window.mediqoPdfContext && Array.isArray(window.mediqoPdfContext.pageThumbnails)
    ? window.mediqoPdfContext.pageThumbnails
    : [];
}

const previousEnhancedInspectPdf = inspectPdf;
inspectPdf = async function inspectPdfWithVisualContext() {
  await previousEnhancedInspectPdf();
  await refreshPdfContextForAI();
};
