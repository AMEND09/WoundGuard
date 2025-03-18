/**
 * WoundGuard Image Analysis Utility
 * 
 * This module provides advanced image processing capabilities
 * for analyzing wound images and estimating wound area.
 */

// Fix the ONNX.js import with proper type declaration
// @ts-ignore - Ignore the type issues with onnxruntime-web
import * as onnx from 'onnxruntime-web';

export interface WoundAnalysisResult {
  estimatedArea: number;
  processedImageUrl: string;
  confidence: number;
  pixelCount: number;
  totalPixels: number;
  detectionMethod: string;
  healingIndicators?: {
    inflammationScore: number;
    exudateScore: number;
    rednessRatio: number;
    tissueTypes: {
      granulation: number;
      slough: number;
      eschar: number;
    }
  };
}

export interface AnalysisOptions {
  sensitivityLevel?: 'low' | 'medium' | 'high';
  referenceSize?: number; // in mm²
  referenceWidth?: number; // in mm
  assumedImageSize?: number; // in mm²
  userOutline?: {
    points: Array<{x: number, y: number}>;
    closed: boolean;
  };
  boundingBox?: { // Add proper type for bounding box
    x: number;
    y: number;
    width: number;
    height: number;
  };
  useML?: boolean; // Option to use ML-based detection
}

// Track if ML model is loaded
let woundSegmentationModel: onnx.InferenceSession | null = null;
let isModelLoading = false;
let modelLoadProgress = 0;
let modelLoadError: string | null = null;

/**
 * Interface for Fitzpatrick skin type classification
 */
interface SkinToneAnalysis {
  fitzpatrickType: 1 | 2 | 3 | 4 | 5 | 6;
  averageColor: {r: number, g: number, b: number};
  luminance: number;
}

/**
 * Get ML model loading status
 * @returns Object with loading status information
 */
export function getModelLoadingStatus() {
  return {
    isLoaded: woundSegmentationModel !== null,
    isLoading: isModelLoading,
    progress: modelLoadProgress,
    error: modelLoadError
  };
}

/**
 * Load the ONNX.js wound segmentation model
 * Can be called early to preload the model
 */
export async function preloadWoundSegmentationModel(): Promise<boolean> {
  if (woundSegmentationModel || isModelLoading) {
    return woundSegmentationModel !== null;
  }
  
  try {
    isModelLoading = true;
    modelLoadError = null;
    
    // Create a model loading progress handler
    const progressHandler = (progress: number) => {
      modelLoadProgress = Math.min(100, Math.round(progress * 100));
    };
    
    // Configure ONNX runtime with optimal settings
    const options: onnx.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true,
      enableMemPattern: true,
      extra: {
        onProgress: progressHandler
      }
    };

    // Model URLs relative to base path, optimized for GitHub Pages
    const modelUrl = `${import.meta.env.BASE_URL || '/'}models/wound-segmentation-lite.onnx`;
    
    // Load the model with progress tracking
    woundSegmentationModel = await onnx.InferenceSession.create(
      modelUrl, 
      options
    );
    
    isModelLoading = false;
    modelLoadProgress = 100;
    
    return true;
  } catch (error) {
    console.warn('Failed to load wound segmentation model:', error);
    isModelLoading = false;
    modelLoadError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

/**
 * Analyzes a wound image to detect the wound area and estimate its size
 * 
 * @param imageUrl URL or base64 string of the wound image
 * @param options Analysis configuration options
 * @returns Promise with analysis results
 */
export async function analyzeWoundImage(
  imageUrl: string,
  options: AnalysisOptions = {}
): Promise<WoundAnalysisResult> {
  return new Promise((resolve, reject) => {
    // Load the image
    const img = new Image();
    img.crossOrigin = "Anonymous";
    
    img.onload = async () => {
      try {
        // Create canvas for image processing
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error("Canvas context not available"));
          return;
        }
        
        // Draw the image on canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Try ML-based detection if requested and available
        let result: DetectionResult | null = null;
        let detectionMethod = '';
        
        if (options.useML) {
          try {
            // First check if model exists or needs to be loaded
            const modelAvailable = woundSegmentationModel !== null || await preloadWoundSegmentationModel();
            
            if (modelAvailable && woundSegmentationModel) {
              // Use ML model for detection
              const mlResult = await detectWoundWithML(
                imageData, 
                canvas.width, 
                canvas.height,
                options.userOutline,
                options.boundingBox // Pass the bounding box to the ML detection
              );
              
              result = mlResult;
              detectionMethod = options.boundingBox
                ? 'ML + User bounding box'
                : options.userOutline
                  ? 'ML + User-guided detection' 
                  : 'Neural network segmentation';
            }
          } catch (mlError) {
            console.warn('ML detection failed, falling back to traditional algorithm:', mlError);
            // Fall back to traditional detection on error
          }
        }
        
        // If ML detection wasn't used or failed, use traditional detection
        if (!result) {
          // Set sensitivity level
          const sensitivity = options.sensitivityLevel || 'medium';
          const sensitivitySettings = {
            low: { hueRange: 15, satMin: 0.3, redRatio: 1.15 },
            medium: { hueRange: 25, satMin: 0.2, redRatio: 1.1 },
            high: { hueRange: 35, satMin: 0.15, redRatio: 1.05 },
          };
          
          const settings = sensitivitySettings[sensitivity];
          
          // Create region of interest mask if user outline is provided
          let regionOfInterestMask: boolean[] | null = null;
          detectionMethod = `Color analysis (${sensitivity} sensitivity)`;
          
          if (options.userOutline && options.userOutline.points.length > 2) {
            // Scale the outline points if the canvas and outline points use different coordinate systems
            const scaledPoints = options.userOutline.points.map(point => {
              return {
                x: Math.min(Math.max(0, point.x), canvas.width),
                y: Math.min(Math.max(0, point.y), canvas.height)
              };
            });
            
            regionOfInterestMask = createRegionOfInterestMask(
              scaledPoints, 
              options.userOutline.closed,
              canvas.width, 
              canvas.height
            );
            detectionMethod = `User-guided ${detectionMethod}`;
          }
          
          // NEW: Analyze skin tone to adapt detection parameters
          const skinTone = analyzeSkinTone(data, canvas.width, canvas.height);
          const adaptedSettings = adaptSettingsForSkinTone(settings, skinTone);
          
          // Analyze image with the optional region mask and skin-tone adapted settings
          result = detectWound(data, canvas.width, canvas.height, adaptedSettings, regionOfInterestMask);
          
          // If no significant wound area was detected, try with higher sensitivity
          if (result.pixelCount === 0 && sensitivity !== 'high') {
            const highSensitivitySettings = sensitivitySettings['high'];
            const adaptedHighSettings = adaptSettingsForSkinTone(highSensitivitySettings, skinTone);
            const highSensitivityResult = detectWound(
              data, 
              canvas.width, 
              canvas.height, 
              adaptedHighSettings, 
              regionOfInterestMask
            );
            
            // If we still don't detect anything significant, return the original result
            if (highSensitivityResult.pixelCount > 0) {
              Object.assign(result, highSensitivityResult);
              detectionMethod = `${detectionMethod} (auto-boosted sensitivity)`;
            }
          }
          
          // Add skin tone information to detection method
          detectionMethod += ` - ${getFitzpatrickDescription(skinTone.fitzpatrickType)}`;
        }
        
        // Calculate area in mm²
        let estimatedArea = 0;
        
        if (options.referenceSize && options.referenceWidth) {
          // If we have a reference size and width, use them for calibrated estimation
          const pixelsPerMM = options.referenceWidth / (canvas.width * 0.5); // Assuming reference covers half the image
          estimatedArea = result.pixelCount / (pixelsPerMM * pixelsPerMM);
        } else {
          // Otherwise use default estimation based on assumed image area
          const assumedImageAreaInMM = options.assumedImageSize || 2500; // 50mm x 50mm by default
          estimatedArea = (result.pixelCount / result.totalPixels) * assumedImageAreaInMM;
        }
        
        // Create visualization of the detected wound, including user outline if provided
        const processedImageUrl = createVisualizedOutput(
          img, 
          result.woundMask, 
          canvas.width, 
          canvas.height, 
          options.userOutline
        );
        
        // Analyze healing indicators
        const healingIndicators = analyzeWoundHealingIndicators(
          data, 
          result.woundMask, 
          canvas.width, 
          canvas.height
        );
        
        resolve({
          estimatedArea: Math.max(1, Math.round(estimatedArea)),
          processedImageUrl,
          confidence: result.confidence,
          pixelCount: result.pixelCount,
          totalPixels: result.totalPixels,
          detectionMethod,
          // Add healing indicators to the result
          healingIndicators
        });
      } catch (error) {
        reject(error);
      }
    };
    
    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };
    
    // Set the image source after setting up the callbacks
    img.src = imageUrl;
  });
}

