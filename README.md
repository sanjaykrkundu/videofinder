# Video Finder Downloader Chrome Extension

This Chrome extension scans the current page for downloadable video/audio sources, shows available sources/qualities, and starts downloads through Chrome's Downloads API.

> Important: this extension only downloads normal, accessible media URLs such as `.mp4`, `.webm`, `.m3u8`, or `.mpd` links found in page markup. It does **not** bypass DRM, login restrictions, encrypted streams, paywalls, or site terms.

## Features

- Popup UI with detected media sources and quality/source labels.
- Common scanner for HTML `<video>`, `<audio>`, `<source>`, media links, and visible playlist URLs.
- Domain-specific script system under `scripts/`.
- Automatic fallback to `scripts/common.js` when no domain script exists.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `desi49-2`.
5. Open a page with a video, play it if needed, then click the extension icon.

## Domain-specific scripts

Create a JavaScript file inside `scripts/` based on the site domain.

Examples:

- `scripts/example.com.js` for `example.com`
- `scripts/videos.example.com.js` for `videos.example.com`
- `scripts/example.js` as a shorter fallback for any `example.*` host

The loader tries domain-specific names first, then falls back to `scripts/common.js`.

Internally, the extension injects these script files with `chrome.scripting.executeScript`, which keeps it compatible with Manifest V3 content security rules.

Each domain script must register a handler like this:

```js
(function () {
  window.VideoFinderScripts = window.VideoFinderScripts || {};

  window.VideoFinderScripts["example.com"] = {
    name: "example.com",
    async scan({ document, location, helpers }) {
      return [{
        title: document.title,
        pageUrl: location.href,
        type: "domain-specific",
        sources: [{
          url: "https://example.com/video-720.mp4",
          quality: "720p",
          extension: "mp4",
          mimeType: "video/mp4"
        }]
      }];
    }
  };
})();
```

## Debug logs

Use the **Debug logs** checkbox in the extension popup to enable verbose logs.

Where to see logs:

- **Popup logs**: right-click the extension popup and choose **Inspect**.
- **Content/domain scanner logs**: open the page DevTools console. Logs are prefixed with `[VideoFinder:content]`.
- **Background logs**: go to `chrome://extensions`, find this extension, then click **service worker** under **Inspect views**. Logs are prefixed with `[VideoFinder:background]`.

The debug flag is stored in `chrome.storage.local` as `debugEnabled`, so it stays enabled after reopening the popup until you turn it off.

Domain scripts can write debug logs with:

```js
helpers.debug("Message", { any: "data" });
```

## Notes and limitations

- Blob URLs cannot be downloaded directly because they are temporary browser object URLs.
- Many streaming sites hide media URLs behind network requests, signed URLs, or DRM. This starter extension does not intercept or decrypt protected streams.
- Manifest playlist files (`.m3u8`, `.mpd`) may download as playlists, not merged video files. Merging segmented streams requires separate tooling and must respect site permissions/terms.