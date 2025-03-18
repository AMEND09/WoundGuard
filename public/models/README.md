# ML Models for WoundGuard

This directory contains machine learning models used by the WoundGuard application for wound detection and analysis.

## Models

The application can use the following models:

- `wound-segmentation-lite.onnx` - A lightweight model optimized for web deployment (~5MB)
- `wound-segmentation.onnx` - A full-sized model with better accuracy but larger size (~12MB)

## Model Format

All models are in ONNX format, which allows them to run in the browser using ONNX Runtime Web.

## Deployment Notes

When deploying to GitHub Pages:

1. Make sure these model files are included in the build
2. The models will be served from the `/WoundGuard/models/` path

## Development

To download the models for local development, run:

```bash
# Create models directory if it doesn't exist
mkdir -p public/models

# Download the lite model
curl -L https://example.com/wound-segmentation-lite.onnx -o public/models/wound-segmentation-lite.onnx

# Download the standard model
curl -L https://example.com/wound-segmentation.onnx -o public/models/wound-segmentation.onnx
```

Replace the URLs with the actual locations of your model files.

## Creating Your Own Models

If you want to create your own wound segmentation models:

1. Train a segmentation model (U-Net, DeepLabv3, etc.) using TensorFlow, PyTorch, or similar
2. Export to ONNX format
3. Optimize using tools like ONNX Runtime's model optimizer
4. Quantize to reduce size if necessary
