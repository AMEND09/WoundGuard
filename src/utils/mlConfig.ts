/**
 * Configuration for machine learning models used in the WoundGuard application
 */

export const ML_CONFIG = {
  /**
   * Base URL for loading ML models, considers deployment environment
   */
  modelBasePath: `${import.meta.env.BASE_URL || '/'}models/`,
  
  /**
   * Available models for wound segmentation
   */
  woundSegmentationModels: {
    lite: 'wound-segmentation-lite.onnx', // Smaller model (~5MB) for faster loading
    standard: 'wound-segmentation.onnx',  // Standard quality model (~12MB)
  },
  
  /**
   * Default model to use
   */
  defaultModel: 'lite',
  
  /**
   * Model quality options
   */
  modelQualities: ['lite', 'standard'] as const,
  
  /**
   * ONNX execution providers configuration
   */
  executionProviders: ['wasm'],
  
  /**
   * Whether to enable preprocessing optimization
   */
  enablePreprocessing: true,
  
  /**
   * Minimum confidence threshold for ML detection
   */
  confidenceThreshold: 0.5
};

/**
 * Get the full URL for a model
 */
export function getModelUrl(modelName: keyof typeof ML_CONFIG.woundSegmentationModels | string): string {
  if (modelName in ML_CONFIG.woundSegmentationModels) {
    return `${ML_CONFIG.modelBasePath}${ML_CONFIG.woundSegmentationModels[modelName as keyof typeof ML_CONFIG.woundSegmentationModels]}`;
  }
  return `${ML_CONFIG.modelBasePath}${modelName}`;
}

/**
 * Type for model quality options
 */
export type ModelQuality = typeof ML_CONFIG.modelQualities[number];
