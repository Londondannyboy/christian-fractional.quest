/**
 * Mulaw to PCM Transform
 *
 * Converts Twilio's mulaw (G.711 μ-law) audio at 8kHz to PCM 16-bit at 16kHz
 * for use with STT services that expect PCM audio.
 *
 * μ-law decoding formula: y = sign(x) * (1/255) * (pow(256, |x|) - 1)
 */

// μ-law decoding table (8-bit μ-law to 16-bit linear PCM)
const MULAW_TO_LINEAR: Int16Array = new Int16Array(256);

// Pre-compute the decoding table
for (let i = 0; i < 256; i++) {
  // Invert all bits (μ-law uses ones' complement)
  const mulaw = ~i & 0xff;

  // Extract sign, exponent, and mantissa
  const sign = mulaw & 0x80 ? -1 : 1;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;

  // Decode to linear value
  // Linear = (1 + mantissa * 2 + 33) * 2^exponent - 33
  let linear = ((mantissa << 1) + 33) << exponent;
  linear = (linear - 33) * sign;

  MULAW_TO_LINEAR[i] = linear;
}

interface MulawToPcmOptions {
  /**
   * Target sample rate for output PCM audio.
   * Default: 16000 (16kHz)
   */
  targetSampleRate?: number;
}

/**
 * Transform stream that converts μ-law 8kHz audio to PCM 16-bit at target sample rate.
 *
 * Input: Buffer containing μ-law encoded audio bytes
 * Output: Buffer containing PCM 16-bit audio bytes
 */
export class MulawToPcmTransform extends TransformStream<Buffer, Buffer> {
  constructor(options: MulawToPcmOptions = {}) {
    const { targetSampleRate = 16000 } = options;

    // Calculate upsampling ratio (Twilio sends 8kHz audio)
    const sourceSampleRate = 8000;
    const upsampleRatio = targetSampleRate / sourceSampleRate;

    super({
      transform(chunk, controller) {
        // Each μ-law byte becomes a 16-bit PCM sample
        // If upsampling, we duplicate samples to reach target rate
        const mulawSamples = chunk.length;
        const outputSamples = Math.floor(mulawSamples * upsampleRatio);

        // Allocate output buffer (2 bytes per PCM sample)
        const output = Buffer.alloc(outputSamples * 2);

        for (let i = 0; i < outputSamples; i++) {
          // Map output sample index to input sample index
          const srcIndex = Math.floor(i / upsampleRatio);
          const mulawByte = chunk[srcIndex];

          // Decode μ-law to linear PCM
          const pcmValue = MULAW_TO_LINEAR[mulawByte];

          // Write 16-bit little-endian PCM sample
          output.writeInt16LE(pcmValue, i * 2);
        }

        controller.enqueue(output);
      },
    });
  }
}

