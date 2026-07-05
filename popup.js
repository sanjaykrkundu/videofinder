const statusEl = document.getElementById("status");
const videoListEl = document.getElementById("videoList");
const refreshBtn = document.getElementById("refreshBtn");
const pageHostEl = document.getElementById("pageHost");
const debugToggleEl = document.getElementById("debugToggle");

let activeTabId = null;
let debugEnabled = false;

refreshBtn.addEventListener("click", () => scanActiveTab(true));
debugToggleEl.addEventListener("change", async () => {
  debugEnabled = debugToggleEl.checked;
  await chrome.storage.local.set({ debugEnabled });
  debugLog("Debug flag changed", { debugEnabled });
  scanActiveTab(true);
});

document.addEventListener("DOMContentLoaded", initializePopup);

async function initializePopup() {
  const stored = await chrome.storage.local.get({ debugEnabled: false });
  debugEnabled = Boolean(stored.debugEnabled);
  debugToggleEl.checked = debugEnabled;
  debugLog("Popup initialized", { debugEnabled });
  scanActiveTab(false);
}

async function scanActiveTab(forceRefresh) {
  setStatus("Scanning page videos…");
  videoListEl.innerHTML = "";
  debugLog("Starting active tab scan", { forceRefresh });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error("No active tab found.");

    activeTabId = tab.id;
    pageHostEl.textContent = new URL(tab.url).hostname;
    debugLog("Active tab found", { tabId: tab.id, url: tab.url });

    const response = await sendMessageToTab(tab.id, {
      type: "SCAN_VIDEOS",
      forceRefresh,
      debug: debugEnabled
    });

    debugLog("Scan response received", response);

    if (!response?.ok) throw new Error(response?.error || "Could not scan videos on this page.");

    renderVideos(response.videos || [], response.scriptName || "common");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    debugLog("Sending message to content script", { tabId, message });
    chrome.tabs.sendMessage(tabId, message, async (response) => {
      if (!chrome.runtime.lastError) return resolve(response);

      // Content script may not be injected on already-open pages after install.
      try {
        debugLog("Content script missing, injecting content.js", chrome.runtime.lastError.message);
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        chrome.tabs.sendMessage(tabId, message, (retryResponse) => resolve(retryResponse));
      } catch (error) {
        debugLog("Content script injection failed", error);
        resolve({ ok: false, error: error.message || chrome.runtime.lastError?.message });
      }
    });
  });
}

function renderVideos(videos, scriptName) {
  debugLog("Rendering videos", { count: videos.length, scriptName, videos });
  if (!videos.length) {
    setStatus(`No downloadable video sources found. Script used: ${scriptName}`);
    videoListEl.innerHTML = `<p class="empty">Try playing the video first, then click refresh. Some sites use protected streams that cannot be downloaded.</p>`;
    return;
  }

  setStatus(`${videos.length} video source${videos.length === 1 ? "" : "s"} found. Script used: ${scriptName}`);
  videoListEl.innerHTML = videos.map((video, index) => createVideoCard(video, index)).join("");

  // Dynamically request and fill sizes asynchronously
  videos.forEach((video, videoIndex) => {
    video.sources.forEach((source, sourceIndex) => {
      chrome.runtime.sendMessage({ type: "GET_FILE_SIZE", url: source.url }, (response) => {
        if (response?.ok && response.size) {
          const sizeStr = formatBytes(response.size);
          const badgeEl = document.getElementById(`size-${videoIndex}-${sourceIndex}`);
          if (badgeEl) badgeEl.textContent = sizeStr;
          
          // Also update selector/option if needed
          const optionEl = document.getElementById(`opt-${videoIndex}-${sourceIndex}`);
          if (optionEl) {
            optionEl.dataset.size = sizeStr;
            updateCardDisplay(videoIndex);
          }
        }
      });
    });
  });

  videoListEl.querySelectorAll(".quality-select").forEach((select) => {
    select.addEventListener("change", () => {
      const card = select.closest(".video-card");
      const videoIndex = card.dataset.index;
      updateCardDisplay(videoIndex);
    });
  });

  videoListEl.querySelectorAll(".download-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".video-card");
      const select = card.querySelector(".quality-select");
      const option = select.selectedOptions[0];
      downloadVideo({
        url: option.value,
        filename: option.dataset.filename || "video",
        mimeType: option.dataset.mimeType || ""
      });
    });
  });
}

