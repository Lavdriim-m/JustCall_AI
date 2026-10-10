export type TtsOptions = { voice?: string | null; signal?: AbortSignal };

export interface TtsProvider {
  readonly name: string;
  /** Returns μ-law 8 kHz mono audio for the text. */
  synthesize(text: string, options?: TtsOptions): Promise<Buffer>;
}
