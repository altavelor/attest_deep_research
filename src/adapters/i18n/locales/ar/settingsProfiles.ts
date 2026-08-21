import type { EnSettingsProfilesMessages } from "../en/settingsProfiles";

export const settingsProfiles: EnSettingsProfilesMessages = {
  "settings.status.suspended": "موقوف",

  "settings.profileList.addAction": "إضافة {title}",
  "settings.profileList.column.profile": "الملف",
  "settings.profileList.column.status": "الحالة",
  "settings.profileList.column.actions": "الإجراءات",
  "settings.profileList.editAction": "تحرير الملف",
  "settings.profileList.tag.agent": "وكيل",
  "settings.profileList.tag.tools": "أدوات",
  "settings.profileList.tag.instant": "فوري",

  "settings.capability.status": "{tools} · {agent}",
  "settings.capability.entry": "{subject}: {phase}",
  "settings.capability.subject.tools": "دعم الأدوات",
  "settings.capability.subject.agent": "دعم وضع الوكيل",
  "settings.capability.phase.testing": "جارٍ الاختبار…",
  "settings.capability.phase.verified": "تم التحقق",
  "settings.capability.phase.advertised": "حسب بيانات المزوّد",
  "settings.capability.phase.notVerified": "لم يتم التحقق",
  "settings.capability.phase.failed": "أخفق",
  "settings.capability.phase.notTested": "لم يُختبر",

  "settings.models.heading": "ملفات النماذج",
  "settings.models.desc": "تهيئة نقاط نهاية المزوّدين ونماذج المحادثة أو التضمين التي تستخدمها.",
  "settings.models.server.title": "ملفات الخوادم",
  "settings.models.server.deleteTooltip": "حذف ملف الخادم",
  "settings.models.server.deleteBlockedTooltip": "احذف ملفات النماذج التابعة أولًا",
  "settings.models.server.deleteBlockedNotice": "احذف ملفات النماذج التابعة أولًا.",
  "settings.models.chat.title": "ملفات نماذج المحادثة",
  "settings.models.chat.deleteTooltip": "حذف ملف نموذج المحادثة",
  "settings.models.chat.testingLabel": "جارٍ اختبار القدرات…",
  "settings.models.chat.testingNotice": "جارٍ اختبار القدرات لـ {profile}.",
  "settings.models.embedding.title": "ملفات نماذج التضمين",
  "settings.models.embedding.deleteTooltip": "حذف ملف نموذج التضمين",
  "settings.models.embedding.deleteBlockedTooltip": "نموذج التضمين هذا مستخدم في ملف فهرس",
  "settings.models.embedding.deleteBlockedNotice": "نموذج التضمين هذا مستخدم في ملف فهرس.",
  "settings.models.embedding.defaultBadge": "افتراضي",
  "settings.models.embedding.defaultBadgeTitle": "نموذج التضمين الافتراضي",
  "settings.models.embedding.defaultAction": "النموذج الافتراضي",
  "settings.models.embedding.setDefaultAction": "تعيينه نموذجًا افتراضيًا",

  "settings.prober.capabilityDetectionFailed": "أخفق اكتشاف القدرات لـ {profile}.",
  "settings.prober.toolCapabilityDetectionFailed": "أخفق اكتشاف قدرة الأدوات لـ {profile}.",
  "settings.prober.agentCapabilityDetectionFailed": "أخفق اكتشاف قدرة وضع الوكيل لـ {profile}.",

  "settings.profileModal.error.requiredFields": "املأ جميع الحقول المطلوبة.",
  "settings.profileModal.error.nameLength": "يجب أن يتراوح طول الاسم بين 1 و{max} حرفًا.",
  "settings.profileModal.error.nameUnique": "يجب أن يكون الاسم فريدًا.",

  "settings.serverModal.editTitle": "تحرير ملف الخادم",
  "settings.serverModal.addTitle": "إضافة ملف خادم",
  "settings.serverModal.name.name": "الاسم",
  "settings.serverModal.name.desc":
    "اسم مقروء يظهر في الإعدادات ومحددات النماذج. بحد أقصى {max} حرفًا.",
  "settings.serverModal.apiFormat.name": "صيغة API",
  "settings.serverModal.apiFormat.desc": "صيغة الطلب والاستجابة التي يستخدمها هذا المزوّد.",
  "settings.serverModal.apiFormat.openaiCompatible": "متوافق مع OpenAI",
  "settings.serverModal.apiFormat.ollama": "Ollama",
  "settings.serverModal.apiFormat.anthropic": "Anthropic",
  "settings.serverModal.baseUrl.name": "عنوان URL الأساسي",
  "settings.serverModal.baseUrl.desc":
    "عنوان URL لنقطة نهاية المزوّد، مثل عنوان API الأساسي لـ OpenRouter أو Ollama أو Anthropic.",
  "settings.serverModal.apiKey.name": "مفتاح API",
  "settings.serverModal.apiKey.desc":
    "اختياري. يُستخدم كرمز حامل للمزوّدين الذين يتطلبون المصادقة.",

  "settings.modelProfileModal.editTitle.chat": "تحرير ملف نموذج المحادثة",
  "settings.modelProfileModal.editTitle.embedding": "تحرير ملف نموذج التضمين",
  "settings.modelProfileModal.addTitle.chat": "إضافة ملف نموذج محادثة",
  "settings.modelProfileModal.addTitle.embedding": "إضافة ملف نموذج تضمين",
  "settings.modelProfileModal.name.name": "الاسم",
  "settings.modelProfileModal.name.desc":
    "اسم مقروء يظهر في الإعدادات وعناصر تحكم المحادثة. بحد أقصى {max} حرفًا.",
  "settings.modelProfileModal.server.name": "الخادم",
  "settings.modelProfileModal.server.desc": "نقطة نهاية المزوّد المستخدمة لاستدعاء هذا النموذج.",
  "settings.modelProfileModal.model.name": "النموذج",
  "settings.modelProfileModal.model.desc": "اسم النموذج المجلوب من ملف الخادم المحدد.",
  "settings.modelProfileModal.model.placeholder": "اجلب النماذج ثم اكتب للتصفية",
  "settings.modelProfileModal.model.fetch": "جلب",
  "settings.modelProfileModal.model.empty": "لا توجد نماذج مطابقة",
  "settings.modelProfileModal.temperature.name": "درجة الحرارة",
  "settings.modelProfileModal.temperature.desc":
    "اختياري. يتحكم في عشوائية الاستجابة؛ الترك فارغًا يستخدم الإعداد الافتراضي للمزوّد أو التطبيق.",
  "settings.modelProfileModal.maxTokens.name": "الحد الأقصى للرموز",
  "settings.modelProfileModal.maxTokens.desc":
    "اختياري. يحدّ طول الاستجابة؛ الترك فارغًا يستخدم الإعداد الافتراضي للمزوّد أو النموذج، أو 4096 لـ Anthropic.",
  "settings.modelProfileModal.contextSize.name": "حجم السياق",
  "settings.modelProfileModal.contextSize.desc":
    "حد اختياري للرموز. يُملأ من البيانات الوصفية للنموذج عند توفرها ويُستخدم لفرض نافذة سياق المحادثة.",
  "settings.modelProfileModal.error.selectServer": "اختر ملف خادم أولًا.",
  "settings.modelProfileModal.error.activeServer": "اختر ملف خادم نشطًا.",
  "settings.modelProfileModal.error.fetchModels": "اجلب النماذج قبل إنشاء ملف نموذج.",
  "settings.modelProfileModal.error.reasoningEffort":
    "يجب أن يكون مستوى الاستدلال افتراضي المزوّد أو مُتحقَّقًا من قدرته.",
  "settings.modelProfileModal.error.reasoningSummary":
    "لم يتم التحقق من ملخّصات الاستدلال لهذا الملف.",

  "settings.capabilityControls.heading": "القدرات",
  "settings.capabilityControls.testTooltip": "اختبار القدرات — {status}",
  "settings.capabilityControls.testingTooltip": "جارٍ اختبار القدرات…",
  "settings.capabilityControls.retestTooltip": "إعادة اختبار القدرات — {status}",
  "settings.capabilityControls.agentic.name": "وضع الوكيل",
  "settings.capabilityControls.agentic.desc": "تفعيل دعم وضع الوكيل المُتحقَّق منه.",
  "settings.capabilityControls.effort.name": "مستوى الاستدلال",
  "settings.capabilityControls.effort.desc":
    "الوضع التلقائي يستخدم افتراضي المزوّد أو قيمة مُتحقَّقًا منها.",
  "settings.capabilityControls.effort.auto": "تلقائي",
  "settings.capabilityControls.effort.enableAgentic": "فعّل وضع الوكيل لاختيار مستوى الاستدلال.",
  "settings.capabilityControls.tools.name": "الأدوات",
  "settings.capabilityControls.tools.desc":
    "السماح لهذا النموذج باستدعاء أدوات الملاحظات — القراءة والبحث وتعديل ملاحظات الخزنة (عند منح صلاحية التحرير). تُدار أدوات بحث الفهرس والويب في وضع التفكير بشكل منفصل.",
  "settings.capabilityControls.notVerified": "لم يتم التحقق منه في اختبار القدرات.",
  "settings.capabilityControls.notTested": "لم يُختبر بعد.",
};
