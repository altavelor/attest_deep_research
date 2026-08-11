import type { EnCommonMessages } from "../en/common";

export const common: EnCommonMessages = {
  "common.cancel": "取消",
  "common.save": "保存",
  "common.close": "关闭",
  "common.advanced": "高级",
  "common.unknownError": "未知错误",
  "common.copiedToClipboard": "已复制到剪贴板。",
  "common.pdfPage": "第 {page} 页",

  "profile.error.chatModelMissing": "提问前请先选择聊天模型配置。",
  "profile.error.embeddingModelMissing": "使用该索引前请先选择嵌入模型配置。",
  "profile.error.serverUnavailable": "所选服务器配置不可用。",
  "profile.error.indexNotBuilt": "在聊天或搜索中使用前，请先为该配置建立索引。",
  "profile.error.indexUnavailable": "所选索引配置不可用。",
  "profile.warning.indexNotSelected": "搜索前请在 Attest 设置中选择一个已建立索引的配置。",
  "profile.warning.embeddingProfileUnavailable":
    "所选索引的嵌入模型配置不可用。请在 Attest 设置中更新。",
  "profile.warning.embeddingProfileSuspended":
    "所选索引的嵌入模型配置已停用。请在 Attest 设置中更新。",
  "profile.warning.embeddingNotSupported":
    "所选索引的嵌入模型无法生成嵌入。请在 Attest 设置中更新。",
  "profile.warning.embeddingServerUnavailable":
    "所选索引的嵌入服务器不可用。请在 Attest 设置中更新。",
};
