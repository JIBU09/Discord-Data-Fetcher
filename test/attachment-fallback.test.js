const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

class FakeElement {
    constructor(dataset = {}) {
        this.dataset = dataset;
        this.listeners = new Map();
        this.style = {};
        this.src = "";
    }

    addEventListener(name, callback, options = {}) {
        const listeners = this.listeners.get(name) || [];
        listeners.push({ callback, once: options.once });
        this.listeners.set(name, listeners);
    }

    emit(name) {
        const listeners = this.listeners.get(name) || [];
        for (const listener of [...listeners]) {
            listener.callback();
            if (listener.once) {
                this.listeners.set(name, listeners.filter((item) => item !== listener));
            }
        }
    }
}

class FakeImageElement extends FakeElement {}

class FakeMediaElement extends FakeElement {
    constructor(dataset) {
        super(dataset);
        this.loadCount = 0;
    }

    load() {
        this.loadCount++;
    }
}

test("browser helper switches media to Tailscale and layers CSS fallbacks", () => {
    const image = new FakeImageElement({
        localSrc: "http://192.168.1.25/file/id",
        remoteSrc: "http://100.100.10.25/file/id"
    });
    const video = new FakeMediaElement({
        localSrc: "http://192.168.1.25/file/video",
        remoteSrc: "http://100.100.10.25/file/video"
    });
    const background = new FakeElement({
        localSrc: "http://192.168.1.25/file/background",
        remoteSrc: "http://100.100.10.25/file/background"
    });
    const timers = new Map();
    let nextTimerId = 0;
    const script = fs.readFileSync(
        path.join(__dirname, "..", "attachment-fallback.js"),
        "utf8"
    );

    vm.runInNewContext(script, {
        document: {
            querySelectorAll(selector) {
                if (selector.startsWith("img")) {
                    return [image, video];
                }
                if (selector.startsWith("[data-attachment-background]")) {
                    return [background];
                }
                return [];
            }
        },
        HTMLImageElement: FakeImageElement,
        HTMLMediaElement: FakeMediaElement,
        setTimeout(callback) {
            const id = ++nextTimerId;
            timers.set(id, callback);
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        }
    });

    assert.equal(image.src, "http://192.168.1.25/file/id");
    image.emit("error");
    assert.equal(image.src, "http://100.100.10.25/file/id");

    assert.equal(video.src, "http://192.168.1.25/file/video");
    assert.equal(video.loadCount, 1);
    const videoTimer = [...timers.values()][0];
    videoTimer();
    assert.equal(video.src, "http://100.100.10.25/file/video");
    assert.equal(video.loadCount, 2);

    assert.match(background.style.backgroundImage, /192\.168\.1\.25/);
    assert.match(background.style.backgroundImage, /100\.100\.10\.25/);
});
