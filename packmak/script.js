// state
let audioContext;
let mediaStream;
let mediaRecorder;
let recordedChunks = [];
let config = {};
let sequence = [];
let currentStepIndex = 0;
let isRecording = false;
let metronomeInterval;
let nextNoteTime = 0;
let audioBuffer = null;

// dom elements
const els = {
  startBtn: document.getElementById("start-btn"),
  configPanel: document.getElementById("config-panel"),
  recordingOverlay: document.getElementById("recording-overlay"),
  resultPanel: document.getElementById("result-panel"),
  mainContainer: document.getElementById("main-container"),
  vignette: document.getElementById("vignette"),
  visualCue: document.getElementById("visual-cue"),
  innerCue: document.getElementById("inner-cue"),
  instructionMain: document.getElementById("instruction-main"),
  instructionSub: document.getElementById("instruction-sub"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  currentPhase: document.getElementById("current-phase"),
  processingState: document.getElementById("processing-state"),
  finishedState: document.getElementById("finished-state"),
  downloadBtn: document.getElementById("download-btn"),
};

const CLICK_TYPES = [
  {
    id: "hard",
    name: "Hard Click",
    folder: "hardclicks",
    relFolder: "hardreleases",
  },
  {
    id: "normal",
    name: "Normal Click",
    folder: "clicks",
    relFolder: "releases",
  },
  {
    id: "soft",
    name: "Soft Click",
    folder: "softclicks",
    relFolder: "softrelease",
  },
  {
    id: "micro",
    name: "Micro Click",
    folder: "microclicks",
    relFolder: "microreleases",
  },
];

// event listeners
els.startBtn.addEventListener("click", startSession);
els.downloadBtn.addEventListener("click", downloadZip);

// denoise toggle
document.getElementById("record-noise").addEventListener("change", (e) => {
  const denoiseContainer = document.getElementById("denoise-container");
  const denoiseCheckbox = document.getElementById("denoise-samples");

  if (e.target.checked) {
    denoiseContainer.classList.remove("opacity-50", "pointer-events-none");
    denoiseCheckbox.disabled = false;
  } else {
    denoiseContainer.classList.add("opacity-50", "pointer-events-none");
    denoiseCheckbox.disabled = true;
    denoiseCheckbox.checked = false;
  }
});

async function startSession() {
  // get config
  config = {
    packName: document.getElementById("pack-name").value || "Clickpack",
    players: parseInt(document.getElementById("num-players").value),
    bpm: parseInt(document.getElementById("bpm").value),
    prePeak: parseInt(document.getElementById("pre-peak").value) || 10,
    recordNoise: document.getElementById("record-noise").checked,
    normalize: document.getElementById("normalize-audio").checked,
    denoise: document.getElementById("denoise-samples").checked,
    counts: {
      hard: parseInt(document.getElementById("count-hard").value),
      normal: parseInt(document.getElementById("count-normal").value),
      soft: parseInt(document.getElementById("count-soft").value),
      micro: parseInt(document.getElementById("count-micro").value),
    },
  };

  buildSequence();

  if (sequence.length === 0) {
    alert("Please select at least one click type to record.");
    return;
  }

  // mic access
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (e) {
    alert("Microphone access denied. Please allow access to record.");
    return;
  }

  // audio context and recorder
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  mediaRecorder = new MediaRecorder(mediaStream);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  // start UI
  els.configPanel.classList.add("hidden");
  els.recordingOverlay.classList.remove("hidden");
  els.recordingOverlay.classList.add("flex");

  // enter fullscreen
  try {
    await document.documentElement.requestFullscreen();
  } catch (e) {
    console.log("Fullscreen denied");
  }

  // start countdown
  renderProgressMarkers();
  startCountdown();
}

function renderProgressMarkers() {
  const container = document.getElementById("progress-container");
  // remove existing markers
  const existing = container.querySelectorAll(".progress-marker");
  existing.forEach((el) => el.remove());

  sequence.forEach((step, index) => {
    if (step.type === "prep") {
      const leftPos = (index / sequence.length) * 100;

      // marker line
      const marker = document.createElement("div");
      marker.className =
        "progress-marker absolute top-0 bottom-0 w-0.5 bg-white/50 z-20";
      marker.style.left = `${leftPos}%`;

      // label
      const label = document.createElement("div");
      label.className =
        "progress-marker absolute -top-6 text-[10px] text-gray-400 font-mono transform whitespace-nowrap";
      label.innerText = step.text
        .replace("Player 1: ", "")
        .replace("Player 2: ", "");
      label.style.left = `${leftPos}%`;

      container.appendChild(marker);
      container.appendChild(label);
    }
  });
}

function updateUI(step) {
  els.instructionMain.innerText = step.text;
  els.instructionSub.innerText = step.sub;
  els.progressText.innerText = `${currentStepIndex + 1}/${sequence.length}`;

  // progress bar
  els.progressBar.style.width = `${(currentStepIndex / sequence.length) * 100}%`;
  if (isRecording) els.currentPhase.innerText = "Recording";

  // vignette reset
  els.vignette.className =
    "absolute inset-0 pointer-events-none vignette-overlay transition-colors duration-200";

  // reset cue
  els.visualCue.classList.remove("scale-110", "scale-90");
  void els.visualCue.offsetWidth;

  if (step.type === "click") {
    els.vignette.classList.add("vignette-click");
    els.visualCue.classList.add("scale-110"); // pulse up
    els.innerCue.style.backgroundColor = "#0ea5e9";
  } else if (step.type === "release") {
    els.vignette.classList.add("vignette-release");
    els.visualCue.classList.add("scale-90"); // pulse down
    els.innerCue.style.backgroundColor = "#a855f7";
  } else if (step.type === "noise") {
    els.vignette.classList.add("vignette-prepare");
    els.innerCue.style.backgroundColor = "#ef4444";
  } else {
    els.vignette.classList.add("vignette-prepare");
    els.innerCue.style.backgroundColor = "#eab308";
  }
}

function buildSequence() {
  sequence = [];
  const beatDuration = 60 / config.bpm;

  // noise profile
  if (config.recordNoise) {
    sequence.push({
      type: "prep",
      text: "Noise",
      sub: "Stay silent for 5 seconds...",
      duration: 2, // 2 beats prep
    });

    // 5 seconds of noise = (5 / beatDuration) beats
    const noiseBeats = Math.ceil(5 / beatDuration);

    sequence.push({
      type: "noise",
      text: "RECORDING NOISE",
      sub: "Shhhhh...",
      duration: noiseBeats,
    });
  }

  // clicks
  for (let p = 1; p <= config.players; p++) {
    const playerPrefix = config.players > 1 ? `Player ${p}: ` : "";

    CLICK_TYPES.forEach((type) => {
      const count = config.counts[type.id];
      if (count > 0) {
        // preparation
        sequence.push({
          type: "prep",
          text: `${playerPrefix}${type.name}s`,
          sub: `Get ready for ${count} clicks...`,
          duration: 2, // beats
        });

        for (let i = 1; i <= count; i++) {
          // click
          sequence.push({
            type: "click",
            cat: type.id,
            player: p,
            index: i,
            action: "down",
            text: "CLICK",
            sub: `${playerPrefix}${type.name} ${i}/${count}`,
            duration: 1,
          });

          // release
          sequence.push({
            type: "release",
            cat: type.id,
            player: p,
            index: i,
            action: "up",
            text: "RELEASE",
            sub: `${playerPrefix}${type.name} ${i}/${count}`,
            duration: 1,
          });
        }
      }
    });
  }
}

function startCountdown() {
  let count = 3;
  els.instructionMain.innerText = count;
  els.instructionSub.innerText = "Lock In...";

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      els.instructionMain.innerText = count;
      playMetronomeClick(800);
    } else {
      clearInterval(interval);
      els.instructionMain.innerText = "GO!";
      playMetronomeClick(1000);
      startRecording();
    }
  }, 1000);
}

