#!/usr/bin/env node
/* eslint-disable */
/**
 * WSI 拼接计算 Worker 脚本
 * 独立于 NestJS 主线程运行，使用 V8 多线程物理隔离 CPU 密集计算
 *
 * 支持任务:
 *   - blend_tiles:        高斯距离加权混合拼接
 *   - generate_weight_map: 生成单 tile 的高斯权重图
 *   - decode_image_batch: 批量 base64 -> RGBA 解码
 *   - encode_image:       RGBA Buffer -> PNG Base64
 */
'use strict';

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- 工具函数 ----------
function base64ToRgba(base64) {
  const buf = Buffer.from(base64, 'base64');
  // PNG 解码: 手写一个轻量 PNG 解析器 (避免依赖 sharp / canvas 等原生库)
  // 支持最常见的 8-bit RGB / RGBA
  return decodePng(buf);
}

function decodePng(buffer) {
  if (buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Invalid PNG header');
  }

  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  let idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!idatChunks.length) throw new Error('PNG missing IDAT');
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));

  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 4;
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const out = new Uint8ClampedArray(width * height * 4);

  let rawPos = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const scan = raw.slice(rawPos, rawPos + stride);
    rawPos += stride;
    const recon = applyFilter(filter, scan, prev, bpp);
    prev = recon;
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      out[di] = recon[si];
      out[di + 1] = recon[si + 1];
      out[di + 2] = recon[si + 2];
      out[di + 3] = channels === 4 ? recon[si + 3] : 255;
    }
  }
  return { width, height, data: out };
}

function applyFilter(type, scan, prev, bpp) {
  const out = new Uint8Array(scan.length);
  for (let i = 0; i < scan.length; i++) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev[i] || 0;
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v = scan[i];
    switch (type) {
      case 0: out[i] = v; break;
      case 1: out[i] = (v + a) & 0xff; break;
      case 2: out[i] = (v + b) & 0xff; break;
      case 3: out[i] = (v + ((a + b) >> 1)) & 0xff; break;
      case 4:
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        let pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        out[i] = (v + pr) & 0xff;
        break;
      default:
        out[i] = v;
    }
  }
  return out;
}

function rgbaToPngBase64(width, height, rgba) {
  // 写 8-bit RGBA PNG
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + width * 4) + 1 + x * 4;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: zlib.constants.Z_BEST_SPEED });

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([tBuf, data]);
    const crc = crc32(body);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

// CRC32 表
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- 高斯权重 ----------
function generateGaussianWeight(tileH, tileW, overlap, sigmaScale = 0.3) {
  const cy = tileH / 2, cx = tileW / 2;
  const sy = tileH * sigmaScale, sx = tileW * sigmaScale;
  const w = new Float64Array(tileH * tileW);
  let max = 0;
  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const d2 = ((y - cy) * (y - cy)) / (2 * sy * sy) +
                 ((x - cx) * (x - cx)) / (2 * sx * sx);
      const v = Math.exp(-d2);
      w[y * tileW + x] = v;
      if (v > max) max = v;
    }
  }
  if (max > 0) for (let i = 0; i < w.length; i++) w[i] /= max;
  // 边缘线性衰减 (重叠区)
  if (overlap > 0 && overlap < tileH / 2 && overlap < tileW / 2) {
    const top = new Float64Array(overlap);
    const bot = new Float64Array(overlap);
    const left = new Float64Array(overlap);
    const right = new Float64Array(overlap);
    for (let i = 0; i < overlap; i++) {
      top[i] = i / overlap;
      bot[i] = (overlap - 1 - i) / overlap;
      left[i] = i / overlap;
      right[i] = (overlap - 1 - i) / overlap;
    }
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        let f = 1;
        if (y < overlap) f *= top[y];
        else if (y >= tileH - overlap) f *= bot[tileH - 1 - y];
        if (x < overlap) f *= left[x];
        else if (x >= tileW - overlap) f *= right[tileW - 1 - x];
        w[y * tileW + x] *= f;
      }
    }
    let m2 = 0;
    for (let i = 0; i < w.length; i++) if (w[i] > m2) m2 = w[i];
    if (m2 > 0) for (let i = 0; i < w.length; i++) w[i] /= m2;
  }
  return w;
}

