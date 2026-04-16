let audioContext;
let mediaStream;
let mediaRecorder;
let recordedChunks = [];
let config = {};
let sequence = [];
let currentStepIndex = 0;
let isRecording = false;
let nextNoteTime = 0;
let previewAudio = null;
let previewAudioUrl = null;
let markerIdCounter = 0;
const AUDIO_FILE_PATTERN = /\.(wav|mp3|ogg|flac|m4a|aac|aiff?|opus|webm)$/i;
const CLICK_REGION_STYLE = {
  fill: "linear-gradient(180deg, rgba(56, 189, 248, 0.3) 0%, rgba(34, 211, 238, 0.16) 100%)",
  selectedFill: "linear-gradient(180deg, rgba(125, 211, 252, 0.76) 0%, rgba(34, 211, 238, 0.38) 100%)",
  border: "rgba(103, 232, 249, 0.35)",
  selectedBorder: "rgba(186, 230, 253, 0.95)",
  selectedGlow: "0 0 0 1px rgba(255,255,255,0.1) inset, 0 0 0 1px rgba(125,211,252,0.35), 0 10px 24px rgba(14,165,233,0.22)",
};
const RELEASE_REGION_STYLE = {
  fill: "linear-gradient(180deg, rgba(120, 128, 142, 0.26) 0%, rgba(73, 80, 93, 0.18) 100%)",
  selectedFill: "linear-gradient(180deg, rgba(209, 213, 219, 0.52) 0%, rgba(107, 114, 128, 0.34) 100%)",
  border: "rgba(209, 213, 219, 0.18)",
  selectedBorder: "rgba(243, 244, 246, 0.62)",
  selectedGlow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 0 1px rgba(229,231,235,0.18), 0 10px 24px rgba(15,23,42,0.2)",
};
const RELEASE_REVIEW_STYLE = {
  bg: "rgba(100, 116, 139, 0.16)",
  bgStrong: "rgba(71, 85, 105, 0.28)",
  border: "rgba(148, 163, 184, 0.26)",
  text: "#e5e7eb",
};

const reviewState = {
  sourceKind: "record",
  importedFile: null,
  sourceData: null,
  detectionData: null,
  envelope: null,
  sampleRate: 44100,
  duration: 0,
  noiseProfile: null,
  expectedExports: [],
  markers: [],
  selectedMarkerId: null,
  waveformUrl: null,
  wavesurfer: null,
  regionsPlugin: null,
  regionMap: new Map(),
  zoomPxPerSec: 0,
  panSession: null,
  waveUiCleanup: null,
  suppressWaveClick: false,
  importDefaultsApplied: false,
};

const els = {
  startBtn: document.getElementById("start-btn"),
  configPanel: document.getElementById("config-panel"),
  resultPanel: document.getElementById("result-panel"),
  recordingOverlay: document.getElementById("recording-overlay"),
  vignette: document.getElementById("vignette"),
  visualCue: document.getElementById("visual-cue"),
  innerCue: document.getElementById("inner-cue"),
  instructionMain: document.getElementById("instruction-main"),
  instructionSub: document.getElementById("instruction-sub"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  progressContainer: document.getElementById("progress-container"),
  currentPhase: document.getElementById("current-phase"),
  processingState: document.getElementById("processing-state"),
  processingTitle: document.getElementById("processing-title"),
  processingCopy: document.getElementById("processing-copy"),
  reviewPanel: document.getElementById("review-panel"),
  reviewList: document.getElementById("review-list"),
  downloadBtn: document.getElementById("download-btn"),
  playPauseBtn: document.getElementById("play-pause-btn"),
  addMarkerBtn: document.getElementById("add-marker-btn"),
  deleteMarkerBtn: document.getElementById("delete-marker-btn"),
  waveformViewport: document.getElementById("waveform-viewport"),
  waveform: document.getElementById("waveform"),
  selectionStatus: document.getElementById("selection-status"),
  summaryDetected: document.getElementById("summary-detected"),
  summaryExpected: document.getElementById("summary-expected"),
  summaryMissing: document.getElementById("summary-missing"),
  summaryExtra: document.getElementById("summary-extra"),
  sourceModeInputs: Array.from(document.querySelectorAll('input[name="source-mode"]')),
  importPanel: document.getElementById("import-panel"),
  importFile: document.getElementById("import-file"),
  importFileDisplay: document.getElementById("import-file-display"),
  importDropOverlay: document.getElementById("import-drop-overlay"),
  readmeInput: document.getElementById("pack-readme"),
  bpmGroup: document.getElementById("bpm-group"),
  recordingOptions: document.getElementById("recording-options"),
  recordNoise: document.getElementById("record-noise"),
  normalizeAudio: document.getElementById("normalize-audio"),
  browserDenoiseRow: document.getElementById("browser-denoise-row"),
  adaptiveDenoiseRow: document.getElementById("adaptive-denoise-row"),
  adaptiveDenoise: document.getElementById("adaptive-denoise"),
};

const CLICK_TYPES = [
  { id: "hard", name: "Hard Click", folder: "hardclicks", relFolder: "hardreleases" },
  { id: "normal", name: "Normal Click", folder: "clicks", relFolder: "releases" },
  { id: "soft", name: "Soft Click", folder: "softclicks", relFolder: "softreleases" },
  { id: "micro", name: "Micro Click", folder: "microclicks", relFolder: "microreleases" },
];

const CATEGORY_THEMES = {
  hard: {
    region: "rgba(239, 68, 68, 0.22)",
    regionSelected: "rgba(239, 68, 68, 0.34)",
    waveRegionFill: "linear-gradient(180deg, rgba(239, 68, 68, 0.32) 0%, rgba(127, 29, 29, 0.22) 100%)",
    waveRegionSelectedFill: "linear-gradient(180deg, rgba(248, 113, 113, 0.48) 0%, rgba(153, 27, 27, 0.34) 100%)",
    waveRegionBorder: "rgba(252, 165, 165, 0.55)",
    badge: "rgba(127, 29, 29, 0.75)",
    releaseRegion: "rgba(68, 12, 12, 0.64)",
    releaseRegionSelected: "rgba(48, 8, 8, 0.82)",
    waveReleaseFill: "linear-gradient(180deg, rgba(68, 12, 12, 0.88) 0%, rgba(32, 5, 5, 0.72) 100%)",
    waveReleaseSelectedFill: "linear-gradient(180deg, rgba(82, 14, 14, 0.96) 0%, rgba(24, 4, 4, 0.84) 100%)",
    waveReleaseBorder: "rgba(248, 113, 113, 0.42)",
    releaseBadge: "rgba(32, 5, 5, 0.95)",
    text: "#fee2e2",
  },
  normal: {
    region: "rgba(56, 189, 248, 0.22)",
    regionSelected: "rgba(56, 189, 248, 0.34)",
    waveRegionFill: "linear-gradient(180deg, rgba(56, 189, 248, 0.32) 0%, rgba(8, 145, 178, 0.2) 100%)",
    waveRegionSelectedFill: "linear-gradient(180deg, rgba(103, 232, 249, 0.48) 0%, rgba(14, 116, 144, 0.3) 100%)",
    waveRegionBorder: "rgba(103, 232, 249, 0.52)",
    badge: "rgba(8, 47, 73, 0.75)",
    releaseRegion: "rgba(8, 30, 42, 0.66)",
    releaseRegionSelected: "rgba(5, 20, 31, 0.84)",
    waveReleaseFill: "linear-gradient(180deg, rgba(8, 30, 42, 0.88) 0%, rgba(3, 12, 20, 0.72) 100%)",
    waveReleaseSelectedFill: "linear-gradient(180deg, rgba(10, 40, 56, 0.96) 0%, rgba(2, 10, 17, 0.84) 100%)",
    waveReleaseBorder: "rgba(56, 189, 248, 0.36)",
    releaseBadge: "rgba(3, 12, 20, 0.96)",
    text: "#ecfeff",
  },
  soft: {
    region: "rgba(245, 158, 11, 0.22)",
    regionSelected: "rgba(245, 158, 11, 0.34)",
    waveRegionFill: "linear-gradient(180deg, rgba(245, 158, 11, 0.32) 0%, rgba(180, 83, 9, 0.22) 100%)",
    waveRegionSelectedFill: "linear-gradient(180deg, rgba(251, 191, 36, 0.46) 0%, rgba(194, 65, 12, 0.3) 100%)",
    waveRegionBorder: "rgba(253, 230, 138, 0.5)",
    badge: "rgba(120, 53, 15, 0.75)",
    releaseRegion: "rgba(84, 39, 10, 0.66)",
    releaseRegionSelected: "rgba(61, 26, 6, 0.84)",
    waveReleaseFill: "linear-gradient(180deg, rgba(84, 39, 10, 0.88) 0%, rgba(37, 16, 3, 0.72) 100%)",
    waveReleaseSelectedFill: "linear-gradient(180deg, rgba(99, 44, 9, 0.96) 0%, rgba(29, 12, 2, 0.84) 100%)",
    waveReleaseBorder: "rgba(251, 191, 36, 0.34)",
    releaseBadge: "rgba(37, 16, 3, 0.95)",
    text: "#fffbeb",
  },
  micro: {
    region: "rgba(16, 185, 129, 0.22)",
    regionSelected: "rgba(16, 185, 129, 0.34)",
    waveRegionFill: "linear-gradient(180deg, rgba(16, 185, 129, 0.32) 0%, rgba(5, 150, 105, 0.22) 100%)",
    waveRegionSelectedFill: "linear-gradient(180deg, rgba(52, 211, 153, 0.46) 0%, rgba(4, 120, 87, 0.3) 100%)",
    waveRegionBorder: "rgba(110, 231, 183, 0.5)",
    badge: "rgba(6, 78, 59, 0.75)",
    releaseRegion: "rgba(3, 54, 41, 0.66)",
    releaseRegionSelected: "rgba(2, 36, 28, 0.84)",
    waveReleaseFill: "linear-gradient(180deg, rgba(3, 54, 41, 0.88) 0%, rgba(1, 21, 17, 0.72) 100%)",
    waveReleaseSelectedFill: "linear-gradient(180deg, rgba(4, 66, 49, 0.96) 0%, rgba(1, 17, 13, 0.84) 100%)",
    waveReleaseBorder: "rgba(52, 211, 153, 0.34)",
    releaseBadge: "rgba(1, 21, 17, 0.95)",
    text: "#ecfdf5",
  },
};

els.startBtn.addEventListener("click", startSession);
els.downloadBtn.addEventListener("click", downloadZip);
els.playPauseBtn.addEventListener("click", toggleWaveformPlayback);
els.addMarkerBtn.addEventListener("click", addMarkerAtCursor);
els.deleteMarkerBtn.addEventListener("click", deleteSelectedMarker);
els.importFile.addEventListener("change", handleImportFileChange);
els.recordNoise.addEventListener("change", syncSourceModeUI);
document.addEventListener("keydown", handleGlobalReviewKeydown);
els.sourceModeInputs.forEach((input) =>
  input.addEventListener("change", syncSourceModeUI),
);

syncSourceModeUI();
bindWaveformViewportInteractions();
bindImportDragOverlay();

function bindWaveformViewportInteractions() {
  const viewport = els.waveformViewport;
  if (!viewport) return;

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (!reviewState.wavesurfer) return;

      if (event.ctrlKey) {
        event.preventDefault();
        const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        const anchorPoint = getWaveformPointerPosition(event);
        setWaveformZoom(reviewState.zoomPxPerSec * zoomFactor, anchorPoint.time, anchorPoint.ratio);
        return;
      }

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;

      if (delta !== 0) {
        event.preventDefault();
        const currentScroll = reviewState.wavesurfer.getScroll
          ? reviewState.wavesurfer.getScroll()
          : 0;
        reviewState.wavesurfer.setScroll(currentScroll + delta);
      }
    },
    { passive: false },
  );
}

