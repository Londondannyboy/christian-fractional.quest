/**
 * PipelineVisualizerMiddleware
 * 
 * Provides observability into the voice pipeline by tracking metrics
 * at each stage and streaming them to a visualization frontend.
 */

import { createVoiceMiddleware, type VoiceMiddleware } from "./middleware.js";

/**
 * Stage metrics tracked by the visualizer.
 */
export interface StageMetrics {
  name: string;
  chunksProcessed: number;
  totalBytes: number;
  firstChunkAt: number | null;
  lastChunkAt: number | null;
  startedAt: number;
}

/**
 * Latency data for a stage.
 */
export interface LatencyData {
  stageName: string;
  turnNumber: number;
  ttfc: number | null;
  inputToOutput: number | null;
  interChunkAvg: number | null;
  stats: {
    min: number | null;
    max: number | null;
    avg: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
}

/**
 * Pipeline events that can be sent to the visualizer.
 */
export type PipelineEvent =
  | { type: "stage_registered"; stageName: string; shortName: string; color: string }
  | { type: "turn_start"; stageName: string; turnNumber: number }
  | { type: "stage_input"; stageName: string; turnNumber: number; chunkPreview?: string }
  | { type: "stage_processing"; stageName: string; turnNumber: number }
  | { type: "first_chunk"; stageName: string; turnNumber: number; ttfc: number; chunkPreview?: string }
  | { type: "chunk"; stageName: string; metrics: StageMetrics; chunkPreview?: string }
  | { type: "latency_update"; stageName: string; shortName: string; latency: LatencyData }
  | { type: "stage_complete"; stageName: string; metrics: StageMetrics }
  | { type: "pipeline_summary"; stages: StageMetrics[] };

/**
 * Options for the pipeline visualizer.
 */
export interface PipelineVisualizerOptions {
  /**
   * Callback to send events to the visualization frontend.
   * This can be a WebSocket send function, etc.
   */
  onEvent?: (event: PipelineEvent) => void;
  
  /**
   * Whether verbose logging is enabled.
   * @default false
   */
  verbose?: boolean;
}

const STAGE_COLORS = [
  "#06b6d4", // cyan
  "#22c55e", // green
  "#eab308", // yellow
  "#a855f7", // purple
  "#3b82f6", // blue
  "#ef4444", // red
];

/**
 * Creates an observable transform that tracks metrics for a pipeline stage.
 */
function createObservableTransform<T>(
  stageName: string,
  options: PipelineVisualizerOptions,
  colorIndex: number
): TransformStream<T, T> {
  const metrics: StageMetrics = {
    name: stageName,
    chunksProcessed: 0,
    totalBytes: 0,
    firstChunkAt: null,
    lastChunkAt: null,
    startedAt: Date.now(),
  };

  const shortName = extractShortName(stageName);
  const color = STAGE_COLORS[colorIndex % STAGE_COLORS.length];

  // Register the stage
  options.onEvent?.({
    type: "stage_registered",
    stageName,
    shortName,
    color,
  });

  return new TransformStream<T, T>({
    transform(chunk, controller) {
      const now = Date.now();
      
      metrics.chunksProcessed++;
      metrics.lastChunkAt = now;
      
      // Calculate chunk size
      if (chunk instanceof Buffer || chunk instanceof Uint8Array) {
        metrics.totalBytes += chunk.length;
      } else if (typeof chunk === "string") {
        metrics.totalBytes += Buffer.byteLength(chunk, "utf-8");
      }

      // Track first chunk
      if (metrics.firstChunkAt === null) {
        metrics.firstChunkAt = now;
        const ttfc = now - metrics.startedAt;
        
        options.onEvent?.({
          type: "first_chunk",
          stageName,
          turnNumber: 1,
          ttfc,
          chunkPreview: getChunkPreview(chunk),
        });
      }

      // Send chunk event
      options.onEvent?.({
        type: "chunk",
        stageName,
        metrics: { ...metrics },
        chunkPreview: getChunkPreview(chunk),
      });

      if (options.verbose) {
        console.log(`[Visualizer] ${stageName}: chunk #${metrics.chunksProcessed}`);
      }

      controller.enqueue(chunk);
    },

    flush() {
      options.onEvent?.({
        type: "stage_complete",
        stageName,
        metrics: { ...metrics },
      });
    },
  });
}

/**
 * Extract a short name from a stage name.
 */
function extractShortName(stageName: string): string {
  const nameMap: Record<string, string> = {
    AssemblyAI: "STT",
    OpenAI: "AI",
    ElevenLabs: "TTS",
    Hume: "TTS",
    Agent: "Agent",
    Filler: "Filler",
    VAD: "VAD",
  };

  for (const [key, value] of Object.entries(nameMap)) {
    if (stageName.includes(key)) return value;
  }

  return stageName.slice(0, 8);
}

/**
 * Get a preview of chunk content for logging.
 */
function getChunkPreview(chunk: unknown, maxLength = 50): string {
  if (typeof chunk === "string") {
    return chunk.length > maxLength ? chunk.slice(0, maxLength) + "..." : chunk;
  }
  if (chunk instanceof Buffer || chunk instanceof Uint8Array) {
    return `<binary ${chunk.length} bytes>`;
  }
  if (typeof chunk === "object" && chunk !== null) {
    const str = JSON.stringify(chunk);
    return str.length > maxLength ? str.slice(0, maxLength) + "..." : str;
  }
  return String(chunk);
}

/**
 * Creates a pipeline visualizer middleware.
 * 
 * This middleware tracks metrics at each stage of the pipeline and
 * streams them to a visualization frontend.
 * 
 * @example
 * ```ts
 * const visualizer = createPipelineVisualizerMiddleware({
 *   onEvent: (event) => ws.send(JSON.stringify(event)),
 * });
 * 
 * const voiceAgent = createVoiceAgent({
 *   agent,
 *   stt,
 *   tts,
 *   transport: "webrtc",
 *   middleware: [visualizer],
 * });
 * ```
 */
export function createPipelineVisualizerMiddleware(
  options: PipelineVisualizerOptions = {}
): VoiceMiddleware {
  let colorIndex = 0;

  return createVoiceMiddleware("PipelineVisualizer", {
    beforeSTT: [
      createObservableTransform<Buffer>("BeforeSTT", options, colorIndex++),
    ],
    afterSTT: [
      createObservableTransform<string>("AfterSTT", options, colorIndex++),
    ],
    beforeTTS: [
      createObservableTransform<string>("BeforeTTS", options, colorIndex++),
    ],
    afterTTS: [
      createObservableTransform<Buffer>("AfterTTS", options, colorIndex++),
    ],
  });
}

