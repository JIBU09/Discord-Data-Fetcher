const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { once } = require("node:events");
const {
    createAttachmentServer,
    createAttachmentStore,
    discoverNetworkAddresses,
    getCurrentAttachmentUrl,
    isAllowedNetworkAddress,
    isPrivateIpv4Address,
    isTailscaleAddress
} = require("../permanentAttachments");

const stores = [];
after(() => {
    for (const store of stores) {
        store.close();
    }
});

function createStore() {
    const store = createAttachmentStore(":memory:");
    stores.push(store);
    return store;
}

function createDiscordClient(attachmentUrls) {
    let fetchCount = 0;
    const client = {
        channels: {
            async fetch(channelId) {
                assert.equal(channelId, "channel-1");
                return {
                    isTextBased: () => true,
                    messages: {
                        async fetch(options) {
                            assert.equal(options.message, "message-1");
                            assert.equal(options.force, true);
                            const url = attachmentUrls[fetchCount++];
                            return {
                                attachments: new Map([
                                    ["attachment-1", { url }]
                                ])
                            };
                        }
                    }
                };
            }
        }
    };

    return { client, getFetchCount: () => fetchCount };
}

test("stores attachment metadata under a random ID without a CDN URL", () => {
    const store = createStore();
    const [record] = store.addMany([{
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1",
        filename: "video.mp4"
    }]);

    assert.match(record.id, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(Number.isFinite(Date.parse(record.created_at)));
    assert.deepEqual(store.get(record.id), record);
    assert.equal(Object.hasOwn(record, "url"), false);
    assert.equal(store.get("unknown"), undefined);
});

test("reuses the existing link for the same Discord attachment", () => {
    const store = createStore();
    const attachment = {
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1",
        filename: "video.mp4"
    };
    const first = store.addOne(attachment);
    const second = store.addOne({
        ...attachment,
        channel_id: "another-channel",
        message_id: "another-message"
    });

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.deepEqual(second.record, first.record);
});

test("deletes only the requested permanent URL ID", () => {
    const store = createStore();
    const [record] = store.addMany([{
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1",
        filename: "video.mp4"
    }]);

    assert.equal(store.delete(record.id), true);
    assert.equal(store.get(record.id), undefined);
    assert.equal(store.delete(record.id), false);
});

test("keeps generated IDs and metadata after reopening the SQLite database", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "permanent-attachments-"));
    const databasePath = path.join(directory, "attachments.sqlite");
    const firstStore = createAttachmentStore(databasePath);
    const [record] = firstStore.addMany([{
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1",
        filename: "video.mp4"
    }]);
    stores.push(firstStore);
    firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = createAttachmentStore(databasePath);
    stores.push(reopenedStore);
    t.after(() => {
        reopenedStore.close();
        stores.splice(stores.indexOf(reopenedStore), 1);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const existing = reopenedStore.addOne({
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1",
        filename: "video.mp4"
    });
    assert.equal(existing.reused, true);
    assert.deepEqual(existing.record, record);
    assert.deepEqual(reopenedStore.get(record.id), record);
});

test("fetches a fresh message and returns the current attachment URL", async () => {
    const { client, getFetchCount } = createDiscordClient([
        "https://cdn.discordapp.com/attachments/1/1?ex=first",
        "https://cdn.discordapp.com/attachments/1/1?ex=second"
    ]);
    const attachment = {
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1"
    };

    assert.match(await getCurrentAttachmentUrl(client, attachment), /ex=first$/);
    assert.match(await getCurrentAttachmentUrl(client, attachment), /ex=second$/);
    assert.equal(getFetchCount(), 2);
});

test("maps missing Discord messages and attachments to not found", async () => {
    const missingMessageClient = {
        channels: {
            async fetch() {
                const error = new Error("Unknown Message");
                error.code = 10008;
                throw error;
            }
        }
    };

    await assert.rejects(
        getCurrentAttachmentUrl(missingMessageClient, { channel_id: "channel-1" }),
        { statusCode: 404 }
    );

    const noAttachmentClient = {
        channels: {
            async fetch() {
                return {
                    isTextBased: () => true,
                    messages: {
                        async fetch() {
                            return { attachments: new Map() };
                        }
                    }
                };
            }
        }
    };

    await assert.rejects(
        getCurrentAttachmentUrl(noAttachmentClient, {
            channel_id: "channel-1",
            message_id: "message-1",
            attachment_id: "attachment-1"
        }),
        { statusCode: 404 }
    );
});