function isRegionInteraction(event) {
  return event
    .composedPath()
    .some((node) => {
      if (!(node instanceof Element)) return false;
      const part = node.getAttribute("part");
      return part?.includes("region");
    });
}

function getSourceMode() {
  return document.querySelector('input[name="source-mode"]:checked').value;
}

function syncSourceModeUI() {
  const sourceMode = getSourceMode();
  const isImport = sourceMode === "import";
  reviewState.sourceKind = sourceMode;

  if (isImport && !reviewState.importDefaultsApplied) {
    applyImportDefaults();
    reviewState.importDefaultsApplied = true;
  }

  els.importPanel.classList.toggle("hidden", !isImport);
  els.bpmGroup.classList.toggle("opacity-50", isImport);
  els.recordingOptions.classList.toggle("opacity-50", isImport);

  document.getElementById("bpm").disabled = isImport;
  document.getElementById("mute-metronome").disabled = isImport;
  els.recordNoise.disabled = isImport;

  if (isImport) {
    els.recordNoise.checked = false;
  }

  const browserRadio = document.querySelector('input[name="denoise-mode"][value="browser"]');
  const adaptiveRadio = els.adaptiveDenoise;
  const noneRadio = document.querySelector('input[name="denoise-mode"][value="none"]');
  const selectedDenoise = document.querySelector('input[name="denoise-mode"]:checked');

  const browserAvailable = !isImport;
  const adaptiveAvailable = !isImport && els.recordNoise.checked;

  browserRadio.disabled = !browserAvailable;
  adaptiveRadio.disabled = !adaptiveAvailable;
  els.browserDenoiseRow.classList.toggle("opacity-50", !browserAvailable);
  els.browserDenoiseRow.classList.toggle("pointer-events-none", !browserAvailable);
  els.adaptiveDenoiseRow.classList.toggle("opacity-50", !adaptiveAvailable);
  els.adaptiveDenoiseRow.classList.toggle("pointer-events-none", !adaptiveAvailable);

  if (
    selectedDenoise &&
    ((selectedDenoise.value === "browser" && !browserAvailable) ||
      (selectedDenoise.value === "adaptive" && !adaptiveAvailable))
  ) {
    noneRadio.checked = true;
  }

  els.startBtn.innerHTML = isImport
    ? `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>Analyze Imported Audio`
    : `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>Start Recording`;
}

function applyImportDefaults() {
  document.getElementById("count-hard").value = "0";
  document.getElementById("count-normal").value = "10";
  document.getElementById("count-soft").value = "0";
  document.getElementById("count-micro").value = "0";
}

function handleImportFileChangeLegacy(event) {
  const file = event.target.files?.[0] || null;
  reviewState.importedFile = file;
  els.importFileDisplay.textContent = file
    ? `${file.name} • ${(file.size / (1024 * 1024)).toFixed(2)} MB`
    : "No audio selected";
}

function readConfig() {
  return {
    packName: document.getElementById("pack-name").value.trim() || "Clickpack",
    readme: els.readmeInput?.value || "",
    sourceMode: getSourceMode(),
    players: parseInt(document.getElementById("num-players").value, 10),
    bpm: parseInt(document.getElementById("bpm").value, 10) || 50,
    transientPadMs: parseFloat(document.getElementById("transient-pad").value) || 1.5,
    recordNoise: els.recordNoise.checked,
    normalize: els.normalizeAudio.checked,
    denoiseMode: document.querySelector('input[name="denoise-mode"]:checked').value,
    muteMetronome: document.getElementById("mute-metronome").checked,
    counts: {
      hard: parseInt(document.getElementById("count-hard").value, 10) || 0,
      normal: parseInt(document.getElementById("count-normal").value, 10) || 0,
      soft: parseInt(document.getElementById("count-soft").value, 10) || 0,
      micro: parseInt(document.getElementById("count-micro").value, 10) || 0,
    },
  };
}

function handleImportFileChange(event) {
  const file = event.target.files?.[0] || null;
  setImportedFile(file);
}

