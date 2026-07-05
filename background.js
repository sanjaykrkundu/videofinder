chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "UPDATE_BADGE") {
    const count = Number(message.count || 0);
    const badgeText = count > 0 ? String(count) : "";
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.action.setBadgeText({ tabId, text: badgeText });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#22c55e" });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GET_FILE_SIZE") {
    fetch(message.url, { method: "HEAD" })
      .then((res) => {
        const size = res.headers.get("content-length");
        sendResponse({ ok: true, size: size ? Number(size) : null });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "INJECT_DOMAIN_SCRIPT") {
    debugLog(Boolean(message.debug), "Inject domain script requested", {
      scriptName: message.scriptName,
      tabId: sender.tab?.id,
      url: sender.tab?.url
    });
    injectDomainScript(message.scriptName, sender.tab?.id, sendResponse);
    return true;
  }

  if (message?.type !== "DOWNLOAD_VIDEO") return false;

  const source = message.source || {};
  debugLog(Boolean(message.debug), "Download requested", source);
  if (!source.url) {
    sendResponse({ ok: false, error: "Missing video URL." });
    return false;
  }

  const filename = sanitizeDownloadPath(source.filename);

  console.log("Download filename:", filename);
  console.log("Original filename:", source);

  chrome.downloads.download(
    {
      url: source.url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError, downloadId)
        debugLog(Boolean(message.debug), "Download failed", chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      debugLog(Boolean(message.debug), "Download started", { downloadId });
      sendResponse({ ok: true, downloadId });
    }
  );

  return true;
});

function injectDomainScript(scriptName, tabId, sendResponse) {
  if (!tabId) {
    sendResponse({ ok: false, error: "No tab available for script injection." });
    return;
  }

  if (!/^[a-z0-9.-]+$/i.test(scriptName || "")) {
    sendResponse({ ok: false, error: "Invalid script name." });
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId },
      files: [`scripts/${scriptName}.js`]
    },
    () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ ok: true });
    }
  );
}

function debugLog(enabled, message, data) {
  if (!enabled) return;
  if (data === undefined) {
    console.debug("[VideoFinder:background]", message);
    return;
  }
  console.debug("[VideoFinder:background]", message, data);
}

// function sanitizeDownloadPath(filename) {
//   return String(filename)
//     .replace(/[\\:*?"<>|]+/g, "-")
//     .replace(/^\.+/, "")
//     .replace(/\s+/g, " ")
//     .trim()
//     .slice(0, 150) || "video.mp4";
// }


function sanitizeDownloadPath(filename) {
  return String(filename)
    // Remove Unicode formatting/invisible characters
    .replace(/[\u200B-\u200D\u2060-\u206F\uFEFF]/g, "")
    // Remove Windows-invalid characters
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "video.mp4";
}

function sanitizeDownloadPath_2(filename) {
  if (!filename) return "video.mp4";

  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  return filename
    .replace(/[<>:"\\|?*\x00-\x1F]/g, "-") // illegal chars
    .replace(/\/+/g, "/")                  // collapse multiple /
    .replace(/^\/+/, "")                   // remove leading /
    .replace(/\.\./g, "")                  // remove ..
    .split("/")
    .map(part =>
      part
        .trim()
        .replace(/[. ]+$/, "")             // remove trailing dots/spaces
        .replace(RESERVED, "_$1")
    )
    .filter(Boolean)
    .join("/")
    .slice(0, 240) || "video.mp4";
}