import type { EnSettingsIndexingMessages } from "../en/settingsIndexing";

export const settingsIndexing: EnSettingsIndexingMessages = {
  "settings.indexing.heading": "Indexación",
  "settings.indexProfiles.title": "Perfiles de índice",
  "settings.indexProfiles.addAction": "Añadir un perfil de índice",
  "settings.indexProfiles.column.index": "Índice",
  "settings.indexProfiles.column.size": "Tamaño",
  "settings.indexProfiles.column.status": "Estado",
  "settings.indexProfiles.column.actions": "Acciones",
  "settings.indexProfiles.mode.wholeVault": "Bóveda completa",
  "settings.indexProfiles.mode.selected": "Selección",
  "settings.indexProfiles.meta": "{mode} · {paths} rutas",
  "settings.indexProfiles.size": "{size} · {files} archivos",
  "settings.indexProfiles.action.continueIndexing": "Continuar la indexación",
  "settings.indexProfiles.action.pauseIndexing": "Pausar la indexación",
  "settings.indexProfiles.action.stopMetadata": "Detener la extracción de metadatos",
  "settings.indexProfiles.action.updateIndex": "Actualizar el índice",
  "settings.indexProfiles.action.startIndexing": "Iniciar la indexación",
  "settings.indexProfiles.action.showReport": "Ver el informe del índice",
  "settings.indexProfiles.action.edit": "Editar el perfil de índice",
  "settings.indexProfiles.action.delete": "Eliminar el perfil de índice",
  "settings.indexProfiles.notice.maxProfiles": "Se pueden crear hasta {max} perfiles de índice.",
  "settings.indexProfiles.notice.embeddingRequired":
    "Crear un modelo de embeddings activo antes de añadir un índice.",
  "settings.indexProfiles.notice.embeddingRequiredForRun":
    "Crear un modelo de embeddings activo antes de indexar.",
  "settings.indexProfiles.notice.chatRequiredForMetadata":
    "Crear un perfil de modelo de chat activo antes de extraer metadatos.",
  "settings.indexProfiles.notice.reportFailed": "No se pudo cargar el informe del índice.",

  "settings.enrichment.running": "Enriqueciendo{scope}{file}{phase}",
  "settings.enrichment.scope": " {processed}/{total}",
  "settings.enrichment.file": " · {file}",
  "settings.enrichment.phase.metadata": " · extrayendo metadatos",
  "settings.enrichment.phase.sectionsWithCount": " · resumiendo la sección {index}/{count}",
  "settings.enrichment.phase.sections": " · resumiendo las secciones",
  "settings.enrichment.phase.document": " · redactando el resumen del documento",
  "settings.enrichment.phase.claimsWithCount": " · extrayendo afirmaciones {index}/{count}",
  "settings.enrichment.phase.claims": " · extrayendo afirmaciones",
  "settings.enrichment.phase.listingSources": " · listando las fuentes",
  "settings.enrichment.done":
    "Metadatos: {extracted} extraídos, {skipped} al día{failed} ({total} fuentes)",
  "settings.enrichment.doneFailed": ", {failed} fallidos",
  "settings.enrichment.error": "Falló el enriquecimiento de metadatos: {message}",
  "settings.enrichment.unknownError": "error desconocido",

  "settings.indexStatus.error.label": "Error",
  "settings.indexStatus.error.title": "Falló la indexación",
  "settings.indexStatus.stale.label": "Índice desactualizado",
  "settings.indexStatus.stale.title":
    "El perfil de índice cambió: ejecutar Actualizar para refrescar el índice.",
  "settings.indexStatus.staleMetadata.label": "Metadatos desactualizados",
  "settings.indexStatus.staleMetadata.title":
    "El índice cambió después de la última extracción de metadatos: ejecutar Actualizar con la sección de metadatos activada.",
  "settings.indexStatus.reindexRequired.label": "Reindexación necesaria",
  "settings.indexStatus.reindexRequired.title":
    "Este índice se creó antes de que existieran los metadatos de imágenes de documentos: reconstruirlo por completo para activar el descubrimiento de imágenes desde el índice. La búsqueda de texto sigue funcionando.",
  "settings.indexStatus.pausing.label": "Pausando",
  "settings.indexStatus.pausing.tooltip": "Pausando{detail}",
  "settings.indexStatus.indexing.label": "Indexando",
  "settings.indexStatus.indexing.tooltip": "Indexando{detail}",
  "settings.indexStatus.paused.label": "En pausa",
  "settings.indexStatus.paused.tooltip": "En pausa{detail}",
  "settings.indexStatus.finished.label": "Finalizado",
  "settings.indexStatus.finished.tooltip":
    "Finalizado\nArchivos: {scanned} · {counters}\nFragmentos con embeddings: {chunks}",
  "settings.indexStatus.finished.scanned": "{scanned}/{total} analizados",
  "settings.indexStatus.finished.scanComplete": "análisis completo",
  "settings.indexStatus.finished.indexed": "{count} indexados",
  "settings.indexStatus.finished.skipped": "{count} omitidos",
  "settings.indexStatus.finished.deferred": "{count} aplazados",
  "settings.indexStatus.finished.failed": "{count} fallidos",
  "settings.indexStatus.stopping.label": "Deteniendo",
  "settings.indexStatus.stopping.tooltip": "Deteniendo la extracción de metadatos{detail}",
  "settings.indexStatus.enriching.label": "Enriqueciendo",
  "settings.indexStatus.enriching.tooltip": "Enriqueciendo los metadatos{detail}",
  "settings.indexStatus.progress.chunks": " · {embedded}/{total} fragmentos{file}",
  "settings.indexStatus.progress.files": " · {percent} % · {scanned}/{total} archivos{file}",
  "settings.indexStatus.progress.file": " · {file}",
  "settings.indexStatus.enrichmentDetail": "{scope}{file}{phase}",
  "settings.indexStatus.enrichmentScope": " · {processed}/{total}",
  "settings.indexStatus.enrichmentPhase.metadata": "\nextrayendo metadatos",
  "settings.indexStatus.enrichmentPhase.sectionsWithCount":
    "\nresumiendo la sección {index}/{count}",
  "settings.indexStatus.enrichmentPhase.sections": "\nresumiendo las secciones",
  "settings.indexStatus.enrichmentPhase.document": "\nredactando el resumen del documento",
  "settings.indexStatus.enrichmentPhase.listingSources": "\nlistando las fuentes",

  "settings.indexProfileModal.editTitle": "Editar el perfil de índice",
  "settings.indexProfileModal.addTitle": "Añadir un perfil de índice",
  "settings.indexProfileModal.name.name": "Nombre",
  "settings.indexProfileModal.name.desc":
    "Nombre único del índice que se muestra en los ajustes, el chat y los selectores de búsqueda. Máximo {max} caracteres.",
  "settings.indexProfileModal.mode.name": "Modo",
  "settings.indexProfileModal.mode.desc":
    "La bóveda completa indexa todos los archivos visibles compatibles salvo las rutas excluidas; la selección indexa solo las rutas elegidas.",
  "settings.indexProfileModal.mode.wholeVault": "Bóveda completa",
  "settings.indexProfileModal.mode.selected": "Selección",
  "settings.indexProfileModal.included.name": "Incluidos",
  "settings.indexProfileModal.included.desc":
    "Archivos y carpetas que deben incluirse en este índice.",
  "settings.indexProfileModal.excluded.name": "Excluidos",
  "settings.indexProfileModal.excluded.desc":
    "Archivos y carpetas que deben excluirse de este índice de bóveda completa.",
  "settings.indexProfileModal.embeddingModel.name": "Modelo de embeddings",
  "settings.indexProfileModal.embeddingModel.desc":
    "Modelo de embeddings que genera los vectores de este índice.",
  "settings.indexProfileModal.embeddingModel.placeholder": "Seleccionar el modelo de embeddings",
  "settings.indexProfileModal.chunkSize.name": "Tamaño del fragmento",
  "settings.indexProfileModal.chunkSize.desc":
    "Tamaño máximo del fragmento de texto en archivos que no son PDF.",
  "settings.indexProfileModal.chunkOverlap.name": "Solapamiento de fragmentos",
  "settings.indexProfileModal.chunkOverlap.desc":
    "Número de caracteres compartidos entre fragmentos contiguos que no son PDF.",
  "settings.indexProfileModal.embeddingBatchSize.name": "Tamaño del lote de embeddings",
  "settings.indexProfileModal.embeddingBatchSize.desc":
    "Número de fragmentos enviados en una misma petición de embeddings.",
  "settings.indexProfileModal.pdfChunkSize.name": "Tamaño del fragmento PDF",
  "settings.indexProfileModal.pdfChunkSize.desc":
    "Tamaño máximo del fragmento de texto en archivos PDF.",
  "settings.indexProfileModal.pdfChunkOverlap.name": "Solapamiento de fragmentos PDF",
  "settings.indexProfileModal.pdfChunkOverlap.desc":
    "Número de caracteres compartidos entre fragmentos PDF contiguos.",
  "settings.indexProfileModal.choose": "Elegir",
  "settings.indexProfileModal.noPaths": "No hay rutas seleccionadas",
  "settings.indexProfileModal.error.name":
    "Usar un nombre único de hasta 60 caracteres con letras, números, espacios, _, -, ., (, ), [, ].",
  "settings.indexProfileModal.error.embeddingModel": "Seleccionar un modelo de embeddings.",
  "settings.indexProfileModal.error.includedPath": "Seleccionar al menos una ruta incluida.",
  "settings.indexProfileModal.error.numbers":
    "Los ajustes numéricos del índice deben ser números enteros válidos.",
  "settings.indexProfileModal.notice.rebuild":
    "Los ajustes del índice cambiaron. Reconstruir este índice para aplicar la nueva configuración.",

  "settings.indexPathPicker.title": "Elegir archivos y carpetas",
  "settings.indexPathPicker.search.name": "Buscar",
  "settings.indexPathPicker.search.placeholder": "Filtrar archivos y carpetas",
  "settings.indexPathPicker.empty": "No hay rutas coincidentes",
  "settings.indexPathPicker.toggle": "Alternar {path}",
  "settings.indexPathPicker.vaultRoot": "raíz de la bóveda",
  "settings.indexPathPicker.select": "Seleccionar {path}",

  "settings.indexRun.updateTitle": "Actualizar “{profile}”",
  "settings.indexRun.indexTitle": "Indexar “{profile}”",
  "settings.indexRun.embedding.name": "Indexar el contenido (modelo de embeddings)",
  "settings.indexRun.embedding.desc":
    "Extraer, fragmentar e incorporar los archivos de la bóveda al índice.",
  "settings.indexRun.embeddingModel.name": "Modelo de embeddings",
  "settings.indexRun.modelOption": "{name} ({model})",
  "settings.indexRun.tokenWarning":
    "La extracción de metadatos puede tardar mucho tiempo y consumir gran cantidad de tokens.",
  "settings.indexRun.metadata.name": "Extraer metadatos y resúmenes (modelo de chat)",
  "settings.indexRun.metadata.desc":
    "Extraer título, autoría, año, resumen y referencias, y generar resúmenes de sección y de documento para cada documento. Los documentos sin cambios se omiten.",
  "settings.indexRun.metadataModel.name": "Modelo de metadatos",
  "settings.indexRun.reextract.name": "Volver a extraer los documentos sin cambios",
  "settings.indexRun.reextract.desc":
    "Ignorar los metadatos guardados y volver a ejecutar la extracción en todos los documentos.",
  "settings.indexRun.embeddingChangedWarning":
    "Cambiar el modelo de embeddings obliga a reindexar por completo: al ejecutarlo se reconstruirán el índice y sus metadatos desde cero.",
  "settings.indexRun.mobileRebuildWarning":
    "Reconstruir en el móvil puede consumir mucha batería, memoria y datos. Pulsa Reconstruir otra vez para confirmar.",
  "settings.indexRun.start": "Iniciar",
  "settings.indexRun.rebuild": "Reconstruir",
  "settings.indexRun.update": "Actualizar",

  "settings.indexReport.title": "Informe de {profile}",
  "settings.indexReport.indexedFiles": "{count} archivos indexados",
  "settings.indexReport.failedFiles": "{count} archivos fallidos",
  "settings.indexReport.chunks": "{count} fragmentos",
  "settings.indexReport.enriched": "{count} enriquecidos",
  "settings.indexReport.empty": "Todavía no hay ningún informe de indexación.",
  "settings.indexReport.failed": "Fallido",
  "settings.indexReport.indexingFailed": "Falló la indexación.",
  "settings.indexReport.metadataSection": "Metadatos del índice",
  "settings.indexReport.extractionModel": "Modelo de extracción: {models}",
  "settings.indexReport.lastExtracted": "Última extracción: {timestamp}",
  "settings.indexReport.referencesCollected": "Referencias recopiladas: {count}",
  "settings.indexReport.sharedReferences":
    "Referencias compartidas (citadas por varios documentos):",
  "settings.indexReport.sharedReference": "{count}× — {reference}",
  "settings.indexReport.citedBy": "Citada por: {sources}",
  "settings.indexReport.authors": "Autoría: {authors}",
  "settings.indexReport.references": "Referencias ({count}):",
  "settings.indexReport.summary": "Resumen · {count} secciones",
  "settings.indexReport.section": "{heading}: {summary}",
  "settings.indexReport.metadataFallbackTitle": "Metadatos",
  "settings.indexReport.refs": "{count} refs",
};