function bindImportDragOverlay() {
  if (!els.importDropOverlay) return;

  let dragDepth = 0;

  const handleDragEnter = (event) => {
    if (!canAcceptDroppedImport() || !eventHasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    showImportDropOverlay();
  };

  const handleDragOver = (event) => {
    if (!canAcceptDroppedImport() || !eventHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    showImportDropOverlay();
  };

  const handleDragLeave = (event) => {
    if (!eventHasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      hideImportDropOverlay();
    }
  };

  const handleDrop = (event) => {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    hideImportDropOverlay();

    const files = Array.from(event.dataTransfer?.files || []);
    const audioFile = files.find(isAudioFile);
    if (!audioFile) return;

    stopPreviewAudio();
    showConfig();
    switchToImportMode();
    setImportedFile(audioFile);
  };

  window.addEventListener("dragenter", handleDragEnter);
  window.addEventListener("dragover", handleDragOver);
  window.addEventListener("dragleave", handleDragLeave);
  window.addEventListener("drop", handleDrop);
  window.addEventListener("dragend", () => {
    dragDepth = 0;
    hideImportDropOverlay();
  });
  window.addEventListener("blur", () => {
    dragDepth = 0;
    hideImportDropOverlay();
  });
}

function canAcceptDroppedImport() {
  return els.recordingOverlay?.classList.contains("hidden");
}

function eventHasFiles(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  if (types.includes("Files")) return true;
  return Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file");
}

function isAudioFile(file) {
  if (!file) return false;
  if (typeof file.type === "string" && file.type.startsWith("audio/")) {
    return true;
  }
  return AUDIO_FILE_PATTERN.test(file.name || "");
}

function showImportDropOverlay() {
  els.importDropOverlay?.classList.remove("hidden");
  els.importDropOverlay?.classList.add("flex");
}

function hideImportDropOverlay() {
  els.importDropOverlay?.classList.add("hidden");
  els.importDropOverlay?.classList.remove("flex");
}

function switchToImportMode() {
  const importModeInput = els.sourceModeInputs.find((input) => input.value === "import");
  if (!importModeInput) return;

  if (!importModeInput.checked) {
    importModeInput.checked = true;
  }

  syncSourceModeUI();
}

function setImportedFile(file) {
  reviewState.importedFile = file;
  els.importFileDisplay.textContent = file
    ? `${file.name} - ${(file.size / (1024 * 1024)).toFixed(2)} MB`
    : "No audio selected";

  if (!els.importFile) return;

  if (!file) {
    els.importFile.value = "";
    return;
  }

  if (typeof DataTransfer !== "function") return;

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    els.importFile.files = transfer.files;
  } catch (error) {
    console.warn("Could not mirror dropped file into the file input.", error);
  }
}

async function startSession() {
  config = readConfig();
  buildSequence();
  reviewState.expectedExports = buildExpectedExports();

  if (reviewState.expectedExports.length === 0) {
    alert("Please configure at least one click so Packmak has something to export.");
    return;
  }

  stopPreviewAudio();
  destroyWaveform();

  if (config.sourceMode === "import") {
    if (!reviewState.importedFile) {
      alert("Choose an audio file to import first.");
      return;
    }

    showProcessing("Importing Audio", "Decoding the file and detecting click regions...");

    try {
      await ensureAudioContext();
      const bytes = await reviewState.importedFile.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(bytes.slice(0));
      await processAudioBuffer(decoded, "import");
    } catch (error) {
      console.error(error);
      alert("Could not decode that audio file. Try WAV, MP3, FLAC, or OGG.");
      showConfig();
    }
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: config.denoiseMode === "browser",
        autoGainControl: false,
      },
    });
  } catch (error) {
    alert("Microphone access was denied.");
    return;
  }

  await ensureAudioContext();
  mediaRecorder = new MediaRecorder(mediaStream);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };

  els.configPanel.classList.add("hidden");
  els.resultPanel.classList.add("hidden");
  els.recordingOverlay.classList.remove("hidden");
  els.recordingOverlay.classList.add("flex");

  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.log("Fullscreen denied");
  }

  renderProgressMarkers();
  startCountdown();
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function showConfig() {
  els.resultPanel.classList.add("hidden");
  els.reviewPanel.classList.add("hidden");
  els.processingState.classList.remove("hidden");
  els.configPanel.classList.remove("hidden");
}

function showProcessing(title, copy) {
  els.configPanel.classList.add("hidden");
  els.resultPanel.classList.remove("hidden");
  els.processingState.classList.remove("hidden");
  els.reviewPanel.classList.add("hidden");
  els.processingTitle.textContent = title;
  els.processingCopy.textContent = copy;
}

function buildSequence() {
  sequence = [];
  const beatDuration = 60 / config.bpm;

  if (config.recordNoise) {
    sequence.push({
      type: "prep",
      text: "Noise",
      sub: "Prepare to stay silent for 5 seconds...",
      duration: 2,
    });

    sequence.push({
      type: "noise",
      text: "RECORDING NOISE",
      sub: "Stay silent for the cleanup profile.",
      duration: Math.ceil(5 / beatDuration),
    });
  }

  for (let player = 1; player <= config.players; player++) {
    const playerPrefix = config.players > 1 ? `Player ${player}: ` : "";

    CLICK_TYPES.forEach((type) => {
      const count = config.counts[type.id];
      if (count <= 0) return;

      sequence.push({
        type: "prep",
        text: `${playerPrefix}${type.name}s`,
        sub: `Get ready for ${count} clicks...`,
        duration: 2,
      });

      for (let index = 1; index <= count; index++) {
        sequence.push({
          type: "click",
          cat: type.id,
          player,
          index,
          action: "down",
          text: "CLICK",
          sub: `${playerPrefix}${type.name} ${index}/${count}`,
          duration: 1,
        });

        sequence.push({
          type: "release",
          cat: type.id,
          player,
          index,
          action: "up",
          text: "RELEASE",
          sub: `${playerPrefix}${type.name} ${index}/${count}`,
          duration: 1,
        });
      }
    });
  }
}

function buildExpectedExports() {
  const expected = [];

  sequence.forEach((step) => {
    if (step.type !== "click" && step.type !== "release") return;

    expected.push({
      category: step.cat,
      action: step.action,
      player: step.player,
      index: step.index,
      path: buildPackPath(step.cat, step.action, step.player, step.index),
      label: `${getClickType(step.cat).name} ${step.action === "down" ? "Down" : "Release"} ${step.index}`,
    });
  });

  return expected;
}

function getClickType(categoryId) {
  return CLICK_TYPES.find((type) => type.id === categoryId) || CLICK_TYPES[1];
}

function buildPackPath(categoryId, action, player, index) {
  const typeInfo = getClickType(categoryId);
  const targetFolder = action === "down" ? typeInfo.folder : typeInfo.relFolder;
  let path = "";

  if (config.players > 1) {
    path += `player${player}/`;
  }

  path += `${targetFolder}/${index}.wav`;
  return path;
}

function renderProgressMarkers() {
  const existing = els.progressContainer.querySelectorAll(".progress-marker");
  existing.forEach((marker) => marker.remove());

  sequence.forEach((step, index) => {
    if (step.type !== "prep") return;

    const left = (index / sequence.length) * 100;
    const marker = document.createElement("div");
    marker.className =
      "progress-marker absolute top-0 bottom-0 w-0.5 bg-white/50 z-20";
    marker.style.left = `${left}%`;

    const label = document.createElement("div");
    label.className =
      "progress-marker absolute -top-6 text-[10px] text-gray-400 font-mono transform whitespace-nowrap";
    label.style.left = `${left}%`;
    label.textContent = step.text.replace("Player 1: ", "").replace("Player 2: ", "");

    els.progressContainer.appendChild(marker);
    els.progressContainer.appendChild(label);
  });
}

