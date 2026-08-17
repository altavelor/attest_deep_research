import type { EnSettingsProfilesMessages } from "../en/settingsProfiles";

export const settingsProfiles: EnSettingsProfilesMessages = {
  "settings.status.suspended": "Suspendido",

  "settings.profileList.addAction": "Añadir {title}",
  "settings.profileList.column.profile": "Perfil",
  "settings.profileList.column.status": "Estado",
  "settings.profileList.column.actions": "Acciones",
  "settings.profileList.editAction": "Editar perfil",
  "settings.profileList.tag.agent": "Agente",
  "settings.profileList.tag.tools": "Herramientas",
  "settings.profileList.tag.instant": "Instantáneo",

  "settings.capability.status": "{tools} · {agent}",
  "settings.capability.entry": "{subject}: {phase}",
  "settings.capability.subject.tools": "Compatibilidad con herramientas",
  "settings.capability.subject.agent": "Compatibilidad con el modo agente",
  "settings.capability.phase.testing": "Probando…",
  "settings.capability.phase.verified": "Verificada",
  "settings.capability.phase.advertised": "Indicado por el proveedor",
  "settings.capability.phase.notVerified": "Sin verificar",
  "settings.capability.phase.failed": "Fallida",
  "settings.capability.phase.notTested": "Sin probar",

  "settings.models.heading": "Perfiles de modelo",
  "settings.models.desc":
    "Configurar los endpoints de los proveedores y los modelos de chat o de embeddings que los usan.",
  "settings.models.server.title": "Perfiles de servidor",
  "settings.models.server.deleteTooltip": "Eliminar el perfil de servidor",
  "settings.models.server.deleteBlockedTooltip":
    "Eliminar primero los perfiles de modelo dependientes",
  "settings.models.server.deleteBlockedNotice":
    "Eliminar primero los perfiles de modelo dependientes.",
  "settings.models.chat.title": "Perfiles de modelo de chat",
  "settings.models.chat.deleteTooltip": "Eliminar el perfil de modelo de chat",
  "settings.models.chat.testingLabel": "Probando capacidades…",
  "settings.models.chat.testingNotice": "Probando las capacidades de {profile}.",
  "settings.models.embedding.title": "Perfiles de modelo de embeddings",
  "settings.models.embedding.deleteTooltip": "Eliminar el perfil de modelo de embeddings",
  "settings.models.embedding.deleteBlockedTooltip":
    "Este modelo de embeddings lo usa un perfil de índice",
  "settings.models.embedding.deleteBlockedNotice":
    "Este modelo de embeddings lo usa un perfil de índice.",
  "settings.models.embedding.defaultBadge": "Por defecto",
  "settings.models.embedding.defaultBadgeTitle": "Modelo de embeddings por defecto",
  "settings.models.embedding.defaultAction": "Modelo por defecto",
  "settings.models.embedding.setDefaultAction": "Establecer como modelo por defecto",

  "settings.prober.capabilityDetectionFailed": "Falló la detección de capacidades de {profile}.",
  "settings.prober.toolCapabilityDetectionFailed":
    "Falló la detección de la capacidad de herramientas de {profile}.",
  "settings.prober.agentCapabilityDetectionFailed":
    "Falló la detección de la capacidad de modo agente de {profile}.",

  "settings.profileModal.error.requiredFields": "Rellenar todos los campos obligatorios.",
  "settings.profileModal.error.nameLength": "El nombre debe tener entre 1 y {max} caracteres.",
  "settings.profileModal.error.nameUnique": "El nombre debe ser único.",

  "settings.serverModal.editTitle": "Editar el perfil de servidor",
  "settings.serverModal.addTitle": "Añadir un perfil de servidor",
  "settings.serverModal.name.name": "Nombre",
  "settings.serverModal.name.desc":
    "Nombre legible que se muestra en los ajustes y en los selectores de modelo. Máximo {max} caracteres.",
  "settings.serverModal.apiFormat.name": "Formato de API",
  "settings.serverModal.apiFormat.desc": "Formato de petición y respuesta que usa este proveedor.",
  "settings.serverModal.apiFormat.openaiCompatible": "Compatible con OpenAI",
  "settings.serverModal.apiFormat.ollama": "Ollama",
  "settings.serverModal.apiFormat.anthropic": "Anthropic",
  "settings.serverModal.baseUrl.name": "URL base",
  "settings.serverModal.baseUrl.desc":
    "URL del endpoint del proveedor, por ejemplo una base de API de OpenRouter, Ollama o Anthropic.",
  "settings.serverModal.apiKey.name": "Clave de API",
  "settings.serverModal.apiKey.desc":
    "Opcional. Se usa como token bearer con los proveedores que requieren autenticación.",

  "settings.modelProfileModal.editTitle.chat": "Editar el perfil de modelo de chat",
  "settings.modelProfileModal.editTitle.embedding": "Editar el perfil de modelo de embeddings",
  "settings.modelProfileModal.addTitle.chat": "Añadir un perfil de modelo de chat",
  "settings.modelProfileModal.addTitle.embedding": "Añadir un perfil de modelo de embeddings",
  "settings.modelProfileModal.name.name": "Nombre",
  "settings.modelProfileModal.name.desc":
    "Nombre legible que se muestra en los ajustes y en los controles del chat. Máximo {max} caracteres.",
  "settings.modelProfileModal.server.name": "Servidor",
  "settings.modelProfileModal.server.desc":
    "Endpoint del proveedor que se usa para llamar a este modelo.",
  "settings.modelProfileModal.model.name": "Modelo",
  "settings.modelProfileModal.model.desc":
    "Nombre del modelo obtenido del perfil de servidor seleccionado.",
  "settings.modelProfileModal.model.placeholder": "Obtener modelos y escribir para filtrar",
  "settings.modelProfileModal.model.fetch": "Obtener",
  "settings.modelProfileModal.model.empty": "No hay modelos coincidentes",
  "settings.modelProfileModal.temperature.name": "Temperatura",
  "settings.modelProfileModal.temperature.desc":
    "Opcional. Controla la aleatoriedad de la respuesta; en blanco se usa el valor por defecto del proveedor o de la aplicación.",
  "settings.modelProfileModal.maxTokens.name": "Máximo de tokens",
  "settings.modelProfileModal.maxTokens.desc":
    "Opcional. Limita la longitud de la respuesta; en blanco se usa el valor por defecto del proveedor o del modelo, o 4096 con Anthropic.",
  "settings.modelProfileModal.contextSize.name": "Tamaño del contexto",
  "settings.modelProfileModal.contextSize.desc":
    "Límite de tokens opcional. Se rellena con los metadatos del modelo cuando están disponibles y se usa para respetar la ventana de contexto del chat.",
  "settings.modelProfileModal.error.selectServer": "Seleccionar primero un perfil de servidor.",
  "settings.modelProfileModal.error.activeServer": "Seleccionar un perfil de servidor activo.",
  "settings.modelProfileModal.error.fetchModels":
    "Obtener los modelos antes de crear un perfil de modelo.",
  "settings.modelProfileModal.error.reasoningEffort":
    "El esfuerzo de razonamiento debe ser el del proveedor por defecto o estar verificado por la prueba de capacidades.",
  "settings.modelProfileModal.error.reasoningSummary":
    "Los resúmenes de razonamiento no se verificaron para este perfil.",

  "settings.capabilityControls.heading": "Capacidades",
  "settings.capabilityControls.testTooltip": "Probar las capacidades — {status}",
  "settings.capabilityControls.testingTooltip": "Prueba de capacidades en curso…",
  "settings.capabilityControls.retestTooltip": "Volver a probar las capacidades — {status}",
  "settings.capabilityControls.agentic.name": "Modo agente",
  "settings.capabilityControls.agentic.desc":
    "Activar la compatibilidad verificada con el modo agente.",
  "settings.capabilityControls.effort.name": "Esfuerzo de razonamiento",
  "settings.capabilityControls.effort.desc":
    "Automático usa el valor por defecto del proveedor o uno verificado.",
  "settings.capabilityControls.effort.auto": "Automático",
  "settings.capabilityControls.effort.enableAgentic":
    "Activar el modo agente para elegir un esfuerzo de razonamiento.",
  "settings.capabilityControls.tools.name": "Herramientas",
  "settings.capabilityControls.tools.desc":
    "Permitir que este modelo llame a las herramientas de notas: leer, buscar y, con permiso de edición, modificar notas de la bóveda. Las herramientas de investigación de índice y web del modo Reflexivo se controlan aparte.",
  "settings.capabilityControls.notVerified": "No verificada por la prueba de capacidades.",
  "settings.capabilityControls.notTested": "Todavía sin probar.",
};