interface DetectionResult {
  pixelCount: number;
  totalPixels: number;
  confidence: number;
  woundMask: Uint8ClampedArray;
}

/**
 * Get descriptive text for Fitzpatrick skin type
 */
function getFitzpatrickDescription(type: 1 | 2 | 3 | 4 | 5 | 6): string {
  switch (type) {
    case 1: return "Very fair skin";
    case 2: return "Fair skin";
    case 3: return "Medium skin";
    case 4: return "Olive skin";
    case 5: return "Brown skin";
    case 6: return "Dark brown/black skin";
  }
}

/**
 * Analyze the skin tone in an image using the Fitzpatrick scale
 */
function analyzeSkinTone(
  imageData: Uint8ClampedArray,
  width: number,
  height: number
): SkinToneAnalysis {
  // Extract skin pixels
  const skinPixels: {r: number, g: number, b: number}[] = [];
  
  // Sample pixels in grid pattern for performance
  const sampleEvery = Math.max(1, Math.floor(Math.sqrt(width * height) / 100));
  
  for (let y = 0; y < height; y += sampleEvery) {
    for (let x = 0; x < width; x += sampleEvery) {
      const i = (y * width + x) * 4;
      
      if (imageData[i + 3] < 128) continue; // Skip transparent pixels
      
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      
      // Basic skin detection heuristic
      if (isSkinPixel(r, g, b)) {
        skinPixels.push({ r, g, b });
      }
    }
  }
  
  // Calculate average RGB of skin pixels
  const avgSkin = skinPixels.reduce(
    (acc, pixel) => ({
      r: acc.r + pixel.r,
      g: acc.g + pixel.g, 
      b: acc.b + pixel.b
    }),
    { r: 0, g: 0, b: 0 }
  );
  
  if (skinPixels.length > 0) {
    avgSkin.r /= skinPixels.length;
    avgSkin.g /= skinPixels.length;
    avgSkin.b /= skinPixels.length;
  } else {
    // If no skin pixels detected, use middle values
    avgSkin.r = 180;
    avgSkin.g = 140;
    avgSkin.b = 120;
  }
  
  // Calculate luminance
  const luminance = 0.299 * avgSkin.r + 0.587 * avgSkin.g + 0.114 * avgSkin.b;
  
  // Determine Fitzpatrick type based on luminance and RGB ratios
  let fitzpatrickType: 1 | 2 | 3 | 4 | 5 | 6;
  
  // Calculate ITA° (Individual Typology Angle) value
  // ITA = [arctangent((L* - 50)/b*)] × 180/π
  // This is a simplified version using luminance instead of L*
  const normLuminance = (luminance / 255) * 100;
  const cbColor = (avgSkin.b - avgSkin.r) / 2;
  const ita = Math.atan((normLuminance - 50) / cbColor) * 180 / Math.PI;
  
  // ITA° classification for Fitzpatrick types
  if (ita > 55) fitzpatrickType = 1;       // Very light skin
  else if (ita > 41) fitzpatrickType = 2;  // Light skin
  else if (ita > 28) fitzpatrickType = 3;  // Intermediate skin
  else if (ita > 10) fitzpatrickType = 4;  // Tan skin
  else if (ita > -30) fitzpatrickType = 5; // Brown skin
  else fitzpatrickType = 6;                // Dark brown/black skin
  
  return {
    fitzpatrickType,
    averageColor: avgSkin,
    luminance
  };
}

/**
 * Basic skin pixel detection
 */
function isSkinPixel(r: number, g: number, b: number): boolean {
  // This is a simplified heuristic for skin detection across different skin tones
  
  // Rule 1: Red should be highest in most skin tones
  const isRedHighest = r > g && r > b;
  
  // Rule 2: Some red dominance
  const hasRedDominance = r - Math.min(g, b) > 10;
  
  // Rule 3: Maintain RGB proportions common in skin
  const hasCorrectProportions = g > 0.4 * r && b > 0.2 * r;
  
  // Rule 4: Red-green difference isn't too extreme
  const reasonableRedGreenDiff = r - g < 0.65 * r;
  
  // Combined check
  return isRedHighest && hasRedDominance && hasCorrectProportions && reasonableRedGreenDiff;
}

/**
 * Adapt detection settings based on skin tone
 */
function adaptSettingsForSkinTone(
  baseSettings: { hueRange: number; satMin: number; redRatio: number },
  skinTone: SkinToneAnalysis
): { hueRange: number; satMin: number; redRatio: number } {
  // Make a copy of the settings to modify
  const adaptedSettings = { ...baseSettings };
  
  // Adjust settings based on Fitzpatrick skin type
  switch (skinTone.fitzpatrickType) {
    case 1:
    case 2:
      // For very fair skin, wounds have high contrast, use stricter settings
      adaptedSettings.redRatio *= 1.1;
      adaptedSettings.satMin *= 1.1;
      break;
      
    case 3:
    case 4:
      // Medium to olive skin, use the base settings
      break;
      
    case 5:
      // Brown skin, reduce thresholds
      adaptedSettings.redRatio *= 0.9;
      adaptedSettings.satMin *= 0.8;
      adaptedSettings.hueRange *= 1.1;
      break;
      
    case 6:
      // Dark brown/black skin, significantly reduce thresholds
      adaptedSettings.redRatio *= 0.8;
      adaptedSettings.satMin *= 0.6;
      adaptedSettings.hueRange *= 1.2;
      break;
  }
  
  return adaptedSettings;
}

/**
 * Detect wound using ONNX.js model
 */
