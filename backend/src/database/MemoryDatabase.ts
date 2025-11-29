/**
 * Memory Database for React Native
 * 
 * Uses AsyncStorage for persistent storage in React Native
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MemoryRecord {
  id: number;
  screenshot_path: string;
  extracted_text: string | null;
  summary: string | null;
  classification: string | null;
  embedding: number[];
  confidence_score: number;
  privacy_score: number; // 0.0 to 1.0 (1.0 = very private)
  inference_mode: 'local' | 'cloud';
  created_at: string;
}

export class MemoryDatabase {
  private readonly storageKey = '@cactus_memories';
  private memories: MemoryRecord[] = [];

  async initialize(): Promise<void> {
    // Load existing memories from storage
    const stored = await AsyncStorage.getItem(this.storageKey);
    if (stored) {
      this.memories = JSON.parse(stored);
    }
  }

  async insertMemory(data: Omit<MemoryRecord, 'id' | 'created_at'>): Promise<number> {
    await this.initialize(); // Ensure initialized
    
    const id = this.memories.length > 0 
      ? Math.max(...this.memories.map(m => m.id)) + 1 
      : 1;

    const memory: MemoryRecord = {
      ...data,
      id,
      created_at: new Date().toISOString(),
    };

    this.memories.push(memory);
    await this.save();
    return id;
  }

  async searchSimilarMemories(
    queryEmbedding: number[],
    limit: number = 5,
    minSimilarity: number = 0.5
  ): Promise<Array<MemoryRecord & { similarity: number }>> {
    await this.initialize(); // Ensure initialized
    
    const similarities = this.memories.map(memory => {
      const similarity = this.cosineSimilarity(queryEmbedding, memory.embedding);
      return { ...memory, similarity };
    });

    return similarities
      .filter(item => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  private async save(): Promise<void> {
    await AsyncStorage.setItem(this.storageKey, JSON.stringify(this.memories));
  }
}

