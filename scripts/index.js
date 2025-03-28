Object.defineProperty(Number.prototype, "fileSize", {
  value: function (a, b, c, d) {
    return (
      ((a = a ? [1e3, "k", "B"] : [1024, "K", "iB"]),
      (b = Math),
      (c = b.log),
      (d = (c(this) / c(a[0])) | 0),
      this / b.pow(a[0], d)).toFixed(2) +
      " " +
      (d ? (a[1] + "MGTPEZY")[--d] + a[2] : "Bytes")
    );
  },
  writable: false,
  enumerable: false,
});

function tagHtml(text, help) {
  return `<span class="tooltip unselectable tag">${text}<span class="tooltiptext">${help}</span></span>`;
}

function tryPopup(url) {
  NProgress.start();
  const currentlyPreviewing = document.getElementById("currentlyPreviewing");

  // set clickpack name & href
  currentlyPreviewing.textContent = url.split("/").pop().split(".")[0];
  currentlyPreviewing.href = url;

  // open popup
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

const DB_URL = document.location.origin.replace("http://", "https://") + "/db.json";

// https://github.com/zeozeozeo/clickpack-db/raw/main/out/ABEST.zip -> https://zeozeozeo.github.io/clickpack-db/out/ABEST.zip
function fixupOrigin(url) {
  const BAD_PREFIX = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/";
  const GOOD_PREFIX = document.location.origin.replace("http://", "https://") + "/out/";
  if (url.startsWith(BAD_PREFIX)) {
    return GOOD_PREFIX + url.substring(BAD_PREFIX.length);
  } else {
    return url; // shouldn't happen, but just in case
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
    )} entries. Last updated <span class="tooltip">${timeSince(
      updatedDate
    )} ago <span class="tooltiptext">${updatedDate.toString()}</span></span>`;

    const table = document.getElementById("clickpack-tbl");

    for (const [key, clickpack] of Object.entries(data.clickpacks)) {
      const row = document.createElement("tr");

      const cell1 = document.createElement("td");
      const clickpackDiv = document.createElement("div");
      clickpackDiv.className = "clickpack";
      const clickpackLink = document.createElement("a");
      clickpackLink.textContent = key;
      clickpackDiv.appendChild(clickpackLink);
      if (clickpack.has_noise) {
        const tag = document.createElement("span");
        tag.className = "tooltip unselectable tag";
        tag.textContent = "🔊";
        const tooltip = document.createElement("span");
        tooltip.className = "tooltiptext";
        tooltip.textContent = "This clickpack has a noise file";
        tag.appendChild(tooltip);
        clickpackDiv.appendChild(tag);
      }
      cell1.appendChild(clickpackDiv);
      row.appendChild(cell1);

      const cell2 = document.createElement("td");
      const downloadButton = document.createElement("a");
      downloadButton.href = fixupOrigin(clickpack.url);
      downloadButton.className = "button-3 tooltip";
      downloadButton.setAttribute("role", "button");
      downloadButton.textContent = "Download";
      const sizeTooltip = document.createElement("span");
      sizeTooltip.className = "tooltiptext";
      sizeTooltip.textContent = clickpack.size.fileSize(1);
      downloadButton.appendChild(sizeTooltip);

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
    }
  } catch (error) {
    console.error("Failed to load clickpacks:", error);
  }
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
    const fileList = document.getElementById("fileList");
    fileList.innerHTML = "";

    zip.forEach((_, zipEntry) => {
      if (
        !zipEntry.name.match(/\.(ogg|wav|mp3|aiff|flac|aac|wma|m4a|amr|3gp)$/)
      )
        return;

      NProgress.inc();
      const listItem = document.createElement("li");
      listItem.textContent = zipEntry.name;
      listItem.className = "audioListItem";

      const buttonsDiv = document.createElement("div");

      const playButton = document.createElement("button");
      playButton.textContent = "Play";
      playButton.className = "listItemButton";
      playButton.addEventListener("click", () => {
        zipEntry.async("blob").then((audioBlob) => {
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
      downloadButton.classList.add("listItemButton", "tooltip");
      downloadButton.addEventListener("click", () => {
        NProgress.start();
        zipEntry.async("blob").then((audioBlob) => {
          NProgress.done();
          const audioUrl = URL.createObjectURL(audioBlob);
          const link = document.createElement("a");
          link.href = audioUrl;
          link.download = zipEntry.name.split("/").pop(); // get filename
          link.click();
          URL.revokeObjectURL(audioUrl);
          link.remove();
        });
      });

      buttonsDiv.appendChild(playButton);
      buttonsDiv.appendChild(downloadButton);

      listItem.appendChild(buttonsDiv);
      fileList.appendChild(listItem);
    });

    NProgress.done();

    document.getElementById("popup").style.display = "block";
    document.getElementById("overlay").style.display = "block";
  } catch (error) {
    console.error("Error:", error);
  }
}

loadClickpacks();

function closePopup() {
  document.getElementById("popup").style.display = "none";
  document.getElementById("fileList").innerHTML = "";
  document.getElementById("overlay").style.display = "none";
}

// close popup button
document.getElementById("closePopup").addEventListener("click", closePopup);

// close popup by clicking outside of it
window.addEventListener("click", ({ target }) => {
  if (target === document.getElementById("overlay")) {
    closePopup();
  }
});
