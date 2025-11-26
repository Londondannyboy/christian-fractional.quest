/**
 * Base abstractions for Speech-to-Text and Text-to-Speech models.
 * These align with LangChain's model abstractions but are specialized for voice.
 */

/**
 * Base interface for Speech-to-Text models.
 * Implementations should extend TransformStream<Buffer, string>.
 * 
 * Input: PCM audio buffer (16-bit, mono)
 * Output: Transcribed text string
 */
export interface SpeechToTextModelParams {
  /** Sample rate of input audio (default: 16000) */
  sampleRate?: number;
  /** Callback when speech is detected (useful for barge-in) */
  onSpeechStart?: () => void;
}

/**
 * Abstract base class for Speech-to-Text models.
 * Provides a common interface for different STT providers.
 */
export abstract class BaseSpeechToTextModel extends TransformStream<Buffer, string> {
  abstract readonly provider: string;
  
  /** Registered speech start listeners */
  protected speechStartListeners: Array<() => void> = [];
  
  /**
   * Interrupt the current transcription (e.g., for barge-in support).
   * Not all providers support this.
   */
  interrupt?(): void;

  /**
   * Add a listener for when speech starts.
   * Multiple listeners can be registered; all will be called.
   */
  addSpeechStartListener(listener: () => void): void {
    this.speechStartListeners.push(listener);
  }

  /**
   * Remove a speech start listener.
   */
  removeSpeechStartListener(listener: () => void): void {
    const index = this.speechStartListeners.indexOf(listener);
    if (index > -1) {
      this.speechStartListeners.splice(index, 1);
    }
  }

  /**
   * Called by implementations when speech is detected.
   * This notifies all registered listeners.
   */
  protected notifySpeechStart(): void {
    for (const listener of this.speechStartListeners) {
      listener();
    }
  }
}

/**
 * Base interface for Text-to-Speech models.
 * Implementations should extend TransformStream<string, Buffer>.
 * 
 * Input: Text string
 * Output: PCM audio buffer
 */
export interface TextToSpeechModelParams {
  /** Output sample rate (default: 16000) */
  outputSampleRate?: number;
  /** Callback when audio generation is interrupted */
  onInterrupt?: () => void;
  /** Callback when audio generation is complete */
  onAudioComplete?: () => void;
}

/**
 * Abstract base class for Text-to-Speech models.
 * Provides a common interface for different TTS providers.
 */
export abstract class BaseTextToSpeechModel extends TransformStream<string, Buffer> {
  abstract readonly provider: string;
  
  /** Registered audio complete listeners */
  protected audioCompleteListeners: Array<() => void> = [];
  
  /**
   * Interrupt the current TTS output (e.g., for barge-in support).
   * Stops audio generation and clears any pending tokens.
   */
  abstract interrupt(): void;

  /**
   * Add a listener for when audio playback completes.
   * Multiple listeners can be registered; all will be called.
   */
  addAudioCompleteListener(listener: () => void): void {
    this.audioCompleteListeners.push(listener);
  }

  /**
   * Remove an audio complete listener.
   */
  removeAudioCompleteListener(listener: () => void): void {
    const index = this.audioCompleteListeners.indexOf(listener);
    if (index > -1) {
      this.audioCompleteListeners.splice(index, 1);
    }
  }

  /**
   * Called by implementations when audio playback completes.
   * This notifies all registered listeners.
   */
  protected notifyAudioComplete(): void {
    for (const listener of this.audioCompleteListeners) {
      listener();
    }
  }
}

