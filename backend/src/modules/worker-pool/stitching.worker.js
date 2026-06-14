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

// ---------- 细胞核形态学分析 (Worker 中运行，不阻塞 Event Loop) ----------
function otsuThreshold(hist) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, maxVar = 0, threshold = 0;
  const total = hist.reduce((a, b) => a + b, 0);
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  return threshold;
}

function connectedComponents(binary, w, h) {
  const labels = new Uint32Array(w * h);
  const parent = [0];
  let nextId = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!binary[i]) continue;
      const nbrs = [];
      if (y > 0 && labels[i - w]) nbrs.push(labels[i - w]);
      if (x > 0 && labels[i - 1]) nbrs.push(labels[i - 1]);
      if (nbrs.length === 0) {
        labels[i] = nextId;
        parent.push(nextId);
        nextId++;
      } else {
        let root = nbrs[0];
        while (parent[root] !== root) { parent[root] = parent[parent[root]]; root = parent[root]; }
        labels[i] = root;
        for (const n of nbrs) {
          let r = n;
          while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
          if (r !== root) parent[r] = root;
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (labels[i]) {
      let r = labels[i];
      while (parent[r] !== r) r = parent[r];
      labels[i] = r;
    }
  }
  return labels;
}

function extractRegionProperties(labels, w, h, rgba, offsetX, offsetY) {
  const regions = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = labels[y * w + x];
      if (!id) continue;
      let r = regions.get(id);
      if (!r) { r = { id, xs: [], ys: [], pixels: [], sumI: 0, minX: x, maxX: x, minY: y, maxY: y }; regions.set(id, r); }
      r.xs.push(x); r.ys.push(y);
      const pi = (y * w + x) * 4;
      r.sumI += 0.299 * rgba[pi] + 0.587 * rgba[pi + 1] + 0.114 * rgba[pi + 2];
      if (x < r.minX) r.minX = x;
      if (x > r.maxX) r.maxX = x;
      if (y < r.minY) r.minY = y;
      if (y > r.maxY) r.maxY = y;
    }
  }
  const result = [];
  let cid = 0;
  for (const r of regions.values()) {
    const n = r.xs.length;
    if (n < 40) continue;
    const area = n;
    // 周长估算: 边界像素 4-邻域变化 + 修正
    const maskSet = new Set(r.xs.map((x, i) => r.ys[i] * w + x));
    let perimeter = 0;
    for (let i = 0; i < n; i++) {
      const x = r.xs[i], y = r.ys[i];
      const idx = y * w + x;
      if (!maskSet.has(idx - w)) perimeter++;
      if (!maskSet.has(idx + w)) perimeter++;
      if (!maskSet.has(idx - 1)) perimeter++;
      if (!maskSet.has(idx + 1)) perimeter++;
    }
    perimeter = Math.max(perimeter, 4);
    const correctedP = perimeter * 0.886;
    // 质心
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += r.xs[i]; sy += r.ys[i]; }
    const cx = sx / n + offsetX, cy = sy / n + offsetY;
    // 协方差 -> 长短轴
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = r.xs[i] - sx / n, dy = r.ys[i] - sy / n;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= n; syy /= n; sxy /= n;
    const trace = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    const l1 = trace / 2 + disc;
    const l2 = Math.max(0, trace / 2 - disc);
    const major = 2 * Math.sqrt(Math.max(l1, l2) * 2.0);
    const minor = 2 * Math.sqrt(Math.max(0, Math.min(l1, l2)) * 2.0);
    const orientation = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // 圆面积比
    const circularity = (4 * Math.PI * area) / (correctedP * correctedP);
    // 长短轴比
    const aspect = minor > 0 ? major / minor : 1;
    // 面凸性 (近似: bbox 面积与真实面积比的反向)
    const bboxArea = (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
    const solidity = Math.min(1, area / bboxArea * 1.6);
    // 边界粗糙度 (周长 / 椭圆等效周长)
    const equivEllipseP = Math.PI * (1.5 * (major + minor) - Math.sqrt(major * minor));
    const roughness = correctedP / Math.max(equivEllipseP, 4);
    const meanI = r.sumI / n;
    // 异常判定
    const reasons = [];
    if (circularity < 0.55) reasons.push('low_circularity');
    if (aspect > 2.2) reasons.push('high_aspect_ratio');
    if (roughness > 1.35) reasons.push('high_roughness');
    if (solidity < 0.55) reasons.push('low_solidity');
    if (area < 150 || area > 15000) reasons.push('abnormal_size');
    const isAbnormal = reasons.length >= 2;
    // 128-dim 特征向量
    const base = [
      area / 5000, correctedP / 500, Math.min(1, circularity),
      Math.min(1, aspect / 3), solidity, Math.min(1, roughness / 2),
      major / 200, minor / 100, meanI / 255, orientation / Math.PI,
    ];
    const fv = [];
    for (const v of base) fv.push(Math.tanh(v));
    for (const v of base) fv.push(Math.tanh(v * v));
    for (const v of base) fv.push(Math.tanh(v * v * v));
    for (const v of base) fv.push(Math.sin(v * Math.PI));
    for (const v of base) fv.push(Math.cos(v * Math.PI));
    for (let i = 0; i < base.length; i++)
      for (let j = i + 1; j < base.length; j++)
        fv.push(Math.tanh(base[i] * base[j]));
    while (fv.length < 128) fv.push(0);
    const feats = fv.slice(0, 128);
    let norm = 0; for (let i = 0; i < 128; i++) norm += feats[i] * feats[i];
    norm = Math.sqrt(norm) + 1e-8;
    for (let i = 0; i < 128; i++) feats[i] = feats[i] / norm;

    result.push({
      cell_id: cid++,
      centroid_x: cx, centroid_y: cy,
      bbox_x: r.minX + offsetX, bbox_y: r.minY + offsetY,
      bbox_w: r.maxX - r.minX + 1, bbox_h: r.maxY - r.minY + 1,
      area, perimeter: correctedP, convex_perimeter: equivEllipseP,
      major_axis: major, minor_axis: Math.max(minor, 1),
      orientation,
      circularity: Math.min(1, circularity),
      aspect_ratio: aspect,
      solidity, roughness,
      mean_intensity: meanI,
      is_abnormal: isAbnormal,
      abnormal_reasons: reasons,
      feature_vector: feats,
    });
  }
  return result;
}

