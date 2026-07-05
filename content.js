(function bootstrapVideoFinder() {
  if (window.__videoFinderDownloaderContentLoaded) return;
  window.__videoFinderDownloaderContentLoaded = true;

  const scriptCache = new Map();
  let debugEnabled = false;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "SCAN_VIDEOS") return false;

    debugEnabled = Boolean(message.debug);
    window.VideoFinderDebugEnabled = debugEnabled;
    debugLog("Scan message received", message);

    scanVideos(Boolean(message.forceRefresh))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  });

  // Automatically trigger an initial scan once the content script bootstraps to update the badge count
  chrome.storage.local.get({ debugEnabled: false }).then((stored) => {
    debugEnabled = Boolean(stored.debugEnabled);
    window.VideoFinderDebugEnabled = debugEnabled;
    debugLog("Automatic startup scan initiating");
    
    // Slight delay to ensure page elements and frames are rendered for detection
    setTimeout(() => {
      scanVideos(false).catch((err) => debugLog("Auto startup scan error", err));
    }, 1200);
  });

  // Keep scanning periodically or watch for mutations to catch dynamically loaded videos
  let autoScanTimeout = null;
  const observer = new MutationObserver(() => {
    if (autoScanTimeout) clearTimeout(autoScanTimeout);
    autoScanTimeout = setTimeout(() => {
      debugLog("Page mutation detected. Running auto-scan.");
      scanVideos(false).catch((err) => debugLog("Mutation scan error", err));
    }, 2500);
  });
  
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }

  async function scanVideos(forceRefresh) {
    debugLog("Starting scan", { forceRefresh, url: location.href });
    const handler = await loadDomainHandler(forceRefresh);
    debugLog("Handler selected", { name: handler?.name });
    const videos = await handler.scan({
      document,
      location,
      helpers: window.VideoFinderHelpers
    });

    const dedupedVideos = window.VideoFinderHelpers.dedupeVideos(videos);

    // Auto-update action badge based on count of available videos
    const totalSources = dedupedVideos.reduce((acc, v) => acc + (v.sources || []).length, 0);
    chrome.runtime.sendMessage({
      type: "UPDATE_BADGE",
      count: totalSources
    }).catch(() => {});

    debugLog("Scan completed", {
      rawVideoGroups: Array.isArray(videos) ? videos.length : 0,
      dedupedVideoGroups: dedupedVideos.length,
      videos: dedupedVideos
    });

    return {
      scriptName: handler.name || "common",
      videos: dedupedVideos
    };
  }

  async function loadDomainHandler(forceRefresh) {
    const host = location.hostname.replace(/^www\./, "").toLowerCase();
    const candidateNames = buildScriptCandidateNames(host);
    debugLog("Domain script candidates", { host, candidateNames });

    for (const scriptName of candidateNames) {
      const handler = await loadScriptHandler(scriptName, forceRefresh);
      if (handler) return handler;
    }

    return loadScriptHandler("common", forceRefresh);
  }

  function buildScriptCandidateNames(host) {
    const parts = host.split(".").filter(Boolean);
    const candidates = new Set();

    // Example: videos.example.com -> videos.example.com.js, example.com.js, example.js
    for (let index = 0; index < parts.length - 1; index += 1) {
      candidates.add(parts.slice(index).join("."));
    }
    if (parts.length >= 2) candidates.add(parts[parts.length - 2]);

    return [...candidates].map((name) => name.replace(/[^a-z0-9.-]/g, ""));
  }

  async function loadScriptHandler(scriptName, forceRefresh) {
    if (!forceRefresh && scriptCache.has(scriptName)) return scriptCache.get(scriptName);

    try {
      window.VideoFinderScripts = window.VideoFinderScripts || {};
      debugLog("Requesting script injection", { scriptName, forceRefresh });
      const response = await chrome.runtime.sendMessage({
        type: "INJECT_DOMAIN_SCRIPT",
        scriptName,
        debug: debugEnabled
      });

      if (!response?.ok) {
        debugLog("Script injection not available", { scriptName, response });
        scriptCache.set(scriptName, null);
        return null;
      }

      const handler = window.VideoFinderScripts[scriptName] || null;
      debugLog("Script injection completed", { scriptName, hasHandler: Boolean(handler) });
      scriptCache.set(scriptName, handler);
      return handler;
    } catch (error) {
      debugLog("Script injection failed", { scriptName, error });
      scriptCache.set(scriptName, null);
      return null;
    }
  }

  window.VideoFinderHelpers = {
    normalizeUrl(url) {
      if (!url || String(url).startsWith("blob:")) return "";
      try {
        return new URL(url, location.href).href;
      } catch {
        return "";
      }
    },

    getPosterThumbnail() {
      // Find poster from standard HTML video tags
      const video = document.querySelector("video[poster]");
      if (video && video.getAttribute("poster")) {
        return this.normalizeUrl(video.getAttribute("poster"));
      }

      // Find from og:image meta tag
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg && ogImg.getAttribute("content")) {
        return this.normalizeUrl(ogImg.getAttribute("content"));
      }

      // Find from twitter:image meta tag
      const twImg = document.querySelector('meta[name="twitter:image"]');
      if (twImg && twImg.getAttribute("content")) {
        return this.normalizeUrl(twImg.getAttribute("content"));
      }

      return "";
    },

    extensionFromUrl(url) {
      try {
        const cleanPath = new URL(url).pathname.toLowerCase();
        const match = cleanPath.match(/\.([a-z0-9]{2,5})$/);
        return match ? match[1] : "";
      } catch {
        return "";
      }
    },

    qualityFromText(text) {
      const value = String(text || "");
      const quality = value.match(/(2160|1440|1080|720|540|480|360|240)p?/i);
      return quality ? `${quality[1]}p` : "Auto/Unknown";
    },

    qualityFromDimensions(width, height) {
      const h = Number(height || 0);
      if (h >= 2000) return "2160p";
      if (h >= 1300) return "1440p";
      if (h >= 1000) return "1080p";
      if (h >= 700) return "720p";
      if (h >= 500) return "540p";
      if (h >= 430) return "480p";
      if (h >= 300) return "360p";
      return width || height ? `${width || "?"}×${height || "?"}` : "Auto/Unknown";
    },

    dedupeVideos(videos) {
      const seenSources = new Set();
      const cleaned = [];

      for (const video of Array.isArray(videos) ? videos : []) {
        const sources = [];
        for (const source of video.sources || []) {
          const normalizedUrl = this.normalizeUrl(source.url);
          if (!normalizedUrl || seenSources.has(normalizedUrl)) continue;
          seenSources.add(normalizedUrl);
          sources.push({
            ...source,
            url: normalizedUrl,
            extension: source.extension || this.extensionFromUrl(normalizedUrl),
            quality: source.quality || this.qualityFromText(normalizedUrl)
          });
        }

        if (sources.length) {
          cleaned.push({
            title: video.title || document.title || "Video",
            pageUrl: video.pageUrl || location.href,
            type: video.type || "media",
            thumbnail: video.thumbnail || this.getPosterThumbnail(),
            sources: sources.sort(sortSourcesByQuality)
          });
        }
      }

      return cleaned;
    },

    debug(message, data) {
      debugLog(message, data);
    }
  };

  function sortSourcesByQuality(a, b) {
    return qualityNumber(b.quality) - qualityNumber(a.quality);
  }

  function qualityNumber(value) {
    const match = String(value || "").match(/(\d{3,4})/);
    return match ? Number(match[1]) : 0;
  }

  function debugLog(message, data) {
    if (!debugEnabled && !window.VideoFinderDebugEnabled) return;
    if (data === undefined) {
      console.log("[VideoFinder:content]", message);
      return;
    }
    console.log("[VideoFinder:content]", message, data);
  }
})();