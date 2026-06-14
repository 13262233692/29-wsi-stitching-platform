#!/usr/bin/env node
/**
 * 验证 Worker 中细胞核分析功能
 * 生成一张合成细胞图像，运行分析，验证指标输出
 */
'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

const SCRIPT = path.join(__dirname, 'stitching.worker.js');

function generateTestTile(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  // 背景: 浅灰色 (HE 染色背景)
  for (let i = 0; i < w * h * 4; i += 4) {
    rgba[i] = 230;
    rgba[i + 1] = 200;
    rgba[i + 2] = 210;
    rgba[i + 3] = 255;
  }
  // 画三个模拟细胞核: 圆形、拉长、不规则
  const cells = [
    { cx: 100, cy: 100, rx: 20, ry: 20, color: [60, 40, 80] },   // 圆形 (正常)
    { cx: 300, cy: 120, rx: 40, ry: 12, color: [50, 30, 70] },   // 拉长 (异常)
    { cx: 180, cy: 320, rx: 25, ry: 22, color: [40, 20, 60] },   // 不规则 (异常, 将用噪声模拟)
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const c of cells) {
        const dx = (x - c.cx) / c.rx;
        const dy = (y - c.cy) / c.ry;
        let d = dx * dx + dy * dy;
        // 加噪声让第三个细胞不规则
        if (c === cells[2]) {
          const noise = Math.sin(x * 0.5) * Math.cos(y * 0.5) * 0.3;
          d += noise;
        }
        if (d <= 1.0) {
          const idx = (y * w + x) * 4;
          rgba[idx] = c.color[0] + Math.round(Math.random() * 20 - 10);
          rgba[idx + 1] = c.color[1] + Math.round(Math.random() * 20 - 10);
          rgba[idx + 2] = c.color[2] + Math.round(Math.random() * 20 - 10);
          break;
        }
      }
    }
  }
  // 用 Worker 内的编码转 base64
  return { rgba, w, h };
}

async function run() {
  console.log('\n==== Worker 细胞分析功能验证 ====\n');

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

  // 1. 生成测试 tile 并编码为 base64
  const { rgba, w, h } = generateTestTile(512, 512);
  const enc = await call('encode_image', { width: w, height: h, rgbaBuffer: rgba });
  console.log(`✓ 生成测试图像: ${w}x${h}, base64 length: ${enc.imageData.length}`);

  // 2. 监测 Event Loop
  const elLog = [];
  let lastTs = Date.now();
  const elTimer = setInterval(() => {
    const now = Date.now();
    elLog.push(now - lastTs - 50);
    lastTs = now;
  }, 50);

  // 3. 运行细胞分析
  const t0 = Date.now();
  const result = await call('analyze_cell_instances', {
    imageData: enc.imageData,
    tile_row: 0,
    tile_col: 0,
    tile_size: 512,
    overlap: 32,
    scale_factor: 1,
  });
  const elapsed = Date.now() - t0;

  clearInterval(elTimer);
  const maxBlock = Math.max(0, ...elLog);

  console.log(`✓ 分析完成: ${result.total_count} 个细胞, ${result.abnormal_count} 个异常`);
  console.log(`✓ 耗时: ${elapsed}ms  (Worker 内: ${result.durationMs}ms)`);
  console.log(`✓ Event Loop 最大阻塞: ${maxBlock.toFixed(0)}ms`);
  console.log(`✓ tile 异常评分: ${result.anomaly_score.toFixed(3)}`);

  // 4. 验证每个细胞核的指标
  console.log('\n  细胞核指标详情:');
  for (const n of result.nuclei) {
    console.log(`\n    [细胞 #${n.cell_id}] @ (${Math.round(n.centroid_x)}, ${Math.round(n.centroid_y)})`);
    console.log(`      圆面积比 Circularity:  ${n.circularity.toFixed(3)}  ${n.circularity < 0.55 ? '⚠️ 异常' : '✓ 正常'}`);
    console.log(`      长短轴比 AspectRatio: ${n.aspect_ratio.toFixed(2)}  ${n.aspect_ratio > 2.2 ? '⚠️ 异常' : '✓ 正常'}`);
    console.log(`      边界粗糙度 Roughness: ${n.roughness.toFixed(3)}  ${n.roughness > 1.35 ? '⚠️ 异常' : '✓ 正常'}`);
    console.log(`      面凸性 Solidity:     ${n.solidity.toFixed(3)}  ${n.solidity < 0.55 ? '⚠️ 异常' : '✓ 正常'}`);
    console.log(`      面积 Area:           ${Math.round(n.area)} px²`);
    console.log(`      特征向量维度:         ${n.feature_vector.length}`);
    console.log(`      异常标记:             ${n.is_abnormal ? '是' : '否'} 原因: [${n.abnormal_reasons.join(', ')}]`);
  }

  // 5. 验证向量 L2 归一化
  const fv = result.nuclei[0]?.feature_vector || [];
  const norm = Math.sqrt(fv.reduce((s, v) => s + v * v, 0));
  console.log(`\n  特征向量 L2 范数: ${norm.toFixed(6)} (应 ≈ 1.0)`);

  // 6. 判定
  const pass =
    maxBlock < 30 &&
    result.total_count >= 2 &&
    result.abnormal_count >= 1 &&
    Math.abs(norm - 1.0) < 0.001 &&
    fv.length === 128;

  console.log(`\n  === 综合判定: ${pass ? '✓ ALL TESTS PASSED' : '✗ TESTS FAILED'} ===\n`);

  await worker.terminate();
  process.exit(pass ? 0 : 1);
}

run().catch((e) => {
  console.error('验证失败:', e);
  process.exit(1);
});
