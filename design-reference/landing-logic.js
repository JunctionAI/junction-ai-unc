
class Component extends DCLogic {
  state = { lm: 'ai' };
  renderVals() {
    const ai = this.state.lm === 'ai';
    return {
      lmIsAI: ai, lmIsHuman: !ai,
      lmGoAI: () => this.setState({ lm: 'ai' }), lmGoHuman: () => this.setState({ lm: 'human' }),
      lmAiBg: ai ? 'oklch(0.78 0.13 220)' : 'transparent', lmAiFg: ai ? 'oklch(0.22 0.05 262)' : 'oklch(0.72 0.06 235)',
      lmHuBg: !ai ? 'oklch(0.78 0.13 220)' : 'transparent', lmHuFg: !ai ? 'oklch(0.22 0.05 262)' : 'oklch(0.72 0.06 235)',
    };
  }
}
