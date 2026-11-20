// Run in a WinOnWeb browser document with Task Manager open.
export async function verifyPerformancePage() {
  const required = {
    cpu: ['cpuUsage', 'cpuSpeed', 'process', 'thread', 'handle', 'cpuUptime', 'maxspeed', 'socket'],
    memory: ['memory_inuse', 'memory_avai', 'memory_commit', 'memory_cache', 'memory_paged', 'memory_non_paged', 'reserved', 'max_memory'],
    disk: ['disk_time', 'disk_response', 'disk_read', 'disk_write', 'disk_capacity', 'disk_formatted', 'disk_sys', 'disk_pagefile', 'disk_type'],
    network: ['netSend', 'netReceive', 'adapter'],
    gpu: ['gpuUsage', 'gpuTotalMemory', 'gpuSharedMemRoot'],
    npu: ['利用率', '厂商:'],
  };
  const report = {};
  const root = document.querySelector('.w11-window:has([data-tm-tab="performance"])');
  root.querySelector('[data-tm-tab="performance"]').click();
  const cards = [...root.querySelectorAll('[data-perf-key]')].map(el => el.dataset.perfKey);
  for (const key of ['cpu', 'memory', 'disk', 'network', 'gpu-0']) {
    if (!cards.includes(key)) throw Error('Missing resource: ' + key);
  }
  for (const key of cards) {
    root.querySelector('[data-perf-key="' + key + '"]').click();
    const detail = root.querySelector('.w11-tm-perf-detail');
    const fields = {};
    for (const row of detail.querySelectorAll('.dui-kpi-cell, .dui-static-row')) {
      const value = row.querySelector('.dui-static-data, .dui-dynamic-data');
      const label = row.querySelector('.dui-static-label, .dui-dynamic-label').textContent;
      const id = value.dataset.duiId || row.dataset.duiId || label;
      if (!value.textContent.trim() || /^(—|未知)$|undefined|NaN/.test(value.textContent)) {
        throw Error(key + '/' + label + ': ' + value.textContent);
      }
      fields[id] = value.textContent;
    }
    for (const id of required[key.split('-')[0]]) {
      if (!(id in fields)) throw Error('Missing ' + key + '/' + id);
    }
    if (key === 'cpu' && !('logicalproc' in fields || 'vProc' in fields)) throw Error('Missing CPU topology');
    if (key === 'cpu' && !['process', 'thread', 'socket'].every(id => Number(fields[id]) > 0)) throw Error('Invalid CPU counters');
    if (key === 'cpu' && !/^\d+$/.test(fields.handle)) throw Error('Invalid handle count');
    if (key.startsWith('gpu-') && detail.querySelector('[data-dui-id=gpuDedicatedMemory]') && !fields.gpuDedicatedMemRoot) throw Error('Missing dedicated GPU memory');
    const title = detail.querySelector('[data-dui-id=resourceName]').textContent;
    if (!title || !detail.querySelector('svg')) throw Error('Missing chart or title: ' + key);
    report[key] = { title, fields };
  }
  return report;
}

