/**
 * Type declarations for onnxruntime-web
 */

declare module 'onnxruntime-web' {
  export class InferenceSession {
    static create(
      path: string,
      options?: InferenceSession.SessionOptions
    ): Promise<InferenceSession>;
    
    constructor();
    
    run(
      feeds: Record<string, Tensor>,
      options?: RunOptions
    ): Promise<Record<string, Tensor>>;
  }
  
  export namespace InferenceSession {
    export interface SessionOptions {
      executionProviders?: string[];
      graphOptimizationLevel?: string;
      enableCpuMemArena?: boolean;
      enableMemPattern?: boolean;
      extra?: {
        onProgress?: (progress: number) => void;
      };
    }
  }
  
  export class Tensor {
    constructor(
      type: string,
      data: Float32Array | Uint8Array | Int8Array | any,
      dims: number[]
    );
    
    data: Float32Array | Uint8Array | Int8Array | any;
  }
  
  export interface RunOptions {
    logSeverityLevel?: number;
    logVerbosityLevel?: number;
    terminateFlag?: boolean;
    tag?: string;
  }
}