function startRecording() {
  mediaRecorder.start();
  isRecording = true;
  currentStepIndex = 0;
  nextNoteTime = audioContext.currentTime;
  scheduler();
}

function scheduler() {
  // lookahead 100ms
  while (
    nextNoteTime < audioContext.currentTime + 0.1 &&
    currentStepIndex < sequence.length
  ) {
    scheduleStep(sequence[currentStepIndex], nextNoteTime);
    nextNoteTime += sequence[currentStepIndex].duration * (60 / config.bpm);
    currentStepIndex++;
  }

  if (
    currentStepIndex < sequence.length ||
    audioContext.currentTime < nextNoteTime + 1
  ) {
    if (isRecording) {
      requestAnimationFrame(scheduler);
    }
  } else {
    finishRecording();
  }
}

function scheduleStep(step, time) {
  // visuals
  const timeToEvent = (time - audioContext.currentTime) * 1000;

  setTimeout(
    () => {
      updateUI(step);
      // audio cue
      if (step.type === "click") playMetronomeClick(600);
      if (step.type === "release") playMetronomeClick(400);
      if (step.type === "prep") playMetronomeClick(800);
    },
    Math.max(0, timeToEvent),
  );
}

function playMetronomeClick(freq) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.frequency.value = freq;
  gain.gain.value = 0.1;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
  osc.stop(audioContext.currentTime + 0.1);
}

