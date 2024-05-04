let table = document.getElementById('clickpack-tbl');

Object.defineProperty(Number.prototype, 'fileSize', {
  value: function(a, b, c, d) {
    return (a = a ? [1e3, 'k', 'B'] : [1024, 'K', 'iB'], b = Math, c = b.log,
            d = c(this) / c(a[0]) | 0, this / b.pow(a[0], d))
               .toFixed(2) +
        ' ' + (d ? (a[1] + 'MGTPEZY')[--d] + a[2] : 'Bytes');
  },
  writable: false,
  enumerable: false
});

function tagHtml(text, help) {
  return `<span class="tooltip unselectable tag">${
      text}<span class="tooltiptext">${help}</span></span>`
}

function tryPopup() {
  Swal.fire('TODO');
}

function countProperties(obj) {
  let count = 0;
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) ++count;
  }
  return count;
}

// https://stackoverflow.com/a/3177838
function timeSince(date) {
  let seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) {
    return Math.floor(interval) + ' years';
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + ' months';
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + ' days';
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + ' hours';
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + ' minutes';
  }
  return Math.floor(seconds) + ' seconds';
}

const DB_URL =
    'https://zeozeozeo.github.io/clickpack-db/db.json';

async function loadClickpacks() {
  try {
    const response = await fetch(DB_URL);
    const data = await response.json();

    const updatedDate = new Date(data.updated_at_iso);
    document.getElementById('loading-span').innerHTML = `Listing ${
        countProperties(
            data.clickpacks)} entries. Last updated <span class="tooltip">${
        timeSince(updatedDate)} ago <span class="tooltiptext">${
        updatedDate.toString()}</span></span>`;

    for (const [key, clickpack] of Object.entries(data.clickpacks)) {
      const row = table.insertRow();
      const cell = row.insertCell();
      let html = `<div class="clickpack"><span><span href="${clickpack.url}">${
          key}</span></span>`;
      if (clickpack.has_noise) {
        html += tagHtml('🔊', 'This clickpack has a noise file');
      }
      html += '</div>';
      cell.innerHTML = html;

      const cell2 = row.insertCell();
      const size = clickpack.size.fileSize(1);
      cell2.innerHTML = `<a class="button-3 tooltip" role="button" href="${
          clickpack.url}">Download <span class="tooltiptext">${
          size}</span></a><button onclick="tryPopup()" style="margin:0px 5px;" class="button-4" role="button">Try</button>${
          size}`;
    }
  } catch (error) {
    console.error('Failed to load clickpacks:', error);
  }
}

loadClickpacks();
