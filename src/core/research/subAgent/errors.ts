export type SubAgentSessionErrorCode =
  | "invalid-state"
  | "not-authorized"
  | "fenced-delivery"
  | "idempotency-conflict"
  | "invalid-input"
  | "source-scope-denied"
  | "budget-denied"
  | "budget-port-error"
  | "import-failed"
  | "checkpoint-corrupt"
  | "persistence-failed";

export type SubAgentErrorDetail =
  | string
  | number
  | boolean
  | null
  | readonly SubAgentErrorDetail[]
  | { readonly [key: string]: SubAgentErrorDetail };

export interface SubAgentSessionError {
  code: SubAgentSessionErrorCode;
  message: string;
  details?: SubAgentErrorDetail;
}

const SUB_AGENT_SESSION_ERROR_MESSAGES: Readonly<Record<SubAgentSessionErrorCode, string>> = {
  "invalid-state": "Операция недоступна в текущем состоянии сессии.",
  "not-authorized": "Нет доступа к сессии.",
  "fenced-delivery": "Доставка отклонена: родительский запуск сменился.",
  "idempotency-conflict": "Команда с этим ключом уже принята с другими параметрами.",
  "invalid-input": "Недопустимые параметры команды.",
  "source-scope-denied": "Запрошенные источники превышают разрешённую область.",
  "budget-denied": "Бюджет родительского запуска не допускает исполнение.",
  "budget-port-error": "Не удалось проверить бюджет родительского запуска.",
  "import-failed": "Не удалось импортировать результат дочернего агента.",
  "checkpoint-corrupt": "Сохранённое состояние дочерних агентов повреждено.",
  "persistence-failed": "Не удалось сохранить состояние дочернего агента.",
};

/** Builds a sub-agent session error whose message is the fixed safe text for its code. */
export function subAgentSessionError(
  code: SubAgentSessionErrorCode,
  details?: SubAgentErrorDetail,
): SubAgentSessionError {
  return {
    code,
    message: SUB_AGENT_SESSION_ERROR_MESSAGES[code],
    ...(details === undefined ? {} : { details }),
  };
}

/** Error thrown by sub-agent facades; it carries the safe session error for its code. */
export class SubAgentSessionFailure extends Error {
  constructor(readonly error: SubAgentSessionError) {
    super(error.message);
    this.name = "SubAgentSessionFailure";
  }

  get code(): SubAgentSessionErrorCode {
    return this.error.code;
  }
}
