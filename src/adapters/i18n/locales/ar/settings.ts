import type { EnSettingsMessages } from "../en/settings";

export const settings: EnSettingsMessages = {
  "settings.language.heading": "اللغة",
  "settings.language.name": "لغة الواجهة",
  "settings.language.desc": "لغة واجهة Attest. تُطبَّق دون إعادة تشغيل Obsidian.",
  "settings.language.auto": "تلقائي (تتبع Obsidian)",

  "settings.tab.heading": "Attest",
  "settings.tab.quickStart.title": "بداية سريعة",
  "settings.tab.quickStart.steps": "1. أضف خادمًا → 2. أضف نموذج محادثة → 3. (اختياري) أضف فهرسًا",
  "settings.tab.gateHint": "أضف ملف نموذج محادثة أولًا",

  "settings.advanced.debugMode.name": "وضع التصحيح",
  "settings.advanced.debugMode.desc": "تسجيل تفاصيل طلبات الإضافة واستجاباتها. تُحجب مفاتيح API.",

  "settings.retrieval.heading": "الاسترجاع",
  "settings.retrieval.desc":
    "يتحكم في طريقة عثور Attest على الأدلة المحلية والرسومية والفهرسية والمستندية والويب قبل الإجابة.",
  "settings.retrieval.graph.heading": "رسم Obsidian البياني",
  "settings.retrieval.useLinkedNotes.name": "استخدام الملاحظات المرتبطة",
  "settings.retrieval.useLinkedNotes.desc":
    "اكتشاف الملاحظات المرتبطة من الإشارات بعلامة @ والملفات النشطة والمرفقات المضمّنة قبل الاسترجاع.",
  "settings.retrieval.includeBacklinks.name": "تضمين الروابط العكسية",
  "settings.retrieval.includeBacklinks.desc":
    "استخدام الروابط العكسية بخطوة واحدة كمرشحات في الرسم البياني. لا يتم تتبع ملاحظات الروابط العكسية أبعد من ذلك.",
  "settings.retrieval.expandFilteredContextThroughLinks.name":
    "توسيع الملفات المُرشَّحة عبر الروابط",
  "settings.retrieval.expandFilteredContextThroughLinks.desc":
    "عندما تكون الملفات المرفقة في وضع التصفية، ابحث أيضًا في جيرانها المرتبطين في الرسم البياني.",
  "settings.retrieval.graphDepth.name": "عمق الرسم البياني",
  "settings.retrieval.graphDepth.desc":
    "العمق 1 يتبع الروابط المباشرة والتضمينات والروابط العكسية. العمق 2 مخصص للتصحيح المتقدم.",
  "settings.retrieval.search.heading": "البحث",
  "settings.retrieval.expandSearchQuery.name": "توسيع استعلام البحث",
  "settings.retrieval.expandSearchQuery.desc":
    "إنشاء صيغ للاستعلام بلغات مختلفة قبل الاسترجاع للعثور على الملاحظات المكتوبة بلغات أخرى. يستهلك استدعاءً إضافيًا لنموذج المحادثة لكل بحث.",
  "settings.retrieval.web.heading": "الويب",
  "settings.retrieval.useWebWhenFreshnessNeeded.name": "استخدام الويب لأسئلة الحداثة",
  "settings.retrieval.useWebWhenFreshnessNeeded.desc":
    "منح أدلة الويب حصة أكبر عندما يطلب السؤال معلومات حالية أو أحدث أو أسعارًا أو إصدارات.",

  "settings.newChatDefaults.heading": "الإعدادات الافتراضية للمحادثة الجديدة",
  "settings.newChatDefaults.desc":
    "التهيئة الأولية لكل محادثة جديدة. تحتفظ المحادثات المحفوظة بإعداداتها الخاصة.",
  "settings.newChatDefaults.source.name": "المصدر الافتراضي",
  "settings.newChatDefaults.source.desc": "مصادر الأدلة التي تبدأ بها المحادثة الجديدة.",
  "settings.newChatDefaults.source.none": "بلا",
  "settings.newChatDefaults.source.indexOnly": "الفهرس",
  "settings.newChatDefaults.source.webOnly": "الويب",
  "settings.newChatDefaults.source.indexAndWeb": "الفهرس + الويب",
  "settings.newChatDefaults.index.name": "الفهرس الافتراضي",
  "settings.newChatDefaults.index.desc":
    "ملف الفهرس الذي تبدأ به المحادثة الجديدة، ويُستخدم كلما شمل المصدر الفهرس.",
  "settings.newChatDefaults.index.empty": "لا توجد ملفات فهرس متاحة",
  "settings.newChatDefaults.mode.name": "الوضع الافتراضي",
  "settings.newChatDefaults.mode.desc": "وضع البحث الذي تبدأ به المحادثة الجديدة.",
  "settings.newChatDefaults.mode.descBlocked": "وضع البحث الذي تبدأ به المحادثة الجديدة. {hint}",
  "settings.newChatDefaults.mode.thinkingUnavailable":
    "يتطلب وضع التفكير نموذج محادثة بقدرة وكيل مُتحقَّق منها. اختبر قدرات النموذج لتفعيله.",
  "settings.newChatDefaults.mode.instant": "فوري",
  "settings.newChatDefaults.mode.thinking": "تفكير",
  "settings.newChatDefaults.model.name": "النموذج الافتراضي",
  "settings.newChatDefaults.model.desc": "ملف نموذج المحادثة الذي تبدأ به المحادثة الجديدة.",
  "settings.newChatDefaults.model.empty": "لا توجد ملفات نماذج محادثة متاحة",
  "settings.newChatDefaults.activeFile.name": "تضمين الملف النشط كسياق",
  "settings.newChatDefaults.activeFile.desc":
    "تضمين الملف المدعوم المفتوح حاليًا تلقائيًا كسياق صريح للمحادثة.",

  "settings.webSources.heading": "المصادر الخارجية",
  "settings.webSources.desc":
    "بحث ويب خارجي يبدأه المستخدم عبر المصادر المفعّلة. يرسل Attest السؤال المكتوب فقط، ولا يرسل أبدًا محتوى الخزنة المسترجَع.",
  "settings.webSources.count": "{enabled} من {total} مفعّل",
  "settings.webSources.column.source": "المصدر",
  "settings.webSources.column.actions": "الإجراءات",
  "settings.webSources.column.state": "الحالة",
  "settings.webSources.categoryCount": "{category} · {enabled}/{total}",
  "settings.webSources.category.serp": "بحث ويب عام",
  "settings.webSources.category.neural": "بحث بالذكاء الاصطناعي",
  "settings.webSources.category.academic": "أكاديمي",
  "settings.webSources.category.encyclopedia": "موسوعة",
  "settings.webSources.category.community": "المطورون والمجتمع",
  "settings.webSources.category.news": "أخبار",
  "settings.webSources.category.fetch": "جلب الصفحة كخيار احتياطي",
  "settings.webSources.category.image": "بحث الصور",
  "settings.webSources.activation.off": "مُعطّل",
  "settings.webSources.activation.auto": "تلقائي — يُستخدم عندما يختاره المخطِّط",
  "settings.webSources.activation.always": "دائمًا — يُستعلم في كل بحث ويب",
  "settings.webSources.issue.unauthorized": "رُفضت بيانات الاعتماد — تحقق من مفتاح API",
  "settings.webSources.issue.rateLimited": "تم تجاوز حد المعدل — ستُعاد المحاولة تلقائيًا لاحقًا",
  "settings.webSources.setUp": "إعداد…",
  "settings.webSources.setUpAria": "إعداد {source}",
  "settings.webSources.configure": "تهيئة {source}",
  "settings.webSources.lampIssueTitle": '{issue} — انقر للتبديل إلى "{next}"',
  "settings.webSources.lampTitle": '{source}: {current} — انقر للتبديل إلى "{next}"',
  "settings.webSources.meta.required": "مطلوب: {fields}",
  "settings.webSources.meta.configured": "تمت التهيئة",

  "settings.webSourceModal.title": "تهيئة {source}",
  "settings.webSourceModal.info": "{note}. ",
  "settings.webSourceModal.providerDocs": "وثائق المزوّد",
  "settings.webSourceModal.field.optional": "اختياري.",
  "settings.webSourceModal.field.required": "مطلوب لتفعيل هذا المصدر.",
  "settings.webSourceModal.imageSearch.name": "استخدامه لبحث الصور",
  "settings.webSourceModal.imageSearch.desc":
    "معطّل افتراضيًا. عند التفعيل، قد يستعلم search_images نقطة نهاية الصور لهذا المحرك، وهو ما يستهلك الحصة نفسها المخصصة للبحث النصي.",
  "settings.webSourceModal.disabledNotice": "تم تعطيل {source}: بيانات الاعتماد المطلوبة مفقودة.",
};