// ---------- 高斯混合拼接 (核心) ----------
function blendTiles(payload) {
  const t0 = Date.now();
  const { tiles, totalWidth, totalHeight, tileSize, overlap, scaleFactor, outputPath, returnBase64 } = payload;
  const srH = totalHeight * scaleFactor;
  const srW = totalWidth * scaleFactor;
  const tH = tileSize * scaleFactor;
  const tW = tileSize * scaleFactor;
  const ov = overlap * scaleFactor;
  const step = (tileSize - overlap) * scaleFactor;

  const weight = generateGaussianWeight(tH, tW, ov);

  // 使用 Float64Array 累积，避免主线程 GC 压力
  const canvas = new Float64Array(srH * srW * 4); // RGBA
  const wsum = new Float64Array(srH * srW);

  let decoded = 0;
  for (const tile of tiles) {
    const decodedImg = base64ToRgba(tile.imageData);
    const curH = decodedImg.height;
    const curW = decodedImg.width;
    const src = decodedImg.data;

    const y0 = tile.row * step;
    const x0 = tile.col * step;
    const y1 = Math.min(y0 + curH, srH);
    const x1 = Math.min(x0 + curW, srW);
    const actualH = y1 - y0;
    const actualW = x1 - x0;

    // 核心: 加权写入画布 + 权重求和 (纯 CPU 浮点运算)
    for (let y = 0; y < actualH; y++) {
      const dstY = y0 + y;
      const srcRow = y * curW;
      const dstRow = dstY * srW;
      const wRow = y * tW;
      for (let x = 0; x < actualW; x++) {
        const dstX = x0 + x;
        const si = (srcRow + x) * 4;
        const di = (dstRow + dstX) * 4;
        const wi = wRow + x;
        const wv = weight[wi];

        canvas[di]     += src[si]     * wv;
        canvas[di + 1] += src[si + 1] * wv;
        canvas[di + 2] += src[si + 2] * wv;
        canvas[di + 3] += src[si + 3] * wv;
        wsum[dstRow + dstX] += wv;
      }
    }
    decoded++;
    if (decoded % 50 === 0) {
      parentPort?.postMessage({ _progress: true, decoded, total: tiles.length });
    }
  }

  // 归一化 + 转 uint8
  const out = new Uint8ClampedArray(srH * srW * 4);
  for (let i = 0; i < srH * srW; i++) {
    const ws = wsum[i] > 1e-6 ? wsum[i] : 1.0;
    const di = i * 4;
    out[di]     = Math.min(255, Math.max(0, canvas[di]     / ws));
    out[di + 1] = Math.min(255, Math.max(0, canvas[di + 1] / ws));
    out[di + 2] = Math.min(255, Math.max(0, canvas[di + 2] / ws));
    out[di + 3] = Math.min(255, Math.max(0, canvas[di + 3] / ws));
  }

  let imageData = undefined;
  if (returnBase64 || !outputPath) {
    imageData = rgbaToPngBase64(srW, srH, out);
  }
  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const pngBuf = Buffer.from(rgbaToPngBase64(srW, srH, out), 'base64');
    fs.writeFileSync(outputPath, pngBuf);
  }

  return {
    imageData,
    outputPath,
    width: srW,
    height: srH,
    durationMs: Date.now() - t0,
    tileCount: tiles.length,
  };
}

// ---------- 调度 ----------
function handle(kind, payload) {
  switch (kind) {
    case 'blend_tiles':
      return blendTiles(payload);
    case 'generate_weight_map': {
      const { tileSize, overlap } = payload;
      const w = generateGaussianWeight(tileSize, tileSize, overlap);
      // 转成灰度 PNG base64 便于调试
      const g = new Uint8ClampedArray(tileSize * tileSize * 4);
      for (let i = 0; i < tileSize * tileSize; i++) {
        const v = Math.round(w[i] * 255);
        g[i * 4] = v; g[i * 4 + 1] = v; g[i * 4 + 2] = v; g[i * 4 + 3] = 255;
      }
      return {
        width: tileSize,
        height: tileSize,
        weight_b64: rgbaToPngBase64(tileSize, tileSize, g),
      };
    }
    case 'decode_image_batch': {
      const out = [];
      for (const t of payload.tiles) {
        const d = base64ToRgba(t.imageData);
        out.push({ width: d.width, height: d.height });
      }
      return { decoded: out.length };
    }
    case 'encode_image': {
      const { width, height, rgbaBuffer } = payload;
      return { imageData: rgbaToPngBase64(width, height, rgbaBuffer) };
    }
    default:
      throw new Error(`Unknown task kind: ${kind}`);
  }
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    if (msg && msg.kind && msg.id) {
      const t0 = Date.now();
      try {
        const data = handle(msg.kind, msg.payload);
        parentPort.postMessage({
          taskId: msg.id,
          success: true,
          data,
          durationMs: Date.now() - t0,
        });
      } catch (err) {
        parentPort.postMessage({
          taskId: msg.id,
          success: false,
          error: err.message || String(err),
          durationMs: Date.now() - t0,
        });
      }
    }
  });
  parentPort.postMessage({ _ready: true });
}

module.exports = {
  generateGaussianWeight,
  blendTiles,
  base64ToRgba,
  rgbaToPngBase64,
};
