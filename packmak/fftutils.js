/*
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
*/

const DSP = {
  FFT: function (bufferSize) {
    this.bufferSize = bufferSize;
    this.reverseTable = new Uint32Array(bufferSize);

    let limit = 1;
    let bit = bufferSize >> 1;

    while (limit < bufferSize) {
      for (let i = 0; i < limit; i++) {
        this.reverseTable[i + limit] = this.reverseTable[i] + bit;
      }
      limit <<= 1;
      bit >>= 1;
    }

    this.calculate = (real, imag, dir) => {
      const n = this.bufferSize;

      for (let i = 0; i < n; i++) {
        const j = this.reverseTable[i];
        if (i < j) {
          let tmp = real[i];
          real[i] = real[j];
          real[j] = tmp;

          tmp = imag[i];
          imag[i] = imag[j];
          imag[j] = tmp;
        }
      }

      for (let halfSize = 1; halfSize < n; halfSize <<= 1) {
        const phaseStepReal = Math.cos((dir * Math.PI) / halfSize);
        const phaseStepImag = Math.sin((dir * Math.PI) / halfSize);

        let currentReal = 1;
        let currentImag = 0;

        for (let fftStep = 0; fftStep < halfSize; fftStep++) {
          for (let i = fftStep; i < n; i += halfSize << 1) {
            const off = i + halfSize;
            const tr = currentReal * real[off] - currentImag * imag[off];
            const ti = currentReal * imag[off] + currentImag * real[off];

            real[off] = real[i] - tr;
            imag[off] = imag[i] - ti;
            real[i] += tr;
            imag[i] += ti;
          }

          const nextReal =
            currentReal * phaseStepReal - currentImag * phaseStepImag;
          currentImag =
            currentReal * phaseStepImag + currentImag * phaseStepReal;
          currentReal = nextReal;
        }
      }

      if (dir === -1) {
        for (let i = 0; i < n; i++) {
          real[i] /= n;
          imag[i] /= n;
        }
      }
    };
  },

  createHanningWindow(size) {
    const win = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return win;
  },

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  },

  smoothArray(input, radius = 2) {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let total = 0;
      let weight = 0;
      for (let j = -radius; j <= radius; j++) {
        const idx = i + j;
        if (idx < 0 || idx >= input.length) continue;
        const currentWeight = radius + 1 - Math.abs(j);
        total += input[idx] * currentWeight;
        weight += currentWeight;
      }
      output[i] = weight > 0 ? total / weight : input[i];
    }
    return output;
  },

  removeDC(source) {
    const output = new Float32Array(source.length);
    let prevX = 0;
    let prevY = 0;
    const pole = 0.995;

    for (let i = 0; i < source.length; i++) {
      const y = source[i] - prevX + pole * prevY;
      output[i] = y;
      prevX = source[i];
      prevY = y;
    }

    return output;
  },

  highpass(source, sampleRate, cutoff = 75) {
    if (!source.length) return new Float32Array(0);

    const output = new Float32Array(source.length);
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / sampleRate;
    const alpha = rc / (rc + dt);
    output[0] = source[0];

    for (let i = 1; i < source.length; i++) {
      output[i] = alpha * (output[i - 1] + source[i] - source[i - 1]);
    }

    return output;
  },

  getPeak(source) {
    let peak = 0;
    for (let i = 0; i < source.length; i++) {
      const value = Math.abs(source[i]);
      if (value > peak) peak = value;
    }
    return peak;
  },

  normalizePeak(source, targetPeak = 0.92) {
    const peak = this.getPeak(source);
    if (peak <= 0) return source.slice();

    const gain = targetPeak / peak;
    const output = new Float32Array(source.length);
    for (let i = 0; i < source.length; i++) {
      output[i] = source[i] * gain;
    }
    return output;
  },

  denoise(source, noiseProfile, amount = 1.0) {
    if (!noiseProfile || noiseProfile.length < 1024 || source.length < 256) {
      return source.slice();
    }

    const fftSize = 1024;
    const hopSize = 256;
    const halfSize = fftSize >> 1;
    const fft = new this.FFT(fftSize);
    const window = this.createHanningWindow(fftSize);

    const noiseMagnitude = new Float32Array(halfSize + 1);
    const frameReal = new Float32Array(fftSize);
    const frameImag = new Float32Array(fftSize);
    let noiseFrames = 0;

    for (let frameStart = 0; frameStart + fftSize <= noiseProfile.length; frameStart += hopSize) {
      for (let i = 0; i < fftSize; i++) {
        frameReal[i] = noiseProfile[frameStart + i] * window[i];
        frameImag[i] = 0;
      }

      fft.calculate(frameReal, frameImag, 1);

      for (let bin = 0; bin <= halfSize; bin++) {
        noiseMagnitude[bin] += Math.hypot(frameReal[bin], frameImag[bin]);
      }
      noiseFrames++;
    }

    if (noiseFrames === 0) {
      return source.slice();
    }

    for (let bin = 0; bin <= halfSize; bin++) {
      noiseMagnitude[bin] /= noiseFrames;
    }

    const output = new Float32Array(source.length);
    const weight = new Float32Array(source.length);
    const gains = new Float32Array(halfSize + 1);
    const prevGains = new Float32Array(halfSize + 1).fill(1);
    const magnitudes = new Float32Array(halfSize + 1);
    let prevFrameEnergy = 0;

    for (let frameStart = 0; frameStart < source.length; frameStart += hopSize) {
      for (let i = 0; i < fftSize; i++) {
        const idx = frameStart + i;
        frameReal[i] = (idx < source.length ? source[idx] : 0) * window[i];
        frameImag[i] = 0;
      }

      fft.calculate(frameReal, frameImag, 1);

      let frameEnergy = 0;
      for (let bin = 0; bin <= halfSize; bin++) {
        const mag = Math.hypot(frameReal[bin], frameImag[bin]);
        magnitudes[bin] = mag;
        frameEnergy += mag;

        const noise = noiseMagnitude[bin] + 1e-7;
        const snr = mag / noise;
        const oversubtract = 0.85 + amount * 0.35;
        const rawGain = (mag - oversubtract * noise) / (mag + 1e-7);
        gains[bin] = this.clamp(rawGain, 0.06, 1);

        if (snr > 4) {
          gains[bin] = Math.max(gains[bin], 0.8);
        }
      }

      const smoothed = this.smoothArray(gains, 2);
      const transientFrame = frameEnergy > prevFrameEnergy * 1.2;

      for (let bin = 0; bin <= halfSize; bin++) {
        const targetGain = transientFrame
          ? Math.max(smoothed[bin], 0.24)
          : smoothed[bin];
        const attack = 0.32;
        const release = 0.9;

        const nextGain =
          targetGain > prevGains[bin]
            ? prevGains[bin] * attack + targetGain * (1 - attack)
            : prevGains[bin] * release + targetGain * (1 - release);

        prevGains[bin] = nextGain;

        frameReal[bin] *= nextGain;
        frameImag[bin] *= nextGain;

        if (bin > 0 && bin < halfSize) {
          const mirrored = fftSize - bin;
          frameReal[mirrored] *= nextGain;
          frameImag[mirrored] *= nextGain;
        }
      }

      prevFrameEnergy = frameEnergy;

      fft.calculate(frameReal, frameImag, -1);

      for (let i = 0; i < fftSize; i++) {
        const idx = frameStart + i;
        if (idx >= source.length) break;

        const value = frameReal[i] * window[i];
        output[idx] += value;
        weight[idx] += window[i] * window[i];
      }
    }

    for (let i = 0; i < output.length; i++) {
      if (weight[i] > 1e-6) {
        output[i] /= weight[i];
      }
      output[i] = output[i] * 0.92 + source[i] * 0.08;
    }

    return output;
  },
};
