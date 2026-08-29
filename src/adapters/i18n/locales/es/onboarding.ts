import type { EnOnboardingMessages } from "../en/onboarding";

export const onboarding: EnOnboardingMessages = {
  "onboarding.title": "Configurar Attest",
  "onboarding.progress": "Paso {step} de {total}",
  "onboarding.scope.pickOne": "Elige una opción para continuar",

  "onboarding.action.back": "Atrás",
  "onboarding.action.skip": "Omitir y configurar manualmente",
  "onboarding.action.continue": "Continuar",
  "onboarding.action.checking": "Comprobando…",
  "onboarding.action.startIndexing": "Iniciar la indexación",
  "onboarding.action.finish": "Finalizar",
  "onboarding.action.openChat": "Abrir el chat",
  "onboarding.action.addVaultLater": "Añadir la búsqueda en notas más tarde",
  "onboarding.action.keepIndexing": "Seguir indexando en segundo plano",

  "onboarding.chat.title": "Proveedor y modelo de chat",
  "onboarding.chat.intro":
    "Attest crea los perfiles por ti sobre la marcha. Todo esto se puede cambiar después en los ajustes del complemento.",

  "onboarding.endpoint.provider.name": "Proveedor",
  "onboarding.endpoint.provider.chatDesc":
    "Rellena la URL base y el formato de la API. Tu modelo de incrustaciones puede usar otro distinto.",
  "onboarding.endpoint.provider.embeddingDesc":
    "El modelo de incrustaciones puede estar en un servidor distinto al del modelo de chat.",
  "onboarding.endpoint.baseUrl.name": "URL base",
  "onboarding.endpoint.baseUrl.desc":
    "Se rellena según el proveedor. Edítala si usas un servidor propio.",
  "onboarding.endpoint.apiKey.name": "Clave de API (opcional)",
  "onboarding.endpoint.apiKey.desc":
    "Se guarda en los ajustes del complemento de esta bóveda. Los proveedores locales no necesitan ninguna.",
  "onboarding.endpoint.connection.name": "Conexión",
  "onboarding.endpoint.connection.action": "Probar la conexión",
  "onboarding.endpoint.connection.desc":
    "Carga la lista de modelos para confirmar que el servidor responde.",
  "onboarding.endpoint.connection.testing": "Contactando con el proveedor…",
  "onboarding.endpoint.connection.mobileLocal":
    "Los proveedores de modelos locales no están disponibles en Obsidian Mobile. Elige un proveedor en la nube.",
  "onboarding.endpoint.model.chatName": "Modelo de chat",
  "onboarding.endpoint.model.embeddingName": "Modelo de incrustaciones",
  "onboarding.endpoint.model.desc": "{count} modelos sirven para esta función.",
  "onboarding.endpoint.model.empty": "Prueba la conexión para cargar la lista de modelos.",
  "onboarding.endpoint.model.placeholder": "Selecciona un modelo",
  "onboarding.endpoint.model.testing": "Probando",

  "onboarding.scope.title": "¿De dónde deben salir las respuestas?",
  "onboarding.scope.intro":
    "Esta es la única elección que cambia cuánta configuración queda. Buscar en tu bóveda requiere un modelo de incrustaciones y un índice; la web no requiere ninguno de los dos.",
  "onboarding.scope.notesAndWeb.name": "Mis notas y la web",
  "onboarding.scope.notesAndWeb.desc":
    "La opción completa. Dos pasos más: un modelo de incrustaciones y luego las carpetas que indexar.",
  "onboarding.scope.webOnly.name": "Solo la web",
  "onboarding.scope.webOnly.desc":
    "Respuestas con citas de la web abierta, más la nota que tengas abierta. Sin índice ni modelo de incrustaciones. DuckDuckGo ya está activo y no necesita clave.",
  "onboarding.scope.notesOnly.name": "Solo mis notas",
  "onboarding.scope.notesOnly.desc":
    "Nada sale de la bóveda salvo la propia pregunta, que va a tu modelo de chat.",
  "onboarding.scope.remaining.two": "Quedan 2 pasos",
  "onboarding.scope.remaining.none": "Listo después de esto",

  "onboarding.embedding.title": "El modelo que lee tus notas",
  "onboarding.embedding.intro":
    "Puede ser de un proveedor distinto al de tu modelo de chat: una combinación habitual es un modelo de chat en la nube con incrustaciones locales, para que el texto de las notas nunca salga del equipo.",
  "onboarding.embedding.sameAsChat.name": "El mismo servidor que el modelo de chat",
  "onboarding.embedding.previousProvider": "antes: igual que el chat ({provider})",
  "onboarding.embedding.sameAsChat.desc":
    "Desactívalo para generar incrustaciones en otro servidor. Entonces se creará un segundo perfil de servidor.",
  "onboarding.embedding.rebuildWarning":
    "Cambiar este modelo más adelante obliga a reconstruir el índice: los vectores de dos modelos no son comparables.",
  "onboarding.embedding.unverified":
    "No se pudo verificar la capacidad de incrustación. Tu modelo de chat ya funciona, así que puedes terminar con la web y añadir la búsqueda en la bóveda más tarde.",
  "onboarding.embedding.useWebInstead": "Usar la web en su lugar",

  "onboarding.folders.title": "¿Qué notas puede leer Attest?",
  "onboarding.folders.intro": "Solo se indexan estas carpetas y solo ellas se pueden citar.",
  "onboarding.folders.mode.name": "Carpetas",
  "onboarding.folders.mode.desc":
    "Empieza con poco: ampliar después es una actualización incremental barata.",
  "onboarding.folders.mode.wholeVault": "Toda la bóveda",
  "onboarding.folders.mode.selected": "Carpetas seleccionadas",
  "onboarding.folders.paths.name": "Seleccionadas",
  "onboarding.folders.paths.action": "Elegir carpetas…",
  "onboarding.folders.paths.empty": "Aún no has seleccionado nada.",
  "onboarding.folders.paths.remove": "Quitar {path}",
  "onboarding.folders.excluded.name": "Excluidas",
  "onboarding.folders.excluded.desc": "Rellenado previamente.",
  "onboarding.folders.location.name": "Ubicación del índice",
  "onboarding.folders.location.desc": "Dentro de la bóveda, para que se sincronice con tus notas.",
  "onboarding.folders.location.outsideVault":
    "El índice debe permanecer dentro del baúl. Elimina los segmentos «..» y la barra inicial.",
  "onboarding.folders.mobileWarning":
    "En el móvil la primera construcción es lenta: lotes pequeños, una página de PDF cada vez y los PDF grandes se omiten. Constrúyelo en el escritorio y sincroniza, o toma de momento la vía de solo web.",

  "onboarding.finish.web.title": "La investigación web está lista",
  "onboarding.finish.web.status": "2 perfiles · sin espera",
  "onboarding.finish.vault.title": "Indexando la búsqueda en notas",
  "onboarding.finish.vault.status": "se ejecuta en segundo plano",
  "onboarding.finish.vault.doneTitle": "La búsqueda en tus notas está lista",
  "onboarding.finish.vault.doneStatus": "indexación finalizada",
  "onboarding.finish.vault.errorTitle": "Indexación interrumpida",
  "onboarding.finish.vault.errorStatus": "la indexación falló",
  "onboarding.finish.tag.server": "Perfil de servidor",
  "onboarding.finish.tag.chat": "Modelo de chat",
  "onboarding.finish.tag.embedding": "Modelo de embedding",
  "onboarding.finish.tag.index": "Perfil de índice",
  "onboarding.finish.stats.files": "{scanned} / {total} archivos",
  "onboarding.finish.stats.chunks": "{embedded} / {total} fragmentos",
  "onboarding.finish.webIntro":
    "No hay nada que indexar, así que la configuración termina aquí. Haz una pregunta y la respuesta citará las páginas web que haya usado.",
  "onboarding.finish.vaultIntro":
    "El chat se abre ahora; las respuestas desde la bóveda mejoran a medida que llegan los fragmentos. El índice sigue construyéndose si cierras este diálogo.",
  "onboarding.finish.vaultDoneIntro":
    "Todas las notas seleccionadas están indexadas. Haz una pregunta y la respuesta citará las notas que usó.",
  "onboarding.finish.vaultErrorIntro":
    "El modelo de chat funciona, así que puedes empezar ya. Abre el perfil de índice en los ajustes para ver la causa y volver a ejecutarlo.",
  "onboarding.finish.indexingStarting": "Iniciando la primera construcción del índice…",

  "command.runSetup": "Ejecutar la configuración inicial",
};
