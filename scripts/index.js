const table = document.getElementById("clickpack-tbl");
const searchInput = document.getElementById("search-input");
const sortBySizeSelect = document.getElementById("sort-by-size");
const filterHasNoiseCheckbox = document.getElementById("filter-has-noise");
const downloadAllButton = document.getElementById("download-all-btn");
const downloadAllStatus = document.getElementById("download-all-status");
let fuse;
let allClickpacks = [];
let databaseDate = new Date();
let isDownloadingAll = false;

Object.defineProperty(Number.prototype, "humanSize", {
  value: function (round = false) {
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let value = this;
    let index = 0;

    while (value >= 1000 && index < units.length - 1) {
      value /= 1000;
      index++;
    }

    return round
      ? `${Math.round(value)} ${units[index]}`
      : `${value.toFixed(2)} ${units[index]}`;
  },
  writable: false,
  configurable: true,
  enumerable: false,
});

function tryPopup(url) {
  NProgress.start();
  const currentlyPreviewing = document.getElementById("currentlyPreviewing");
  currentlyPreviewing.textContent = decodeURIComponent(
    url.split("/").pop().split(".")[0]
  );
  currentlyPreviewing.href = url;
  loadZipFile(url);
}

function countProperties(obj) {
  let count = 0;
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) ++count;
  }
  return count;
}