async function detectWoundWithML(
  imageData: ImageData,
  width: number,
  height: number,
  userOutline?: {
    points: Array<{x: number, y: number}>;
    closed: boolean;
  },
  boundingBox?: { 
    x: number;
    y: number;
    width: number;
    height: number;
  }
): Promise<DetectionResult> {
  if (!woundSegmentationModel) {
    throw new Error("ML model not loaded");
  }
  
  try {
    // Size to resize the image for model input
    const modelInputSize = 224;
    
    // Create a temporary canvas for preprocessing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = modelInputSize;
    tempCanvas.height = modelInputSize;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) {
      throw new Error("Failed to create canvas context");
    }
    
    // Create a temporary canvas from the image data
    const imageDataCanvas = createCanvasFromImageData(imageData);
    
    let cropX = 0, cropY = 0, cropWidth = width, cropHeight = height;
    let hasCrop = false;
    
    // Use the boundingBox if provided to focus the ML processing on a specific area
    if (boundingBox && boundingBox.width > 10 && boundingBox.height > 10) {
      // Set crop values from the bounding box
      cropX = boundingBox.x;
      cropY = boundingBox.y;
      cropWidth = boundingBox.width;
      cropHeight = boundingBox.height;
      hasCrop = true;
    }
    
    // Draw the cropped image to the temporary canvas
    tempCtx.drawImage(
      imageDataCanvas,
      cropX, cropY, cropWidth, cropHeight,
      0, 0, modelInputSize, modelInputSize
    );
    
    // Get the resized image data for processing
    const resizedData = tempCtx.getImageData(0, 0, modelInputSize, modelInputSize);
    
    // Apply any user-provided region of interest mask if available
    let roiMask: boolean[] | null = null;
    if (userOutline && userOutline.points.length > 2) {
      // Scale the user outline to model input size
      const scaledPoints = userOutline.points.map(point => ({
        // If we cropped, we need to adjust the coordinates relative to the crop
        x: hasCrop ? 
          ((point.x - cropX) / cropWidth) * modelInputSize :
          (point.x / width) * modelInputSize,
        y: hasCrop ? 
          ((point.y - cropY) / cropHeight) * modelInputSize :
          (point.y / height) * modelInputSize
      }));
      
      roiMask = createRegionOfInterestMask(
        scaledPoints,
        userOutline.closed,
        modelInputSize,
        modelInputSize
      );
    }
    
    // Prepare tensor input data - float32 array of normalized RGB values
    // ONNX models typically expect data in NCHW format (batch, channels, height, width)
    // With values normalized between 0-1
    const inputData = new Float32Array(1 * 3 * modelInputSize * modelInputSize);
    
    // Fill the input tensor with normalized RGB values
    let offset = 0;
    // For each channel (R, G, B)
    for (let c = 0; c < 3; c++) {
      // For each pixel
      for (let i = 0; i < resizedData.data.length / 4; i++) {
        // Only consider pixels in the ROI if a mask is provided
        if (roiMask && !roiMask[i]) {
          inputData[offset++] = 0;
          continue;
        }
        
        // For RGB, we take channels 0, 1, 2 from the image data
        // Normalize to 0-1 range for the neural network
        const value = resizedData.data[i * 4 + c] / 255.0;
        inputData[offset++] = value;
      }
    }
    
    // Create ONNX tensor from the input data
    const inputTensor = new onnx.Tensor(
      'float32', 
      inputData, 
      [1, 3, modelInputSize, modelInputSize] // Shape: [batch, channels, height, width]
    );
    
    // Create feeds object with input tensor
    const feeds = { input: inputTensor };
    
    // Run model inference
    const results = await woundSegmentationModel.run(feeds);
    
    // Get the output tensor - assuming output is a mask with name 'output'
    const outputTensor = results.output;
    
    if (!outputTensor) {
      throw new Error("Model didn't return expected output");
    }
    
    // Get array data from the output tensor
    const outputData = outputTensor.data as Float32Array;
    
    // Create wound mask with the original image size
    const woundMask = new Uint8ClampedArray(width * height * 4).fill(0);
    
    // Track wound pixels and confidence
    let pixelCount = 0;
    let confidenceSum = 0;
    
    // Resize the segmentation mask back to original image size
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Only process pixels inside the bounding box if one was provided
        if (hasCrop && boundingBox) {    
          const isInBoundingBox = x >= boundingBox.x && 
                                x < (boundingBox.x + boundingBox.width) &&
                                y >= boundingBox.y && 
                                y < (boundingBox.y + boundingBox.height);
                                
          if (!isInBoundingBox) {
            // Skip pixels outside the bounding box - important to ensure nothing outside is selected
            continue;
          }
          
          // For pixels inside the bounding box, map to the model output coordinates
          const modelX = Math.floor(((x - boundingBox.x) / boundingBox.width) * modelInputSize);
          const modelY = Math.floor(((y - boundingBox.y) / boundingBox.height) * modelInputSize);
          
          // Check if the mapped coordinates are valid
          if (modelX < 0 || modelX >= modelInputSize || modelY < 0 || modelY >= modelInputSize) {
            continue;
          }
          
          // Get the confidence from the model output 
          const confidence = outputData[modelY * modelInputSize + modelX];
          const isWound = confidence > 0.5;
          
          if (isWound) {
            // Mark this pixel in the mask
            const targetIdx = (y * width + x) * 4;
            
            woundMask[targetIdx] = 255;     // Red
            woundMask[targetIdx + 1] = 0;   // Green
            woundMask[targetIdx + 2] = 128; // Blue
            woundMask[targetIdx + 3] = Math.round(confidence * 200 + 55);
            
            pixelCount++;
            confidenceSum += confidence;
          }
        } else {
          // Regular full-image processing
          // Map coordinates from original to model size
          const srcX = (x / width) * modelInputSize;
          const srcY = (y / height) * modelInputSize;
          
          // Get the four nearest source pixels
          const srcX0 = Math.floor(srcX);
          const srcY0 = Math.floor(srcY);
          const srcX1 = Math.min(srcX0 + 1, modelInputSize - 1);
          const srcY1 = Math.min(srcY0 + 1, modelInputSize - 1);
          
          // Calculate interpolation weights
          const xWeight = srcX - srcX0;
          const yWeight = srcY - srcY0;
          
          // Get values of the four nearest pixels from the model output
          const val00 = outputData[srcY0 * modelInputSize + srcX0];
          const val01 = outputData[srcY0 * modelInputSize + srcX1];
          const val10 = outputData[srcY1 * modelInputSize + srcX0];
          const val11 = outputData[srcY1 * modelInputSize + srcX1];
          
          // Perform bilinear interpolation
          const topInterp = val00 * (1 - xWeight) + val01 * xWeight;
          const bottomInterp = val10 * (1 - xWeight) + val11 * xWeight;
          const finalVal = topInterp * (1 - yWeight) + bottomInterp * yWeight;
          
          // Threshold the value to get binary segmentation with confidence
          const confidence = Math.max(0, Math.min(1, finalVal));
          const isWound = confidence > 0.5;
          
          if (isWound) {
            // Get the target index in the wound mask
            const targetIdx = (y * width + x) * 4;
            
            // Mark as wound in the mask
            woundMask[targetIdx] = 255;     // Red
            woundMask[targetIdx + 1] = 0;   // Green
            woundMask[targetIdx + 2] = 128; // Blue
            
            // Set alpha based on confidence (55-255)
            woundMask[targetIdx + 3] = Math.round(confidence * 200 + 55);
            
            // Count this pixel
            pixelCount++;
            confidenceSum += confidence;
          }
        }
      }
    }
    
    return {
      pixelCount,
      totalPixels: width * height,
      confidence: pixelCount > 0 ? confidenceSum / pixelCount : 0,
      woundMask
    };
    
  } catch (error) {
    console.error("ML-based wound detection error:", error);
    throw error;
  }
}

/**
 * Helper function to create a canvas from ImageData
 */
function createCanvasFromImageData(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(imageData, 0, 0);
  }
  
  return canvas;
}

/**
 * Simplified stub for the auto-segmentation function
 * This is kept for API compatibility but returns default values
 * since we're no longer using auto-segmentation by default
 */
