/**
 * Voice Activity Detection (VAD) Buffer Transform
 * 
 * Buffers audio until speech ends, then emits the complete utterance.
 * Useful for non-streaming STT providers like OpenAI Whisper.
 * 
 * Note: This is a basic implementation. For production use,
 * consider using a proper VAD library like @ericedouard/vad-node-realtime.
 */

/**
 * Options for the VAD buffer transform.
 */
export interface VADBufferOptions {
  /**
   * Sample rate of input audio.
   * @default 16000
   */
  sampleRate?: number;

  /**
   * Minimum number of speech frames required to trigger output.
   * @default 4 (~0.125s at 32ms frames)
   */
  minSpeechFrames?: number;

  /**
   * Callback when speech ends and audio is emitted.
   */
  onSpeechEnd?: (audioBuffer: Buffer) => void;
}

/**
 * A simple energy-based VAD buffer transform.
 * 
 * This implementation uses basic energy detection.
 * For better accuracy, use a proper VAD library.
 */
export class VADBufferTransform extends TransformStream<Buffer, Buffer> {
  constructor(options: VADBufferOptions = {}) {
    const {
      sampleRate = 16000,
      minSpeechFrames = 4,
      onSpeechEnd,
    } = options;

    // Frame size: 32ms worth of samples
    const frameSizeMs = 32;
    const samplesPerFrame = Math.floor(sampleRate * frameSizeMs / 1000);
    const bytesPerFrame = samplesPerFrame * 2; // 16-bit audio = 2 bytes per sample

    // Energy threshold for speech detection (tune as needed)
    const energyThreshold = 500;

    // Silence frames required to trigger end of speech
    const silenceFramesThreshold = 10;

    let audioBuffer: Buffer[] = [];
    let speechFrameCount = 0;
    let silenceFrameCount = 0;
    let isSpeaking = false;
    let pendingBytes = Buffer.alloc(0);

    const calculateEnergy = (frame: Buffer): number => {
      let sum = 0;
      for (let i = 0; i < frame.length - 1; i += 2) {
        const sample = frame.readInt16LE(i);
        sum += Math.abs(sample);
      }
      return sum / (frame.length / 2);
    };

    const processFrame = (
      frame: Buffer,
      controller: TransformStreamDefaultController<Buffer>
    ) => {
      const energy = calculateEnergy(frame);
      const isSpeech = energy > energyThreshold;

      if (isSpeech) {
        silenceFrameCount = 0;
        speechFrameCount++;
        
        if (!isSpeaking && speechFrameCount >= minSpeechFrames) {
          isSpeaking = true;
          console.log("VAD: Speech started");
        }
        
        if (isSpeaking) {
          audioBuffer.push(frame);
        }
      } else {
        if (isSpeaking) {
          silenceFrameCount++;
          audioBuffer.push(frame); // Include some trailing silence
          
          if (silenceFrameCount >= silenceFramesThreshold) {
            // Speech ended, emit the buffer
            const completeAudio = Buffer.concat(audioBuffer);
            console.log(`VAD: Speech ended (${completeAudio.length} bytes)`);
            
            onSpeechEnd?.(completeAudio);
            controller.enqueue(completeAudio);
            
            // Reset state
            audioBuffer = [];
            speechFrameCount = 0;
            silenceFrameCount = 0;
            isSpeaking = false;
          }
        } else {
          speechFrameCount = 0;
        }
      }
    };

    super({
      transform(chunk, controller) {
        // Combine pending bytes with new chunk
        const combined = Buffer.concat([pendingBytes, chunk]);
        
        // Process complete frames
        let offset = 0;
        while (offset + bytesPerFrame <= combined.length) {
          const frame = combined.subarray(offset, offset + bytesPerFrame);
          processFrame(frame, controller);
          offset += bytesPerFrame;
        }
        
        // Save remaining bytes for next chunk
        pendingBytes = combined.subarray(offset);
      },

      flush(controller) {
        // Emit any remaining speech
        if (isSpeaking && audioBuffer.length > 0) {
          const completeAudio = Buffer.concat(audioBuffer);
          console.log(`VAD: Flushing remaining speech (${completeAudio.length} bytes)`);
          onSpeechEnd?.(completeAudio);
          controller.enqueue(completeAudio);
        }
      },
    });
  }
}

