const table = document.getElementById("clickpack-tbl");
const searchInput = document.getElementById("search-input");
const sortBySizeSelect = document.getElementById("sort-by-size");
const filterHasNoiseCheckbox = document.getElementById("filter-has-noise");
let fuse;
let allClickpacks = [];

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
  let seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) {
    return Math.floor(interval) + " years";
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + " months";
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + " days";
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + " hours";
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + " minutes";
  }
  return Math.floor(seconds) + " seconds";
}

const DB_URL = document.location.origin + "/db.json";

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
    const updatedDate = new Date(data.updated_at_iso);
    document.getElementById(
      "loading-span"
    ).innerHTML = `Listing ${countProperties(
      data.clickpacks
    )} entries. Last updated <span data-tippy-content="${updatedDate.toString()}">${timeSince(
      updatedDate
    )} ago</span>`;

    allClickpacks = [];
    for (const [key, clickpackData] of Object.entries(data.clickpacks)) {
      const name = key.replaceAll("_", " ");
      allClickpacks.push({
        id: key,
        name: name,
        ...clickpackData,
      });
    }

    const options = {
      keys: ["name"],
      includeScore: true,
      threshold: 0.4,
    };
    fuse = new Fuse(allClickpacks, options);
    applyFiltersAndRender();
  } catch (error) {
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
    clickpackDiv.appendChild(size);

    cell1.appendChild(clickpackDiv);
    row.appendChild(cell1);

    const cell2 = document.createElement("td");
    const downloadButton = document.createElement("a");
    downloadButton.href = fixupOrigin(clickpack.url);
    downloadButton.className = "button-3";
    downloadButton.setAttribute("role", "button");
    downloadButton.textContent = "Download";
    downloadButton.setAttribute(
      "data-tippy-content",
      clickpack.size.humanSize()
    );

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

loadClickpacks();
