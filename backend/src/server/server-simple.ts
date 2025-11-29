/**
 * Simple HTTP Server for React Native Backend
 * 
 * Uses a simple HTTP server implementation that works in React Native.
 * This is a basic implementation - you may need to use a native module
 * or a library like react-native-tcp-socket for production.
 */

import { CactusLM } from 'cactus-react-native';
import { MemoryDatabase } from '../database/MemoryDatabase';
import { InferenceRouter } from '../services/InferenceRouter';
import { CloudInferenceService } from '../services/CloudInferenceService';
import { startHttpServer, stopHttpServer } from './httpServer';

let serverRunning = false;
let inferenceRouter: InferenceRouter | null = null;
let memoryDb: MemoryDatabase | null = null;
let httpServerUrl: string | null = null;

export async function startServer(port: number = 3000): Promise<string> {
  if (serverRunning) {
    return `http://localhost:${port}`;
  }

  try {
    // Initialize Cactus SDK models
    console.log('[Server] Initializing Cactus SDK...');
    
    // Initialize database
    memoryDb = new MemoryDatabase();
    await memoryDb.initialize();
    
    // Initialize Cactus SDK services
    console.log('[Server] Downloading Cactus models...');
    const cactusLM = new CactusLM({ model: 'qwen3-0.6' });
    await cactusLM.download();
    await cactusLM.init();
    console.log('[Server] CactusLM initialized');
    
    const cactusVision = new CactusLM({ model: 'lfm2-vl-450m' });
    await cactusVision.download();
    await cactusVision.init();
    console.log('[Server] Cactus Vision model initialized');
    
    // Initialize cloud service
    const cloudService = new CloudInferenceService();
    
    // Initialize router
    // Privacy threshold: if privacy score >= 0.5, never use cloud
    // Note: In React Native, use default values or pass via config
    const privacyThreshold = 0.5; // High privacy = never use cloud
    const confidenceThreshold = 0.7; // Low confidence = can use cloud (if privacy allows)
    
    inferenceRouter = new InferenceRouter(
      cactusLM,
      cactusVision,
      cloudService,
      confidenceThreshold,
      privacyThreshold
    );

    // Start HTTP server to receive images from frontend
    try {
      httpServerUrl = await startHttpServer(port);
      console.log(`[Server] ✅ HTTP server started on ${httpServerUrl}`);
    } catch (error) {
      console.warn('[Server] ⚠️  Failed to start HTTP server:', error);
      console.warn('[Server] Functions are still available for direct use');
    }
    
    serverRunning = true;
    const url = httpServerUrl || `http://localhost:${port}`;
    console.log(`[Server] 🚀 Backend ready (Cactus SDK initialized)`);
    console.log(`[Server] ✅ Using Cactus SDK directly!`);
    console.log(`[Server] Ready to receive images from frontend's automatic photo scanning!`);
    
    return url;
  } catch (error) {
    console.error('[Server] Failed to initialize:', error);
    throw error;
  }
}

export async function processScreenshot(imagePath: string): Promise<any> {
  if (!inferenceRouter || !memoryDb) {
    throw new Error('Server not initialized. Call startServer() first.');
  }
  
  const result = await inferenceRouter.processScreenshot(imagePath);
  
  const memoryId = await memoryDb.insertMemory({
    screenshot_path: imagePath,
    extracted_text: result.extractedText,
    summary: result.summary,
    classification: result.classification,
    embedding: result.embedding,
    confidence_score: result.confidenceScore,
    privacy_score: result.privacyScore,
    inference_mode: result.inferenceMode,
  });

  return {
    success: true,
    memoryId,
    ...result,
  };
}

export async function queryMemory(query: string, maxResults: number = 5): Promise<any> {
  if (!inferenceRouter || !memoryDb) {
    throw new Error('Server not initialized. Call startServer() first.');
  }
  
  const queryEmbedding = await inferenceRouter.processQuery(query);
  const similarMemories = await memoryDb.searchSimilarMemories(
    queryEmbedding,
    maxResults
  );
  
  const answer = await inferenceRouter.generateAnswer(query, similarMemories);

  return {
    answer,
    relevantMemories: similarMemories,
  };
}

export function stopServer() {
  stopHttpServer();
  serverRunning = false;
  inferenceRouter = null;
  memoryDb = null;
  httpServerUrl = null;
}

