/**
 * Cloud Inference Service
 * 
 * Fallback to cloud LLM when local confidence is low.
 * Uses fetch API (available in React Native).
 */

export class CloudInferenceService {
  private apiKey?: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey?: string,
    model: string = 'gpt-4o-mini',
    useOpenRouter: boolean = false
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
  }

  async processText(text: string, generateSummary: boolean = true): Promise<{
    summary: string;
    classification: string;
  }> {
    if (!this.apiKey) {
      throw new Error('Cloud API key not configured');
    }

    if (generateSummary) {
      const summary = await this.generateSummary(text);
      const classification = await this.classify(text);
      return { summary, classification };
    }

    return {
      summary: text.substring(0, 200),
      classification: 'general',
    };
  }

  private async generateSummary(text: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes text concisely.',
          },
          {
            role: 'user',
            content: `Summarize the following text in 2-3 sentences:\n\n${text.substring(0, 2000)}`,
          },
        ],
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloud API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'Summary unavailable';
  }

  private async classify(text: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a content classifier. Respond with only one word: email, message, note, calendar, code, or general.',
          },
          {
            role: 'user',
            content: `Classify this content:\n\n${text.substring(0, 500)}`,
          },
        ],
        max_tokens: 10,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloud API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim().toLowerCase() || 'general';
  }

  getConfidenceScore(): number {
    // Cloud inference is assumed to have high confidence
    return 0.9;
  }
}
