/**
 * Backend API Client
 *
 * Handles all communication with the Cactus Memory Backend HTTP server.
 */

// IMPORTANT:
// - On Android emulator: replace localhost with 10.0.2.2
// - On a real device: replace with your computer's LAN IP, e.g. http://192.168.1.23:3000
const DEFAULT_BACKEND_URL = 'http://10.0.2.2:3000';

export interface ProcessImageResult {
  success: boolean;
  memoryId: number;
  extractedText: string;
  summary: string;
  classification: string;
  embedding: number[];
  confidenceScore: number;
  privacyScore: number;
  inferenceMode: 'local' | 'cloud';
}

export interface ProcessBatchResponse {
  success: boolean;
  processed: number;
  failed: number;
  total: number;
  results: Array<{
    index: number;
    success: boolean;
    memoryId?: number;
    extractedText?: string;
    summary?: string;
    classification?: string;
    confidenceScore?: number;
    privacyScore?: number;
    inferenceMode?: 'local' | 'cloud';
  }>;
  errors?: Array<{
    index: number;
    imagePath?: string;
    error: string;
  }>;
}

export interface QueryMemoryResponse {
  answer: string;
  relevantMemories: Array<{
    id: number;
    summary: string | null;
    classification: string | null;
    similarity: number;
  }>;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  service: string;
}

class BackendApi {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BACKEND_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if backend is running
   */
  async healthCheck(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Process multiple images in batch
   * Each image can have either imagePath or imageUri (we use imageUri from gallery)
   */
  async processImagesBatch(
    images: Array<{ imagePath?: string; imageUri?: string }>
  ): Promise<ProcessBatchResponse> {
    const response = await fetch(`${this.baseUrl}/api/process-images-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ images }),
    });

    if (!response.ok) {
      let message = `Failed to process batch: ${response.statusText}`;
      try {
        const error = await response.json();
        if (error?.message) {
          message = error.message;
        }
      } catch {
        // ignore JSON parse error
      }
      throw new Error(message);
    }

    return response.json();
  }

  /**
   * Query memory with vector search (for chat interface)
   */
  async queryMemory(
    query: string,
    maxResults: number = 5
  ): Promise<QueryMemoryResponse> {
    const response = await fetch(`${this.baseUrl}/api/query-memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, maxResults }),
    });

    if (!response.ok) {
      let message = `Failed to query memory: ${response.statusText}`;
      try {
        const error = await response.json();
        if (error?.message) {
          message = error.message;
        }
      } catch {
        // ignore JSON parse error
      }
      throw new Error(message);
    }

    return response.json();
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const backendApi = new BackendApi();
