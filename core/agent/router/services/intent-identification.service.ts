import type { LlmAdapter } from "../../../../common/interfaces/types.js";
import type { IntentResult } from "../types.js";

export interface IntentIdentificationParams {
  userInput: string;
  llm: LlmAdapter;
}

export class IntentIdentificationService {
  async identify(params: IntentIdentificationParams): Promise<IntentResult> {
    void params;
    throw new Error("IntentIdentificationService.identify is not implemented");
  }
}
