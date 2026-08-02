// Публичный API подмодуля chat/artifacts — отрисовка галерей и графиков ответа
// и освобождение созданных ими ресурсов.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { renderAnswerArtifacts, disposeAnswerArtifacts } from "./artifactRenderer";
export type { ArtifactRenderOptions } from "./artifactRenderer";
export { attributionText, isPageReference } from "./imageAttribution";
export { renderChartArtifact } from "./chartRenderer";
export { renderImageGalleryArtifact } from "./imageGalleryRenderer";
export { resolveAnswerImageSource } from "./imageSourceResolver";
export { ImageLightboxModal } from "./ImageLightboxModal";
