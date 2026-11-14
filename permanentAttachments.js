const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const TAILSCALE_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

class AttachmentLookupError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = "AttachmentLookupError";
        this.statusCode = statusCode;
    }
}

function createAttachmentStore(databasePath) {
    if (databasePath !== ":memory:") {
        fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }

    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("busy_timeout = 5000");
    database.exec(`
        CREATE TABLE IF NOT EXISTS permanent_attachments (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            attachment_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    `);
    database.exec(`
        CREATE INDEX IF NOT EXISTS idx_permanent_attachments_source
        ON permanent_attachments (channel_id, message_id, attachment_id)
    `);

    const insertAttachment = database.prepare(`
        INSERT INTO permanent_attachments
            (id, channel_id, message_id, attachment_id, filename, created_at)
        VALUES
            (@id, @channel_id, @message_id, @attachment_id, @filename, @created_at)
    `);
    const deleteAttachment = database.prepare("DELETE FROM permanent_attachments WHERE id = ?");
    const findAttachment = database.prepare(`
        SELECT id, channel_id, message_id, attachment_id, filename, created_at
        FROM permanent_attachments
        WHERE channel_id = ? AND message_id = ? AND attachment_id = ?
        ORDER BY rowid
        LIMIT 1
    `);
    const insertAttachments = database.transaction((attachments) => attachments.map((attachment) => {
        const existing = findAttachment.get(
            attachment.channel_id,
            attachment.message_id,
            attachment.attachment_id
        );
        if (existing) {
            return existing;
        }

        for (let attempt = 0; attempt < 5; attempt++) {
            const record = {
                id: crypto.randomBytes(16).toString("base64url"),
                channel_id: attachment.channel_id,
                message_id: attachment.message_id,
                attachment_id: attachment.attachment_id,
                filename: attachment.filename,
                created_at: new Date().toISOString()
            };

            try {
                insertAttachment.run(record);
                return record;
            } catch (error) {
                if (error.code !== "SQLITE_CONSTRAINT_PRIMARYKEY" || attempt === 4) {
                    throw error;
                }
            }
        }
        throw new Error("Unable to create a unique attachment identifier");
    }));

    return {
        addMany(attachments) {
            return insertAttachments(attachments);
        },
        get(id) {
            return database.prepare(`
                SELECT id, channel_id, message_id, attachment_id, filename, created_at
                FROM permanent_attachments
                WHERE id = ?
            `).get(id);
        },
        delete(id) {
            return deleteAttachment.run(id).changes > 0;
        },
        close() {
            database.close();
        }
    };
}

function getDiscordLookupStatus(error) {
    const code = Number(error.code);
    if (code === 10003 || code === 10008 || error.status === 404) {
        return 404;
    }
    if (code === 50001 || code === 50013 || error.status === 403) {
        return 403;
    }
    if (error.status === 429 || error.status >= 500) {
        return 503;
    }
    return 502;
}

async function getCurrentAttachmentUrl(client, attachment) {
    let channel;
    let message;
    try {
        channel = await client.channels.fetch(attachment.channel_id);
        if (!channel || !channel.isTextBased() || !channel.messages) {
            throw new AttachmentLookupError(404, "Original channel not found");
        }
        message = await channel.messages.fetch({
            message: attachment.message_id,
            force: true
        });
    } catch (error) {
        if (error instanceof AttachmentLookupError) {
            throw error;
        }
        throw new AttachmentLookupError(getDiscordLookupStatus(error), "Discord message lookup failed");
    }

    const currentAttachment = message.attachments.get(attachment.attachment_id);
    if (!currentAttachment) {
        throw new AttachmentLookupError(404, "Original attachment not found");
    }

    let currentUrl;
    try {
        currentUrl = new URL(currentAttachment.url);
    } catch {
        throw new AttachmentLookupError(502, "Discord returned an invalid attachment URL");
    }

    if (currentUrl.protocol !== "https:" || !TAILSCALE_ATTACHMENT_HOSTS.has(currentUrl.hostname)) {
        throw new AttachmentLookupError(502, "Discord returned an unexpected attachment host");
    }

    return currentUrl.href;
}

function isTailscaleAddress(address) {
    if (typeof address !== "string") {
        return false;
    }

    const normalizedAddress = address.split("%")[0];
    if (normalizedAddress.startsWith("::ffff:")) {
        return isTailscaleAddress(normalizedAddress.slice(7));
    }

    if (net.isIPv4(normalizedAddress)) {
        const [first, second] = normalizedAddress.split(".").map(Number);
        return first === 100 && second >= 64 && second <= 127;
    }

    if (!net.isIPv6(normalizedAddress)) {
        return false;
    }

    const [leftPart, rightPart = ""] = normalizedAddress.split("::");
    const leftGroups = leftPart ? leftPart.split(":") : [];
    const rightGroups = rightPart ? rightPart.split(":") : [];
    const zeroCount = 8 - leftGroups.length - rightGroups.length;
    const groups = [
        ...leftGroups,
        ...Array(Math.max(0, zeroCount)).fill("0"),
        ...rightGroups
    ].map((group) => Number.parseInt(group || "0", 16));

    return groups.length === 8 &&
        groups[0] === 0xfd7a &&
        groups[1] === 0x115c &&
        groups[2] === 0xa1e0;
}

