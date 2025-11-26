/**
 * PCM to Mulaw Transform
 *
 * Converts PCM 16-bit audio to mulaw (G.711 μ-law) at 8kHz
 * for sending audio back to Twilio.
 *
 * μ-law encoding compresses dynamic range for telephony.
 */

// Bias for μ-law encoding
const MULAW_BIAS = 0x84;
const MULAW_MAX = 0x7fff;
const MULAW_CLIP = 32635;

// Segment lookup table for fast encoding
const SEGMENT_TABLE: number[] = [
  0, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
];

/**
 * Encode a 16-bit linear PCM sample to 8-bit μ-law
 */
function linearToMulaw(sample: number): number {
  // Get the sign
  const sign = sample < 0 ? 0x80 : 0x00;

  // Get absolute value and clip
  let absValue = sample < 0 ? -sample : sample;
  if (absValue > MULAW_CLIP) {
    absValue = MULAW_CLIP;
  }

  // Add bias
  absValue += MULAW_BIAS;

  // Find the segment (exponent)
  const segment = SEGMENT_TABLE[(absValue >> 8) & 0x7f];

  // Combine sign, segment, and quantized mantissa
  // Then invert all bits (μ-law uses ones' complement)
  const mulaw =
    ~(sign | (segment << 4) | ((absValue >> (segment + 3)) & 0x0f)) & 0xff;

  return mulaw;
}

interface PcmToMulawOptions {
  /**
   * Source sample rate of input PCM audio.
   * Default: 16000 (16kHz)
   */
  sourceSampleRate?: number;
}

/**
 * Transform stream that converts PCM 16-bit audio to μ-law 8kHz.
 *
 * Input: Buffer containing PCM 16-bit audio bytes
 * Output: Buffer containing μ-law encoded audio bytes
 */
export class PcmToMulawTransform extends TransformStream<Buffer, Buffer> {
  constructor(options: PcmToMulawOptions = {}) {
    const { sourceSampleRate = 16000 } = options;

    // Calculate downsampling ratio (Twilio expects 8kHz audio)
    const targetSampleRate = 8000;
    const downsampleRatio = sourceSampleRate / targetSampleRate;

    // Accumulator for fractional sample positions (for smooth downsampling)
    let accumulator = 0;

    super({
      transform(chunk, controller) {
        // Each PCM sample is 2 bytes (16-bit)
        const pcmSamples = Math.floor(chunk.length / 2);

        // Calculate how many output samples we'll produce
        const outputSamples: number[] = [];

        for (let i = 0; i < pcmSamples; i++) {
          accumulator += 1;

          // When we've accumulated enough samples, emit one
          if (accumulator >= downsampleRatio) {
            accumulator -= downsampleRatio;

            // Read 16-bit little-endian PCM sample
            const pcmValue = chunk.readInt16LE(i * 2);

            // Encode to μ-law
            const mulawByte = linearToMulaw(pcmValue);
            outputSamples.push(mulawByte);
          }
        }

        if (outputSamples.length > 0) {
          controller.enqueue(Buffer.from(outputSamples));
        }
      },
    });
  }
}

