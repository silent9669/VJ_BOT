class VJBotVadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.squares=0;
    this.samples=0;
    this.reportEvery=Math.round(sampleRate*0.03);
  }
  process(inputs) {
    const channel=inputs[0]?.[0];
    if (channel) {
      for (const sample of channel) this.squares+=sample*sample;
      this.samples+=channel.length;
      if (this.samples>=this.reportEvery) {
        this.port.postMessage({rms:Math.sqrt(this.squares/this.samples)});
        this.samples=0;this.squares=0;
      }
    }
    return true;
  }
}
registerProcessor('vjbot-vad-processor',VJBotVadProcessor);
