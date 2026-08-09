import type { EnCommonMessages } from "../en/common";

export const common: EnCommonMessages = {
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.close": "Cerrar",
  "common.advanced": "Avanzado",
  "common.unknownError": "Error desconocido",
  "common.copiedToClipboard": "Copiado al portapapeles.",
  "common.pdfPage": "pág. {page}",

  "profile.error.chatModelMissing":
    "Seleccionar un perfil de modelo de chat antes de hacer una pregunta.",
  "profile.error.embeddingModelMissing":
    "Seleccionar un perfil de modelo de embeddings antes de usar este índice.",
  "profile.error.serverUnavailable": "El perfil de servidor seleccionado no está disponible.",
  "profile.error.indexNotBuilt": "Indexar este perfil antes de usarlo en el chat o la búsqueda.",
  "profile.error.indexUnavailable": "El perfil de índice seleccionado no está disponible.",
  "profile.warning.indexNotSelected":
    "Seleccionar un perfil indexado en los ajustes de Ixplorer antes de buscar.",
  "profile.warning.embeddingProfileUnavailable":
    "El perfil de modelo de embeddings del índice seleccionado no está disponible. Actualizarlo en los ajustes de Ixplorer.",
  "profile.warning.embeddingProfileSuspended":
    "El perfil de modelo de embeddings del índice seleccionado está suspendido. Actualizarlo en los ajustes de Ixplorer.",
  "profile.warning.embeddingNotSupported":
    "El modelo de embeddings del índice seleccionado no puede crear embeddings. Actualizarlo en los ajustes de Ixplorer.",
  "profile.warning.embeddingServerUnavailable":
    "El servidor de embeddings del índice seleccionado no está disponible. Actualizarlo en los ajustes de Ixplorer.",
};
