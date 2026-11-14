(() => {
    const fallbackDelay = 2500;
    const mediaElements = document.querySelectorAll(
        "img[data-local-src][data-remote-src], video[data-local-src][data-remote-src], audio[data-local-src][data-remote-src]"
    );

    for (const element of mediaElements) {
        const localUrl = element.dataset.localSrc;
        const remoteUrl = element.dataset.remoteSrc;
        let usingRemote = false;
        let timeout;

        const useRemote = () => {
            if (usingRemote) {
                return;
            }
            usingRemote = true;
            clearTimeout(timeout);
            element.src = remoteUrl;
            if (element instanceof HTMLMediaElement) {
                element.load();
            }
        };
        const localLoaded = () => {
            if (!usingRemote) {
                clearTimeout(timeout);
            }
        };

        element.addEventListener("error", useRemote, { once: true });
        if (element instanceof HTMLImageElement) {
            element.addEventListener("load", localLoaded, { once: true });
        } else {
            element.addEventListener("loadedmetadata", localLoaded, { once: true });
            element.addEventListener("canplay", localLoaded, { once: true });
        }

        timeout = setTimeout(useRemote, fallbackDelay);
        element.src = localUrl;
        if (element instanceof HTMLMediaElement) {
            element.load();
        }
    }

    const backgroundElements = document.querySelectorAll(
        "[data-attachment-background][data-local-src][data-remote-src]"
    );
    for (const element of backgroundElements) {
        const localUrl = escapeCssUrl(element.dataset.localSrc);
        const remoteUrl = escapeCssUrl(element.dataset.remoteSrc);
        element.style.backgroundImage = `url("${localUrl}"), url("${remoteUrl}")`;
    }

    function escapeCssUrl(value) {
        return value.replace(/["\\\n\r]/g, "\\$&");
    }
})();
