import type { EnOnboardingMessages } from "../en/onboarding";

export const onboarding: EnOnboardingMessages = {
  "onboarding.title": "设置 Attest",
  "onboarding.progress": "第 {step} 步，共 {total} 步",
  "onboarding.scope.pickOne": "选择一项以继续",

  "onboarding.action.back": "上一步",
  "onboarding.action.skip": "跳过，手动配置",
  "onboarding.action.continue": "继续",
  "onboarding.action.checking": "正在检查…",
  "onboarding.action.startIndexing": "开始建立索引",
  "onboarding.action.finish": "完成",
  "onboarding.action.openChat": "打开聊天",
  "onboarding.action.addVaultLater": "稍后添加笔记检索",
  "onboarding.action.keepIndexing": "在后台继续建立索引",

  "onboarding.chat.title": "聊天服务商与模型",
  "onboarding.chat.intro":
    "Attest 会在你操作的过程中自动创建配置档案。这里的一切之后都可以在插件设置中修改。",

  "onboarding.endpoint.provider.name": "服务商",
  "onboarding.endpoint.provider.chatDesc": "用于填写基础 URL 和 API 格式。嵌入模型可以使用另一个。",
  "onboarding.endpoint.provider.embeddingDesc": "嵌入模型所在的服务器可以与聊天模型不同。",
  "onboarding.endpoint.baseUrl.name": "基础 URL",
  "onboarding.endpoint.baseUrl.desc": "由服务商自动填写。若使用自建端点，请手动修改。",
  "onboarding.endpoint.apiKey.name": "API 密钥（可选）",
  "onboarding.endpoint.apiKey.desc": "保存在本仓库的插件设置中。本地服务商无需密钥。",
  "onboarding.endpoint.connection.name": "连接",
  "onboarding.endpoint.connection.action": "测试连接",
  "onboarding.endpoint.connection.desc": "加载模型列表以确认端点能够响应。",
  "onboarding.endpoint.connection.testing": "正在联系服务商…",
  "onboarding.endpoint.connection.mobileLocal":
    "Obsidian Mobile 上无法使用本地模型服务商。请选择一个云端服务商。",
  "onboarding.endpoint.model.chatName": "聊天模型",
  "onboarding.endpoint.model.embeddingName": "嵌入模型",
  "onboarding.endpoint.model.desc": "有 {count} 个模型符合该用途。",
  "onboarding.endpoint.model.empty": "请先测试连接以加载模型列表。",
  "onboarding.endpoint.model.placeholder": "选择一个模型",
  "onboarding.endpoint.model.testing": "测试中",

  "onboarding.scope.title": "答案应当来自哪里？",
  "onboarding.scope.intro":
    "这是唯一会改变剩余设置量的选择。搜索仓库需要嵌入模型和索引；搜索网络两者都不需要。",
  "onboarding.scope.notesAndWeb.name": "我的笔记和网络",
  "onboarding.scope.notesAndWeb.desc": "完整方案。还需两步：先选嵌入模型，再选要索引的文件夹。",
  "onboarding.scope.webOnly.name": "仅网络",
  "onboarding.scope.webOnly.desc":
    "来自公开网络并附引用的答案，外加你当前打开的笔记。无需索引，也无需嵌入模型。DuckDuckGo 已启用且无需密钥。",
  "onboarding.scope.notesOnly.name": "仅我的笔记",
  "onboarding.scope.notesOnly.desc": "除了问题本身会发给聊天模型外，没有任何内容离开仓库。",
  "onboarding.scope.remaining.two": "还剩 2 步",
  "onboarding.scope.remaining.none": "完成这一步即可",

  "onboarding.embedding.title": "读取笔记的模型",
  "onboarding.embedding.intro":
    "它可以来自与聊天模型不同的服务商——常见做法是云端聊天模型搭配本地嵌入，这样笔记内容永远不会离开本机。",
  "onboarding.embedding.sameAsChat.name": "与聊天模型使用同一服务器",
  "onboarding.embedding.previousProvider": "之前：与聊天相同（{provider}）",
  "onboarding.embedding.sameAsChat.desc":
    "关闭后可在其他端点计算嵌入，届时会创建第二个服务器档案。",
  "onboarding.embedding.rebuildWarning":
    "之后更换这个模型意味着要重建索引：两个模型产生的向量无法互相比较。",
  "onboarding.embedding.unverified":
    "无法验证嵌入能力。你的聊天模型已经可用，因此可以改用网络完成设置，之后再添加仓库搜索。",
  "onboarding.embedding.useWebInstead": "改用网络",

  "onboarding.folders.title": "Attest 可以读取哪些笔记？",
  "onboarding.folders.intro": "只有这些文件夹会被索引，也只有它们可以被引用。",
  "onboarding.folders.mode.name": "文件夹",
  "onboarding.folders.mode.desc": "先从小范围开始——以后扩大只是一次开销很小的增量刷新。",
  "onboarding.folders.mode.wholeVault": "整个仓库",
  "onboarding.folders.mode.selected": "选定的文件夹",
  "onboarding.folders.paths.name": "已选择",
  "onboarding.folders.paths.action": "选择文件夹…",
  "onboarding.folders.paths.empty": "尚未选择任何内容。",
  "onboarding.folders.paths.remove": "移除 {path}",
  "onboarding.folders.excluded.name": "已排除",
  "onboarding.folders.excluded.desc": "已预填。",
  "onboarding.folders.location.name": "索引位置",
  "onboarding.folders.location.desc": "位于仓库内部，以便与笔记同步。",
  "onboarding.folders.location.outsideVault": "索引必须保留在库内。请去掉“..”路径段和开头的斜杠。",
  "onboarding.folders.mobileWarning":
    "在移动端首次构建很慢：批次小、PDF 每次只处理一页、超大 PDF 会被跳过。建议在桌面端构建后同步，或暂时选择仅网络的方案。",

  "onboarding.finish.web.title": "网页检索已就绪",
  "onboarding.finish.web.status": "2 个配置 · 无需等待",
  "onboarding.finish.vault.title": "正在为笔记检索建立索引",
  "onboarding.finish.vault.status": "在后台运行",
  "onboarding.finish.vault.doneTitle": "笔记搜索已就绪",
  "onboarding.finish.vault.doneStatus": "索引已完成",
  "onboarding.finish.vault.errorTitle": "索引已中断",
  "onboarding.finish.vault.errorStatus": "索引失败",
  "onboarding.finish.tag.server": "服务器配置",
  "onboarding.finish.tag.chat": "对话模型",
  "onboarding.finish.tag.embedding": "嵌入模型",
  "onboarding.finish.tag.index": "索引配置",
  "onboarding.finish.stats.files": "{scanned} / {total} 个文件",
  "onboarding.finish.stats.chunks": "{embedded} / {total} 个片段",
  "onboarding.finish.webIntro":
    "没有需要索引的内容，设置到此结束。提出问题，答案会引用它所使用的网页。",
  "onboarding.finish.vaultIntro":
    "聊天窗口现在就会打开；随着文本块入库，仓库答案会越来越好。即使关闭此对话框，索引也会继续构建。",
  "onboarding.finish.vaultDoneIntro": "所选笔记已全部编入索引。提出问题，回答会引用它使用的笔记。",
  "onboarding.finish.vaultErrorIntro":
    "聊天模型可用，现在就能开始。在设置中打开索引配置查看原因并重新运行。",
  "onboarding.finish.indexingStarting": "正在启动首次索引构建…",

  "command.runSetup": "运行首次设置向导",
};