export function autoSegmentWound(
  _imageData: Uint8ClampedArray,
  width: number,
  height: number,
  _skinTone: SkinToneAnalysis
): {mask: Uint8ClampedArray, pixelCount: number, confidence: number} {
  // Create a default return value with an empty mask
  const visualMask = new Uint8ClampedArray(width * height * 4);
  
  return {
    mask: visualMask,
    pixelCount: 0,
    confidence: 0
  };
}

function detectWound(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  settings: { hueRange: number; satMin: number; redRatio: number },
  regionOfInterestMask: boolean[] | null = null
): DetectionResult {
  const totalPixels = width * height;
  const woundMask = new Uint8ClampedArray(imageData.length);
  
  // Pre-processing: Calculate image average color and luminance
  let avgRed = 0, avgGreen = 0, avgBlue = 0;
  let avgLuma = 0;
  
  // Track skin tone regions for adaptive detection
  let skinToneR = 0, skinToneG = 0, skinToneB = 0;
  let skinPixelCount = 0;
  
  // First pass: analyze the entire image to detect average skin tone
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    
    // Skip pixels that don't contribute to the overall stats
    if (imageData[i + 3] < 128) continue;
    
    // Add to global averages
    avgRed += r;
    avgGreen += g;
    avgBlue += b;
    
    // Calculate luminance: 0.299R + 0.587G + 0.114B
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    avgLuma += luma;
    
    // Basic skin tone detection (works for various skin tones)
    // This heuristic checks if the color is in the skin tone range, which spans from pale to dark skin
    // Instead of unused max/min, just use the values directly in the conditions
    if (r > g && r > b && // Red channel is highest in most skin tones
        r - Math.min(g, b) > 10 && // Some red dominance
        g > 0.4 * r && b > 0.25 * r && // Maintain proportions of RGB common in skin
        ((r - g) < 0.5 * r)) { // Red-green difference isn't too extreme
      
      skinToneR += r;
      skinToneG += g;
      skinToneB += b;
      skinPixelCount++;
    }
  }
  
  // Calculate averages
  if (totalPixels > 0) {
    avgRed /= totalPixels;
    avgGreen /= totalPixels;
    avgBlue /= totalPixels;
    avgLuma /= totalPixels;
  }
  
  // If we found enough skin pixels, use them as reference
  let skinToneReference = false;
  if (skinPixelCount > totalPixels * 0.1) { // At least 10% of the image should be skin
    skinToneR /= skinPixelCount;
    skinToneG /= skinPixelCount;
    skinToneB /= skinPixelCount;
    skinToneReference = true;
  } else {
    // Fallback to general averages if not enough skin detected
    skinToneR = avgRed;
    skinToneG = avgGreen;
    skinToneB = avgBlue;
  }
  
  // Calculate standard deviation for luminance to detect shadow thresholds
  let lumaVariance = 0;
  for (let i = 0; i < imageData.length; i += 4) {
    if (imageData[i + 3] < 128) continue;
    
    const luma = 0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2];
    lumaVariance += (luma - avgLuma) * (luma - avgLuma);
  }
  
  const lumaStdDev = Math.sqrt(lumaVariance / totalPixels);
  const shadowThreshold = avgLuma - lumaStdDev * 1.5; // Pixels darker than this might be shadows
  
  // Simple edge detection to help with boundary identification
  const edgeMap = new Uint8ClampedArray(totalPixels);
  
  // Simplified edge detection using local luminance difference
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const topIdx = ((y - 1) * width + x) * 4;
      const rightIdx = (y * width + (x + 1)) * 4;
      const bottomIdx = ((y + 1) * width + x) * 4;
      const leftIdx = (y * width + (x - 1)) * 4;
      
      // Calculate luminance for center and surrounding pixels
      const centerLuma = 0.299 * imageData[idx] + 0.587 * imageData[idx + 1] + 0.114 * imageData[idx + 2];
      const topLuma = 0.299 * imageData[topIdx] + 0.587 * imageData[topIdx + 1] + 0.114 * imageData[topIdx + 2];
      const rightLuma = 0.299 * imageData[rightIdx] + 0.587 * imageData[rightIdx + 1] + 0.114 * imageData[rightIdx + 2];
      const bottomLuma = 0.299 * imageData[bottomIdx] + 0.587 * imageData[bottomIdx + 1] + 0.114 * imageData[bottomIdx + 2];
      const leftLuma = 0.299 * imageData[leftIdx] + 0.587 * imageData[leftIdx + 1] + 0.114 * imageData[leftIdx + 2];
      
      // Calculate max difference
      const maxDiff = Math.max(
        Math.abs(centerLuma - topLuma),
        Math.abs(centerLuma - rightLuma),
        Math.abs(centerLuma - bottomLuma),
        Math.abs(centerLuma - leftLuma)
      );
      
      // Mark as edge if difference is significant
      edgeMap[y * width + x] = maxDiff > 15 ? 1 : 0;
    }
  }
  
  // Detect wound pixels
  let woundPixelCount = 0;
  let confidenceSum = 0;
  
  // Calculate average red-to-others ratio to better identify skin tone variations
  let avgRedRatio = 0;
  let ratioSamples = 0;
  
  for (let i = 0; i < imageData.length; i += 4) {
    const red = imageData[i];
    const green = imageData[i + 1];
    const blue = imageData[i + 2];
    
    if (green > 0 && blue > 0) {
      avgRedRatio += red / ((green + blue) / 2);
      ratioSamples++;
    }
  }
  
  avgRedRatio = ratioSamples > 0 ? avgRedRatio / ratioSamples : 1.0;
  
  // Calculate skin-tone adaptive detection thresholds
  // This is the key improvement for handling different skin tones
  const skinToneLuma = 0.299 * skinToneR + 0.587 * skinToneG + 0.114 * skinToneB;
  
  // Adaptive thresholds based on detected skin tone
  let adaptiveRedRatioThreshold: number;
  let adaptiveSaturationMin: number;
  
  // For darker skin, use relative increases in red rather than absolute values
  if (skinToneLuma < 80) { // Darker skin
    adaptiveRedRatioThreshold = Math.max(1.05, avgRedRatio * 0.9); // Lower red ratio threshold, more focused on relative change
    adaptiveSaturationMin = Math.max(0.08, settings.satMin * 0.6); // Lower saturation threshold
  } else if (skinToneLuma < 120) { // Medium skin
    adaptiveRedRatioThreshold = Math.max(1.08, avgRedRatio * 0.95);
    adaptiveSaturationMin = Math.max(0.12, settings.satMin * 0.8);
  } else { // Lighter skin
    adaptiveRedRatioThreshold = Math.max(settings.redRatio, avgRedRatio);
    adaptiveSaturationMin = settings.satMin;
  }
  
  // For each pixel, analyze surrounding context to determine if it's wound
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const pixelIndex = i / 4;
      
      // Skip pixels outside the region of interest if a mask is provided
      if (regionOfInterestMask && !regionOfInterestMask[pixelIndex]) {
        continue;
      }
      
      const red = imageData[i];
      const green = imageData[i + 1];
      const blue = imageData[i + 2];
      const alpha = imageData[i + 3];
      
      // Skip transparent pixels
      if (alpha < 128) continue;
      
      // Calculate HSV
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const delta = max - min;
      
      // Saturation & Value
      const saturation = max === 0 ? 0 : delta / max;
      const value = max / 255;
      
      // Calculate luminance for shadow detection
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      
      // Shadow detection (adjusted for darker skin)
      const isShadow = luma < shadowThreshold && saturation < 0.3;
      
      // Hue calculation
      let hue = 0;
      if (delta === 0) {
        hue = 0;
      } else {
        if (max === red) {
          hue = ((green - blue) / delta) % 6;
        } else if (max === green) {
          hue = (blue - red) / delta + 2;
        } else {
          hue = (red - green) / delta + 4;
        }
        hue *= 60;
        if (hue < 0) hue += 360;
      }
      
      // IMPROVED: Compute red dominance relative to surrounding area and skin tone
      // Get a relative redness score compared to the detected skin tone
      const relativeSkinRedness = (red / (green + blue + 1)) / (skinToneR / (skinToneG + skinToneB + 1));
      
      // Also check local context by analyzing a small neighborhood
      let localAreaRedSum = 0, localAreaGreenSum = 0, localAreaBlueSum = 0;
      let localAreaCount = 0;
      
      // Sample neighboring pixels (within 5 pixels radius)
      const sampleRadius = 5;
      for (let ny = Math.max(0, y - sampleRadius); ny <= Math.min(height - 1, y + sampleRadius); ny += 2) {
        for (let nx = Math.max(0, x - sampleRadius); nx <= Math.min(width - 1, x + sampleRadius); nx += 2) {
          // Skip the center pixel itself
          if (nx === x && ny === y) continue;
          
          // Skip if too far from center (approximate circle)
          const distance = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
          if (distance > sampleRadius) continue;
          
          const ni = (ny * width + nx) * 4;
          
          // Skip if outside region of interest or transparent
          if ((regionOfInterestMask && !regionOfInterestMask[ni / 4]) || imageData[ni + 3] < 128) continue;
          
          // Add to local area sums
          localAreaRedSum += imageData[ni];
          localAreaGreenSum += imageData[ni + 1];
          localAreaBlueSum += imageData[ni + 2];
          localAreaCount++;
        }
      }
      
      // If we have enough surrounding pixels, compute a local contrast ratio
      let localRedContrastRatio = 1.0;
      if (localAreaCount > 0) {
        const localAvgRed = localAreaRedSum / localAreaCount;
        const localAvgGreen = localAreaGreenSum / localAreaCount;
        const localAvgBlue = localAreaBlueSum / localAreaCount;
        
        // Compute how much redder this pixel is compared to its neighborhood
        if (localAvgGreen > 0 && localAvgBlue > 0) {
          const localAreaRedRatio = localAvgRed / ((localAvgGreen + localAvgBlue) / 2);
          localRedContrastRatio = (red / ((green + blue) / 2)) / localAreaRedRatio;
        }
      }
      
      // Relative redness is now based on both overall skin tone and local neighborhood
      const redRatio = (green + blue > 0) ? red / ((green + blue) / 2) : 1.0;
      
      // Calculate pixel position for edge detection
      const isEdge = x > 0 && x < width - 1 && y > 0 && y < height - 1 && 
                   edgeMap[y * width + x] === 1;
      
      // Extended wound hue ranges with more precise values
      const isWoundHue = (
        (hue >= 0 && hue <= 30) ||     // Red to orange-red
        (hue >= 340 && hue <= 360) ||  // Red to magenta-red
        (hue >= 300 && hue <= 339 && saturation < 0.5 && relativeSkinRedness > 1.08)  // Purplish for darker wounds
      );
      
      // IMPROVED: For darker skin, we put more weight on the relative redness compared to skin tone
      const isRedHigher = skinToneLuma < 100
        ? relativeSkinRedness > 1.15 || localRedContrastRatio > 1.1  // For darker skin, use relative values
        : red > green * adaptiveRedRatioThreshold && red > blue * adaptiveRedRatioThreshold; // For lighter skin
      
      const isReasonablySaturated = saturation > adaptiveSaturationMin && saturation < 0.95; // Upper bound to exclude artifical colors
      const isReasonablyBright = skinToneLuma < 80 
        ? value > 0.08 && value < 0.95  // Allow darker values for dark skin
        : value > 0.15 && value < 0.90; // Standard range for lighter skin
      
      const isAboveAvg = skinToneReference 
        ? relativeSkinRedness > 1.05  // Compare to detected skin tone
        : red > avgRed * 1.05;       // Fallback to image average
      
      // Skip shadows
      if (isShadow) {
        continue;
      }
      
      // Confidence level (0-1) based on how well the pixel matches wound criteria
      let confidence = 0;
      
      // IMPROVED: Adjust criteria for detection based on skin tone
      const detectAsWound = skinToneLuma < 80
        // For darker skin tones, rely more on relative redness and local contrast
        ? ((isWoundHue || relativeSkinRedness > 1.15) && localRedContrastRatio > 1.08 && isReasonablyBright)
        // For lighter skin tones, use the standard criteria
        : ((isWoundHue && isRedHigher && isReasonablySaturated && isReasonablyBright) || 
           (isEdge && redRatio > adaptiveRedRatioThreshold * 1.1 && isReasonablyBright));
      
      if (detectAsWound) {
        // Calculate confidence based on multiple factors
        const hueFactor = isWoundHue ? 
          (1 - Math.min(Math.abs(hue - 0), Math.abs(hue - 360)) / 30) : 0.3;
        
        // For darker skin, use the relative redness factors more
        const redFactor = skinToneLuma < 100
          ? Math.min(1, (relativeSkinRedness - 1) * 1.2)
          : Math.min(1, (redRatio - 1) * 0.6);
        
        const satFactor = Math.min(1, saturation / (skinToneLuma < 100 ? 0.4 : 0.6));
        
        // Weight the local contrast more heavily for darker skin
        const localContrastWeight = skinToneLuma < 100 ? 0.35 : 0.1;
        
        // Weighted confidence calculation with adjusted weights for skin tone
        confidence = (hueFactor * 0.3 + redFactor * 0.4 + satFactor * 0.2 + 
                     Math.min(1, (localRedContrastRatio - 1) * 2) * localContrastWeight) * 
                    (isAboveAvg ? 1.1 : 0.9) * 
                    (isEdge ? 0.9 : 1.0);
        
        confidence = Math.min(1, Math.max(0, confidence));
        
        // Use a lower threshold for darker skin since the contrasts can be more subtle
        const confidenceThreshold = skinToneLuma < 100 ? 0.28 : 0.35;
        
        if (confidence > confidenceThreshold) {
          woundPixelCount++;
          confidenceSum += confidence;
          
          // Mark this pixel in the mask with higher opacity for more confident detections
          woundMask[i] = 255; // Red
          woundMask[i + 1] = 0; // Green
          woundMask[i + 2] = 128; // Blue
          woundMask[i + 3] = Math.round(confidence * 200 + 55); // Alpha based on confidence (55-255)
        }
      }
    }
  }
  
  // If inside a user-drawn region and very little is detected, use more aggressive detection
  // This helps when the user has clearly identified an area but our algorithm isn't sensitive enough
  if (regionOfInterestMask && woundPixelCount < totalPixels * 0.01 && skinToneLuma < 100) {
    // Second pass with more aggressive detection for dark skin tones within user-drawn regions
    woundPixelCount = 0;
    confidenceSum = 0;
    
    for (let i = 0; i < imageData.length; i += 4) {
      const pixelIndex = i / 4;
      
      // Only process pixels inside the region of interest
      if (!regionOfInterestMask[pixelIndex] || imageData[i + 3] < 128) {
        continue;
      }
      
      const red = imageData[i];
      const green = imageData[i + 1];
      const blue = imageData[i + 2];
      
      // For dark skin with user outline, focus mostly on luminance differences
      const pixelLuma = 0.299 * red + 0.587 * green + 0.114 * blue;
      
      // Check if pixel is darker than skin tone and has some red dominance
      if (pixelLuma < skinToneLuma * 0.85 && red > Math.min(green, blue)) {
        const confidence = 0.5 * Math.min(1, (skinToneLuma - pixelLuma) / (skinToneLuma * 0.3));
        
        woundPixelCount++;
        confidenceSum += confidence;
        
        // Mark in the mask
        woundMask[i] = 255; // Red
        woundMask[i + 1] = 0; // Green
        woundMask[i + 2] = 128; // Blue
        woundMask[i + 3] = Math.round(confidence * 200 + 55);
      }
    }
  }
  
  // If less than 0.5% of the image is detected as wound, it might be noise
  // But for user-defined regions, we're more lenient (0.1% threshold)
  const minDetectionPercent = regionOfInterestMask ? 0.001 : 0.005;
  const detectionPercent = woundPixelCount / totalPixels;
  
  if (detectionPercent < minDetectionPercent) {
    return {
      pixelCount: 0,  // Return zero to indicate no significant detection
      totalPixels,
      confidence: 0,
      woundMask
    };
  }
  
  return {
    pixelCount: woundPixelCount,
    totalPixels,
    confidence: woundPixelCount > 0 ? confidenceSum / woundPixelCount : 0,
    woundMask
  };
}

