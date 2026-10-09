class BotMetrics {
  constructor() {
    this._counts = {};
    this._errors = {};
    this._timingSum = 0;
    this._timingN = 0;
  }

  incr(cmd) {
    this._counts[cmd] = (this._counts[cmd] || 0) + 1;
  }

  error(cmd) {
    this._errors[cmd] = (this._errors[cmd] || 0) + 1;
  }

  recordTiming(seconds) {
    this._timingSum += seconds;
    this._timingN++;
  }

  get avgLatencyMs() {
    return this._timingN ? (this._timingSum / this._timingN * 1000) : 0;
  }

  get totalCommands() {
    return Object.values(this._counts).reduce((a, b) => a + b, 0);
  }

  get totalErrors() {
    return Object.values(this._errors).reduce((a, b) => a + b, 0);
  }

  summary() {
    return {
      commands: { ...this._counts },
      errors: { ...this._errors },
      avgLatencyMs: Math.round(this.avgLatencyMs * 100) / 100,
      totalCmds: this.totalCommands,
      totalErrs: this.totalErrors,
    };
  }
}

module.exports = BotMetrics;