function startCountdown() {
  let count = 3;
  els.instructionMain.textContent = String(count);
  els.instructionSub.textContent = "Lock in...";

  const countdown = setInterval(() => {
    count--;
    if (count > 0) {
      els.instructionMain.textContent = String(count);
      playMetronomeClick(800);
      return;
    }

    clearInterval(countdown);
    els.instructionMain.textContent = "GO!";
    playMetronomeClick(1000);
    startRecording();
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
    audioContext.currentTime < nextNoteTime + 0.75
  ) {
    if (isRecording) requestAnimationFrame(scheduler);
  } else {
    finishRecording();
  }
}

function scheduleStep(step, time) {
  const timeToEvent = (time - audioContext.currentTime) * 1000;
  setTimeout(() => {
    updateRecordingUI(step);
    if (step.type === "click") playMetronomeClick(600);
    if (step.type === "release") playMetronomeClick(420);
    if (step.type === "prep") playMetronomeClick(800);
  }, Math.max(0, timeToEvent));
}

function updateRecordingUI(step) {
  els.instructionMain.textContent = step.text;
  els.instructionSub.textContent = step.sub;
  els.progressText.textContent = `${currentStepIndex + 1}/${sequence.length}`;
  els.progressBar.style.width = `${(currentStepIndex / sequence.length) * 100}%`;
  els.currentPhase.textContent = "Recording";

  els.vignette.className =
    "absolute inset-0 pointer-events-none vignette-overlay transition-colors duration-200";
  els.visualCue.classList.remove("scale-110", "scale-90");
  void els.visualCue.offsetWidth;

  if (step.type === "click") {
    els.vignette.classList.add("vignette-click");
    els.visualCue.classList.add("scale-110");
    els.innerCue.style.backgroundColor = "#0ea5e9";
  } else if (step.type === "release") {
    els.vignette.classList.add("vignette-release");
    els.visualCue.classList.add("scale-90");
    els.innerCue.style.backgroundColor = "#f59e0b";
  } else if (step.type === "noise") {
    els.vignette.classList.add("vignette-prepare");
    els.innerCue.style.backgroundColor = "#ef4444";
  } else {
    els.vignette.classList.add("vignette-prepare");
    els.innerCue.style.backgroundColor = "#eab308";
  }
}

function playMetronomeClick(freq) {
  if (config.muteMetronome || !audioContext) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  osc.stop(audioContext.currentTime + 0.08);
}

function finishRecording() {
  isRecording = false;

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  els.recordingOverlay.classList.add("hidden");
  els.recordingOverlay.classList.remove("flex");
  showProcessing("Processing Recording", "Analyzing click onsets and building editable regions...");

  mediaRecorder.onstop = async () => {
    try {
      const mimeType = recordedChunks[0]?.type || mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      await processAudioBuffer(decoded, "record");
    } catch (error) {
      console.error(error);
      alert("Recording finished, but the browser could not decode the captured audio.");
      showConfig();
    } finally {
      stopMediaStream();
    }
  };

  mediaRecorder.stop();
}

function stopMediaStream() {
  if (!mediaStream) return;
  mediaStream.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

async function processAudioBuffer(buffer, sourceKind) {
  const monoData = mixToMono(buffer);
  const sampleRate = buffer.sampleRate;
  const detectionData = DSP.highpass(DSP.removeDC(monoData), sampleRate, 90);
  const envelope = buildEnvelope(detectionData, sampleRate);

  reviewState.sourceKind = sourceKind;
  reviewState.sourceData = monoData;
  reviewState.detectionData = detectionData;
  reviewState.envelope = envelope;
  reviewState.sampleRate = sampleRate;
  reviewState.duration = monoData.length / sampleRate;
  reviewState.selectedMarkerId = null;

  const detection =
    sourceKind === "record"
      ? detectGuidedMarkers(monoData, sampleRate)
      : detectImportedMarkers(monoData, envelope, sampleRate, reviewState.expectedExports.length);

  reviewState.markers = detection.markers;
  reviewState.noiseProfile = detection.noiseRange
    ? monoData.slice(detection.noiseRange.start, detection.noiseRange.end)
    : null;

  await createWaveformPreview(monoData, sampleRate);
  els.processingState.classList.add("hidden");
  els.reviewPanel.classList.remove("hidden");

  renderReviewList();
  syncWaveformRegions();
}

function mixToMono(buffer) {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      mono[i] += channelData[i] / buffer.numberOfChannels;
    }
  }
  return mono;
}

function buildEnvelope(samples, sampleRate) {
  const envelope = new Float32Array(samples.length);
  let current = 0;
  const attack = Math.exp(-1 / (sampleRate * 0.00025));
  const release = Math.exp(-1 / (sampleRate * 0.004));

  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]);
    const coeff = value > current ? attack : release;
    current = coeff * current + (1 - coeff) * value;
    envelope[i] = current;
  }

  return envelope;
}

function detectGuidedMarkers(samples, sampleRate) {
  const beatDuration = 60 / config.bpm;
  const markers = [];
  let currentTime = 0;
  let noiseRange = null;

  sequence.forEach((step) => {
    const duration = step.duration * beatDuration;

    if (step.type === "noise") {
      noiseRange = {
        start: Math.max(0, Math.floor(currentTime * sampleRate)),
        end: Math.min(samples.length, Math.floor((currentTime + duration) * sampleRate)),
      };
    }

    if (step.type === "click" || step.type === "release") {
      const windowStart = config.muteMetronome ? currentTime - 0.15 : currentTime + 0.11;
      const windowEnd = currentTime + 0.5;
      const startSample = Math.max(0, Math.floor(windowStart * sampleRate));
      const endSample = Math.min(samples.length, Math.floor(windowEnd * sampleRate));
      const peakIndex = findPeakInRange(samples, startSample, endSample, 0.001);

      if (peakIndex !== null) {
        markers.push(
          createPeakMarker(
            samples,
            peakIndex,
            config.muteMetronome ? 0 : startSample,
            sampleRate,
            "auto",
            step.cat,
          ),
        );
      }
    }

    currentTime += duration;
  });

  return {
    markers: finalizeMarkers(markers),
    noiseRange,
  };
}

function detectImportedMarkers(samples, envelope, sampleRate, expectedCount) {
  const peakReference = percentileFromRange(
    Float32Array.from(samples, (value) => Math.abs(value)),
    0,
    samples.length,
    0.998,
  );
  let threshold = Math.max(peakReference * 0.18, 0.008);
  let peaks = findImportedPeaks(samples, threshold, sampleRate);

  for (let attempt = 0; attempt < 8 && expectedCount > 0; attempt++) {
    if (peaks.length > expectedCount * 1.2) {
      threshold *= 1.15;
      peaks = findImportedPeaks(samples, threshold, sampleRate);
      continue;
    }

    if (peaks.length < expectedCount * 0.8 && threshold > 0.0025) {
      threshold *= 0.88;
      peaks = findImportedPeaks(samples, threshold, sampleRate);
      continue;
    }

    break;
  }

  peaks = collapseImportedDecayPeaks(peaks, envelope, sampleRate);

  const markers = peaks.map((peakIndex) =>
    createPeakMarker(samples, peakIndex, 0, sampleRate, "auto"),
  );

  return {
    markers: finalizeMarkers(markers),
    noiseRange: null,
  };
}

function findImportedPeaks(samples, threshold, sampleRate) {
  const peaks = [];
  const minGap = Math.max(1, Math.floor(sampleRate * 0.045));
  const lookahead = Math.max(1, Math.floor(sampleRate * 0.018));
  let lastPeak = -minGap;

  for (let i = 1; i < samples.length - 1; i++) {
    const current = Math.abs(samples[i]);
    if (current < threshold) continue;

    if (current < Math.abs(samples[i - 1]) || current < Math.abs(samples[i + 1])) {
      continue;
    }

    let peakIndex = i;
    const limit = Math.min(samples.length, i + lookahead);
    for (let j = i; j < limit; j++) {
      if (Math.abs(samples[j]) > Math.abs(samples[peakIndex])) {
        peakIndex = j;
      }
    }

    if (peakIndex - lastPeak >= minGap) {
      peaks.push(peakIndex);
      lastPeak = peakIndex;
    } else if (peaks.length && Math.abs(samples[peakIndex]) > Math.abs(samples[peaks[peaks.length - 1]])) {
      peaks[peaks.length - 1] = peakIndex;
      lastPeak = peakIndex;
    }

    i = peakIndex + Math.floor(sampleRate * 0.01);
  }

  return peaks;
}