/**
 * Creates a binary mask for the region of interest based on user-drawn outline
 * 
 * @param points Array of points defining the outline
 * @param closed Whether the outline is closed
 * @param width Canvas width
 * @param height Canvas height
 * @returns Binary mask array where true indicates inside the region
 */
function createRegionOfInterestMask(
  points: Array<{x: number, y: number}>,
  closed: boolean,
  width: number,
  height: number
): boolean[] {
  // Create a temporary canvas to draw the region
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    return new Array(width * height).fill(true); // Fallback to no masking
  }
  
  // Clear the canvas
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);
  
  // Draw the region in white
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  
  // Draw lines between points
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  
  // Close the path if needed
  if (closed && points.length > 2) {
    ctx.closePath();
  }
  
  // Fill and get the mask data
  ctx.fill();
  const maskData = ctx.getImageData(0, 0, width, height).data;
  
  // Convert to boolean array (white pixels = true)
  const result: boolean[] = new Array(width * height);
  for (let i = 0; i < maskData.length; i += 4) {
    result[i/4] = maskData[i] > 128;
  }
  
  return result;
}

function createVisualizedOutput(
  originalImage: HTMLImageElement,
  woundMask: Uint8ClampedArray,
  width: number,
  height: number,
  userOutline?: {
    points: Array<{x: number, y: number}>;
    closed: boolean;
  }
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    return '';
  }
  
  // Draw original image with better clarity
  ctx.globalAlpha = 0.8;
  ctx.drawImage(originalImage, 0, 0);
  
  // Overlay wound detection
  ctx.globalAlpha = 0.4;
  const overlayImageData = new ImageData(woundMask, width, height);
  ctx.putImageData(overlayImageData, 0, 0);
  
  // Remove automatic bounding box drawing when no user outline is provided
  
  // Draw user outline if provided
  if (userOutline && userOutline.points.length > 1) {
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(userOutline.points[0].x, userOutline.points[0].y);
    
    for (let i = 1; i < userOutline.points.length; i++) {
      ctx.lineTo(userOutline.points[i].x, userOutline.points[i].y);
    }
    
    if (userOutline.closed && userOutline.points.length > 2) {
      ctx.closePath();
    }
    
    ctx.stroke();
  }
  
  // Add label showing the detection method
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(5, height - 25, 150, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '12px Arial';
  ctx.fillText(userOutline ? 'User-Guided Detection' : 'Color Analysis Detection', 10, height - 10);
  
  return canvas.toDataURL('image/png');
}

