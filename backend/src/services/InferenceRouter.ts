/**
 * Inference Router using Cactus SDK
 *
 * Uses actual Cactus SDK (CactusLM) for inference!
 */

import { CactusLM, type Message } from 'cactus-react-native';
import { CloudInferenceService } from './CloudInferenceService';

export interface RouterResult {
  extractedText: string;
  summary: string;
  classification: string;
  embedding: number[];
  confidenceScore: number;
  privacyScore: number; // 0.0 to 1.0 (1.0 = very private, should never use cloud)
  inferenceMode: 'local' | 'cloud';
}

export class InferenceRouter {
  constructor(
    private cactusLM: CactusLM,
    private cactusVision: CactusLM,
    private cloudService: CloudInferenceService,
    private confidenceThreshold: number = 0.7,
    private privacyThreshold: number = 0.5 // If privacy > 0.5, never use cloud
  ) {}

  /**
   * Process screenshot using Cactus SDK
   */
  async processScreenshot(imagePath: string): Promise<RouterResult> {
    console.log('[InferenceRouter] Processing screenshot with Cactus SDK...');

    // Step 1: Extract text using Cactus vision model
    const visionMessages: Message[] = [
      {
        role: 'user',
        content:
          'Extract all text from this image. Return only the extracted text.',
        images: [imagePath],
      },
    ];

    const visionResult = await this.cactusVision.complete({
      messages: visionMessages,
    });
    const extractedText = visionResult.response.trim();

    // Step 2: Generate summary using Cactus SDK
    const summaryMessages: Message[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant that summarizes text concisely.',
      },
      {
        role: 'user',
        content: `Summarize the following text in 2-3 sentences:\n\n${extractedText.substring(0, 1000)}`,
      },
    ];

    const summaryResult = await this.cactusLM.complete({
      messages: summaryMessages,
    });
    let summary = summaryResult.response.trim();

    // Step 3: Classify content
    const classifyMessages: Message[] = [
      {
        role: 'system',
        content:
          'You are a content classifier. Respond with only one word: email, message, note, calendar, code, or general.',
      },
      {
        role: 'user',
        content: `Classify this content:\n\n${extractedText.substring(0, 500)}`,
      },
    ];

    const classifyResult = await this.cactusLM.complete({
      messages: classifyMessages,
      options: { maxTokens: 10, temperature: 0.3 },
    });
    let classification = classifyResult.response.trim().toLowerCase();

    // Step 4: Generate embedding using Cactus SDK
    const embeddingText = `${summary}\n${extractedText.substring(0, 500)}`;
    const embedResult = await this.cactusLM.embed({ text: embeddingText });
    const embedding = embedResult.embedding;

    // Step 5: Calculate confidence
    let confidenceScore = this.calculateConfidence(extractedText, summary);

    // Step 6: Calculate privacy score (how sensitive/private the data is)
    const privacyScore = await this.calculatePrivacyScore(
      extractedText,
      classification
    );

    // Step 7: Router decision - privacy score has higher priority
    // If privacy is high (sensitive data), always use local, regardless of confidence
    let inferenceMode: 'local' | 'cloud' = 'local';
    let decisionReason = '';

    if (privacyScore >= this.privacyThreshold) {
      // High privacy - never use cloud, even if confidence is low
      inferenceMode = 'local';
      decisionReason = `High privacy score (${privacyScore.toFixed(2)}) - using local only`;
      console.log(`[InferenceRouter] ${decisionReason}`);
    } else if (confidenceScore < this.confidenceThreshold) {
      // Low privacy but low confidence - can use cloud
      inferenceMode = 'cloud';
      decisionReason = `Low confidence (${confidenceScore.toFixed(2)}) and low privacy (${privacyScore.toFixed(2)}) - using cloud`;
      console.log(`[InferenceRouter] ${decisionReason}`);
    } else {
      // Good confidence - use local
      inferenceMode = 'local';
      decisionReason = `Good confidence (${confidenceScore.toFixed(2)}) - using local`;
      console.log(`[InferenceRouter] ${decisionReason}`);
    }

    // Step 8: Enhance with cloud LLM if decision is to use cloud
    if (inferenceMode === 'cloud') {
      try {
        console.log('[InferenceRouter] Enhancing results with cloud LLM...');
        const cloudResult = await this.cloudService.processText(
          extractedText,
          true
        );

        // Override local summary and classification with cloud-enhanced versions
        summary = cloudResult.summary;
        classification = cloudResult.classification;

        // Update confidence score (cloud inference is assumed to have high confidence)
        confidenceScore = this.cloudService.getConfidenceScore();

        console.log('[InferenceRouter] ✅ Cloud enhancement completed');
      } catch (error) {
        console.warn(
          '[InferenceRouter] ⚠️  Cloud enhancement failed, using local results:',
          error
        );
        // Fall back to local results if cloud fails
        inferenceMode = 'local';
        decisionReason += ' (cloud failed, using local)';
      }
    }

