import type { EnOnboardingMessages } from "../en/onboarding";

export const onboarding: EnOnboardingMessages = {
  "onboarding.title": "إعداد Attest",
  "onboarding.progress": "الخطوة {step} من {total}",
  "onboarding.scope.pickOne": "اختر خيارًا للمتابعة",

  "onboarding.action.back": "رجوع",
  "onboarding.action.skip": "تخطٍ مع الإعداد يدويًا",
  "onboarding.action.continue": "متابعة",
  "onboarding.action.checking": "جارٍ التحقق…",
  "onboarding.action.startIndexing": "بدء الفهرسة",
  "onboarding.action.finish": "إنهاء",
  "onboarding.action.openChat": "فتح المحادثة",
  "onboarding.action.addVaultLater": "أضف البحث في الملاحظات لاحقًا",
  "onboarding.action.keepIndexing": "تابع الفهرسة في الخلفية",

  "onboarding.chat.title": "مزوّد المحادثة والنموذج",
  "onboarding.chat.intro":
    "ينشئ Attest الملفات نيابةً عنك أثناء تقدّمك. كل ما هنا يمكن تغييره لاحقًا من إعدادات الإضافة.",

  "onboarding.endpoint.provider.name": "المزوّد",
  "onboarding.endpoint.provider.chatDesc":
    "يملأ الرابط الأساسي وصيغة الواجهة البرمجية. يمكن لنموذج التضمين استخدام مزوّد آخر.",
  "onboarding.endpoint.provider.embeddingDesc":
    "قد يكون نموذج التضمين على خادم غير الخادم الذي يستضيف نموذج المحادثة.",
  "onboarding.endpoint.baseUrl.name": "الرابط الأساسي",
  "onboarding.endpoint.baseUrl.desc": "يُملأ من المزوّد. عدّله إذا كنت تستضيف الخدمة بنفسك.",
  "onboarding.endpoint.apiKey.name": "مفتاح الواجهة البرمجية (اختياري)",
  "onboarding.endpoint.apiKey.desc":
    "يُحفظ في إعدادات الإضافة الخاصة بهذه الخزنة. المزوّدون المحليون لا يحتاجون إليه.",
  "onboarding.endpoint.connection.name": "الاتصال",
  "onboarding.endpoint.connection.action": "اختبار الاتصال",
  "onboarding.endpoint.connection.desc": "حمّل قائمة النماذج للتأكد من أن الخادم يستجيب.",
  "onboarding.endpoint.connection.testing": "جارٍ الاتصال بالمزوّد…",
  "onboarding.endpoint.connection.mobileLocal":
    "مزوّدو النماذج المحلية غير متاحين على Obsidian Mobile. اختر مزوّدًا سحابيًا.",
  "onboarding.endpoint.model.chatName": "نموذج المحادثة",
  "onboarding.endpoint.model.embeddingName": "نموذج التضمين",
  "onboarding.endpoint.model.desc": "عدد النماذج المناسبة لهذا الدور: {count}.",
  "onboarding.endpoint.model.empty": "اختبر الاتصال لتحميل قائمة النماذج.",
  "onboarding.endpoint.model.placeholder": "اختر نموذجًا",
  "onboarding.endpoint.model.testing": "جارٍ الاختبار",

  "onboarding.scope.title": "من أين تأتي الإجابات؟",
  "onboarding.scope.intro":
    "هذا هو الخيار الوحيد الذي يغيّر حجم ما تبقّى من الإعداد. البحث في خزنتك يحتاج إلى نموذج تضمين وفهرس، أما الويب فلا يحتاج إلى أيٍّ منهما.",
  "onboarding.scope.notesAndWeb.name": "ملاحظاتي والويب",
  "onboarding.scope.notesAndWeb.desc":
    "الخيار الكامل. خطوتان إضافيتان: نموذج تضمين، ثم المجلدات المراد فهرستها.",
  "onboarding.scope.webOnly.name": "الويب فقط",
  "onboarding.scope.webOnly.desc":
    "إجابات موثّقة من الويب المفتوح، إضافةً إلى الملاحظة المفتوحة لديك. بلا فهرس وبلا نموذج تضمين. DuckDuckGo مفعّل أصلًا ولا يحتاج إلى مفتاح.",
  "onboarding.scope.notesOnly.name": "ملاحظاتي فقط",
  "onboarding.scope.notesOnly.desc":
    "لا يغادر الخزنة شيء سوى السؤال نفسه، وهو يُرسل إلى نموذج المحادثة لديك.",
  "onboarding.scope.remaining.two": "تبقّت خطوتان",
  "onboarding.scope.remaining.none": "ينتهي الإعداد بعد هذه الخطوة",

  "onboarding.embedding.title": "النموذج الذي يقرأ ملاحظاتك",
  "onboarding.embedding.intro":
    "يمكن أن يكون من مزوّد يختلف عن مزوّد نموذج المحادثة، والإعداد الشائع هو نموذج محادثة سحابي مع تضمين محلي، حتى لا يغادر نص الملاحظات جهازك.",
  "onboarding.embedding.sameAsChat.name": "الخادم نفسه المستخدم لنموذج المحادثة",
  "onboarding.embedding.previousProvider": "سابقًا: مثل المحادثة ({provider})",
  "onboarding.embedding.sameAsChat.desc":
    "أوقف هذا الخيار لإجراء التضمين على خادم آخر، وعندها يُنشأ ملف خادم ثانٍ.",
  "onboarding.embedding.rebuildWarning":
    "تغيير هذا النموذج لاحقًا يعني إعادة بناء الفهرس، لأن متجهات نموذجين مختلفين غير قابلة للمقارنة.",
  "onboarding.embedding.unverified":
    "تعذّر التحقق من قدرة التضمين. نموذج المحادثة لديك يعمل بالفعل، لذا يمكنك إنهاء الإعداد بالويب وإضافة البحث في الخزنة لاحقًا.",
  "onboarding.embedding.useWebInstead": "استخدام الويب بدلًا من ذلك",

  "onboarding.folders.title": "ما الملاحظات التي يجوز لـ Attest قراءتها؟",
  "onboarding.folders.intro": "تُفهرس هذه المجلدات وحدها، وهي وحدها التي يمكن الاستشهاد بها.",
  "onboarding.folders.mode.name": "المجلدات",
  "onboarding.folders.mode.desc": "ابدأ بنطاق ضيّق، فتوسيعه لاحقًا مجرد تحديث تدريجي زهيد.",
  "onboarding.folders.mode.wholeVault": "الخزنة كاملة",
  "onboarding.folders.mode.selected": "مجلدات محددة",
  "onboarding.folders.paths.name": "المحدد",
  "onboarding.folders.paths.action": "اختيار المجلدات…",
  "onboarding.folders.paths.empty": "لم تحدد شيئًا بعد.",
  "onboarding.folders.paths.remove": "إزالة {path}",
  "onboarding.folders.excluded.name": "المستبعد",
  "onboarding.folders.excluded.desc": "معبأ مسبقًا.",
  "onboarding.folders.location.name": "موقع الفهرس",
  "onboarding.folders.location.desc": "داخل الخزنة، لكي يتزامن مع ملاحظاتك.",
  "onboarding.folders.location.outsideVault":
    "يجب أن يبقى الفهرس داخل القبو. أزل مقاطع «..» والشرطة المائلة في البداية.",
  "onboarding.folders.mobileWarning":
    "على الهاتف يكون البناء الأول بطيئًا: دفعات صغيرة، وصفحة PDF واحدة في كل مرة، مع تخطي ملفات PDF الكبيرة. ابنِ الفهرس على الحاسوب ثم زامن، أو اسلك مسار الويب فقط في الوقت الحالي.",

  "onboarding.finish.web.title": "البحث على الويب جاهز",
  "onboarding.finish.web.status": "ملفان · بلا انتظار",
  "onboarding.finish.vault.title": "تجري فهرسة الملاحظات",
  "onboarding.finish.vault.status": "يعمل في الخلفية",
  "onboarding.finish.vault.doneTitle": "البحث في ملاحظاتك جاهز",
  "onboarding.finish.vault.doneStatus": "اكتملت الفهرسة",
  "onboarding.finish.vault.errorTitle": "توقفت الفهرسة",
  "onboarding.finish.vault.errorStatus": "فشلت الفهرسة",
  "onboarding.finish.tag.server": "ملف الخادم",
  "onboarding.finish.tag.chat": "نموذج المحادثة",
  "onboarding.finish.tag.embedding": "نموذج التضمين",
  "onboarding.finish.tag.index": "ملف الفهرس",
  "onboarding.finish.stats.files": "{scanned} / {total} ملفًا",
  "onboarding.finish.stats.chunks": "{embedded} / {total} مقطعًا",
  "onboarding.finish.webIntro":
    "لا شيء لفهرسته، لذا ينتهي الإعداد هنا. اطرح سؤالًا وستستشهد الإجابة بصفحات الويب التي استعملتها.",
  "onboarding.finish.vaultIntro":
    "تُفتح المحادثة الآن، وتتحسّن إجابات الخزنة كلما وصلت مقاطع جديدة. ويستمر بناء الفهرس حتى إن أغلقت هذه النافذة.",
  "onboarding.finish.vaultDoneIntro":
    "جميع الملاحظات المختارة مفهرسة. اطرح سؤالاً وسيستشهد الرد بالملاحظات التي استخدمها.",
  "onboarding.finish.vaultErrorIntro":
    "نموذج الدردشة يعمل، فيمكنك البدء الآن. افتح ملف الفهرس في الإعدادات لمعرفة السبب وإعادة التشغيل.",
  "onboarding.finish.indexingStarting": "جارٍ بدء أول بناء للفهرس…",

  "command.runSetup": "تشغيل إعداد التشغيل الأول",
};