function updateCardDisplay(videoIndex) {
  const card = document.querySelector(`.video-card[data-index="${videoIndex}"]`);
  if (!card) return;
  const select = card.querySelector(".quality-select");
  const option = select.selectedOptions[0];
  if (!option) return;

  const sizeEl = card.querySelector(".info-size");
  if (sizeEl) sizeEl.textContent = option.dataset.size || "Unknown Size";
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "Unknown Size";
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

function createVideoCard(video, index) {
  const sources = video.sources || [];
  const title = escapeHtml(video.title || `Video ${index + 1}`);
  const sourceCount = sources.length;
  const thumbnail = video.thumbnail || "";

  // Set up initial selection values
  const defaultSource = sources[0] || {};
  const defaultMime = defaultSource.mimeType || "media";
  const defaultExt = defaultSource.extension || "mp4";
  const defaultType = `${defaultMime.split("/")[1] || defaultExt}`.toUpperCase();

  return `
    <article class="video-card" data-index="${index}">
      <div class="video-layout">
        <div class="thumbnail-wrapper">
          ${
            thumbnail
              ? `<img class="video-thumbnail" src="${escapeAttribute(thumbnail)}" alt="Video thumbnail" />`
              : `<div class="video-thumbnail placeholder-thumb">🎬</div>`
          }
        </div>
        <div class="video-details">
          <h2 class="video-title" title="${title}">${title}</h2>
          <div class="video-badges">
            <span class="info-badge info-quality">${escapeHtml(defaultSource.quality || "Auto")}</span>
            <span class="info-badge info-size" id="size-${index}-0">Fetching Size...</span>
            <span class="info-badge info-type">${escapeHtml(defaultType)}</span>
          </div>
          <div class="download-row">
            <select class="quality-select" ${sourceCount ? "" : "disabled"}>
              ${sources.map((source, sIndex) => createSourceOption(source, sIndex, video.title, index)).join("")}
            </select>
            <button class="download-btn" ${sourceCount ? "" : "disabled"} title="Download Instantly without prompts">Download</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function createSourceOption(source, sIndex, title, videoIndex) {
  const labelParts = [source.quality, source.extension, source.mimeType].filter(Boolean);
  const label = escapeHtml(labelParts.join(" • ") || "Unknown Quality");
  const url = escapeAttribute(source.url);
  const filename = escapeAttribute(buildFilename(title, source));
  const mimeType = escapeAttribute(source.mimeType || "");
  return `<option id="opt-${videoIndex}-${sIndex}" value="${url}" data-filename="${filename}" data-mime-type="${mimeType}" data-size="Fetching Size...">${label}</option>`;
}

async function downloadVideo(source) {
  setStatus("Starting download…");
  debugLog("Requesting download", source);
  const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_VIDEO", source, debug: debugEnabled });
  debugLog("Download response received", response);
  if (response?.ok) {
    setStatus("Download started. Check Chrome downloads.");
  } else {
    setStatus(response?.error || "Download failed.", true);
  }
}

function buildFilename(title, source) {
  const safeTitle = String(title || "video")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "video";
  const extension = source.extension || extensionFromUrl(source.url) || "mp4";
  return `${safeTitle}.${extension.replace(/^\./, "")}`;
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split(".").pop()?.slice(0, 5);
  } catch {
    return "mp4";
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function debugLog(message, data) {
  if (!debugEnabled) return;
  if (data === undefined) {
    console.debug("[VideoFinder:popup]", message);
    return;
  }
  console.debug("[VideoFinder:popup]", message, data);
}