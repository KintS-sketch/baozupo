export type VisionMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface VisionRecognitionRequest {
  systemPrompt: string;
  userPrompt: string;
  imageBase64: string;
  mediaType: VisionMediaType;
  maxTokens?: number;
}

export interface VisionRecognitionResponse {
  rawText: string;
  model: string;
  tokensUsed?: number;
  providerName: string;
}

export interface VisionProvider {
  readonly name: string;
  recognize(req: VisionRecognitionRequest): Promise<VisionRecognitionResponse>;
}

export class VisionProviderError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly friendly: string
  ) {
    super(message);
    this.name = "VisionProviderError";
  }
}