function timeSince(date) {
  const units = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
    { label: "second", seconds: 1 },
  ];

  const secondsElapsed = Math.floor((Date.now() - date.getTime()) / 1000);

  for (const { label, seconds } of units) {
    const interval = Math.floor(secondsElapsed / seconds);
    if (interval >= 1) {
      return `${interval} ${label}${interval !== 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
}

const DB_URL = document.location.origin + "/db.json";
const HIATUS_API = "http://localhost:8080";

function fixupOrigin(url) {
  const BAD_PREFIX = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/";
  const GOOD_PREFIX = document.location.origin + "/out/";
  if (url.startsWith(BAD_PREFIX)) {
    return GOOD_PREFIX + url.substring(BAD_PREFIX.length);
  } else {
    return url;
  }
}

async function loadClickpacks() {
  try {
    const response = await fetch(DB_URL);
    const data = await response.json();
    let downloadsData = {};
    try {
      const hiatusResponse = await fetch(HIATUS_API + "/downloads/all");
      downloadsData = await hiatusResponse.json();
    } catch (e) {
      console.error("failed to fetch downloads from hiatus", e);
    }

    databaseDate = new Date(data.updated_at_iso);
    document.getElementById(
      "loading-span"
    ).innerHTML = `Listing ${countProperties(
      data.clickpacks
    )} entries. Last updated <span data-tippy-content="${databaseDate.toString()}">${timeSince(
      databaseDate
    )}</span> (rev. ${data.version})`;

    allClickpacks = [];
    for (const [key, clickpackData] of Object.entries(data.clickpacks)) {
      const name = key.replaceAll("_", " ");
      const downloads = downloadsData[key];
      allClickpacks.push({
        id: key,
        name: name,
        ...clickpackData,
        downloads: downloads ? downloads : 0,
      });
    }

    const options = {
      keys: ["name"],
      includeScore: true,
      threshold: 0.4,
    };
    fuse = new Fuse(allClickpacks, options);
    applyFiltersAndRender();

    let totalEstimatedSize = 0;
    allClickpacks.forEach((cp) => (totalEstimatedSize += cp.size));
    downloadAllButton.setAttribute(
      "data-tippy-content",
      `Download all clickpacks in the database as a ZIP. This will use approximately ${totalEstimatedSize.humanSize(
        true
      )} of traffic.`
    );
    downloadAllButton.disabled = false;
    tippy("[data-tippy-content]");
  } catch (error) {
    downloadAllButton.disabled = true;
    console.error("Failed to load clickpacks:", error);
    document.getElementById("loading-span").textContent =
      "Error loading clickpacks. See console for details.";
  }
}

function renderTable(clickpacksToRender) {
  table.innerHTML = "";

  if (clickpacksToRender.length === 0) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 2;
    cell.textContent = "No clickpacks match your criteria.";
    cell.style.textAlign = "center";
    cell.style.padding = "20px";
    return;
  }

  clickpacksToRender.forEach((clickpack) => {
    const row = document.createElement("tr");
    row.dataset.clickpackId = clickpack.id;

    const cell1 = document.createElement("td");
    const clickpackDiv = document.createElement("div");
    clickpackDiv.className = "clickpack";
    const clickpackLink = document.createElement("a");
    clickpackLink.textContent = clickpack.name;
    clickpackDiv.appendChild(clickpackLink);

    if (clickpack.has_noise) {
      const tag = document.createElement("span");
      tag.className = "unselectable tag";
      tag.textContent = "🔊";
      tag.setAttribute("data-tippy-content", "This clickpack has a noise file");
      clickpackDiv.appendChild(tag);
    }
    if (clickpack.readme) {
      const tag = document.createElement("span");
      tag.className = "unselectable tag";
      tag.textContent = "readme";
      tag.setAttribute("data-tippy-content", clickpack.readme);
      clickpackDiv.appendChild(tag);
    }

    const size = document.createElement("span");
    size.className = "unselectable tag";
    size.innerText = clickpack.size.humanSize(true);
    const fullHumanSize = clickpack.size.humanSize();
    size.setAttribute("data-tippy-content", fullHumanSize);

    // download count tag
    let downloadCount = null;
    if (clickpack.downloads !== 0) {
      downloadCount = document.createElement("span");
      downloadCount.className = "unselectable tag";
      downloadCount.innerText = clickpack.downloads;
      downloadCount.setAttribute(
        "data-tippy-content",
        `${clickpack.downloads} download${clickpack.downloads === 1 ? "" : "s"}`
      );
      clickpackDiv.appendChild(downloadCount);
    }

    clickpackDiv.appendChild(size);

    cell1.appendChild(clickpackDiv);
    row.appendChild(cell1);

    const cell2 = document.createElement("td");
    const downloadButton = document.createElement("a");
    downloadButton.href = fixupOrigin(clickpack.url);
    downloadButton.className = "button-3";
    downloadButton.setAttribute("role", "button");
    downloadButton.textContent = "Download";
    downloadButton.setAttribute("data-tippy-content", fullHumanSize);
    downloadButton.addEventListener("click", async (event) => {
      event.preventDefault();

      try {
        await fetch(HIATUS_API + `/inc/${clickpack.id}`, {
          method: "POST",
        });
        console.log("incremented download count for:", clickpack.id);
        if (downloadCount) {
          downloadCount.innerText = clickpack.downloads + 1;
          downloadCount.setAttribute(
            "data-tippy-content",
            `${clickpack.downloads + 1} download${
              clickpack.downloads + 1 === 1 ? "" : "s"
            }`
          );
        }
      } catch (error) {
        console.error(
          "failed to increment download count for " + clickpack.id + ":",
          error
        );
      }
      window.location.href = clickpack.url;
    });

    const tryButton = document.createElement("button");
    tryButton.className = "button-4";
    tryButton.setAttribute("role", "button");
    tryButton.textContent = "Preview";
    tryButton.addEventListener("click", () =>
      tryPopup(fixupOrigin(clickpack.url))
    );

    cell2.appendChild(downloadButton);
    cell2.appendChild(tryButton);
    row.appendChild(cell2);

    table.appendChild(row);
  });
  tippy("[data-tippy-content]");
}

function applyFiltersAndRender() {
  const searchQuery = searchInput.value.trim().toLowerCase();
  const sortBy = sortBySizeSelect.value;
  const filterNoise = filterHasNoiseCheckbox.checked;
  let filteredClickpacks = [];

  if (searchQuery) {
    const results = fuse.search(searchQuery);
    filteredClickpacks = results.map((result) => result.item);
  } else {
    filteredClickpacks = [...allClickpacks];
  }

  if (filterNoise) {
    filteredClickpacks = filteredClickpacks.filter((cp) => cp.has_noise);
  }

  if (sortBy === "asc") {
    filteredClickpacks.sort((a, b) => a.size - b.size);
  } else if (sortBy === "desc") {
    filteredClickpacks.sort((a, b) => b.size - a.size);
  } else if (sortBy == "downloads-desc") {
    filteredClickpacks.sort((a, b) => b.downloads - a.downloads);
  } else if (sortBy == "downloads-asc") {
    filteredClickpacks.sort((a, b) => a.downloads - b.downloads);
  } else {
    filteredClickpacks.sort((a, b) => a.name.localeCompare(b.name));
  }
  renderTable(filteredClickpacks);
}

function renderTree(node, containerElement) {
  const keys = Object.keys(node).sort((a, b) => {
    // sort folders before files
    if (node[a]._isLeaf && !node[b]._isLeaf) return 1;
    if (!node[a]._isLeaf && node[b]._isLeaf) return -1;

    // sort files by numerical part of the filename
    const aNum = a.match(/\d+/) ? +a.match(/\d+/)[0] : NaN;
    const bNum = b.match(/\d+/) ? +b.match(/\d+/)[0] : NaN;
    if (isNaN(aNum) && isNaN(bNum)) {
      return a.localeCompare(b);
    }
    if (isNaN(aNum)) return 1;
    if (isNaN(bNum)) return -1;
    return aNum - bNum;
  });

  keys.forEach((key) => {
    const item = node[key];
    NProgress.inc();

    if (item._isLeaf) {
      // it's a file
      const listItem = document.createElement("li");
      listItem.className = "audioListItem file-item";

      const fileNameSpan = document.createElement("span");
      fileNameSpan.textContent = item.name;
      listItem.appendChild(fileNameSpan);

      const buttonsDiv = document.createElement("div");

      const playButton = document.createElement("button");
      playButton.textContent = "Play";
      playButton.className = "listItemButton";
      playButton.addEventListener("click", (e) => {
        e.stopPropagation();
        item.entry.async("blob").then((audioBlob) => {
          const audioUrl = URL.createObjectURL(audioBlob);
          const audioPlayer = document.getElementById("audioPlayer");
          audioPlayer.src = audioUrl;
          audioPlayer.addEventListener("ended", () => {
            URL.revokeObjectURL(audioUrl);
          });
          audioPlayer.play();
        });
      });

      const downloadButton = document.createElement("button");
      downloadButton.textContent = "Download";
      downloadButton.classList.add("listItemButton");
      downloadButton.addEventListener("click", (e) => {
        e.stopPropagation();
        NProgress.start();
        item.entry.async("blob").then((audioBlob) => {
          NProgress.done();
          const audioUrl = URL.createObjectURL(audioBlob);
          const link = document.createElement("a");
          link.href = audioUrl;
          link.download = item.name;
          link.click();
          URL.revokeObjectURL(audioUrl);
          link.remove();
        });
      });

      buttonsDiv.appendChild(playButton);
      buttonsDiv.appendChild(downloadButton);
      listItem.appendChild(buttonsDiv);
      containerElement.appendChild(listItem);
    } else {
      // it's a folder
      const folderItem = document.createElement("li");
      folderItem.className = "folder-item";

      const folderNameSpan = document.createElement("span");
      folderNameSpan.textContent = key;
      folderNameSpan.className = "folder-name";
      folderItem.appendChild(folderNameSpan);

      const subList = document.createElement("ul");
      subList.style.display = "none";
      renderTree(item.children, subList);

      if (subList.hasChildNodes()) {
        folderItem.appendChild(subList);
        folderItem.addEventListener("click", (e) => {
          if (
            e.target === folderNameSpan ||
            (e.target === folderItem &&
              !Array.from(folderItem.children).includes(e.target))
          ) {
            folderItem.classList.toggle("open");
            subList.style.display =
              subList.style.display === "none" ? "block" : "none";
          }
        });
        folderNameSpan.addEventListener("click", (e) => {
          e.stopPropagation();
          folderItem.classList.toggle("open");
          subList.style.display =
            subList.style.display === "none" ? "block" : "none";
        });
        containerElement.appendChild(folderItem);
      }
    }
  });
}

async function loadZipFile(zipUrl) {
  try {
    const response = await fetch(zipUrl);
    NProgress.inc();
    if (!response.ok) {
      throw new Error("Failed to fetch ZIP file");
    }
    const data = await response.arrayBuffer();
    const jszip = new JSZip();
    const zip = await jszip.loadAsync(data);
    NProgress.inc();
    const fileListContainer = document.getElementById("fileList");
    fileListContainer.innerHTML = "";

    const root = {};

    // build the file tree
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return; // skip directories themselves, we'll create them from paths

      const pathParts = relativePath.split("/").filter((p) => p);
      let currentLevel = root;

      pathParts.forEach((part, index) => {
        if (index === pathParts.length - 1) {
          // it's a file
          if (
            !zipEntry.name.match(
              /\.(ogg|wav|mp3|aiff|flac|aac|wma|m4a|amr|3gp)$/
            )
          )
            return;
          currentLevel[part] = {
            _isLeaf: true,
            entry: zipEntry,
            name: part,
          };
        } else {
          // it's a folder
          if (!currentLevel[part]) {
            currentLevel[part] = { _isLeaf: false, children: {} };
          }
          currentLevel = currentLevel[part].children;
        }
      });
    });

    const rootUl = document.createElement("ul");
    renderTree(root, rootUl);
    fileListContainer.appendChild(rootUl);

    NProgress.done();
    document.getElementById("popup").style.display = "block";
    document.getElementById("overlay").style.display = "block";
  } catch (error) {
    console.error("Error:", error);
    NProgress.done();
  }
}

function formatDateToCustomString(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}-${month}-${hour}-${minute}-${second}-${year}`;
}

async function downloadAllClickpacks() {
  if (isDownloadingAll) {
    alert("A download all operation is already in progress.");
    return;
  }
  if (!allClickpacks || allClickpacks.length === 0) {
    alert("No clickpacks loaded to download.");
    return;
  }

  let totalEstimatedSize = 0;
  allClickpacks.forEach((cp) => (totalEstimatedSize += cp.size));

  const userConfirmed = confirm(
    `You are about to download and re-package ALL ${
      allClickpacks.length
    } clickpacks.
This will unzip each pack and add its contents to a single new ZIP file.
This will use ${totalEstimatedSize.humanSize(true)} of traffic.
This process might put strain on your browser.
Are you sure you want to proceed?`
  );

  if (!userConfirmed) {
    return;
  }

  isDownloadingAll = true;
  downloadAllButton.disabled = true;
  downloadAllStatus.style.display = "block";
  downloadAllStatus.textContent = "Initializing download process...";
  NProgress.start();
  NProgress.set(0);

  const masterZip = new JSZip();
  const failedDownloads = [];
  const failedFileOperations = [];

  const totalClickpacks = allClickpacks.length;
  // +1 step for the final masterZip generation
  const totalProgressSteps = totalClickpacks + 1;

  for (let i = 0; i < totalClickpacks; i++) {
    const clickpack = allClickpacks[i];
    const clickpackFolderName = clickpack.name.trim();

    NProgress.set(i / totalProgressSteps);
    downloadAllStatus.textContent = `(${i + 1}/${totalClickpacks}) Fetching: ${
      clickpack.name
    }...`;

    try {
      const response = await fetch(fixupOrigin(clickpack.url));
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const clickpackZipBlob = await response.blob();

      downloadAllStatus.textContent = `(${
        i + 1
      }/${totalClickpacks}) Processing: ${clickpack.name} (Unzipping...)`;
      NProgress.set((i + 0.2) / totalProgressSteps);

      const individualZip = new JSZip();
      await individualZip.loadAsync(clickpackZipBlob);

      downloadAllStatus.textContent = `(${
        i + 1
      }/${totalClickpacks}) Adding files from: ${clickpack.name}...`;
      NProgress.set((i + 0.4) / totalProgressSteps);

      const fileEntries = [];
      individualZip.forEach((relativePath, zipEntry) => {
        fileEntries.push({ relativePath, zipEntry });
      });

      for (let j = 0; j < fileEntries.length; j++) {
        const { relativePath, zipEntry } = fileEntries[j];
        if (j % 10 === 0 || j === fileEntries.length - 1) {
          downloadAllStatus.textContent = `(${
            i + 1
          }/${totalClickpacks}) Adding files from ${clickpack.name}: ${j + 1}/${
            fileEntries.length
          }`;
        }

        if (!zipEntry.dir) {
          // only process files
          try {
            const fileContent = await zipEntry.async("blob");
            const decodedRelativePath = decodeURIComponent(relativePath);

            const finalPathInMasterZip = `${clickpackFolderName}/${decodedRelativePath}`;

            masterZip.file(finalPathInMasterZip, fileContent, {
              date: zipEntry.date,
            });
          } catch (fileError) {
            console.error(
              `Error processing file '${relativePath}' in clickpack '${clickpack.name}':`,
              fileError
            );
            failedFileOperations.push({
              clickpack: clickpack.name,
              file: relativePath,
              reason: fileError.message,
            });
          }
        }
        NProgress.set(
          (i + 0.4 + ((j + 1) / fileEntries.length) * 0.5) / totalProgressSteps
        );
      }
    } catch (error) {
      console.error(
        `Failed to download or process clickpack '${clickpack.name}':`,
        error
      );
      failedDownloads.push({ name: clickpack.name, reason: error.message });
      downloadAllStatus.textContent = `Failed: ${clickpack.name}. Skipping...`;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (Object.keys(masterZip.files).length === 0) {
    downloadAllStatus.textContent =
      "No files were successfully processed. Aborting zip generation.";
    NProgress.done();
    isDownloadingAll = false;
    downloadAllButton.disabled = false;
    setTimeout(() => {
      downloadAllStatus.style.display = "none";
    }, 5000);
    if (failedDownloads.length > 0 || failedFileOperations.length > 0) {
      alert(`All processing failed. Check console for details.
Failed Clickpacks: ${failedDownloads.length}
Failed File Operations: ${failedFileOperations.length}`);
    }
    return;
  }

  NProgress.set(totalClickpacks / totalProgressSteps);
  downloadAllStatus.textContent =
    "All clickpacks processed. Now creating the final ZIP file (this may take a while)...";

  try {
    const content = await masterZip.generateAsync(
      {
        type: "blob",
        compression: "STORE",
      },
      (metadata) => {
        downloadAllStatus.textContent = `Creating final ZIP: ${metadata.percent.toFixed(
          2
        )}% processed. Current file: ${
          metadata.currentFile ? metadata.currentFile : "..."
        }`;
        NProgress.set(
          totalClickpacks / totalProgressSteps +
            (metadata.percent / 100.0) * (1.0 / totalProgressSteps)
        );
      }
    );

    downloadAllStatus.textContent =
      "Final ZIP file generated. Starting download...";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = `clickpack-db-${formatDateToCustomString(
      databaseDate
    )}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    let finalMessage = "Download complete!";
    if (failedDownloads.length > 0 || failedFileOperations.length > 0) {
      finalMessage += ` However, there were some issues:
- Clickpacks failed to fetch/process: ${failedDownloads.length}
- Individual files failed during processing: ${failedFileOperations.length}
Please check the console for detailed error messages.`;
      downloadAllStatus.textContent = `Done, with errors. See console.`;
    } else {
      downloadAllStatus.textContent =
        "All clickpacks downloaded and zipped successfully!";
    }
    alert(finalMessage);
  } catch (error) {
    console.error("Error generating the master ZIP file:", error);
    downloadAllStatus.textContent =
      "Error generating the final ZIP file. Check console.";
    alert(
      "An error occurred while creating the final ZIP file. See console for details."
    );
    NProgress.done();
  } finally {
    if (NProgress.status < 1) NProgress.done();
    isDownloadingAll = false;
    downloadAllButton.disabled = false;
    setTimeout(() => {
      downloadAllStatus.style.display = "none";
      downloadAllStatus.textContent = "";
    }, 15000);
  }
}

function closePopup() {
  document.getElementById("popup").style.display = "none";
  document.getElementById("fileList").innerHTML = "";
  document.getElementById("overlay").style.display = "none";
  const audioPlayer = document.getElementById("audioPlayer");
  audioPlayer.pause();
  audioPlayer.src = "";
}

searchInput.addEventListener("input", applyFiltersAndRender);
sortBySizeSelect.addEventListener("change", applyFiltersAndRender);
filterHasNoiseCheckbox.addEventListener("change", applyFiltersAndRender);
document.getElementById("closePopup").addEventListener("click", closePopup);
window.addEventListener("click", ({ target }) => {
  if (target === document.getElementById("overlay")) {
    closePopup();
  }
});

downloadAllButton.addEventListener("click", downloadAllClickpacks);
downloadAllButton.disabled = true;

loadClickpacks();
