/**
 * Audio module exports
 */

export { AdaptiveVADBuffer } from './AdaptiveVADBuffer';
export { AudioValidator } from './AudioValidator';
export { StreamingAudioSender } from './StreamingAudioSender';
export { NoiseSuppression } from './NoiseSuppression';

// Re-export existing modules
export { AudioPipeline } from './AudioPipeline';
export { VADProcessor } from './VADProcessor';
export { ResamplerProcessor } from './ResamplerProcessor';
export { EncoderProcessor } from './EncoderProcessor';
