/** Loads a local PDF.js runtime in place of the host's built-in PDF engine. */
export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  if (typeof window !== "undefined") {
    (window as typeof window & { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  }
  return pdfjs;
}
