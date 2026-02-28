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
  // Cooley-Tukey FFT
  FFT: function (bufferSize) {
    this.bufferSize = bufferSize;
    this.reverseTable = new Uint32Array(bufferSize);
    this.sinTable = new Float32Array(bufferSize);
    this.cosTable = new Float32Array(bufferSize);

    let limit = 1;
    let bit = bufferSize >> 1;
    let i;

    while (limit < bufferSize) {
      for (i = 0; i < limit; i++) {
        this.reverseTable[i + limit] = this.reverseTable[i] + bit;
      }
      limit = limit << 1;
      bit = bit >> 1;
    }

    for (i = 0; i < bufferSize; i++) {
      this.sinTable[i] = Math.sin(-Math.PI / i);
      this.cosTable[i] = Math.cos(-Math.PI / i);
    }

    this.calculate = (real, imag, dir) => {
      // dir: 1 for forward, -1 for inverse
      const n = this.bufferSize;

      // bit-reverse
      for (let i = 0; i < n; i++) {
        const off = this.reverseTable[i];
        if (i < off) {
          let tr = real[i];
          real[i] = real[off];
          real[off] = tr;
          let ti = imag[i];
          imag[i] = imag[off];
          imag[off] = ti;
        }
      }

      // butterfly
      let halfSize = 1;
      while (halfSize < n) {
        const phaseShiftStepReal = Math.cos((dir * Math.PI) / halfSize);
        const phaseShiftStepImag = Math.sin((dir * Math.PI) / halfSize);

        let currentPhaseShiftReal = 1;
        let currentPhaseShiftImag = 0;

        for (let fftStep = 0; fftStep < halfSize; fftStep++) {
          for (let i = fftStep; i < n; i += 2 * halfSize) {
            const off = i + halfSize;
            const tr =
              currentPhaseShiftReal * real[off] -
              currentPhaseShiftImag * imag[off];
            const ti =
              currentPhaseShiftReal * imag[off] +
              currentPhaseShiftImag * real[off];

            real[off] = real[i] - tr;
            imag[off] = imag[i] - ti;
            real[i] += tr;
            imag[i] += ti;
          }
          const tmpReal = currentPhaseShiftReal;
          currentPhaseShiftReal =
            tmpReal * phaseShiftStepReal -
            currentPhaseShiftImag * phaseShiftStepImag;
          currentPhaseShiftImag =
            tmpReal * phaseShiftStepImag +
            currentPhaseShiftImag * phaseShiftStepReal;
        }
        halfSize <<= 1;
      }

      // scaling for inverse
      if (dir === -1) {
        for (let i = 0; i < n; i++) {
          real[i] /= n;
          imag[i] /= n;
        }
      }
    };
  },

  createHanningWindow: function (size) {
    const win = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return win;
  },

  // spectral subtraction denoiser
  denoise: function (source, noiseProfile, amount = 1.0) {
    const fftSize = 2048;
    const hopSize = fftSize / 4; // 75% overlap
    const fft = new this.FFT(fftSize);
    const window = this.createHanningWindow(fftSize);

    // compute power spectrum
    const noisePower = new Float32Array(fftSize);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    let noiseFrames = 0;

    for (let i = 0; i < noiseProfile.length - fftSize; i += hopSize) {
      for (let j = 0; j < fftSize; j++) {
        real[j] = noiseProfile[i + j] * window[j];
        imag[j] = 0;
      }
      fft.calculate(real, imag, 1);

      // accumulate power
      for (let j = 0; j < fftSize; j++) {
        noisePower[j] += (real[j] * real[j] + imag[j] * imag[j]);
      }
      noiseFrames++;
    }

    // average power
    for (let j = 0; j < fftSize; j++) noisePower[j] /= noiseFrames;

    const output = new Float32Array(source.length);
    const inputReal = new Float32Array(fftSize);
    const inputImag = new Float32Array(fftSize);

    // for Ephraim-Malah smoothing
    const alpha = 0.98;
    const prevOutputPower = new Float32Array(fftSize);

    for (let i = 0; i < source.length - fftSize; i += hopSize) {
      // apply window
      for (let j = 0; j < fftSize; j++) {
        inputReal[j] = source[i + j] * window[j];
        inputImag[j] = 0;
      }

      // forward fft
      fft.calculate(inputReal, inputImag, 1);

      // Wiener filter
      for (let j = 0; j < fftSize; j++) {
        const currentPower = inputReal[j] * inputReal[j] + inputImag[j] * inputImag[j];
        const nPower = noisePower[j] + 1e-10; // dividebyzero

        // a posteriori SNR
        const snrPost = currentPower / nPower;

        // a priori SNR (decision-directed estimation)
        const snrPrio = alpha * (prevOutputPower[j] / nPower) + (1 - alpha) * Math.max(0, snrPost - 1);

        // calculate Wiener gain based on a priori SNR
        let gain = snrPrio / (snrPrio + amount);

        // soft floor
        gain = Math.max(0.02, gain);

        const mag = Math.sqrt(currentPower);
        const newMag = mag * gain;

        // store for next frame's smoothing
        prevOutputPower[j] = newMag * newMag;

        // reconstruct with original phase
        const phase = Math.atan2(inputImag[j], inputReal[j]);
        inputReal[j] = newMag * Math.cos(phase);
        inputImag[j] = newMag * Math.sin(phase);
      }

      // inverse fft
      fft.calculate(inputReal, inputImag, -1);

      // overlap-add WOLA
      for (let j = 0; j < fftSize; j++) {
        if (i + j < output.length) {
          output[i + j] += inputReal[j] * window[j] * (2 / 3);
        }
      }
    }

    return output;
  },
};