function collapseImportedDecayPeaks(peaks, envelope, sampleRate) {
  if (peaks.length < 2) return peaks;

  const merged = [peaks[0]];
  const noiseFloor = percentileFromRange(envelope, 0, envelope.length, 0.35);

  for (let i = 1; i < peaks.length; i++) {
    const currentPeak = peaks[i];
    const previousPeak = merged[merged.length - 1];
    const gapSeconds = (currentPeak - previousPeak) / sampleRate;
    const previousStrength = envelope[previousPeak] || 0;
    const currentStrength = envelope[currentPeak] || 0;
    const valley = getMinValueInRange(envelope, previousPeak, currentPeak);
    const quietGapThreshold = Math.max(
      noiseFloor * 2.4,
      Math.min(previousStrength, currentStrength) * 0.1,
    );
    const hasQuietGap = valley < quietGapThreshold;

    const continuousDecay =
      gapSeconds < 0.24 &&
      !hasQuietGap &&
      currentStrength < previousStrength * 0.9;

    const rapidDuplicate =
      gapSeconds < 0.08 &&
      currentStrength <= previousStrength * 1.2;

    if (continuousDecay || rapidDuplicate) {
      continue;
    }

    merged.push(currentPeak);
  }

  return merged;
}

function getMinValueInRange(values, startIndex, endIndex) {
  const start = clamp(Math.floor(startIndex), 0, values.length - 1);
  const end = clamp(Math.floor(endIndex), start + 1, values.length);
  let min = values[start];

  for (let i = start; i < end; i++) {
    if (values[i] < min) {
      min = values[i];
    }
  }

  return min;
}

function findPeakInRange(samples, startSample, endSample, threshold) {
  const clampedStart = clamp(startSample, 0, samples.length - 1);
  const clampedEnd = clamp(endSample, clampedStart + 1, samples.length);
  let maxValue = 0;
  let maxIndex = clampedStart;

  for (let i = clampedStart; i < clampedEnd; i++) {
    const value = Math.abs(samples[i]);
    if (value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }

  return maxValue > threshold ? maxIndex : null;
}

function createPeakMarker(samples, peakIndex, minStartSample, sampleRate, source, category = null) {
  const prePeakSamples = Math.floor((config.transientPadMs / 1000) * sampleRate);
  const start = Math.max(minStartSample, peakIndex - prePeakSamples);
  const end = Math.min(samples.length, peakIndex + Math.floor(0.3 * sampleRate));

  return {
    id: nextMarkerId(),
    start: start / sampleRate,
    end: end / sampleRate,
    peak: peakIndex / sampleRate,
    peakStrength: Math.abs(samples[peakIndex]) || 0,
    category,
    source,
  };
}

function detectWindowTransient(samples, envelope, startSample, endSample) {
  if (endSample <= startSample) return null;

  const clampedStart = clamp(startSample, 0, envelope.length - 1);
  const clampedEnd = clamp(endSample, clampedStart + 1, envelope.length);

  let peakIndex = clampedStart;
  let peakValue = 0;

  for (let i = clampedStart; i < clampedEnd; i++) {
    if (envelope[i] > peakValue) {
      peakValue = envelope[i];
      peakIndex = i;
    }
  }

  const localFloor = percentileFromRange(
    envelope,
    clampedStart,
    Math.min(clampedEnd, clampedStart + Math.floor(reviewState.sampleRate * 0.05)),
    0.3,
  );

  if (peakValue < Math.max(localFloor * 3.2, 0.0011)) {
    return null;
  }

  return { peakIndex, peakValue };
}

function createMarkerFromPeak(samples, envelope, sampleRate, peakIndex, minIndex, maxIndex, source) {
  const startIndex = Math.max(
    minIndex,
    findTransientStart(samples, envelope, peakIndex, minIndex, sampleRate) -
      Math.floor((config.transientPadMs / 1000) * sampleRate),
  );

  const endIndex = Math.min(
    maxIndex,
    findTransientEnd(samples, envelope, peakIndex, maxIndex, sampleRate) +
      Math.floor(sampleRate * 0.008),
  );

  const safeEnd = Math.max(endIndex, startIndex + Math.floor(sampleRate * 0.012));

  return {
    id: nextMarkerId(),
    start: startIndex / sampleRate,
    end: safeEnd / sampleRate,
    peak: peakIndex / sampleRate,
    peakStrength: envelope[peakIndex] || 0,
    source,
  };
}

function findTransientStart(samples, envelope, peakIndex, minIndex, sampleRate) {
  const scanStart = Math.max(minIndex, peakIndex - Math.floor(sampleRate * 0.03));
  const localFloor = percentileFromRange(envelope, scanStart, peakIndex, 0.25);
  const threshold = Math.max(localFloor * 2.2, envelope[peakIndex] * 0.08, 0.0005);
  const quietSpan = Math.max(4, Math.floor(sampleRate * 0.0008));
  let best = Math.max(scanStart, peakIndex - Math.floor(sampleRate * 0.003));

  for (let i = peakIndex; i >= scanStart + quietSpan; i--) {
    let quiet = true;
    for (let j = 0; j < quietSpan; j++) {
      if (envelope[i - j] > threshold) {
        quiet = false;
        break;
      }
    }
    if (quiet) {
      best = i;
      break;
    }
  }

  return snapToZeroCrossing(samples, best, -1, minIndex);
}

function findTransientEnd(samples, envelope, peakIndex, maxIndex, sampleRate) {
  const searchStart = Math.min(maxIndex, peakIndex + Math.floor(sampleRate * 0.012));
  const searchEnd = Math.min(maxIndex, peakIndex + Math.floor(sampleRate * 0.18));
  const localFloor = percentileFromRange(envelope, peakIndex, searchEnd, 0.35);
  const threshold = Math.max(localFloor * 1.8, envelope[peakIndex] * 0.05, 0.00035);
  const quietSpan = Math.max(6, Math.floor(sampleRate * 0.0016));
  let best = Math.min(searchEnd, peakIndex + Math.floor(sampleRate * 0.05));

  for (let i = searchStart; i <= searchEnd - quietSpan; i++) {
    let quiet = true;
    for (let j = 0; j < quietSpan; j++) {
      if (envelope[i + j] > threshold) {
        quiet = false;
        break;
      }
    }
    if (quiet) {
      best = i;
      break;
    }
  }

  return snapToZeroCrossing(samples, best, 1, maxIndex);
}

function snapToZeroCrossing(samples, startIndex, direction, limit) {
  let bestIndex = clamp(startIndex, 0, samples.length - 1);
  let bestAbs = Math.abs(samples[bestIndex]) || Infinity;
  const maxSearch = 160;

  for (let step = 0; step < maxSearch; step++) {
    const current = startIndex + step * direction;
    if (direction < 0 && current < limit) break;
    if (direction > 0 && current > limit) break;
    if (current <= 0 || current >= samples.length) break;

    const prev = current - direction;
    const abs = Math.abs(samples[current]);
    if (abs < bestAbs) {
      bestAbs = abs;
      bestIndex = current;
    }

    if (samples[current] === 0 || samples[current] * samples[prev] <= 0) {
      return current;
    }
  }

  return bestIndex;
}

function finalizeMarkers(markers) {
  const sorted = [...markers].sort((a, b) => a.start - b.start);
  const minDuration = 0.012;

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    current.start = clamp(current.start, 0, reviewState.duration);
    current.end = clamp(current.end, current.start + minDuration, reviewState.duration);

    if (i === 0) continue;

    const prev = sorted[i - 1];
    if (current.start < prev.end) {
      const midpoint = (current.start + prev.end) / 2;
      prev.end = clamp(midpoint - 0.001, prev.start + minDuration, reviewState.duration);
      current.start = clamp(midpoint + 0.001, 0, current.end - minDuration);
      current.end = clamp(current.end, current.start + minDuration, reviewState.duration);
    }
  }

  return sorted;
}

function percentileFromRange(data, start, end, percentile) {
  const from = clamp(Math.floor(start), 0, data.length);
  const to = clamp(Math.floor(end), from + 1, data.length);
  const values = [];
  const step = Math.max(1, Math.floor((to - from) / 2048));

  for (let i = from; i < to; i += step) {
    values.push(data[i]);
  }

  values.sort((a, b) => a - b);
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((values.length - 1) * percentile)),
  );

  return values[index] || 0;
}

function nextMarkerId() {
  markerIdCounter += 1;
  return `marker-${markerIdCounter}`;
}