/**
 * Estimates the actual size of an object in an image
 * when given a reference object of known size
 * 
 * @param referencePixels Number of pixels in the reference object
 * @param referenceSize Actual size of reference object (mm²)
 * @param targetPixels Number of pixels in the target object
 * @returns Estimated size of target object (mm²)
 */
export function calibratedSizeEstimation(
  referencePixels: number,
  referenceSize: number,
  targetPixels: number
): number {
  const pixelToSizeRatio = referenceSize / referencePixels;
  return targetPixels * pixelToSizeRatio;
}

/**
 * Calculate scale factor between two images based on visual features
 * This helps when images are taken at different distances
 * 
 * @param referenceImageUrl URL or data URI of the reference image
 * @param currentImageUrl URL or data URI of the current image
 * @param options Optional configuration for the scaling process
 * @returns Promise resolving to the calculated scale factor
 */
export async function calculateImageScaleFactor(
  referenceImageUrl: string,
  currentImageUrl: string,
  options: {
    manualScale?: number;
    useFeatureMatching?: boolean;
    referenceRegion?: {x: number, y: number, width: number, height: number};
    currentRegion?: {x: number, y: number, width: number, height: number};
  } = {}
): Promise<number> {
  // If manual scale is provided, return it directly
  if (options.manualScale && options.manualScale > 0) {
    return options.manualScale;
  }

  // Load both images
  const [referenceImage, currentImage] = await Promise.all([
    loadImage(referenceImageUrl),
    loadImage(currentImageUrl)
  ]);

  // Default to simple size-based scaling if feature matching is not requested
  if (!options.useFeatureMatching) {
    // Calculate a simple ratio based on image dimensions
    // This assumes both images have similar framing and the wound takes up a comparable 
    // portion of the frame in both pictures
    const referenceArea = referenceImage.width * referenceImage.height;
    const currentArea = currentImage.width * currentImage.height;
    
    // Return the square root of the area ratio to get a linear scale factor
    return Math.sqrt(currentArea / referenceArea);
  }

  // For more advanced feature matching, we need to extract visual features
  // from both images and match them to determine the scale
  // This implementation uses a simplified approach that works with regions of interest

  // Create canvases for both images
  const referenceCanvas = document.createElement('canvas');
  const currentCanvas = document.createElement('canvas');
  
  // Setup reference canvas
  referenceCanvas.width = referenceImage.width;
  referenceCanvas.height = referenceImage.height;
  const refCtx = referenceCanvas.getContext('2d');
  if (!refCtx) throw new Error("Failed to create canvas context");
  refCtx.drawImage(referenceImage, 0, 0);
  
  // Setup current image canvas
  currentCanvas.width = currentImage.width;
  currentCanvas.height = currentImage.height;
  const curCtx = currentCanvas.getContext('2d');
  if (!curCtx) throw new Error("Failed to create canvas context");
  curCtx.drawImage(currentImage, 0, 0);

  // Get image data, using regions if provided
  const refRegion = options.referenceRegion || {
    x: 0, y: 0, width: referenceImage.width, height: referenceImage.height
  };
  
  const curRegion = options.currentRegion || {
    x: 0, y: 0, width: currentImage.width, height: currentImage.height
  };

  const refImageData = refCtx.getImageData(
    refRegion.x, refRegion.y, refRegion.width, refRegion.height
  );
  
  const curImageData = curCtx.getImageData(
    curRegion.x, curRegion.y, curRegion.width, curRegion.height
  );

  // Calculate feature descriptors for both images
  // Here we use a simplified edge detection approach and histogram comparison
  const refFeatures = extractImageFeatures(refImageData);
  const curFeatures = extractImageFeatures(curImageData);
  
  // Compare features to estimate scale
  const scaleEstimate = estimateScaleFromFeatures(refFeatures, curFeatures);
  
  // Apply a sanity check - scale factor should typically be between 0.5 and 2.0
  // unless the images are taken from very different distances
  const boundedScale = Math.max(0.25, Math.min(4.0, scaleEstimate));
  
  return boundedScale;
}