function isPrivateIpv4Address(address) {
    if (typeof address !== "string") {
        return false;
    }

    if (address.startsWith("::ffff:")) {
        return isPrivateIpv4Address(address.slice(7));
    }
    if (!net.isIPv4(address)) {
        return false;
    }

    const [first, second] = address.split(".").map(Number);
    return first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
}

function isAllowedNetworkAddress(address) {
    return isTailscaleAddress(address) || isPrivateIpv4Address(address);
}

function discoverNetworkAddresses(interfaces = os.networkInterfaces()) {
    const addresses = [];
    for (const [name, interfaceAddresses] of Object.entries(interfaces)) {
        for (const address of interfaceAddresses || []) {
            if (!address.internal && (address.family === "IPv4" || address.family === 4)) {
                addresses.push({ name, address: address.address });
            }
        }
    }

    const tailscaleIpv4 = addresses
        .filter(({ address }) => isTailscaleAddress(address))
        .sort((left, right) => Number(!/^tailscale/i.test(left.name)) - Number(!/^tailscale/i.test(right.name)))[0]?.address;
    const localIpv4 = addresses
        .filter(({ name, address }) =>
            isPrivateIpv4Address(address) &&
            !/^(tailscale|docker|br-|veth|virbr|vmnet|vboxnet)/i.test(name))
        .sort((left, right) => {
            const interfacePriority = (name) => /^(eth|en|wlan|wl)/i.test(name) ? 0 : 1;
            const subnetPriority = (address) => {
                if (address.startsWith("192.168.")) return 0;
                if (address.startsWith("10.")) return 1;
                return 2;
            };
            return interfacePriority(left.name) - interfacePriority(right.name) ||
                subnetPriority(left.address) - subnetPriority(right.address) ||
                left.name.localeCompare(right.name);
        })[0]?.address;

    return { localIpv4: localIpv4 || null, tailscaleIpv4: tailscaleIpv4 || null };
}

function createAttachmentServer({
    store,
    client,
    isAllowedAddress = isAllowedNetworkAddress,
    logger = console
}) {
    const rateLimits = new Map();
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [address, limit] of rateLimits) {
            if (limit.resetAt <= now) {
                rateLimits.delete(address);
            }
        }
    }, RATE_LIMIT_WINDOW_MS);
    cleanupInterval.unref();

    const server = http.createServer((request, response) => {
        void handleRequest(request, response).catch((error) => {
            logger.error("Unexpected permanent attachment server error:", error.message);
            sendResponse(response, 500, "Internal server error");
        });
    });

    async function handleRequest(request, response) {
        setResponseHeaders(response);

        const remoteAddress = request.socket.remoteAddress || "";
        if (!isAllowedAddress(remoteAddress)) {
            sendResponse(response, 403, "Forbidden");
            return;
        }

        const now = Date.now();
        const limit = rateLimits.get(remoteAddress);
        if (!limit || limit.resetAt <= now) {
            rateLimits.set(remoteAddress, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        } else if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
            response.setHeader("Retry-After", String(Math.ceil((limit.resetAt - now) / 1000)));
            sendResponse(response, 429, "Too many requests");
            return;
        } else {
            limit.count++;
        }

        if (request.method === "OPTIONS") {
            response.writeHead(204);
            response.end();
            return;
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
            response.setHeader("Allow", "GET, HEAD, OPTIONS");
            sendResponse(response, 405, "Method not allowed");
            return;
        }

        let pathname;
        try {
            pathname = new URL(request.url, "http://localhost").pathname;
        } catch {
            sendResponse(response, 404, "Not found");
            return;
        }

        const match = /^\/file\/([A-Za-z0-9_-]{22})$/.exec(pathname);
        if (!match || !ID_PATTERN.test(match[1])) {
            sendResponse(response, 404, "Not found");
            return;
        }

        const attachment = store.get(match[1]);
        if (!attachment) {
            sendResponse(response, 404, "Not found");
            return;
        }

        try {
            const currentUrl = await getCurrentAttachmentUrl(client, attachment);
            response.writeHead(302, {
                Location: currentUrl,
                "Cache-Control": "no-store, private, max-age=0"
            });
            response.end();
        } catch (error) {
            const statusCode = error instanceof AttachmentLookupError ? error.statusCode : 500;
            if (statusCode >= 500) {
                logger.error("Permanent attachment resolution failed:", error.message);
            }
            sendResponse(response, statusCode, statusCode === 404
                ? "Attachment not found"
                : statusCode === 403
                    ? "The bot cannot access this message"
                    : statusCode === 502 || statusCode === 503
                        ? "Discord is temporarily unavailable"
                        : "Internal server error");
        }
    }

    server.on("close", () => clearInterval(cleanupInterval));
    return server;
}

function setResponseHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Cache-Control", "no-store, private, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendResponse(response, statusCode, message) {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(response.req.method === "HEAD" ? undefined : message);
}

module.exports = {
    createAttachmentServer,
    createAttachmentStore,
    discoverNetworkAddresses,
    getCurrentAttachmentUrl,
    isAllowedNetworkAddress,
    isPrivateIpv4Address,
    isTailscaleAddress
};