    return {
      extractedText,
      summary,
      classification,
      embedding,
      confidenceScore,
      privacyScore,
      inferenceMode,
    };
  }

  /**
   * Process query for vector search
   */
  async processQuery(query: string): Promise<number[]> {
    const embedResult = await this.cactusLM.embed({ text: query });
    return embedResult.embedding;
  }

  /**
   * Generate answer using RAG
   */
  async generateAnswer(query: string, memories: any[]): Promise<string> {
    const context = memories
      .map((mem, idx) => {
        return `Memory ${idx + 1}:
Summary: ${mem.summary}
Classification: ${mem.classification}
Text: ${mem.extracted_text?.substring(0, 200) || 'N/A'}
---`;
      })
      .join('\n\n');

    const messages: Message[] = [
      {
        role: 'system',
        content:
          'You are a helpful assistant that answers questions based on provided context.',
      },
      {
        role: 'user',
        content: `Based on the following memories, answer the user's question.\n\nMemories:\n${context}\n\nUser Question: ${query}`,
      },
    ];

    const result = await this.cactusLM.complete({ messages });
    return result.response;
  }

  private calculateConfidence(extractedText: string, summary: string): number {
    let confidence = 0.0; // Start at 0.0 instead of 0.5

    // Base confidence from text extraction quality
    if (extractedText.length === 0) {
      return 0.0; // No text extracted = no confidence
    } else if (extractedText.length < 20) {
      confidence += 0.2; // Very short text = low confidence
    } else if (extractedText.length < 50) {
      confidence += 0.4; // Short text = medium-low confidence
    } else if (extractedText.length < 200) {
      confidence += 0.6; // Medium text = medium confidence
    } else {
      confidence += 0.8; // Long text = high confidence
    }

    // Boost confidence if we have a good summary
    if (summary && summary.length > 20) {
      confidence += 0.2;
    }

    return Math.min(Math.max(confidence, 0.0), 1.0); // Clamp between 0.0 and 1.0
  }

  /**
   * Calculate privacy score based on content sensitivity
   * Returns 0.0 to 1.0, where 1.0 = very private (should never use cloud)
   */
  private async calculatePrivacyScore(
    extractedText: string,
    classification: string
  ): Promise<number> {
    // Privacy indicators (case-insensitive)
    const privacyKeywords = [
      // Personal identifiers
      'password',
      'passcode',
      'pin',
      'ssn',
      'social security',
      'credit card',
      'card number',
      'cvv',
      'cvc',
      'bank account',
      'routing number',
      'account number',
      // Personal information
      'private',
      'confidential',
      'secret',
      'personal',
      'medical',
      'health',
      'diagnosis',
      'prescription',
      'financial',
      'salary',
      'income',
      'tax',
      // Sensitive communications
      'private message',
      'dm',
      'direct message',
      'personal email',
      'private email',
    ];

    const textLower = extractedText.toLowerCase();
    let privacyScore = 0.0;

    // Check for privacy keywords
    const keywordMatches = privacyKeywords.filter((keyword) =>
      textLower.includes(keyword.toLowerCase())
    );
    privacyScore += keywordMatches.length * 0.15; // Each keyword adds 0.15

    // Classification-based privacy
    const highPrivacyClassifications = ['message', 'email', 'note'];
    if (highPrivacyClassifications.includes(classification)) {
      privacyScore += 0.3; // Personal communications are more private
    }

    // Check for personal identifiers (patterns)
    const patterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN pattern
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card pattern
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email addresses
      /\b\d{10,}\b/, // Long numbers (could be account numbers)
    ];

    const patternMatches = patterns.filter((pattern) =>
      pattern.test(extractedText)
    );
    privacyScore += patternMatches.length * 0.2; // Each pattern match adds 0.2

    // Text length factor (very short or very long might be more private)
    if (extractedText.length < 20) {
      privacyScore += 0.1; // Very short might be sensitive
    } else if (extractedText.length > 1000) {
      privacyScore += 0.1; // Very long might contain sensitive details
    }

    // Use LLM to assess privacy if we have uncertainty
    // For now, we'll use a rule-based approach, but could enhance with LLM
    if (privacyScore > 0.3 && privacyScore < 0.6) {
      // Medium privacy - use LLM to assess
      try {
        const privacyMessages: Message[] = [
          {
            role: 'system',
            content:
              'You are a privacy assessment assistant. Analyze the text and respond with only a number between 0.0 and 1.0, where 1.0 means very private/sensitive data that should never be sent to cloud services, and 0.0 means public/non-sensitive data. Consider: personal identifiers, financial info, medical info, private communications.',
          },
          {
            role: 'user',
            content: `Assess the privacy sensitivity of this text (respond with only a number 0.0-1.0):\n\n${extractedText.substring(0, 500)}`,
          },
        ];

        const privacyResult = await this.cactusLM.complete({
          messages: privacyMessages,
          options: { maxTokens: 10, temperature: 0.1 },
        });

        const llmPrivacyScore = parseFloat(privacyResult.response.trim());
        if (
          !isNaN(llmPrivacyScore) &&
          llmPrivacyScore >= 0 &&
          llmPrivacyScore <= 1
        ) {
          // Use LLM assessment, but weight it with our rule-based score
          privacyScore = privacyScore * 0.4 + llmPrivacyScore * 0.6;
        }
      } catch (error) {
        console.warn(
          '[InferenceRouter] LLM privacy assessment failed, using rule-based score:',
          error
        );
        // Fall back to rule-based score
      }
    }

    return Math.min(Math.max(privacyScore, 0.0), 1.0); // Clamp between 0.0 and 1.0
  }
}
