// Tiny Prometheus counters/gauges. No dependencies.

function labelKey(labels) {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',');
}

export function createMetrics() {
  const defs = new Map(); // name -> { type, help, values: Map<labelKey, number> }

  function define(name, type, help) {
    let d = defs.get(name);
    if (!d) {
      d = { type, help, values: new Map() };
      defs.set(name, d);
    }
    return d;
  }

  return {
    /** Increment a counter (created on first use). */
    inc(name, labels = {}, by = 1, help = name) {
      const d = define(name, 'counter', help);
      const k = labelKey(labels);
      d.values.set(k, (d.values.get(k) ?? 0) + by);
    },
    /** Set a gauge. */
    set(name, value, labels = {}, help = name) {
      const d = define(name, 'gauge', help);
      d.values.set(labelKey(labels), value);
    },
    get(name, labels = {}) {
      return defs.get(name)?.values.get(labelKey(labels));
    },
    render() {
      let out = '';
      for (const [name, d] of defs) {
        out += `# HELP ${name} ${d.help}\n# TYPE ${name} ${d.type}\n`;
        for (const [k, v] of d.values) out += `${name}${k ? `{${k}}` : ''} ${v}\n`;
      }
      return out;
    },
  };
}