async function createWaveformPreview(monoData, sampleRate) {
  destroyWaveform();

  const wavBuffer = encodeWAV(monoData, sampleRate);
  reviewState.waveformUrl = URL.createObjectURL(new Blob([wavBuffer], { type: "audio/wav" }));
  reviewState.zoomPxPerSec = getInitialZoomPxPerSec();

  if (!window.WaveSurfer || !window.WaveSurfer.Regions) {
    return;
  }

  reviewState.regionsPlugin = window.WaveSurfer.Regions.create();
  reviewState.wavesurfer = window.WaveSurfer.create({
    container: els.waveform,
    url: reviewState.waveformUrl,
    height: 240,
    waveColor: "#67e8f9",
    progressColor: "#f59e0b",
    cursorColor: "#ffffff",
    minPxPerSec: reviewState.zoomPxPerSec,
    fillParent: false,
    dragToSeek: false,
    autoScroll: true,
    autoCenter: false,
    normalize: true,
    plugins: [reviewState.regionsPlugin],
  });

  if (typeof reviewState.regionsPlugin.on === "function") {
    reviewState.regionsPlugin.on("region-clicked", (region, event) => {
      if (event?.stopPropagation) event.stopPropagation();
      selectMarker(region.id, true);
    });
  }

  reviewState.wavesurfer.on("ready", () => {
    bindWaveformUi();
    syncWaveformRegions();
    updatePlaybackLabel();
  });

  reviewState.wavesurfer.on("play", updatePlaybackLabel);
  reviewState.wavesurfer.on("pause", updatePlaybackLabel);
  reviewState.wavesurfer.on("finish", updatePlaybackLabel);
}

function destroyWaveform() {
  if (typeof reviewState.waveUiCleanup === "function") {
    reviewState.waveUiCleanup();
    reviewState.waveUiCleanup = null;
  }

  if (reviewState.wavesurfer) {
    reviewState.wavesurfer.destroy();
    reviewState.wavesurfer = null;
  }

  reviewState.panSession = null;
  els.waveformViewport?.classList.remove("is-panning");
  reviewState.regionMap.clear();
  reviewState.regionsPlugin = null;
  els.waveform.innerHTML = "";

  if (reviewState.waveformUrl) {
    URL.revokeObjectURL(reviewState.waveformUrl);
    reviewState.waveformUrl = null;
  }
}

function syncWaveformRegions() {
  if (!reviewState.regionsPlugin) return;

  reviewState.regionMap.forEach((region) => region.remove());
  reviewState.regionMap.clear();

  getSortedMarkers().forEach((marker, index) => {
    const assignment = getMarkerAssignment(index, marker);
    const theme = getCategoryTheme(getMarkerCategory(index, marker));
    const isRelease = assignment.action === "up";
    const isSelected = marker.id === reviewState.selectedMarkerId;
    const region = reviewState.regionsPlugin.addRegion({
      id: marker.id,
      start: marker.start,
      end: marker.end,
      drag: true,
      resize: true,
      color: isSelected
        ? (isRelease ? theme.releaseRegionSelected : theme.regionSelected)
        : (isRelease ? theme.releaseRegion : theme.region),
      content: buildRegionBadge(index + 1, assignment.extra, theme, isRelease),
    });

    styleWaveformRegion(region, theme, isRelease, isSelected);
    bindRegionEvents(region);
    reviewState.regionMap.set(marker.id, region);
  });
}

function styleWaveformRegion(region, theme, isRelease, isSelected, attempt = 0) {
  const element = region?.element;
  if (!element) {
    if (attempt >= 3) return;
    requestAnimationFrame(() => styleWaveformRegion(region, theme, isRelease, isSelected, attempt + 1));
    return;
  }

  const palette = isRelease ? RELEASE_REGION_STYLE : CLICK_REGION_STYLE;
  element.style.setProperty("border-radius", "0.6rem", "important");
  element.style.setProperty(
    "border",
    `1px solid ${isSelected ? palette.selectedBorder : palette.border}`,
    "important",
  );
  element.style.setProperty(
    "background",
    isSelected ? palette.selectedFill : palette.fill,
    "important",
  );
  element.style.setProperty(
    "box-shadow",
    isSelected
      ? palette.selectedGlow
      : "0 0 0 1px rgba(255,255,255,0.04) inset",
    "important",
  );
}

function buildRegionBadge(index, isExtra, theme, isRelease) {
  const badge = document.createElement("span");
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.justifyContent = "center";
  badge.style.minWidth = "24px";
  badge.style.height = "24px";
  badge.style.padding = "0 8px";
  badge.style.borderRadius = "999px";
  badge.style.pointerEvents = "none";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "700";
  badge.style.fontFamily = "JetBrains Mono, monospace";
  badge.style.color = isExtra ? "#fde68a" : theme.text;
  badge.style.background = isExtra
    ? "rgba(245,158,11,0.2)"
    : (isRelease ? theme.releaseBadge : theme.badge);
  badge.textContent = String(index);
  return badge;
}

function bindRegionEvents(region) {
  if (!region || typeof region.on !== "function") return;

  region.on("click", (event) => {
    if (event?.stopPropagation) event.stopPropagation();
    selectMarker(region.id, true);
  });

  region.on("update-end", () => syncMarkerFromRegion(region));
}

function syncMarkerFromRegion(region) {
  const marker = reviewState.markers.find((item) => item.id === region.id);
  if (!marker) return;

  marker.start = clamp(region.start, 0, reviewState.duration);
  marker.end = clamp(region.end, marker.start + 0.012, reviewState.duration);
  reviewState.markers = finalizeMarkers(reviewState.markers);
  selectMarker(region.id, false);
}

function getSortedMarkers() {
  return [...reviewState.markers].sort((a, b) => a.start - b.start);
}

function getMarkerCategory(index, marker) {
  const expected = reviewState.expectedExports[index];
  return marker?.category || expected?.category || "normal";
}

function getCategoryTheme(category) {
  return CATEGORY_THEMES[category] || CATEGORY_THEMES.normal;
}

function getMarkerAssignment(index, marker) {
  const category = getMarkerCategory(index, marker);
  const expected = reviewState.expectedExports[index];
  if (expected) {
    return {
      path: buildPackPath(category, expected.action, expected.player, expected.index),
      extra: false,
      category,
      action: expected.action,
      player: expected.player,
      index: expected.index,
    };
  }

  return {
    path: `extras/${category}-${String(index - reviewState.expectedExports.length + 1).padStart(3, "0")}.wav`,
    extra: true,
    category,
  };
}

