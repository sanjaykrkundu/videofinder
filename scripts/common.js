(function registerCommonVideoFinderScript() {
  window.VideoFinderScripts = window.VideoFinderScripts || {};

  window.VideoFinderScripts.common = {
    name: "common",

    async scan({ document, location, helpers }) {
      helpers.debug("Common scanner started", { url: location.href, title: document.title });
      const videos = [];
      const mediaSources = collectHtmlMediaSources(document, helpers);
      const linkSources = collectLinkedMediaSources(document, helpers);
      const manifestSources = collectManifestSources(document, helpers);

      helpers.debug("Common scanner source counts", {
        htmlMedia: mediaSources.length,
        linkedMedia: linkSources.length,
        manifests: manifestSources.length
      });

      if (mediaSources.length) {
        videos.push({
          title: document.title || "HTML video",
          pageUrl: location.href,
          type: "html-video",
          sources: mediaSources
        });
      }

      if (linkSources.length) {
        videos.push({
          title: document.title || "Linked media",
          pageUrl: location.href,
          type: "linked-media",
          sources: linkSources
        });
      }

      if (manifestSources.length) {
        videos.push({
          title: document.title || "Streaming playlist",
          pageUrl: location.href,
          type: "playlist/manifest",
          sources: manifestSources
        });
      }

      helpers.debug("Common scanner finished", { groups: videos.length, videos });
      return videos;
    }
  };

  function collectHtmlMediaSources(document, helpers) {
    const sources = [];
    document.querySelectorAll("video, audio").forEach((media, index) => {
      const directUrl = helpers.normalizeUrl(media.currentSrc || media.src);
      if (directUrl) {
        helpers.debug("HTML media direct source found", { index, url: directUrl });
        sources.push(sourceFromUrl(directUrl, {
          quality: helpers.qualityFromDimensions(media.videoWidth, media.videoHeight),
          mimeType: media.type || "",
          label: media.getAttribute("title") || `Media ${index + 1}`
        }, helpers));
      }

      media.querySelectorAll("source[src]").forEach((source) => {
        const url = helpers.normalizeUrl(source.getAttribute("src"));
        if (!url) return;
        helpers.debug("HTML media nested source found", { index, url });
        sources.push(sourceFromUrl(url, {
          quality: source.getAttribute("label") || source.getAttribute("res") || helpers.qualityFromText(url),
          mimeType: source.getAttribute("type") || ""
        }, helpers));
      });
    });
    return sources;
  }

  function collectLinkedMediaSources(document, helpers) {
    const mediaExtensionPattern = /\.(mp4|m4v|webm|mov|mkv|avi|mp3|m4a|aac|ogg)(?:[?#]|$)/i;
    return [...document.querySelectorAll("a[href], link[href]")]
      .map((element) => helpers.normalizeUrl(element.href || element.getAttribute("href")))
      .filter((url) => mediaExtensionPattern.test(url))
      .map((url) => sourceFromUrl(url, { quality: helpers.qualityFromText(url) }, helpers));
  }

  function collectManifestSources(document, helpers) {
    const manifestPattern = /\.(m3u8|mpd)(?:[?#]|$)/i;
    const attrValues = [];

    document.querySelectorAll("[src], [href], [data-src], [data-video], [data-url]").forEach((element) => {
      ["src", "href", "data-src", "data-video", "data-url"].forEach((attr) => {
        const value = element.getAttribute(attr);
        if (value) attrValues.push(value);
      });
    });

    const htmlMatches = document.documentElement.innerHTML.match(/https?:[^'"\\\s<>]+\.(?:m3u8|mpd)(?:[^'"\\\s<>]*)?/gi) || [];

    return [...attrValues, ...htmlMatches]
      .map((url) => helpers.normalizeUrl(url))
      .filter((url) => manifestPattern.test(url))
      .map((url) => sourceFromUrl(url, {
        quality: "Playlist/Manifest",
        mimeType: url.includes(".mpd") ? "application/dash+xml" : "application/vnd.apple.mpegurl"
      }, helpers));
  }

  function sourceFromUrl(url, options, helpers) {
    return {
      url,
      quality: options.quality || helpers.qualityFromText(url),
      extension: helpers.extensionFromUrl(url),
      mimeType: options.mimeType || mimeTypeFromExtension(helpers.extensionFromUrl(url)),
      label: options.label || ""
    };
  }

  function mimeTypeFromExtension(extension) {
    const types = {
      mp4: "video/mp4",
      m4v: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      m3u8: "application/vnd.apple.mpegurl",
      mpd: "application/dash+xml",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      ogg: "audio/ogg"
    };
    return types[extension] || "";
  }
})();