function finishRecording() {
  isRecording = false;
  mediaRecorder.stop();

  // exit fullscreen
  if (document.fullscreenElement) {
    document.exitFullscreen();
  }

  els.recordingOverlay.classList.add("hidden");
  els.recordingOverlay.classList.remove("flex");
  els.resultPanel.classList.remove("hidden");

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: "audio/ogg; codecs=opus" });
    const arrayBuffer = await blob.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    processAudio();
  };
}
async function processAudio() {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const beatDuration = 60 / config.bpm;

  let currentTime = 0;
  const processedEvents = [];
  let noiseBuffer = null;

  window.generatedFiles = [];

  // find peaks in sequence
  sequence.forEach((step) => {
    const duration = step.duration * beatDuration;

    if (step.type === "noise") {
      // noise profile
      const startSample = Math.floor(currentTime * sampleRate);
      const endSample = Math.floor((currentTime + duration) * sampleRate);
      noiseBuffer = channelData.slice(startSample, endSample);
    } else if (step.type === "click" || step.type === "release") {
      const windowStart = currentTime - 0.15; // 150ms before
      const windowEnd = currentTime + 0.4; // 400ms after

      // convert to samples
      const startSample = Math.max(0, Math.floor(windowStart * sampleRate));
      const endSample = Math.min(
        channelData.length,
        Math.floor(windowEnd * sampleRate),
      );

      // find peak in window
      let maxVal = 0;
      let maxIdx = startSample;

      for (let i = startSample; i < endSample; i++) {
        const val = Math.abs(channelData[i]);
        if (val > maxVal) {
          maxVal = val;
          maxIdx = i;
        }
      }

      // missed click threshold
      if (maxVal > 0.01) {
        processedEvents.push({
          step: step,
          peakIndex: maxIdx,
          maxVal: maxVal,
        });
      }
    }

    currentTime += duration;
  });

  // save noise.wav if exists
  if (noiseBuffer) {
    const noiseWav = encodeWAV(noiseBuffer, sampleRate);
    window.generatedFiles.push({ path: "noise.wav", data: noiseWav });
  }

  // process each event and add to ZIP
  for (const event of processedEvents) {
    const step = event.step;
    const peak = event.peakIndex;

    const prePeakSeconds = config.prePeak / 1000;

    // xms before peak, 300ms after
    const start = Math.max(0, peak - Math.floor(prePeakSeconds * sampleRate));
    const end = Math.min(
      channelData.length,
      peak + Math.floor(0.3 * sampleRate),
    );

    let slice = channelData.slice(start, end);

    // run spectral denoiser
    if (config.denoise && noiseBuffer && noiseBuffer.length > 2048) {
      slice = DSP.denoise(slice, noiseBuffer, 1.0);
    }

    if (config.normalize) {
      let maxVal = 0;
      // find peak
      for (let i = 0; i < slice.length; i++) {
        if (Math.abs(slice[i]) > maxVal) {
          maxVal = Math.abs(slice[i]);
        }
      }
      if (maxVal > 0) {
        // normalize to 0db
        const gain = 1.0 / maxVal;
        for (let i = 0; i < slice.length; i++) {
          slice[i] *= gain;
        }
      }
    }

    // fade out
    const fadeLen = Math.floor(0.01 * sampleRate);
    for (let i = 0; i < fadeLen; i++) {
      if (slice.length - 1 - i >= 0) {
        slice[slice.length - 1 - i] *= i / fadeLen;
      }
    }

    // fade in
    for (let i = 0; i < 100; i++) {
      if (i < slice.length) slice[i] *= i / 100;
    }

    const wavBuffer = encodeWAV(slice, sampleRate);

    // add to archive
    let path = "";
    if (config.players > 1) {
      path += `player${step.player}/`;
    }

    const typeInfo = CLICK_TYPES.find((t) => t.id === step.cat);
    const targetFolder =
      step.action === "down" ? typeInfo.folder : typeInfo.relFolder;

    path += `${targetFolder}/${step.index}.wav`;

    window.generatedFiles.push({ path: path, data: wavBuffer });
  }

  els.processingState.classList.add("hidden");
  els.finishedState.classList.remove("hidden");
}

async function downloadZip() {
  const zip = new JSZip();

  if (!window.generatedFiles) {
    return;
  }

  window.generatedFiles.forEach((file) => {
    zip.file(file.path, file.data);
  });

  const content = await zip.generateAsync({ type: "blob" });

  // trigger download
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.packName}.zip`;
  a.click();
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, "RIFF");
  // RIFF chunk length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(view, 8, "WAVE");
  // format chunk identifier
  writeString(view, 12, "fmt ");
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, "data");
  // data chunk length
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);

  return buffer;
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    output.setInt16(offset, s, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
