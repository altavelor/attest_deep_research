declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export interface PdfTextContentItem {
    str?: string;
    hasEOL?: boolean;
  }

  export interface PdfTextContent {
    items: PdfTextContentItem[];
  }

  export interface PdfPageProxy {
    getTextContent(options?: { disableCombineTextItems?: boolean }): Promise<PdfTextContent>;
  }

  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
  }

  export interface PdfLoadingTask {
    promise: Promise<PdfDocumentProxy>;
    destroy(): Promise<void>;
  }

  export const VerbosityLevel: {
    ERRORS: number;
    WARNINGS: number;
    INFOS: number;
  };

  export function getDocument(options: {
    data: Uint8Array;
    disableWorker?: boolean;
    useSystemFonts?: boolean;
    verbosity?: number;
  }): PdfLoadingTask;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