test("allows private LAN and Tailscale addresses only", () => {
    assert.equal(isTailscaleAddress("100.64.0.1"), true);
    assert.equal(isTailscaleAddress("100.127.255.254"), true);
    assert.equal(isTailscaleAddress("::ffff:100.100.10.2"), true);
    assert.equal(isTailscaleAddress("fd7a:115c:a1e0::1234"), true);
    assert.equal(isPrivateIpv4Address("192.168.1.10"), true);
    assert.equal(isPrivateIpv4Address("10.0.0.8"), true);
    assert.equal(isPrivateIpv4Address("172.20.0.8"), true);
    assert.equal(isPrivateIpv4Address("172.32.0.8"), false);
    assert.equal(isAllowedNetworkAddress("192.168.1.10"), true);
    assert.equal(isAllowedNetworkAddress("8.8.8.8"), false);
    assert.equal(isTailscaleAddress("fd7a:115c:a1e1::1234"), false);
});

test("discovers physical LAN and Tailscale IPv4 addresses", () => {
    assert.deepEqual(discoverNetworkAddresses({
        docker0: [{ family: "IPv4", address: "172.17.0.1", internal: false }],
        eth0: [{ family: "IPv4", address: "192.168.1.25", internal: false }],
        tailscale0: [{ family: "IPv4", address: "100.100.10.25", internal: false }]
    }), {
        localIpv4: "192.168.1.25",
        tailscaleIpv4: "100.100.10.25"
    });
});

test("HTTP endpoint dynamically redirects and returns not found for unknown IDs", async (t) => {
    const store = createStore();
    const [record] = store.addMany([{
        channel_id: "channel-1",
        message_id: "message-1",
        attachment_id: "attachment-1",
        filename: "video.mp4"
    }]);
    const { client, getFetchCount } = createDiscordClient([
        "https://cdn.discordapp.com/attachments/1/1?ex=first",
        "https://cdn.discordapp.com/attachments/1/1?ex=second"
    ]);
    const server = createAttachmentServer({
        store,
        client,
        isAllowedAddress: () => true,
        logger: { error() {} }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const firstResponse = await fetch(`${baseUrl}/file/${record.id}`, { redirect: "manual" });
    const secondResponse = await fetch(`${baseUrl}/file/${record.id}`, { redirect: "manual" });
    const missingResponse = await fetch(`${baseUrl}/file/${"A".repeat(22)}`, { redirect: "manual" });

    assert.equal(firstResponse.status, 302);
    assert.match(firstResponse.headers.get("location"), /ex=first$/);
    assert.equal(firstResponse.headers.get("cache-control"), "no-store, private, max-age=0");
    assert.equal(secondResponse.status, 302);
    assert.match(secondResponse.headers.get("location"), /ex=second$/);
    assert.equal(getFetchCount(), 2);
    assert.equal(missingResponse.status, 404);
});

test("HTTP endpoint rejects requests outside LAN and Tailscale", async (t) => {
    const server = createAttachmentServer({
        store: createStore(),
        client: {},
        logger: { error() {} }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/file/${"A".repeat(22)}`);
    assert.equal(response.status, 403);
});

test("HTTP endpoint distinguishes Discord permission failures from service outages", async (t) => {
    const store = createStore();
    const [forbiddenRecord, unavailableRecord] = store.addMany([
        {
            channel_id: "forbidden-channel",
            message_id: "message-1",
            attachment_id: "attachment-1",
            filename: "forbidden.png"
        },
        {
            channel_id: "unavailable-channel",
            message_id: "message-1",
            attachment_id: "attachment-2",
            filename: "unavailable.png"
        }
    ]);
    const client = {
        channels: {
            async fetch(channelId) {
                const error = new Error("Discord request failed");
                if (channelId === "forbidden-channel") {
                    error.code = 50013;
                    error.status = 403;
                } else {
                    error.status = 503;
                }
                throw error;
            }
        }
    };
    const server = createAttachmentServer({
        store,
        client,
        isAllowedAddress: () => true,
        logger: { error() {} }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const forbiddenResponse = await fetch(`${baseUrl}/file/${forbiddenRecord.id}`);
    const unavailableResponse = await fetch(`${baseUrl}/file/${unavailableRecord.id}`);

    assert.equal(forbiddenResponse.status, 403);
    assert.equal(unavailableResponse.status, 503);
});