function renderReviewList() {
  const markers = getSortedMarkers();
  const stats = getReviewStats(markers.length);
  const selectedIndex = markers.findIndex((marker) => marker.id === reviewState.selectedMarkerId);
  const selectedAssignment = selectedIndex >= 0 ? getMarkerAssignment(selectedIndex, markers[selectedIndex]) : null;

  els.summaryDetected.textContent = `${stats.detected} detected`;
  els.summaryExpected.textContent = `${stats.expected} expected`;
  els.summaryMissing.textContent = `${stats.missing} missing`;
  els.summaryExtra.textContent = `${stats.extra} extra`;
  els.selectionStatus.textContent = selectedAssignment
    ? `Selected: ${selectedAssignment.path}`
    : "";

  if (!markers.length) {
    els.reviewList.innerHTML =
      '<div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-gray-500">No regions were detected. Add markers manually on the waveform.</div>';
  } else {
    els.reviewList.innerHTML = "";

    markers.forEach((marker, index) => {
      const assignment = getMarkerAssignment(index, marker);
      const category = getMarkerCategory(index, marker);
      const categoryTheme = getCategoryTheme(category);
      const categoryLabel = CLICK_TYPES.find((type) => type.id === category)?.name.replace(" Click", "") || category;
      const isRelease = assignment.action === "up";
      const actionLabel = assignment.extra
        ? "extra"
        : (isRelease ? "release" : "click");
      const row = document.createElement("div");
      row.className = `review-row ${marker.id === reviewState.selectedMarkerId ? "is-selected" : ""}`;
      row.addEventListener("click", () => selectMarker(marker.id, true));

      const layout = document.createElement("div");
      layout.className = "review-row-layout";

      const main = document.createElement("div");
      main.className = "review-row-main";

      const pathLine = document.createElement("div");
      pathLine.className = "review-row-pathline";

      const title = document.createElement("div");
      title.className = "review-row-path";
      title.textContent = assignment.path;

      const meta = document.createElement("div");
      meta.className = "review-row-meta";

      const actionTag = document.createElement("span");
      actionTag.className = "review-tag";
      actionTag.textContent = actionLabel;
      actionTag.style.color = assignment.extra
        ? "#fde68a"
        : (isRelease ? RELEASE_REVIEW_STYLE.text : categoryTheme.text);
      actionTag.style.background = assignment.extra
        ? "rgba(146, 64, 14, 0.28)"
        : (isRelease ? RELEASE_REVIEW_STYLE.bgStrong : categoryTheme.badge);
      actionTag.style.borderColor = assignment.extra
        ? "rgba(245, 158, 11, 0.28)"
        : (isRelease ? RELEASE_REVIEW_STYLE.border : categoryTheme.regionSelected);

      const categoryTag = document.createElement("span");
      categoryTag.className = "review-tag";
      categoryTag.textContent = categoryLabel;
      categoryTag.style.color = isRelease ? RELEASE_REVIEW_STYLE.text : categoryTheme.text;
      categoryTag.style.background = isRelease ? RELEASE_REVIEW_STYLE.bg : categoryTheme.region;
      categoryTag.style.borderColor = isRelease
        ? RELEASE_REVIEW_STYLE.border
        : categoryTheme.regionSelected;

      const durationTag = document.createElement("span");
      durationTag.className = "review-tag";
      durationTag.textContent = `${Math.round((marker.end - marker.start) * 1000)} ms`;

      const startTag = document.createElement("span");
      startTag.className = "review-tag review-tag-accent";
      startTag.textContent = `${marker.start.toFixed(3)}s`;

      meta.appendChild(actionTag);
      meta.appendChild(categoryTag);
      meta.appendChild(durationTag);
      meta.appendChild(startTag);

      if (assignment.extra) {
        const extraTag = document.createElement("span");
        extraTag.className = "review-tag review-tag-warn";
        extraTag.textContent = "extra";
        meta.appendChild(extraTag);
      }

      pathLine.appendChild(title);
      main.appendChild(pathLine);
      main.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "review-row-controls";

      const categorySelect = document.createElement("select");
      categorySelect.className = "review-select review-select-compact";
      categorySelect.style.color = isRelease ? RELEASE_REVIEW_STYLE.text : categoryTheme.text;
      categorySelect.style.borderColor = isRelease
        ? RELEASE_REVIEW_STYLE.border
        : categoryTheme.regionSelected;
      categorySelect.style.background = isRelease
        ? RELEASE_REVIEW_STYLE.bgStrong
        : categoryTheme.region;
      CLICK_TYPES.forEach((type) => {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.name.replace(" Click", "");
        option.selected = type.id === category;
        categorySelect.appendChild(option);
      });
      categorySelect.addEventListener("click", (event) => event.stopPropagation());
      categorySelect.addEventListener("change", (event) => {
        event.stopPropagation();
        marker.category = categorySelect.value;
        renderReviewList();
        syncWaveformRegions();
      });

      const previewBtn = document.createElement("button");
      previewBtn.className = "review-btn review-btn-small";
      previewBtn.textContent = "Preview";
      previewBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        playMarkerPreview(marker);
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "review-btn review-btn-danger review-btn-small";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeMarker(marker.id);
      });

      actions.appendChild(categorySelect);
      actions.appendChild(previewBtn);
      actions.appendChild(removeBtn);
      layout.appendChild(main);
      layout.appendChild(actions);
      row.appendChild(layout);
      els.reviewList.appendChild(row);
    });
  }
}

function getReviewStats(detectedCount) {
  return {
    detected: detectedCount,
    expected: reviewState.expectedExports.length,
    missing: Math.max(0, reviewState.expectedExports.length - detectedCount),
    extra: Math.max(0, detectedCount - reviewState.expectedExports.length),
  };
}

function selectMarker(markerId, centerWaveform) {
  reviewState.selectedMarkerId = markerId;
  renderReviewList();
  syncWaveformRegions();

  if (!centerWaveform || !reviewState.wavesurfer) return;

  const marker = reviewState.markers.find((item) => item.id === markerId);
  if (marker) {
    reviewState.wavesurfer.setTime(Math.max(0, marker.start));
    scrollWaveformToTime(marker.start, "smooth");
  }
}

function removeMarker(markerId) {
  reviewState.markers = reviewState.markers.filter((marker) => marker.id !== markerId);
  if (reviewState.selectedMarkerId === markerId) {
    reviewState.selectedMarkerId = null;
  }
  renderReviewList();
  syncWaveformRegions();
}

function addMarkerAtCursor() {
  if (!reviewState.sourceData) return;

  const currentTime = reviewState.wavesurfer?.getCurrentTime
    ? reviewState.wavesurfer.getCurrentTime()
    : 0;

  const marker = createManualMarkerNearTime(currentTime);
  reviewState.markers.push(marker);
  reviewState.markers = finalizeMarkers(reviewState.markers);
  selectMarker(marker.id, true);
}

function createManualMarkerNearTime(time) {
  const center = Math.floor(time * reviewState.sampleRate);
  const searchRadius = Math.floor(reviewState.sampleRate * 0.04);
  const peakIndex = findPeakInRange(
    reviewState.sourceData,
    center - searchRadius,
    center + searchRadius,
    0.002,
  );

  if (peakIndex !== null) {
    return createPeakMarker(
      reviewState.sourceData,
      peakIndex,
      Math.max(0, peakIndex - searchRadius),
      reviewState.sampleRate,
      "manual",
      reviewState.selectedMarkerId
        ? getMarkerCategory(
            reviewState.markers.findIndex((marker) => marker.id === reviewState.selectedMarkerId),
            reviewState.markers.find((marker) => marker.id === reviewState.selectedMarkerId),
          )
        : null,
    );
  }

  return {
    id: nextMarkerId(),
    start: clamp(time - 0.012, 0, reviewState.duration),
    end: clamp(time + 0.04, 0.012, reviewState.duration),
    peak: time,
    source: "manual",
  };
}

function deleteSelectedMarker() {
  if (!reviewState.selectedMarkerId) {
    alert("Select a region first.");
    return;
  }

  removeMarker(reviewState.selectedMarkerId);
}

function toggleWaveformPlayback() {
  if (!reviewState.wavesurfer) return;
  reviewState.wavesurfer.playPause();
}

function handleGlobalReviewKeydown(event) {
  if (event.code !== "Space") return;
  if (els.reviewPanel.classList.contains("hidden")) return;
  if (isTypingTarget(event.target)) return;

  event.preventDefault();
  toggleWaveformPlayback();
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, button")) return true;
  return target.hasAttribute("contenteditable");
}

function updatePlaybackLabel() {
  if (!reviewState.wavesurfer) {
    els.playPauseBtn.textContent = "Play Audio";
    return;
  }

  els.playPauseBtn.textContent = reviewState.wavesurfer.isPlaying()
    ? "Pause Audio"
    : "Play Audio";
}

function getInitialZoomPxPerSec() {
  const viewportWidth = els.waveformViewport?.clientWidth || 900;
  if (!reviewState.duration) return 120;
  return Math.max(140, (viewportWidth / reviewState.duration) * 1.8);
}