function analyzeCellInstances(payload) {
  const t0 = Date.now();
  const { imageData, tile_row = 0, tile_col = 0, tile_size = 512, overlap = 32, scale_factor = 4 } = payload;
  const decoded = base64ToRgba(imageData);
  const { width: w, height: h, data: rgba } = decoded;
  // 灰度化 + Otsu (细胞核通常染色深)
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    gray[i] = v;
    hist[v]++;
  }
  const thr = otsuThreshold(hist);
  // 反向: 暗色核为前景
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) fg[i] = gray[i] < thr ? 1 : 0;
  const labels = connectedComponents(fg, w, h);
  const offsetX = tile_col * (tile_size - overlap) * scale_factor;
  const offsetY = tile_row * (tile_size - overlap) * scale_factor;
  const nuclei = extractRegionProperties(labels, w, h, rgba, offsetX, offsetY);
  const abnormalCells = nuclei.filter((n) => n.is_abnormal);
  const abnormal = abnormalCells.length;
  const pixelUm = 0.25;
  const areaMm2 = (w * h * pixelUm * pixelUm) / 1e6;
  const density = nuclei.length / Math.max(areaMm2, 1e-9);
  let anomaly = 0;
  if (nuclei.length > 0) {
    const ratio = abnormal / nuclei.length;
    const meanCirc = abnormalCells.length > 0
      ? abnormalCells.reduce((s, n) => s + (1 - n.circularity), 0) / abnormalCells.length
      : 0;
    anomaly = Math.min(1, 0.5 * ratio + 0.25 * Math.min(1, density / 8000) + 0.25 * meanCirc);
  }
  return {
    tile_index: [tile_row, tile_col],
    tile_offset: [offsetX, offsetY],
    tile_size: w,
    scale_factor,
    nuclei,
    abnormal_count: abnormal,
    total_count: nuclei.length,
    density,
    anomaly_score: anomaly,
    durationMs: Date.now() - t0,
  };
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
    case 'analyze_cell_instances':
      return analyzeCellInstances(payload);
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
  analyzeCellInstances,
};
