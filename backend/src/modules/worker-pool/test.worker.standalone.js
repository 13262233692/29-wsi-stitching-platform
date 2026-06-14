/**
 * Node 环境直接运行的 Worker 测试脚本
 * 验证高斯混合拼接算法的正确性与 Event Loop 隔离效果
 *
 * 运行: node backend/src/modules/worker-pool/test.worker.standalone.js
 */
'use strict';

const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, 'stitching.worker.js');

function makeTile(w, h, r, g, b) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  // 直接复用 worker 里的 PNG 编码：通过 worker 编码一下
  return buf;
}

async function run() {
  console.log('\n==== Worker Threads 高斯拼接验证 ====\n');

  // 1) 测试 Event Loop 延迟
  const elLog = [];
  let lastTs = Date.now();
  const elTimer = setInterval(() => {
    const now = Date.now();
    elLog.push(now - lastTs - 50);
    lastTs = now;
  }, 50);

  // 2) 构造 2x2 网格，每 tile 256x256, overlap=32, scale=1
  // 直接通过 worker 自身的 encode 生成 base64
  const worker = new Worker(SCRIPT);
  await new Promise((res) => worker.once('message', (m) => m._ready && res()));

  function call(kind, payload) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = (m) => {
        if (m.taskId === id) {
          worker.off('message', onMsg);
          if (m.success) resolve(m.data);
          else reject(new Error(m.error));
        }
      };
      worker.on('message', onMsg);
      worker.postMessage({ id, kind, payload });
    });
  }

  // 生成 4 张纯色 tile
  const colors = [
    [220, 50, 50], [50, 200, 80],
    [60, 120, 255], [240, 200, 60],
  ];
  const tiles = [];
  for (let i = 0; i < 4; i++) {
    const [r, g, b] = colors[i];
    // 用 encode_image 造 base64
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let p = 0; p < 256 * 256; p++) {
      rgba[p * 4] = r;
      rgba[p * 4 + 1] = g;
      rgba[p * 4 + 2] = b;
      rgba[p * 4 + 3] = 255;
    }
    const enc = await call('encode_image', { width: 256, height: 256, rgbaBuffer: rgba });
    tiles.push({
      row: i >> 1,
      col: i & 1,
      x: (i & 1) * (256 - 32),
      y: (i >> 1) * (256 - 32),
      width: 256,
      height: 256,
      imageData: enc.imageData,
    });
    console.log(`  tile ${i}: row=${tiles[i].row} col=${tiles[i].col} rgb(${r},${g},${b})`);
  }

  // 3) 执行拼接
  const t0 = Date.now();
  const result = await call('blend_tiles', {
    tiles,
    totalWidth: 256 + 224, // = 256 + (256-32)
    totalHeight: 256 + 224,
    tileSize: 256,
    overlap: 32,
    scaleFactor: 1,
    outputPath: path.join(__dirname, '..', '..', '..', 'data', 'worker_test_out.png'),
    returnBase64: true,
  });
  const elapsed = Date.now() - t0;

  clearInterval(elTimer);

  const maxBlockMs = Math.max(0, ...elLog);
  const avgBlockMs = elLog.reduce((a, b) => a + b, 0) / (elLog.length || 1);
  console.log(`\n  拼接耗时: ${elapsed}ms  (worker 内: ${result.durationMs}ms)`);
  console.log(`  输出尺寸: ${result.width}x${result.height}`);
  console.log(`  Event Loop 最大阻塞: ${maxBlockMs.toFixed(0)}ms, 平均: ${avgBlockMs.toFixed(2)}ms`);
  console.log(`  输出文件: ${result.outputPath}`);

  if (fs.existsSync(result.outputPath)) {
    const st = fs.statSync(result.outputPath);
    console.log(`  输出文件大小: ${st.size} bytes`);
  }

  // 4) 验证权重图
  const wm = await call('generate_weight_map', { tileSize: 64, overlap: 8 });
  console.log(`\n  权重图生成成功: ${wm.weight_b64.length} chars`);

  console.log('\n  Event Loop 隔离验证:', maxBlockMs < 30 ? '✓ PASS (阻塞 < 30ms)' : '✗ FAIL');
  console.log('========================================\n');

  await worker.terminate();
}

run().catch((e) => {
  console.error('测试失败:', e);
  process.exit(1);
});