/**
 * Load an image from URL or data URI
 * @param url Image URL or data URI
 * @returns Promise resolving to the loaded image
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Extract simplified feature descriptors from image data for comparison
 * @param imageData The image data to analyze
 * @returns Object containing image features used for comparison
 */
function extractImageFeatures(imageData: ImageData) {
  const { width, height, data } = imageData;
  
  // Calculate edge density using a simplified approach
  let edges = 0;
  const edgeThreshold = 30;
  
  // Calculate brightness histogram for distribution analysis
  const histogram = new Array(256).fill(0);
  
  // Sample pixels with a stride to improve performance
  const stride = Math.max(1, Math.floor(Math.sqrt(width * height) / 100));
  
  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const idx = (y * width + x) * 4;
      
      // Calculate pixel brightness
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      
      // Add to histogram
      histogram[brightness]++;
      
      // Simple edge detection
      const idxRight = (y * width + (x + stride)) * 4;
      const idxDown = ((y + stride) * width + x) * 4;
      
      const brightRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
      const brightDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];
      
      if (Math.abs(brightness - brightRight) > edgeThreshold ||
          Math.abs(brightness - brightDown) > edgeThreshold) {
        edges++;
      }
    }
  }
  
  // Calculate image complexity metrics
  const edgeDensity = edges / ((width / stride) * (height / stride));
  
  // Calculate histogram features (25th, 50th, 75th percentiles)
  const totalPixels = Math.floor((width / stride) * (height / stride));
  let count = 0;
  let p25 = 0, p50 = 0, p75 = 0;
  
  for (let i = 0; i < 256; i++) {
    count += histogram[i];
    if (!p25 && count >= totalPixels * 0.25) p25 = i;
    if (!p50 && count >= totalPixels * 0.5) p50 = i;
    if (!p75 && count >= totalPixels * 0.75) p75 = i;
  }
  
  return {
    width,
    height,
    edgeDensity,
    histogram,
    percentiles: { p25, p50, p75 }
  };
}

/**
 * Estimate the scale factor between two images based on their features
 * @param reference Features from the reference image
 * @param current Features from the current image
 * @returns Estimated scale factor
 */
function estimateScaleFromFeatures(reference: any, current: any): number {
  // Basic size-based estimate
  const areaRatio = (current.width * current.height) / (reference.width * reference.height);
  const sizeBasedScale = Math.sqrt(areaRatio);
  
  // Edge density comparison for feature-based estimate
  // If edge density is higher, the image likely contains more detail (closer shot)
  const edgeDensityRatio = reference.edgeDensity > 0 ? 
    current.edgeDensity / reference.edgeDensity : 1;
  
  // Histogram distribution comparison
  // Compare the spread of the histogram to gauge relative detail level
  const refHistSpread = reference.percentiles.p75 - reference.percentiles.p25;
  const curHistSpread = current.percentiles.p75 - current.percentiles.p25;
  const histogramSpreadRatio = refHistSpread > 0 ? curHistSpread / refHistSpread : 1;
  
  // Combine multiple factors with weights
  // Size is most reliable, so it gets the highest weight
  const weightedScale = (sizeBasedScale * 0.6) + 
                        (edgeDensityRatio * 0.25) + 
                        (histogramSpreadRatio * 0.15);
  
  return weightedScale;
}

/**
 * Apply scale factor to wound area measurement
 * 
 * @param area Original area measurement in mm²
 * @param scaleFactor Scale factor relative to reference image
 * @returns Adjusted area measurement in mm²
 */
export function applyScaleToArea(area: number, scaleFactor: number): number {
  // Area scales with square of the linear scale factor
  return area * (scaleFactor * scaleFactor);
}

/**
 * Generates a thumbnail with scale indicators for two images
 * 
 * @param referenceImageUrl URL or data URI of the reference image
 * @param currentImageUrl URL or data URI of the current image
 * @param scaleFactor Scale factor between the two images
 * @returns Promise resolving to data URIs for the processed images with scale indicators
 */
export async function generateScaleComparisonImages(
  referenceImageUrl: string, 
  currentImageUrl: string, 
  scaleFactor: number
): Promise<{referenceImage: string, currentImage: string}> {
  try {
    // Load both images
    const [referenceImage, currentImage] = await Promise.all([
      loadImage(referenceImageUrl),
      loadImage(currentImageUrl)
    ]);
    
    // Create canvases for both images
    const refCanvas = document.createElement('canvas');
    const curCanvas = document.createElement('canvas');
    
    // Size for thumbnail display (fixed for UI consistency)
    const thumbnailSize = 150;
    
    // Determine scale to fit images in the fixed thumbnail size while maintaining aspect ratio
    const refScale = Math.min(
      thumbnailSize / referenceImage.width, 
      thumbnailSize / referenceImage.height
    );
    
    const curScale = Math.min(
      thumbnailSize / currentImage.width,
      thumbnailSize / currentImage.height
    );
    
    // Set canvas dimensions to maintain aspect ratio
    refCanvas.width = referenceImage.width * refScale;
    refCanvas.height = referenceImage.height * refScale;
    curCanvas.width = currentImage.width * curScale;
    curCanvas.height = currentImage.height * curScale;
    
    // Get rendering contexts
    const refCtx = refCanvas.getContext('2d');
    const curCtx = curCanvas.getContext('2d');
    
    if (!refCtx || !curCtx) {
      throw new Error("Failed to get canvas contexts");
    }
    
    // Draw scaled images on canvases
    refCtx.drawImage(
      referenceImage, 
      0, 0, 
      refCanvas.width, 
      refCanvas.height
    );
    
    curCtx.drawImage(
      currentImage, 
      0, 0, 
      curCanvas.width, 
      curCanvas.height
    );
    
    // Calculate the size of the scale indicator
    // Base size is proportional to canvas width - we'll vary this by scale factor
    const baseSize = Math.min(refCanvas.width, curCanvas.width) * 0.3;
    const refIndicatorSize = baseSize;
    const curIndicatorSize = baseSize * (1 / scaleFactor);
    
    // Draw scale indicators
    // Reference image indicator (cyan)
    refCtx.strokeStyle = 'rgba(6, 182, 212, 0.8)'; // cyan
    refCtx.lineWidth = 2;
    refCtx.strokeRect(
      refCanvas.width - refIndicatorSize - 10, 
      refCanvas.height - refIndicatorSize - 10,
      refIndicatorSize,
      refIndicatorSize
    );
    
    // Current image indicator (yellow)
    curCtx.strokeStyle = 'rgba(250, 204, 21, 0.8)'; // yellow
    curCtx.lineWidth = 2;
    curCtx.strokeRect(
      curCanvas.width - curIndicatorSize - 10,
      curCanvas.height - curIndicatorSize - 10,
      curIndicatorSize,
      curIndicatorSize
    );
    
    // Add labels with scaling info
    refCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    refCtx.fillRect(5, 5, 60, 16);
    refCtx.fillStyle = '#FFFFFF';
    refCtx.font = '10px Arial';
    refCtx.fillText('Reference', 10, 15);
    
    curCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    curCtx.fillRect(5, 5, 60, 16);
    curCtx.fillStyle = '#FFFFFF';
    curCtx.font = '10px Arial';
    curCtx.fillText(`Scale: ${scaleFactor.toFixed(2)}x`, 10, 15);
    
    // Return the data URIs
    return {
      referenceImage: refCanvas.toDataURL('image/jpeg'),
      currentImage: curCanvas.toDataURL('image/jpeg')
    };
  } catch (error) {
    console.error('Error generating scale comparison images:', error);
    // Return the original images if processing fails
    return {
      referenceImage: referenceImageUrl,
      currentImage: currentImageUrl
    };
  }
}