function bindWaveformUi() {
  if (!reviewState.wavesurfer || typeof reviewState.wavesurfer.getWrapper !== "function") {
    return;
  }

  if (typeof reviewState.waveUiCleanup === "function") {
    reviewState.waveUiCleanup();
    reviewState.waveUiCleanup = null;
  }

  const wrapper = reviewState.wavesurfer.getWrapper();
  const viewport = els.waveformViewport;
  if (!wrapper || !viewport) {
    return;
  }

  let isPanning = false;
  let moved = false;
  let startX = 0;
  let startScroll = 0;

  const swallowClick = (event) => {
    if (!reviewState.suppressWaveClick) return;
    reviewState.suppressWaveClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onMouseMove = (event) => {
    if (!isPanning) return;
    const deltaX = event.clientX - startX;
    if (Math.abs(deltaX) > 2) {
      moved = true;
      viewport.classList.add("is-panning");
    }
    if (moved) {
      event.preventDefault();
      reviewState.wavesurfer.setScroll(startScroll - deltaX);
    }
  };

  const onMouseUp = () => {
    if (!isPanning) return;

    isPanning = false;
    viewport.classList.remove("is-panning");
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);

    if (moved) {
      reviewState.suppressWaveClick = true;
      wrapper.addEventListener("click", swallowClick, true);
      setTimeout(() => wrapper.removeEventListener("click", swallowClick, true), 0);
    }
  };

  const onMouseDown = (event) => {
    if (event.button !== 0 || isRegionInteraction(event)) return;
    isPanning = true;
    moved = false;
    startX = event.clientX;
    startScroll = reviewState.wavesurfer.getScroll ? reviewState.wavesurfer.getScroll() : 0;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const onWaveformClick = (event) => {
    if (reviewState.suppressWaveClick) {
      reviewState.suppressWaveClick = false;
      return;
    }

    if (isRegionInteraction(event)) return;

    const { time, ratio } = getWaveformPointerPosition(event);
    reviewState.wavesurfer.setTime(time);

    const focusRatio = ratio >= 0.35 && ratio <= 0.65
      ? 0.5
      : clamp(ratio, 0.15, 0.85);
    scrollWaveformToTime(time, "auto", focusRatio);
  };

  wrapper.addEventListener("mousedown", onMouseDown, true);
  wrapper.addEventListener("click", onWaveformClick);

  reviewState.waveUiCleanup = () => {
    isPanning = false;
    moved = false;
    viewport.classList.remove("is-panning");
    wrapper.removeEventListener("mousedown", onMouseDown, true);
    wrapper.removeEventListener("click", onWaveformClick);
    wrapper.removeEventListener("click", swallowClick, true);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
}

function getWaveformPointerPosition(event) {
  const viewport = els.waveformViewport;
  if (!viewport || !reviewState.duration || !reviewState.zoomPxPerSec) {
    return {
      time: reviewState.wavesurfer?.getCurrentTime?.() || 0,
      ratio: 0.5,
    };
  }

  const rect = viewport.getBoundingClientRect();
  const localX = clamp(event.clientX - rect.left, 0, rect.width);
  const ratio = rect.width > 0 ? localX / rect.width : 0.5;
  const scroll = reviewState.wavesurfer?.getScroll ? reviewState.wavesurfer.getScroll() : 0;

  return {
    time: clamp((scroll + localX) / reviewState.zoomPxPerSec, 0, reviewState.duration),
    ratio,
  };
}

function setWaveformZoom(nextZoom, anchorTime = null, focusRatio = 0.5) {
  if (!reviewState.wavesurfer?.zoom || !reviewState.duration) return;

  const targetZoom = clamp(nextZoom, 16, 1000000);
  reviewState.zoomPxPerSec = targetZoom;

  const targetTime =
    anchorTime ??
    (reviewState.wavesurfer.getCurrentTime ? reviewState.wavesurfer.getCurrentTime() : 0);

  reviewState.wavesurfer.zoom(targetZoom);
  requestAnimationFrame(() => scrollWaveformToTime(targetTime, "auto", focusRatio));
}

function scrollWaveformToTime(time, behavior = "auto", focusRatio = 0.35) {
  if (!reviewState.wavesurfer || !reviewState.duration) return;

  const viewportWidth = els.waveformViewport?.clientWidth || 0;
  const visibleDuration =
    reviewState.zoomPxPerSec > 0 && viewportWidth > 0
      ? viewportWidth / reviewState.zoomPxPerSec
      : 0;

  const targetStartTime = clamp(
    time - visibleDuration * clamp(focusRatio, 0.05, 0.95),
    0,
    Math.max(0, reviewState.duration - visibleDuration),
  );

  reviewState.wavesurfer.setScrollTime(targetStartTime);
}

function playMarkerPreview(marker) {
  selectMarker(marker.id, true);
  const slice = extractPreviewClip(marker);
  const wavBuffer = encodeWAV(slice, reviewState.sampleRate);

  stopPreviewAudio();

  previewAudioUrl = URL.createObjectURL(new Blob([wavBuffer], { type: "audio/wav" }));
  previewAudio = new Audio(previewAudioUrl);
  previewAudio.onended = stopPreviewAudio;
  previewAudio.play();
}

function stopPreviewAudio() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }

  if (previewAudioUrl) {
    URL.revokeObjectURL(previewAudioUrl);
    previewAudioUrl = null;
  }
}

function extractProcessedClip(marker) {
  const startSample = clamp(
    Math.floor(marker.start * reviewState.sampleRate),
    0,
    reviewState.sourceData.length,
  );
  const endSample = clamp(
    Math.ceil(marker.end * reviewState.sampleRate),
    startSample + 1,
    reviewState.sourceData.length,
  );

  let slice = reviewState.sourceData.slice(startSample, endSample);
  const rawPeak = DSP.getPeak(slice);
  slice = DSP.removeDC(slice);

  if (config.denoiseMode === "adaptive" && reviewState.noiseProfile?.length > 2048) {
    const filteredSlice = DSP.highpass(slice, reviewState.sampleRate, 75);
    const filteredNoise = DSP.highpass(reviewState.noiseProfile, reviewState.sampleRate, 75);
    slice = DSP.denoise(filteredSlice, filteredNoise, 1);

    if (!config.normalize) {
      const cleanedPeak = DSP.getPeak(slice);
      if (cleanedPeak > 0 && rawPeak > cleanedPeak) {
        const makeUp = Math.min(1.45, rawPeak / cleanedPeak);
        for (let i = 0; i < slice.length; i++) {
          slice[i] *= makeUp;
        }
      }
    }
  }

  if (config.normalize) {
    slice = DSP.normalizePeak(slice, 0.92);
  }

  applyEdgeFades(slice, reviewState.sampleRate);
  return slice;
}

function extractPreviewClip(marker) {
  const startSample = clamp(
    Math.floor(marker.start * reviewState.sampleRate),
    0,
    reviewState.sourceData.length,
  );
  const endSample = clamp(
    Math.ceil(marker.end * reviewState.sampleRate),
    startSample + 1,
    reviewState.sourceData.length,
  );

  const slice = reviewState.sourceData.slice(startSample, endSample);
  applyPreviewFades(slice, reviewState.sampleRate);
  return slice;
}

function applyPreviewFades(samples, sampleRate) {
  const fadeIn = Math.min(samples.length, Math.max(8, Math.floor(sampleRate * 0.00025)));
  const fadeOut = Math.min(samples.length, Math.max(16, Math.floor(sampleRate * 0.0005)));

  for (let i = 0; i < fadeIn; i++) {
    samples[i] *= i / fadeIn;
  }

  for (let i = 0; i < fadeOut; i++) {
    const idx = samples.length - 1 - i;
    if (idx < 0) break;
    samples[idx] *= i / fadeOut;
  }
}

function applyEdgeFades(samples, sampleRate) {
  const fadeIn = Math.min(samples.length, Math.max(24, Math.floor(sampleRate * 0.001)));
  const fadeOut = Math.min(samples.length, Math.max(120, Math.floor(sampleRate * 0.008)));

  for (let i = 0; i < fadeIn; i++) {
    samples[i] *= i / fadeIn;
  }

  for (let i = 0; i < fadeOut; i++) {
    const idx = samples.length - 1 - i;
    if (idx < 0) break;
    samples[idx] *= i / fadeOut;
  }
}

async function downloadZip() {
  if (!reviewState.sourceData || !reviewState.markers.length) {
    return;
  }

  const zip = new JSZip();
  const markers = getSortedMarkers();

  markers.forEach((marker, index) => {
    const assignment = getMarkerAssignment(index, marker);
    const clip = extractProcessedClip(marker);
    if (clip.length > 0) {
      zip.file(assignment.path, encodeWAV(clip, reviewState.sampleRate));
    }
  });

  if (reviewState.noiseProfile?.length) {
    zip.file("noise.wav", encodeWAV(reviewState.noiseProfile, reviewState.sampleRate));
  }

  if (config.readme.trim()) {
    zip.file("readme.txt", `${normalizeLineEndings(config.readme).trimEnd()}\n`);
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${config.packName}.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);
  return buffer;
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let sample = Math.max(-1, Math.min(1, input[i]));
    sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    output.setInt16(offset, sample, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
