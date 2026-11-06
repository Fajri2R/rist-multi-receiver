'use strict';

const fs = require('fs');
const path = require('path');

// Deployment identity lives outside the source tree. This module is the only
// writer, and it refuses anything that could escape its own directory or turn
// into a script/stylesheet URL.
const DATA_DIR = path.join(__dirname, '..', 'data');
const BRAND_DIR = path.join(DATA_DIR, 'brand');
const BRAND_FILE = path.join(DATA_DIR, 'brand.json');
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

// Defaults are deliberately neutral: a fresh clone shows no tenant identity.
const DEFAULTS = {
    name: 'RIST',
    tagline: 'Multi Receiver',
    accent: '',
    logoPath: '',
    faviconPath: ''
};

const HEX = /^#[0-9a-fA-F]{6}$/;
// Root-relative only, one directory, no dot segments: /brand/<file>.
const LOGO_PATH = /^\/brand\/[a-z0-9][a-z0-9._-]{0,80}$/i;
const ALLOWED_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    webp: 'image/webp'
};

function clampText(value, max) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().replace(/[<>"'`\\]/g, '');
    return trimmed.slice(0, max);
}

function ensureBrandDir() {
    if (!fs.existsSync(BRAND_DIR)) {
        fs.mkdirSync(BRAND_DIR, { recursive: true });
        return true;
    }
    return false;
}

function readStored() {
    try {
        if (!fs.existsSync(BRAND_FILE)) return null;
        const raw = fs.readFileSync(BRAND_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
        console.warn('[BRAND] Could not read brand.json:', err.message);
        return null;
    }
}

// Only known keys, only strings, only validated values survive.
function sanitize(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;

    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
        out.name = clampText(input.name, 24);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'tagline')) {
        out.tagline = clampText(input.tagline, 32);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'accent')) {
        const accent = typeof input.accent === 'string' ? input.accent.trim() : '';
        out.accent = accent === '' || HEX.test(accent) ? (accent === '' ? '' : accent.toLowerCase()) : undefined;
        if (out.accent === undefined) delete out.accent;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'logoPath')) {
        const logo = typeof input.logoPath === 'string' ? input.logoPath.trim() : '';
        out.logoPath = logo === '' || LOGO_PATH.test(logo) ? logo : undefined;
        if (out.logoPath === undefined) delete out.logoPath;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'faviconPath')) {
        const fav = typeof input.faviconPath === 'string' ? input.faviconPath.trim() : '';
        out.faviconPath = fav === '' || LOGO_PATH.test(fav) ? fav : undefined;
        if (out.faviconPath === undefined) delete out.faviconPath;
    }
    return out;
}

function getConfig() {
    const stored = readStored() || {};
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        const value = stored[key];
        if (typeof value === 'string' && value !== '') merged[key] = value;
    }
    // An asset reference is only published while the file it points at exists,
    // so a deleted logo degrades to the neutral mark instead of a broken image.
    for (const key of ['logoPath', 'faviconPath']) {
        if (merged[key] && !resolveAsset(merged[key])) merged[key] = '';
    }
    return merged;
}

function saveConfig(patch) {
    const next = { ...getConfig(), ...sanitize(patch) };
    ensureBrandDir();
    const tmp = `${BRAND_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, BRAND_FILE);
    return next;
}

function resolveAsset(requestPath) {
    if (typeof requestPath !== 'string' || !LOGO_PATH.test(requestPath)) return null;
    const name = path.basename(requestPath);
    const full = path.join(BRAND_DIR, name);
    // Defence in depth: the resolved file must stay inside BRAND_DIR.
    if (!full.startsWith(BRAND_DIR + path.sep)) return null;
    try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) return null;
        return { full, size: stat.size };
    } catch (err) {
        return null;
    }
}

function contentTypeFor(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return ALLOWED_TYPES[ext] || 'application/octet-stream';
}

function saveAsset(filename, buffer) {
    const ext = path.extname(filename || '').slice(1).toLowerCase();
    if (!ALLOWED_TYPES[ext]) {
        const err = new Error('Unsupported logo type. Use png, jpg, webp, or svg.');
        err.status = 415;
        throw err;
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const err = new Error('Empty upload.');
        err.status = 400;
        throw err;
    }
    if (buffer.length > MAX_ASSET_BYTES) {
        const err = new Error('Logo must be 2MB or smaller.');
        err.status = 413;
        throw err;
    }
    // SVG is markup: reject anything that carries script or event handlers.
    if (ext === 'svg') {
        const text = buffer.toString('utf8');
        if (/<script|onload=|onerror=|javascript:|<foreignObject/i.test(text)) {
            const err = new Error('SVG contains active content and was rejected.');
            err.status = 415;
            throw err;
        }
    }
    ensureBrandDir();
    const safeName = `logo-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(BRAND_DIR, safeName), buffer);
    return `/brand/${safeName}`;
}

module.exports = {
    getConfig,
    saveConfig,
    resolveAsset,
    contentTypeFor,
    saveAsset,
    DEFAULTS,
    BRAND_DIR
};
