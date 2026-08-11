import type { EnSettingsMessages } from "../en/settings";

export const settings: EnSettingsMessages = {
  "settings.language.heading": "Idioma",
  "settings.language.name": "Idioma de la interfaz",
  "settings.language.desc": "Idioma de la interfaz de Attest. Se aplica sin reiniciar Obsidian.",
  "settings.language.auto": "Automático (según Obsidian)",

  "settings.tab.heading": "Attest",
  "settings.tab.quickStart.title": "Inicio rápido",
  "settings.tab.quickStart.steps":
    "1. Añadir un servidor → 2. Añadir un modelo de chat → 3. (opcional) Añadir un índice",
  "settings.tab.gateHint": "Añadir primero un perfil de modelo de chat",

  "settings.advanced.debugMode.name": "Modo de depuración",
  "settings.advanced.debugMode.desc":
    "Registrar los detalles de las peticiones y respuestas del plugin. Las claves de API se ocultan.",

  "settings.retrieval.heading": "Recuperación",
  "settings.retrieval.desc":
    "Controla cómo Attest busca evidencias locales, del grafo, del índice, de documentos y de la web antes de responder.",
  "settings.retrieval.graph.heading": "Grafo de Obsidian",
  "settings.retrieval.useLinkedNotes.name": "Usar notas enlazadas",
  "settings.retrieval.useLinkedNotes.desc":
    "Descubrir notas enlazadas desde @menciones, archivos activos y adjuntos incluidos antes de la recuperación.",
  "settings.retrieval.includeBacklinks.name": "Incluir enlaces entrantes",
  "settings.retrieval.includeBacklinks.desc":
    "Usar enlaces entrantes de un salto como candidatos del grafo. Esas notas no se recorren más allá.",
  "settings.retrieval.expandFilteredContextThroughLinks.name":
    "Ampliar los archivos filtrados a través de enlaces",
  "settings.retrieval.expandFilteredContextThroughLinks.desc":
    "Cuando los archivos adjuntos están en modo Filtro, buscar también en sus vecinos enlazados del grafo.",
  "settings.retrieval.graphDepth.name": "Profundidad del grafo",
  "settings.retrieval.graphDepth.desc":
    "La profundidad 1 sigue enlaces directos, incrustaciones y enlaces entrantes. La profundidad 2 se reserva para depuración avanzada.",
  "settings.retrieval.search.heading": "Búsqueda",
  "settings.retrieval.expandSearchQuery.name": "Ampliar la consulta de búsqueda",
  "settings.retrieval.expandSearchQuery.desc":
    "Generar variantes de la consulta en varios idiomas antes de la recuperación para encontrar notas escritas en otras lenguas. Consume una llamada adicional al modelo de chat por búsqueda.",
  "settings.retrieval.web.heading": "Web",
  "settings.retrieval.useWebWhenFreshnessNeeded.name": "Usar la web para preguntas de actualidad",
  "settings.retrieval.useWebWhenFreshnessNeeded.desc":
    "Dar más presupuesto a las evidencias web cuando la pregunta pide información actual, reciente, de precios o de lanzamientos.",

  "settings.newChatDefaults.heading": "Valores por defecto de los chats nuevos",
  "settings.newChatDefaults.desc":
    "Configuración inicial de cada chat nuevo. Los chats guardados conservan sus propios ajustes.",
  "settings.newChatDefaults.source.name": "Fuente por defecto",
  "settings.newChatDefaults.source.desc":
    "Fuentes de evidencias con las que empieza un chat nuevo.",
  "settings.newChatDefaults.source.none": "Ninguna",
  "settings.newChatDefaults.source.indexOnly": "Índice",
  "settings.newChatDefaults.source.webOnly": "Web",
  "settings.newChatDefaults.source.indexAndWeb": "Índice + Web",
  "settings.newChatDefaults.index.name": "Índice por defecto",
  "settings.newChatDefaults.index.desc":
    "Perfil de índice con el que empieza un chat nuevo, usado siempre que la fuente incluya el índice.",
  "settings.newChatDefaults.index.empty": "No hay perfiles de índice disponibles",
  "settings.newChatDefaults.mode.name": "Modo por defecto",
  "settings.newChatDefaults.mode.desc": "Modo de investigación con el que empieza un chat nuevo.",
  "settings.newChatDefaults.mode.descBlocked":
    "Modo de investigación con el que empieza un chat nuevo. {hint}",
  "settings.newChatDefaults.mode.thinkingUnavailable":
    "El modo Reflexivo necesita un modelo de chat con la capacidad de agente verificada. Probar las capacidades del modelo para activarlo.",
  "settings.newChatDefaults.mode.instant": "Instantáneo",
  "settings.newChatDefaults.mode.thinking": "Reflexivo",
  "settings.newChatDefaults.model.name": "Modelo por defecto",
  "settings.newChatDefaults.model.desc":
    "Perfil de modelo de chat con el que empieza un chat nuevo.",
  "settings.newChatDefaults.model.empty": "No hay perfiles de modelo de chat disponibles",
  "settings.newChatDefaults.activeFile.name": "Incluir el archivo activo como contexto",
  "settings.newChatDefaults.activeFile.desc":
    "Incluir automáticamente el archivo compatible abierto como contexto explícito del chat.",

  "settings.webSources.heading": "Fuentes externas",
  "settings.webSources.desc":
    "Búsqueda web externa iniciada por la persona usuaria en las fuentes activadas. Attest envía solo la pregunta escrita, nunca contenido recuperado de la bóveda.",
  "settings.webSources.count": "{enabled} de {total} activadas",
  "settings.webSources.column.source": "Fuente",
  "settings.webSources.column.actions": "Acciones",
  "settings.webSources.column.state": "Estado",
  "settings.webSources.categoryCount": "{category} · {enabled}/{total}",
  "settings.webSources.category.serp": "Búsqueda web general",
  "settings.webSources.category.neural": "Búsqueda con IA",
  "settings.webSources.category.academic": "Académica",
  "settings.webSources.category.encyclopedia": "Enciclopedia",
  "settings.webSources.category.community": "Desarrollo y comunidad",
  "settings.webSources.category.news": "Noticias",
  "settings.webSources.category.fetch": "Descarga de página como alternativa",
  "settings.webSources.category.image": "Búsqueda de imágenes",
  "settings.webSources.activation.off": "Desactivada",
  "settings.webSources.activation.auto": "Automática — se usa cuando el planificador la elige",
  "settings.webSources.activation.always": "Siempre — se consulta en cada búsqueda web",
  "settings.webSources.issue.unauthorized": "Credenciales rechazadas — revisar la clave de API",
  "settings.webSources.issue.rateLimited":
    "Límite de peticiones superado — se reintentará automáticamente más tarde",
  "settings.webSources.setUp": "Configurar…",
  "settings.webSources.setUpAria": "Configurar {source}",
  "settings.webSources.configure": "Configurar {source}",
  "settings.webSources.lampIssueTitle": '{issue} — hacer clic para cambiar a "{next}"',
  "settings.webSources.lampTitle": '{source}: {current} — hacer clic para cambiar a "{next}"',
  "settings.webSources.meta.required": "{fields} obligatorios",
  "settings.webSources.meta.configured": "configurada",

  "settings.webSourceModal.title": "Configurar {source}",
  "settings.webSourceModal.info": "{note}. ",
  "settings.webSourceModal.providerDocs": "Documentación del proveedor",
  "settings.webSourceModal.field.optional": "Opcional.",
  "settings.webSourceModal.field.required": "Obligatorio para activar esta fuente.",
  "settings.webSourceModal.imageSearch.name": "Usar para la búsqueda de imágenes",
  "settings.webSourceModal.imageSearch.desc":
    "Desactivado por defecto. Si se activa, search_images puede consultar el endpoint de imágenes de este motor, que consume la misma cuota que la búsqueda de texto.",
  "settings.webSourceModal.disabledNotice":
    "{source} desactivada: faltan las credenciales obligatorias.",
};