/**
 * Analyzes wound healing indicators including inflammation and exudate (pus)
 * 
 * @param imageData Raw image data to analyze
 * @param woundMask Mask identifying the wound region
 * @param width Image width
 * @param height Image height
 * @returns Analysis results with healing indicators
 */
export function analyzeWoundHealingIndicators(
  imageData: Uint8ClampedArray,
  woundMask: Uint8ClampedArray,
  width: number,
  height: number
): {
  inflammationScore: number;
  exudateScore: number;
  rednessRatio: number;
  tissueTypes: {
    granulation: number;
    slough: number;
    eschar: number;
  }
} {
  // Initialize counters and sums for analysis
  let woundPixelCount = 0;
  let inflammationSum = 0;
  let exudateSum = 0;
  
  // Tissue type counters
  let granulationPixels = 0;
  let sloughPixels = 0;
  let escharPixels = 0;
  
  // First pass: gather skin tone data from non-wound areas
  const skinPixels: {r: number, g: number, b: number}[] = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      
      // Skip transparent pixels
      if (imageData[i + 3] < 128) continue;
      
      // If this pixel is not part of the wound (wound mask alpha is low)
      if (woundMask[i + 3] < 50) {
        // Sample skin pixels, but not from every pixel for performance
        if ((x + y) % 7 === 0) { // Sample roughly every 7th pixel
          const r = imageData[i];
          const g = imageData[i + 1];
          const b = imageData[i + 2];
          
          // Check if it's likely a skin pixel
          if (isSkinPixel(r, g, b)) {
            skinPixels.push({ r, g, b });
          }
        }
      }
    }
  }
  
  // Calculate average skin tone from samples
  const avgSkin = {
    r: 0, g: 0, b: 0
  };
  
  if (skinPixels.length > 0) {
    // Calculate average skin tone
    for (const pixel of skinPixels) {
      avgSkin.r += pixel.r;
      avgSkin.g += pixel.g;
      avgSkin.b += pixel.b;
    }
    
    avgSkin.r /= skinPixels.length;
    avgSkin.g /= skinPixels.length;
    avgSkin.b /= skinPixels.length;
  } else {
    // Fallback values if we couldn't detect skin
    avgSkin.r = 210;
    avgSkin.g = 180;
    avgSkin.b = 160;
  }
  
  // Now analyze wound pixels for inflammation and exudate
  let totalRedValue = 0;
  let totalGreenValue = 0;
  let totalBlueValue = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      
      // Skip transparent pixels
      if (imageData[i + 3] < 128) continue;
      
      // Check if this pixel is identified as part of the wound (wound mask alpha is high)
      if (woundMask[i + 3] > 100) {
        woundPixelCount++;
        
        const red = imageData[i];
        const green = imageData[i + 1];
        const blue = imageData[i + 2];
        
        // Add to color totals for later averages
        totalRedValue += red;
        totalGreenValue += green;
        totalBlueValue += blue;
        
        // Calculate color metrics
        const colorSum = red + green + blue;
        const colorMax = Math.max(red, green, blue);
        const colorMin = Math.min(red, green, blue);
        const colorRange = colorMax - colorMin;
        
        // Calculate HSV values for tissue type assessment
        let hue = 0;
        let saturation = 0;
        let value = colorMax / 255;
        
        if (colorMax > 0) {
          saturation = colorRange / colorMax;
          
          if (colorRange > 0) {
            if (colorMax === red) {
              hue = ((green - blue) / colorRange) % 6;
            } else if (colorMax === green) {
              hue = ((blue - red) / colorRange) + 2;
            } else {
              hue = ((red - green) / colorRange) + 4;
            }
            
            hue *= 60;
            if (hue < 0) hue += 360;
          }
        }
        
        // Calculate inflammation score (increased redness compared to skin)
        // Compare red channel enhancement relative to surrounding skin
        const rednessRatio = red / (avgSkin.r || 1);
        const greenRatio = green / (avgSkin.g || 1);
        
        // Inflammation is signified by increased redness compared to normal skin tone
        const inflammationLevel = Math.max(0, Math.min(1, 
          (rednessRatio - greenRatio) * 2 + // Red-green difference ratio 
          (red > 1.3 * green && red > 1.3 * blue ? 0.5 : 0) + // Extra weight for very red pixels
          (red > 200 && saturation > 0.4 ? 0.3 : 0) // Bright red areas
        ));
        
        inflammationSum += inflammationLevel;
        
        // Exudate/pus detection - typically yellowish-white
        // Pus tends to be high value (bright), low saturation (pale), with yellow-white hue
        const isPale = saturation < 0.25 && value > 0.7;
        const isYellowish = (hue >= 40 && hue <= 80) || (red > 200 && green > 180 && blue < 160);
        const isWhitish = (red > 200 && green > 200 && blue > 180) && saturation < 0.15;
        
        const exudateLevel = Math.max(0, Math.min(1,
          (isPale && (isYellowish || isWhitish) ? 0.7 : 0) +
          (green > blue * 1.2 && red > blue * 1.2 && value > 0.6 ? 0.5 : 0) + // Yellow tones
          (value > 0.85 && saturation < 0.2 ? 0.4 : 0) // Very bright, desaturated areas
        ));
        
        exudateSum += exudateLevel;
        
        // Tissue type classification
        if (red > 180 && red > green * 1.5 && red > blue * 1.5) {
          // Bright red tissue - healthy granulation
          granulationPixels++;
        } 
        else if ((isYellowish || (green > 170 && red > 170 && blue < 150)) && value > 0.5) {
          // Yellow fibrinous tissue - slough
          sloughPixels++;
        }
        else if (value < 0.25 || (red < 130 && green < 130 && blue < 130 && saturation < 0.3)) {
          // Dark tissue - eschar/necrotic
          escharPixels++;
        }
        else {
          // Not clearly identified - assign to granulation by default
          // This is a simplification - real tissue classification is much more complex
          granulationPixels++;
        }
      }
    }
  }
  
  // Calculate average values and scores
  const inflammationScore = woundPixelCount > 0 ? inflammationSum / woundPixelCount : 0;
  const exudateScore = woundPixelCount > 0 ? exudateSum / woundPixelCount : 0;
  
  // Calculate redness ratio for the entire wound
  const avgRed = woundPixelCount > 0 ? totalRedValue / woundPixelCount : 0;
  const avgGreen = woundPixelCount > 0 ? totalGreenValue / woundPixelCount : 0;
  const avgBlue = woundPixelCount > 0 ? totalBlueValue / woundPixelCount : 0;
  
  const woundRedness = avgGreen > 0 ? avgRed / avgGreen : 1;
  const skinRedness = avgSkin.g > 0 ? avgSkin.r / avgSkin.g : 1;
  
  // Normalized redness ratio comparing wound to surrounding skin
  const rednessRatio = skinRedness > 0 ? woundRedness / skinRedness : 1;
  
  // Calculate tissue type percentages
  const totalTissuePixels = granulationPixels + sloughPixels + escharPixels;
  const tissueTypes = {
    granulation: totalTissuePixels > 0 ? granulationPixels / totalTissuePixels : 0,
    slough: totalTissuePixels > 0 ? sloughPixels / totalTissuePixels : 0,
    eschar: totalTissuePixels > 0 ? escharPixels / totalTissuePixels : 0
  };
  
  return {
    inflammationScore,
    exudateScore,
    rednessRatio,
    tissueTypes
  };
}
