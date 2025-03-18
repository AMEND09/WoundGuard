import React, { useState, useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';
import { Gauge, AlertCircle, Wifi, WifiOff, Droplet, ThermometerSun, Microscope, Activity, Camera, PencilRuler, FileDown, FileUp, ClipboardList, ClipboardEdit, Download } from 'lucide-react';
import { analyzeWoundImage as analyzeWoundImageUtil, preloadWoundSegmentationModel } from '@/utils/woundAnalysis';
import DetectionSettings from '@/components/MLToggle';

// Define interfaces for the app
interface HistoricalDataPoint {
  day: number;
  area: number;
  temperature: number | string;
  humidity: number;
  ph: number | string;
  lastUpdate?: string | null;
  imageUrl?: string | null;
  notes?: string;
}

interface SensorData {
  area: number;
  temperature: number | string;
  humidity: number;
  ph: number | string;
  lastUpdate: string | null;
}

// New interface for drawing state
interface DrawingState {
  isDrawing: boolean;
  points: Array<{x: number, y: number}>;
  canvasRect: DOMRect | null;
}

// New interface for bounding box state
interface BoundingBoxState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  isDrawing: boolean;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<any>;
  label?: string | number;
}

interface LogEntry {
  timestamp: string;
  type: string;
  description: string;
}

interface UserOutlineData {
  points: Array<{x: number, y: number}>;
  closed: boolean;
}

interface BoundingBoxData {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WoundTrackingApp = () => {
  const [connected, setConnected] = useState(false);
  const [currentData, setCurrentData] = useState<SensorData>({
    area: 0,
    temperature: 0,
    humidity: 0,
    ph: 0,
    lastUpdate: null
  });
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
  const [serialMessages, setSerialMessages] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isWebSerialSupported, setIsWebSerialSupported] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  
  // State variables for manual area measurement
  const [showAreaInput, setShowAreaInput] = useState(false);
  const [manualAreaValue, setManualAreaValue] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  // New state variables for manual logging and data export/import
  const [showManualLogDialog, setShowManualLogDialog] = useState(false);
  const [manualLogEntries, setManualLogEntries] = useState<LogEntry[]>([]);
  const [manualLogType, setManualLogType] = useState<string>('observation');
  const [manualLogDescription, setManualLogDescription] = useState<string>('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  
  // Refs for maintaining serial port connection and file input
  const serialPortRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Add new state variable for manual mode
  const [manualMode, setManualMode] = useState(false);
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(true);
  
  // Add state variables for drawing
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawingState, setDrawingState] = useState<DrawingState>({
    isDrawing: false,
    points: [],
    canvasRect: null
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Add state variable for sensitivity
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  
  // Add a preview timer ref to control debounced live previews
  const previewTimerRef = useRef<number | null>(null);

  // Add state variables for drawing mode and bounding box
  const [drawingMode, setDrawingMode] = useState<'outline' | 'boundingBox'>('outline');
  const [boundingBoxState, setBoundingBoxState] = useState<BoundingBoxState>({
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    isDrawing: false
  });

  // Preload ML model in the background when app starts
  useEffect(() => {
    const loadModelInBackground = async () => {
      try {
        // Silently try to preload the model without showing errors to the user
        await preloadWoundSegmentationModel();
      } catch (error) {
        // Silently fail - we'll handle errors when the user attempts to use ML
        console.warn('Background model loading failed:', error);
      }
    };
    
    // Start loading after a short delay to not block initial rendering
    const timer = setTimeout(() => {
      loadModelInBackground();
    }, 2000);
    
    return () => clearTimeout(timer);
  }, []);
  
  // Check Web Serial API support on component mount
  useEffect(() => {
    const checkSerialSupport = () => {
      // Check if Web Serial API is supported
      if ('serial' in navigator) {
        setIsWebSerialSupported(true);
        setSerialMessages([
          "Web Serial API is supported in this browser.",
          "Click 'Connect to Arduino' to begin monitoring."
        ]);
      } else {
        setIsWebSerialSupported(false);
        setSerialMessages([
          "Web Serial API is not supported in this browser.",
          "Using demo mode. For full functionality, use Chrome or Edge."
        ]);
      }
    };
    
    checkSerialSupport();
  }, []);

  // Simulate connecting to Arduino
  const connectToArduino = async () => {
    setConnectionStatus('connecting');
    setSerialMessages(prev => [...prev, "Attempting to connect to Arduino..."]);
    setShowWelcomeDialog(false);
    
    if (isWebSerialSupported) {
      try {
        // Request a serial port
        const port = await (navigator as any).serial.requestPort();
        serialPortRef.current = port;
        
        // Open the port with appropriate settings (adjust baud rate as needed)
        await port.open({ baudRate: 115200 });
        
        // Create reader and writer
        const reader = port.readable.getReader();
        readerRef.current = reader;
        
        const writer = port.writable.getWriter();
        writerRef.current = writer;
        
        setConnected(true);
        setConnectionStatus('connected');
        setSerialMessages(prev => [...prev, "Connected to Arduino device"]);
        
        // Start reading data
        readFromSerialPort(reader);
      } catch (error) {
        console.error('Error connecting to Arduino:', error);
        setSerialMessages(prev => [
          ...prev, 
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          "Falling back to demo mode..."
        ]);
        
        // Fallback to demo mode
        startDemoMode();
      }
    } else {
      // Use demo mode for browsers without Web Serial API support (like Safari)
      startDemoMode();
    }
  };
  
  // Start demo mode with simulated data
  const startDemoMode = () => {
    setDemoMode(true);
    setConnectionStatus('connected');
    setConnected(true);
    setSerialMessages(prev => [...prev, "Demo mode activated (simulated data)"]);
    setShowWelcomeDialog(false);
    
    // Set initial data
    const mockData = {
      area: 75,
      temperature: 36.8,
      humidity: 65,
      ph: 6.5,
      lastUpdate: new Date().toLocaleTimeString()
    };
    
    setCurrentData(mockData);
    
    // Create mock historical data
    const mockHistory: HistoricalDataPoint[] = Array(15).fill(null).map((_, i) => ({
      day: i + 1,
      area: Math.round(100 - 70 * Math.exp(-i / 15) + Math.random() * 5),
      temperature: (36 + Math.random() * 2).toFixed(1),
      humidity: Math.round(60 + Math.random() * 20),
      ph: (6.5 + Math.sin(i / 5) * 0.5).toFixed(1),
      lastUpdate: new Date(Date.now() - (15 - i) * 24 * 60 * 60 * 1000).toLocaleString()
    }));
    
    setHistoricalData(mockHistory);
  };

  // Start manual mode with user-provided data only
  const startManualMode = () => {
    setManualMode(true);
    setConnectionStatus('manual');
    setConnected(true);
    setSerialMessages(prev => [...prev, "Manual mode activated (user logs only)"]);
    
    // Set initial empty data
    const initialData = {
      area: 100, // Start with 100mm² as initial area
      temperature: 37.0,
      humidity: 65,
      ph: 6.5,
      lastUpdate: new Date().toLocaleTimeString()
    };
    
    setCurrentData(initialData);
    
    // Create initial entry for historical data
    const initialHistoricalDataPoint = {
      day: 1,
      ...initialData,
      notes: "Initial manual entry"
    };
    
    setHistoricalData([initialHistoricalDataPoint]);
    
    // Open the dialog to input initial measurement
    setShowManualLogDialog(true);
    setManualLogType('data-entry');

    // Close the welcome dialog
    setShowWelcomeDialog(false);
  };

  // Simulate receiving data from Arduino
  useEffect(() => {
    if (!connected || !demoMode) return;
    
    const interval = setInterval(() => {
      const noise = Math.random() * 2 - 1;
      const tempVal = typeof currentData.temperature === 'string' 
        ? parseFloat(currentData.temperature) 
        : currentData.temperature;
      const phVal = typeof currentData.ph === 'string'
        ? parseFloat(currentData.ph)
        : currentData.ph;
        
      const newData = {
        area: Math.max(5, Math.min(100, currentData.area + noise)),
        temperature: parseFloat((tempVal + (Math.random() * 0.2 - 0.1)).toFixed(1)),
        humidity: Math.round(Math.max(40, Math.min(90, currentData.humidity + Math.random() * 4 - 2))),
        ph: parseFloat((phVal + (Math.random() * 0.2 - 0.1)).toFixed(1)),
        lastUpdate: new Date().toLocaleTimeString()
      };
      
      setCurrentData(newData);
      setSerialMessages(prev => [
        ...prev, 
        `[DEMO] [${newData.lastUpdate}] Received: Area=${newData.area.toFixed(1)}mm², Temp=${newData.temperature}°C, Humidity=${newData.humidity}%, pH=${newData.ph}`
      ].slice(-20));
    }, 3000);
    
    return () => clearInterval(interval);
  }, [connected, demoMode, currentData]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (readerRef.current || writerRef.current || serialPortRef.current) {
        disconnectFromDevice();
      }
    };
  }, []);

  // Function to read data from the serial port
  const readFromSerialPort = async (reader: ReadableStreamDefaultReader) => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        
        // Process the received data
        const message = new TextDecoder().decode(value);
        setSerialMessages(prev => [...prev.slice(-49), message].filter(Boolean));
        
        // Try to parse sensor data
        try {
          // Match the Arduino's output format:
          // "pH Sensor Value (Potentiometer 1): X"
          // "Temperature (Simulated by Potentiometer 2): X"
          // "Moisture Sensor Value (Photoresistor): X"
          
          const phMatch = message.match(/pH Sensor Value.*?:\s*(\d+\.?\d*)/);
          const tempMatch = message.match(/Temperature.*?:\s*(\d+\.?\d*)/);
          const moistureMatch = message.match(/Moisture Sensor Value.*?:\s*(\d+\.?\d*)/);
          
          if (phMatch || tempMatch || moistureMatch) {
            const newData = { ...currentData };
            
            if (phMatch && phMatch[1]) {
              const phValue = parseFloat(phMatch[1]);
              // pH ranges from 0-14, but most Arduino sensors might return raw values
              // We'll convert this to a more realistic pH range (typically 4-10 for wounds)
              newData.ph = Math.max(4, Math.min(10, phValue / 100 * 6 + 4)).toFixed(1);
            }
            
            if (tempMatch && tempMatch[1]) {
              // Parse temperature directly as it's likely in proper units already
              newData.temperature = parseFloat(tempMatch[1]);
            }
            
            if (moistureMatch && moistureMatch[1]) {
              // Convert moisture sensor value (likely 0-1023 from analog read) to humidity percentage
              const moistureValue = parseFloat(moistureMatch[1]);
              newData.humidity = Math.round((moistureValue / 1023) * 100);
            }
            
            // Update timestamp
            newData.lastUpdate = new Date().toLocaleTimeString();
            
            setCurrentData(newData);
            
            // Add to historical data once per hour or when significant change occurs
            const now = new Date();
            if (now.getMinutes() === 0 && now.getSeconds() <= 10) {
              setHistoricalData(prev => [
                ...prev, 
                {
                  day: prev.length > 0 ? prev[prev.length - 1].day + 1 : 1,
                  ...newData
                }
              ]);
            }
          }
        } catch (parseError) {
          console.error('Error parsing data:', parseError);
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') {
        console.error('Error reading from serial port:', error);
        setSerialMessages(prev => [...prev, `Error reading: ${error instanceof Error ? error.message : String(error)}`]);
        setConnectionStatus('disconnected');
        setConnected(false);
      }
    }
  };

  // Enhanced function to handle image upload with better wound area estimation
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageUrl = reader.result as string;
        // Store original image for reuse during preview updates
        setImagePreview(imageUrl);
        
        // Create a new image element to get the natural dimensions
        const img = new Image();
        img.onload = () => {
          // Once the image is loaded, set up the canvas with correct dimensions
          if (canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              // Set canvas dimensions to match the actual image dimensions
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              
              // Clear canvas and draw the image at its natural size
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              // Update the canvas rect for accurate drawing coordinates
              setDrawingState({
                isDrawing: false,
                points: [],
                canvasRect: canvas.getBoundingClientRect()
              });
            }
          }
        };
        img.src = imageUrl;
        
        setSerialMessages(prev => [...prev, 
          `[IMAGE] Image loaded. Draw around wound or click "Analyze" for automatic detection.`
        ]);
      };
      
      reader.readAsDataURL(file);
    }
  };

  // Updated function to estimate wound area from image with improved shadow rejection
  const estimateWoundArea = (imageUrl: string) => {
    // Create a new image element to work with
    const img = new Image();
    img.src = imageUrl;
    
    img.onload = () => {
      // Create a canvas element to process the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        setSerialMessages(prev => [...prev, 
          `[ERROR] Canvas context not supported in your browser. Please enter wound area manually.`
        ]);
        return;
      }
      
      // Set canvas dimensions based on image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw the image on the canvas
      ctx.drawImage(img, 0, 0);
      
      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // IMPROVED ALGORITHM: Multi-factor wound detection with shadow rejection
      
      let pixelsInWound = 0;
      const totalPixels = canvas.width * canvas.height;
      
      // Pre-processing: Calculate image average color to establish baseline
      let avgRed = 0, avgGreen = 0, avgBlue = 0;
      let avgLuma = 0;
      
      for (let i = 0; i < data.length; i += 4) {
        avgRed += data[i];
        avgGreen += data[i + 1];
        avgBlue += data[i + 2];
        
        // Calculate luminance: 0.299R + 0.587G + 0.114B
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        avgLuma += luma;
      }
      
      const pixelCount = totalPixels;
      avgRed /= pixelCount;
      avgGreen /= pixelCount;
      avgBlue /= pixelCount;
      avgLuma /= pixelCount;
      
      // Calculate standard deviation for luminance to detect shadow thresholds
      let lumaVariance = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lumaVariance += (luma - avgLuma) * (luma - avgLuma);
      }
      
      const lumaStdDev = Math.sqrt(lumaVariance / pixelCount);
      const shadowThreshold = avgLuma - lumaStdDev * 1.5; // Pixels darker than this might be shadows
      
      // Simple Sobel edge detection to help identify wound boundaries
      const sobelData = new Uint8ClampedArray(data.length);
      for (let y = 1; y < canvas.height - 1; y++) {
        for (let x = 1; x < canvas.width - 1; x++) {
          const idx = (y * canvas.width + x) * 4;
          
          // Calculate intensity gradients in x and y directions (simplified Sobel)
          const gx = (
            -1 * data[idx - 4] + 
            1 * data[idx + 4]
          );
          
          const gy = (
            -1 * data[idx - canvas.width * 4] + 
            1 * data[idx + canvas.width * 4]
          );
          
          // Calculate gradient magnitude
          const mag = Math.sqrt(gx * gx + gy * gy);
          
          // Store edge information
          sobelData[idx] = mag > 25 ? 255 : 0; // Edge threshold
          sobelData[idx + 1] = mag > 25 ? 255 : 0;
          sobelData[idx + 2] = mag > 25 ? 255 : 0;
          sobelData[idx + 3] = 255;
        }
      }
      
      // Wound detection criteria
      for (let i = 0; i < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];
        
        // Skip transparent pixels
        if (data[i + 3] < 128) continue;
        
        // Calculate HSV (Hue, Saturation, Value) for better color analysis
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const delta = max - min;
        
        // Compute saturation (0-1)
        const saturation = max === 0 ? 0 : delta / max;
        
        // Compute value/brightness (0-1)
        const value = max / 255;
        
        // Compute luminance for shadow detection
        const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
        
        // Compute hue (0-360)
        let hue = 0;
        if (delta === 0) {
          hue = 0; // Achromatic (gray)
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
        
        // Edge detection factor - check if this pixel is part of an edge
        const isEdge = sobelData[i] > 0;
        
        // IMPROVED WOUND DETECTION WITH SHADOW REJECTION
        
        // Shadow detection: shadows tend to be darker but maintain color relationship
        const isShadow = luma < shadowThreshold && saturation < 0.25;
        
        // Compute red dominance - wounds typically have stronger red component
        const redDominance = red / (green + blue + 1) * 2;
        
        // More specific criteria for reddish hues in skin/wound context
        const isReddish = ((hue >= 0 && hue <= 25) || (hue >= 340 && hue <= 360));
        const isPinkish = (hue >= 300 && hue <= 339); // Darker wounds can appear more purple/pink
        
        const isRedHigher = red > green * 1.15 && red > blue * 1.15;
        const isReasonablySaturated = saturation > 0.15 && saturation < 0.9; // Upper bound helps exclude overly saturated areas
        const isReasonablyBright = value > 0.15 && value < 0.90; // Wounds aren't typically the brightest or darkest
        
        const redAboveAverage = red > avgRed * 1.1;
        
        // Consider a pixel as part of wound if it meets our criteria AND is not a shadow
        if (!isShadow && (
            // Primary wound detection criteria
            ((isReddish || isPinkish) && isRedHigher && isReasonablySaturated && isReasonablyBright && redAboveAverage) ||
            // Edge-enhanced detection criteria for wound boundaries
            (isEdge && redDominance > 1.2 && isReasonablyBright)
          )) {
          pixelsInWound++;
          
          // For visualization - mark detected pixels in a visible color
          data[i] = 255;      // Red
          data[i + 1] = 0;    // Green
          data[i + 2] = 128;  // Blue
          data[i + 3] = 255;  // Alpha
        }
      }
      
      // Create visualization of the detected wound for preview
      const detectedWoundCanvas = document.createElement('canvas');
      detectedWoundCanvas.width = canvas.width;
      detectedWoundCanvas.height = canvas.height;
      const detectedCtx = detectedWoundCanvas.getContext('2d');
      
      if (detectedCtx) {
        // Draw original image at 70% opacity
        detectedCtx.globalAlpha = 0.7;
        detectedCtx.drawImage(img, 0, 0);
        
        // Overlay wound detection
        detectedCtx.globalAlpha = 0.5;
        const overlayImageData = new ImageData(data, canvas.width, canvas.height);
        detectedCtx.putImageData(overlayImageData, 0, 0);
        
        // Create output image URL
        const detectedImageUrl = detectedWoundCanvas.toDataURL('image/png');
        setImagePreview(detectedImageUrl);
      }
      
      // Calculate wound area percentage
      const woundPercentage = (pixelsInWound / totalPixels) * 100;
      
      // Apply a minimum threshold to avoid detecting noise
      // This helps in cases with no actual wound but small areas being falsely detected
      if (woundPercentage < 0.5) {
        setSerialMessages(prev => [...prev, 
          `[IMAGE] No significant wound area detected. Please manually enter the area if needed.`
        ]);
        setManualAreaValue('0');
        return;
      }
      
      // IMPROVED AREA ESTIMATION
      // Convert to estimated mm² (assuming a typical wound photo context)
      // Default conversion factor (estimating a 5cm x 5cm field of view)
      const assumedImageAreaInMM = 2500; // 50mm x 50mm
      const estimatedArea = Math.round((woundPercentage / 100) * assumedImageAreaInMM);
      
      // Set the estimated area, minimum of 1mm² to avoid unrealistic small values
      setManualAreaValue(Math.max(1, estimatedArea).toString());
      
      setSerialMessages(prev => [...prev, 
        `[IMAGE] Wound image analyzed. Estimated area: ~${Math.max(1, estimatedArea)}mm² (adjust if needed)`,
        `[IMAGE] Detection used enhanced color analysis with shadow rejection.`
      ]);
    };
    
    img.onerror = () => {
      setSerialMessages(prev => [...prev, 
        `[ERROR] Failed to process image. Please enter wound area manually.`
      ]);
    };
  };

  // New function for adding a manual log entry
  const addLogEntry = (type: string, description: string) => {
    const timestamp = new Date().toLocaleString();
    setManualLogEntries(prev => [...prev, {
      timestamp,
      type,
      description
    }]);
  };

  // Function to handle manual log submission
  const handleManualLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (manualLogDescription.trim() !== '') {
      // Add to log entries
      addLogEntry(manualLogType, manualLogDescription);
      
      // Add note to the most recent historical data point if applicable
      if (historicalData.length > 0) {
        const updatedHistoricalData = [...historicalData];
        const latestEntry = updatedHistoricalData[updatedHistoricalData.length - 1];
        latestEntry.notes = latestEntry.notes 
          ? `${latestEntry.notes}; ${manualLogDescription}` 
          : manualLogDescription;
        setHistoricalData(updatedHistoricalData);
      }
      
      // Log to serial messages
      setSerialMessages(prev => [...prev, 
        `[LOG] [${new Date().toLocaleTimeString()}] ${manualLogType}: ${manualLogDescription}`
      ]);
      
      // Reset form
      setManualLogDescription('');
      setShowManualLogDialog(false);
    }
  };

  // Function to export data
  const exportData = () => {
    // Combine historical data with log entries
    const exportData = {
      patientId: 'WP' + Math.floor(Math.random() * 10000),
      exportDate: new Date().toISOString(),
      historicalData,
      manualLogEntries,
      serialMessages
    };
    
    // Create a JSON blob and download it
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wound-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    setShowExportDialog(false);
    addLogEntry('system', 'Data exported successfully');
  };

  // Function to handle data import
  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const importedData = JSON.parse(event.target?.result as string);
          
          // Validate the imported data
          if (importedData.historicalData && Array.isArray(importedData.historicalData)) {
            // Set historical data
            setHistoricalData(importedData.historicalData);
            
            // Set last entry as current data
            if (importedData.historicalData.length > 0) {
              const lastEntry = importedData.historicalData[importedData.historicalData.length - 1];
              setCurrentData({
                area: lastEntry.area,
                temperature: lastEntry.temperature,
                humidity: lastEntry.humidity,
                ph: lastEntry.ph,
                lastUpdate: new Date().toLocaleTimeString()
              });
            }
            
            // Import log entries if available
            if (importedData.manualLogEntries && Array.isArray(importedData.manualLogEntries)) {
              setManualLogEntries(importedData.manualLogEntries);
            }
            
            addLogEntry('system', `Data imported successfully from ${file.name}`);
            
            // Add to serial log
            setSerialMessages(prev => [...prev, 
              `[IMPORT] Data imported successfully from ${file.name}`
            ]);
          } else {
            // Invalid data format
            addLogEntry('error', `Invalid data format in ${file.name}`);
            setSerialMessages(prev => [...prev, 
              `[ERROR] Failed to import data: Invalid format in ${file.name}`
            ]);
          }
        } catch (error) {
          console.error('Error importing data:', error);
          addLogEntry('error', `Error importing data: ${error instanceof Error ? error.message : String(error)}`);
          setSerialMessages(prev => [...prev, 
            `[ERROR] Failed to import data: ${error instanceof Error ? error.message : String(error)}`
          ]);
        }
      };
      
      reader.readAsText(file);
    }
  };

  // Function to trigger file input click
  const triggerImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Function to handle manual entry of all data points
  const handleManualDataEntry = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData(e.currentTarget);
    const area = parseFloat(formData.get('area') as string);
    const temperature = parseFloat(formData.get('temperature') as string);
    const humidity = parseFloat(formData.get('humidity') as string);
    const ph = parseFloat(formData.get('ph') as string);
    const notes = formData.get('notes') as string;
    
    if (!isNaN(area) && !isNaN(temperature) && !isNaN(humidity) && !isNaN(ph)) {
      const newData = {
        area,
        temperature,
        humidity,
        ph,
        lastUpdate: new Date().toLocaleTimeString()
      };
      
      // Update current data
      setCurrentData(newData);
      
      // Add to historical data
      const newHistoricalDataPoint = {
        day: historicalData.length > 0 ? historicalData[historicalData.length - 1].day + 1 : 1,
        ...newData,
        notes: notes || undefined
      };
      
      setHistoricalData(prev => [...prev, newHistoricalDataPoint]);
      
      // Add log entry
      addLogEntry('manual-data', `Manual data entry: Area=${area}mm², Temp=${temperature}°C, Humidity=${humidity}%, pH=${ph}`);
      
      // Add to serial log
      setSerialMessages(prev => [...prev, 
        `[MANUAL-DATA] [${newData.lastUpdate}] Area=${area}mm², Temp=${temperature}°C, Humidity=${humidity}%, pH=${ph}`
      ]);
      
      setShowManualLogDialog(false);
    }
  };

  // Function to reset the canvas completely
  const resetCanvas = () => {
    // Reset drawing state
    setDrawingState({
      isDrawing: false,
      points: [],
      canvasRect: null
    });
    
    // Reset sensitivity to default
    setSensitivity('medium');
    
    // Reset drawing mode
    setDrawingEnabled(false);
    
    // Clear the image preview
    setImagePreview(null);
    
    // Reset manual area value
    setManualAreaValue('');
    
    // Clear the canvas if it exists
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  // Function to handle area input submission
  const handleAreaInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const areaValue = parseFloat(manualAreaValue);
    if (!isNaN(areaValue) && areaValue > 0) {
      // Save the current image for the historical record (before it gets reset)
      const currentImageForHistory = imagePreview;
      
      const newData = {
        ...currentData,
        area: areaValue,
        lastUpdate: new Date().toLocaleTimeString()
      };
      
      setCurrentData(newData);
      setShowAreaInput(false);
      
      // Add to historical record
      setHistoricalData(prev => [
        ...prev, 
        {
          day: prev.length > 0 ? prev[prev.length - 1].day + 1 : 1,
          ...newData,
          imageUrl: currentImageForHistory
        }
      ]);
      
      // Log the manual measurement
      setSerialMessages(prev => [...prev, 
        `[MANUAL] [${newData.lastUpdate}] Area measurement recorded: ${areaValue.toFixed(1)}mm²`
      ]);
      
      // Reset the canvas and related state completely
      resetCanvas();
    }
  };

  // Function to determine wound healing status
  const getHealingStatus = () => {
    if (currentData.area < 30) return "Good";
    if (currentData.area < 60) return "Moderate";
    return "Concerning";
  };

  // Function to get background color based on healing status
  const getStatusBgColor = () => {
    const status = getHealingStatus();
    if (status === "Good") return "bg-emerald-500";
    if (status === "Moderate") return "bg-amber-500";
    return "bg-rose-500";
  };

  // Calculate healing percentage
  const healingPercentage = () => {
    if (historicalData.length <= 0) return 0;
    
    const initial = historicalData[0]?.area || 100;
    const current = currentData.area;
    
    // Ensure we don't divide by zero and handle negative progress
    if (initial <= 0) return 0;
    
    const percentage = Math.min(100, Math.max(0, Math.round((initial - current) / initial * 100)));
    return percentage;
  };

  // Get healing progress color
  const getHealingColor = () => {
    const percentage = healingPercentage();
    if (percentage > 70) return '#10b981'; // Green for good progress
    if (percentage > 40) return '#f59e0b'; // Amber for moderate progress
    return '#f43f5e'; // Red for concerning progress
  };

  // Custom tooltip component that's mobile-friendly
  const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-indigo-900 p-3 border border-indigo-700 rounded shadow-lg text-xs text-white">
          <p className="font-semibold text-indigo-200">Day {label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color || '#fff' }}>
              {entry.name}: {entry.value}
              {entry.name === 'temperature' ? '°C' : entry.name === 'area' ? 'mm²' : entry.name === 'humidity' ? '%' : ''}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Data for weekly progress chart
  const weeklyProgressData = React.useMemo(() => {
    if (!historicalData.length) return [];
    
    // Group data by week and calculate average values
    const weeks: Record<string, any> = {};
    historicalData.forEach(point => {
      const weekNum = Math.ceil(point.day / 7);
      const weekKey = `Week ${weekNum}`;
      
      if (!weeks[weekKey]) {
        weeks[weekKey] = { 
          week: weekKey, 
          area: [], 
          temperature: [], 
          humidity: [], 
          ph: [] 
        };
      }
      
      weeks[weekKey].area.push(point.area);
      weeks[weekKey].temperature.push(typeof point.temperature === 'string' ? 
        parseFloat(point.temperature) : point.temperature);
      weeks[weekKey].humidity.push(point.humidity);
      weeks[weekKey].ph.push(typeof point.ph === 'string' ? 
        parseFloat(point.ph) : point.ph);
    });
    
    // Calculate average values and healing rate for each week
    return Object.keys(weeks).map(weekKey => {
      const week = weeks[weekKey];
      const avgArea = week.area.reduce((sum: number, val: number) => sum + val, 0) / week.area.length;
      const avgTemp = week.temperature.reduce((sum: number, val: number) => sum + val, 0) / week.temperature.length;
      const avgHumidity = week.humidity.reduce((sum: number, val: number) => sum + val, 0) / week.humidity.length;
      const avgPh = week.ph.reduce((sum: number, val: number) => sum + val, 0) / week.ph.length;
      
      // Calculate healing rate (percentage improvement from previous week)
      const weekNum = parseInt(weekKey.split(' ')[1]);
      let rate = 0;
      if (weekNum > 1 && weeks[`Week ${weekNum - 1}`]) {
        const prevAvgArea = weeks[`Week ${weekNum - 1}`].area.reduce((sum: number, val: number) => sum + val, 0) / 
          weeks[`Week ${weekNum - 1}`].area.length;
        rate = prevAvgArea > 0 ? Math.round((prevAvgArea - avgArea) / prevAvgArea * 100) : 0;
      }
      
      return {
        week: weekKey,
        avgArea: Math.round(avgArea * 10) / 10,
        avgTemp: Math.round(avgTemp * 10) / 10,
        avgHumidity: Math.round(avgHumidity),
        avgPh: Math.round(avgPh * 10) / 10,
        rate: Math.max(0, rate)
      };
    });
  }, [historicalData]);

  // Function to disconnect from device
  const disconnectFromDevice = async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      
      if (writerRef.current) {
        await writerRef.current.close();
        writerRef.current = null;
      }
      
      if (serialPortRef.current) {
        await serialPortRef.current.close();
        serialPortRef.current = null;
      }
      
      setConnectionStatus('disconnected');
      setConnected(false);
      setSerialMessages(prev => [...prev, "Disconnected from device"]);
    } catch (error) {
      console.error('Error disconnecting:', error);
      setSerialMessages(prev => [...prev, `Error disconnecting: ${error instanceof Error ? error.message : String(error)}`]);
    }
  };

  // Function to handle drawing start
  const handleDrawStart = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled || !canvasRef.current) return;
    
    if (drawingMode === 'boundingBox') {
      handleBoundingBoxStart(e);
      return;
    }
    
    // Original outline drawing code
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX: number, clientY: number;
    
    // Handle both mouse and touch events
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    // Calculate position relative to canvas
    // Scale coordinates to match canvas internal size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    // Start drawing
    setDrawingState({
      isDrawing: true,
      points: [{x, y}],
      canvasRect: rect
    });
    
    // Draw the first point
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Use thicker, semi-transparent highlight style
      ctx.lineWidth = 12 * scaleX; // Much thicker line for highlighting
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)'; // Semi-transparent cyan
      ctx.lineCap = 'round'; // Round line caps for smoother highlighting
      ctx.lineJoin = 'round'; // Round line joins
      
      ctx.beginPath();
      ctx.arc(x, y, 6 * scaleX, 0, Math.PI * 2); // Larger starting point
      ctx.stroke();
    }
  };
  
  // Function to handle drawing movement
  const handleDrawMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    if (drawingMode === 'boundingBox') {
      handleBoundingBoxMove(e);
      return;
    }
    
    // Original outline drawing code
    if (!drawingState.isDrawing || !drawingState.canvasRect) return;
    
    e.preventDefault(); // Prevent scrolling on touch devices
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = drawingState.canvasRect;
    
    let clientX: number, clientY: number;
    
    // Handle both mouse and touch events
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    // Calculate position relative to canvas with proper scaling
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    // Add point to array
    setDrawingState(prev => ({
      ...prev,
      points: [...prev.points, {x, y}]
    }));
    
    // Draw the line
    if (ctx && drawingState.points.length > 0) {
      const prevPoint = drawingState.points[drawingState.points.length - 1];
      
      // Use thicker, semi-transparent highlight style
      ctx.lineWidth = 12 * scaleX; // Much thicker line for highlighting
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)'; // Semi-transparent cyan
      ctx.lineCap = 'round'; // Round line caps for smoother highlighting
      ctx.lineJoin = 'round'; // Round line joins
      
      ctx.beginPath();
      ctx.moveTo(prevPoint.x, prevPoint.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };
  
  // Function to handle drawing end
  const handleDrawEnd = () => {
    if (drawingMode === 'boundingBox') {
      handleBoundingBoxEnd();
      return;
    }
    
    // Original outline drawing code
    if (!drawingState.isDrawing) return;
    
    // Complete the drawing
    setDrawingState(prev => ({
      ...prev,
      isDrawing: false,
    }));
    
    // Draw closed path if we have enough points
    if (drawingState.points.length > 2 && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const rect = drawingState.canvasRect;
      
      if (ctx && rect) {
        const firstPoint = drawingState.points[0];
        const lastPoint = drawingState.points[drawingState.points.length - 1];
        
        const scaleX = canvas.width / rect.width;
        
        // Use thicker, semi-transparent highlight style
        ctx.lineWidth = 12 * scaleX; // Much thicker line for highlighting
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)'; // Semi-transparent cyan
        ctx.lineCap = 'round'; // Round line caps for smoother highlighting
        ctx.lineJoin = 'round'; // Round line joins
        
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(firstPoint.x, firstPoint.y);
        ctx.stroke();
        
        // Now close the path in the points array
        setDrawingState(prev => ({
          ...prev,
          points: [...prev.points, {...firstPoint}]
        }));
      }
    }
  };

  // Function to handle bounding box drawing start
  const handleBoundingBoxStart = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled || !canvasRef.current || drawingMode !== 'boundingBox') return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX: number, clientY: number;
    
    // Handle both mouse and touch events
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    // Calculate position relative to canvas with proper scaling
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    // Start drawing the bounding box
    setBoundingBoxState({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      isDrawing: true
    });
    
    // Reset any previous outline drawing
    setDrawingState({
      isDrawing: false,
      points: [],
      canvasRect: rect
    });
  };
  
  // Function to handle bounding box drawing movement
  const handleBoundingBoxMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!boundingBoxState.isDrawing || !canvasRef.current || drawingMode !== 'boundingBox') return;
    
    e.preventDefault(); // Prevent scrolling on touch devices
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX: number, clientY: number;
    
    // Handle both mouse and touch events
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    // Calculate position relative to canvas with proper scaling
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    // Update the end position of the bounding box
    setBoundingBoxState(prev => ({
      ...prev,
      endX: x,
      endY: y
    }));
    
    // Redraw the canvas with the current bounding box
    if (canvas && imagePreview) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear canvas and redraw image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Load and draw the original image
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // Draw the bounding box
          const { startX, startY } = boundingBoxState;
          const width = x - startX;
          const height = y - startY;
          
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.strokeRect(startX, startY, width, height);
          
          // Draw handles at corners for visibility
          ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
          const handleSize = 6;
          ctx.fillRect(startX - handleSize/2, startY - handleSize/2, handleSize, handleSize);
          ctx.fillRect(startX + width - handleSize/2, startY - handleSize/2, handleSize, handleSize);
          ctx.fillRect(startX - handleSize/2, startY + height - handleSize/2, handleSize, handleSize);
          ctx.fillRect(startX + width - handleSize/2, startY + height - handleSize/2, handleSize, handleSize);
        };
        img.src = imagePreview;
      }
    }
  };
  
  // Function to handle bounding box drawing end
  const handleBoundingBoxEnd = () => {
    if (!boundingBoxState.isDrawing || drawingMode !== 'boundingBox') return;
    
    // Complete the drawing
    setBoundingBoxState(prev => ({
      ...prev,
      isDrawing: false,
    }));
    
    // Trigger preview update with the new bounding box
    updatePreview();
  };

  // Function to clear drawing and reset to original image
  const clearDrawing = () => {
    if (!canvasRef.current || !imagePreview) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Clear canvas and redraw original image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Load image to canvas
      const img = new Image();
      img.onload = () => {
        // Keep the canvas dimensions the same, but redraw the image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = imagePreview;
    }
    
    // Reset drawing states
    setDrawingState({
      isDrawing: false,
      points: [],
      canvasRect: canvas.getBoundingClientRect()
    });
    
    setBoundingBoxState({
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      isDrawing: false
    });
  };

  // Function to normalize the bounding box (handle negative width/height)
  const getNormalizedBoundingBox = () => {
    const { startX, startY, endX, endY } = boundingBoxState;
    return {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY)
    };
  };

  // Function to create a debounced live preview update
  const updatePreview = () => {
    // Clear any existing timeout
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }
    
    // Set a new timeout to update the preview after a short delay
    previewTimerRef.current = window.setTimeout(() => {
      analyzeWoundImage(true); // true = preview mode (don't update messages)
    }, 400); // Debounce for smoother experience
  };

  // Function to analyze image with or without user outline
  const analyzeWoundImage = (isPreview = false) => {
    if (!imagePreview) return;
    
    if (!isPreview) {
      setSerialMessages(prev => [...prev, 
        `[IMAGE] Analyzing wound image, please wait...`
      ]);
    }
    
    // Make sure we have a consistent canvas reference
    if (!canvasRef.current) {
      if (!isPreview) {
        setSerialMessages(prev => [...prev, 
          `[ERROR] Canvas reference not found. Please try again.`
        ]);
      }
      return;
    }
    
    // Save original user drawing to reapply later
    let userDrawing: ImageData | null = null;
    if (!isPreview && drawingMode === 'outline' && drawingState.points.length > 2) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvasRef.current.width;
      tempCanvas.height = canvasRef.current.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      if (tempCtx) {
        tempCtx.drawImage(canvasRef.current, 0, 0);
        userDrawing = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      }
    }
    
    // Prepare user outline or bounding box data
    let userOutline: UserOutlineData | undefined = undefined;
    let boundingBox: BoundingBoxData | undefined = undefined;
    
    if (drawingMode === 'outline' && drawingState.points.length > 2) {
      userOutline = {
        points: drawingState.points,
        closed: true
      };
    } else if (drawingMode === 'boundingBox') {
      const box = getNormalizedBoundingBox();
      // Only use bounding box if it has meaningful dimensions
      if (box.width > 10 && box.height > 10) {
        boundingBox = box;
      }
    }
    
    // If we're not using user outline or bounding box, indicate we're using automatic segmentation
    if (!isPreview && !userOutline && !boundingBox) {
      setSerialMessages(prev => [...prev, 
        `[IMAGE] No highlighting or bounding box detected. Using automatic wound segmentation...`
      ]);
    }
    
    // Use the advanced wound analysis utility with the selected sensitivity and drawing method
    analyzeWoundImageUtil(imagePreview, { 
      sensitivityLevel: sensitivity,
      assumedImageSize: 2500, // 50mm x 50mm default field of view
      userOutline,
      boundingBox,
      useML: true // Enable ML and advanced algorithms like GrabCut
    })
    .then(result => {
      // Set the processed image with detection visualization
      // But don't update imagePreview directly since we need to draw user highlights on it
      
      // Reload the image on the canvas with the analyzed version
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            // Draw the processed image
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // If we have user drawings, reapply them
            if (userDrawing && !isPreview && drawingMode === 'outline') {
              // Redraw the user's highlights with the appropriate style
              ctx.globalAlpha = 0.4; // Semi-transparent
              
              if (drawingState.points.length > 2) {
                ctx.lineWidth = 12; // Thicker line for highlighting
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)'; // Semi-transparent cyan
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                
                // Redraw each segment of the user's path
                ctx.moveTo(drawingState.points[0].x, drawingState.points[0].y);
                for (let i = 1; i < drawingState.points.length; i++) {
                  ctx.lineTo(drawingState.points[i].x, drawingState.points[i].y);
                }
                
                ctx.stroke();
              }
              
              ctx.globalAlpha = 1.0; // Reset alpha
            } else if (!isPreview && drawingMode === 'boundingBox' && boundingBox) {
              // Redraw the user's bounding box
              const { x, y, width, height } = boundingBox;
              ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 3]);
              ctx.strokeRect(x, y, width, height);
              ctx.setLineDash([]);
              
              // Draw handles at corners
              ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
              const handleSize = 6;
              ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
              ctx.fillRect(x + width - handleSize/2, y - handleSize/2, handleSize, handleSize);
              ctx.fillRect(x - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
              ctx.fillRect(x + width - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
            }
            
            // Save the final canvas as the new image preview
            setImagePreview(canvas.toDataURL('image/png'));
          }
        }
      };
      img.src = result.processedImageUrl;
      
      // Set the estimated area
      setManualAreaValue(result.estimatedArea.toString());
      
      // Log the results with sensitivity info if not in preview mode
      if (!isPreview) {
        let detectionMethod = "Automatic wound segmentation";
        if (userOutline) {
          detectionMethod = "User-guided outline detection";
        } else if (boundingBox) {
          detectionMethod = "User-defined bounding box detection";
        }
          
        setSerialMessages(prev => [...prev, 
          `[IMAGE] Wound image analyzed. Estimated area: ~${result.estimatedArea}mm² (adjust if needed)`,
          `[IMAGE] Detection confidence: ${Math.round(result.confidence * 100)}%`,
          `[IMAGE] Detection method: ${detectionMethod} (${result.detectionMethod})`
        ]);
      }
    })
    .catch(error => {
      // Fallback to the built-in estimation method if advanced analysis fails
      if (!isPreview) {
        estimateWoundArea(imagePreview);
        
        setSerialMessages(prev => [...prev, 
          `[WARNING] Analysis failed: ${error.message}. Using simplified detection.`
        ]);
      }
    });
  };

  // Modified area input dialog to include drawing capabilities and sensitivity settings
  const renderAreaInputDialog = () => {
    if (!showAreaInput) return null;
    
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-indigo-900 border border-indigo-700 rounded-lg shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
          <div className="p-4 border-b border-indigo-800 flex-shrink-0">
            <h3 className="font-semibold text-lg text-white flex items-center">
              <PencilRuler className="mr-2 h-5 w-5 text-cyan-400" />
              Wound Area Measurement
            </h3>
          </div>
          
          <form onSubmit={handleAreaInputSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-indigo-300">
                    {imagePreview ? "Wound Image" : "Upload Wound Image"}
                  </label>
                  {imagePreview && (
                    <div className="flex gap-2">
                      <div className="flex p-1 bg-indigo-800 rounded">
                        <button
                          type="button"
                          onClick={() => {
                            setDrawingEnabled(!drawingEnabled);
                            setDrawingMode('outline');
                          }}
                          className={`text-xs px-2 py-1 rounded ${
                            drawingEnabled && drawingMode === 'outline' 
                              ? 'bg-cyan-600 text-white' 
                              : 'bg-indigo-800 text-indigo-300'
                          }`}
                          title="Draw around the wound outline"
                        >
                          Outline
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDrawingEnabled(!drawingEnabled);
                            setDrawingMode('boundingBox');
                          }}
                          className={`text-xs px-2 py-1 rounded ${
                            drawingEnabled && drawingMode === 'boundingBox' 
                              ? 'bg-cyan-600 text-white' 
                              : 'bg-indigo-800 text-indigo-300'
                          }`}
                          title="Draw a rectangular box around the wound"
                        >
                          Box
                        </button>
                      </div>
                      {drawingEnabled && (
                        <button
                          type="button"
                          onClick={clearDrawing}
                          className="text-xs px-2 py-1 rounded bg-indigo-700 text-indigo-300"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => analyzeWoundImage()}
                        className="text-xs px-2 py-1 rounded bg-green-700 text-white"
                      >
                        Analyze
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-center relative">
                  {!imagePreview ? (
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-indigo-600 rounded-lg cursor-pointer bg-indigo-800/30 hover:bg-indigo-800/50 transition-all">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Camera className="w-8 h-8 text-indigo-400 mb-2" />
                        <p className="text-xs text-indigo-300">Click to upload image</p>
                      </div>
                      <input 
                        type="file" 
                        accept="image/*"
                        capture="environment"
                        className="hidden" 
                        onChange={handleImageUpload}
                      />
                    </label>
                  ) : (
                    <div className="relative w-full overflow-hidden rounded border border-indigo-700">
                      <canvas
                        ref={canvasRef}
                        className={`w-full h-auto object-contain ${drawingEnabled ? 'cursor-crosshair' : 'cursor-default'}`}
                        onMouseDown={handleDrawStart}
                        onMouseMove={handleDrawMove}
                        onMouseUp={handleDrawEnd}
                        onMouseLeave={handleDrawEnd}
                        onTouchStart={handleDrawStart}
                        onTouchMove={handleDrawMove}
                        onTouchEnd={handleDrawEnd}
                      />
                      <div className="absolute top-0 right-0 bg-indigo-900/80 text-xs px-2 py-1 rounded m-1">
                        {manualAreaValue ? `Est. ${manualAreaValue} mm²` : "Upload or select image"}
                      </div>
                      {drawingEnabled && (
                        <div className="absolute bottom-0 left-0 right-0 bg-indigo-900/80 text-[10px] text-center text-cyan-300 py-1">
                          {drawingMode === 'outline' 
                            ? "Draw around the wound to highlight the affected area" 
                            : "Draw a rectangle around the wound area"}
                        </div>
                      )}
                      {/* Add a button to allow uploading a different image */}
                      <div className="absolute top-0 left-0 m-1">
                        <label 
                          className="bg-indigo-900/80 text-xs px-2 py-1 rounded cursor-pointer hover:bg-indigo-800/80"
                          title="Upload new image"
                        >
                          <Camera size={14} />
                          <input 
                            type="file" 
                            accept="image/*"
                            capture="environment"
                            className="hidden" 
                            onChange={handleImageUpload}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                {/* Enhanced tip for users about auto-segmentation */}
                {imagePreview && !drawingEnabled && (
                  <div className="mt-1 text-[10px] text-indigo-300 text-center">
                    Tip: Click "Outline" to trace the wound or "Box" to draw a rectangle around it, 
                    or just click "Analyze" for automatic segmentation
                  </div>
                )}
              </div>

              {/* Replace ML toggle with the DetectionSettings component */}
              {imagePreview && (
                <DetectionSettings
                  sensitivity={sensitivity}
                  onChange={setSensitivity}
                  className="mb-4"
                />
              )}
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2 text-indigo-300">
                  Wound Area (mm²)
                  {imagePreview && <span className="text-xs text-indigo-400 ml-2">
                    {drawingMode === 'outline' && drawingState.points.length > 2 
                      ? "(User-outlined estimate)" 
                      : drawingMode === 'boundingBox' && boundingBoxState.endX !== boundingBoxState.startX
                      ? "(User-boxed estimate)"
                      : "(Auto-segmented estimate)"
                    }
                  </span>}
                </label>
                <input 
                  type="number"
                  value={manualAreaValue}
                  onChange={(e) => setManualAreaValue(e.target.value)}
                  className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white"
                  placeholder="Enter area in mm²"
                  required
                  min="0.1"
                  step="0.1"
                />
                {imagePreview && (
                  <p className="text-xs text-indigo-300 mt-1">
                    Adjust the value if needed based on known reference size.
                  </p>
                )}
              </div>
            </div>
            
            <div className="p-4 border-t border-indigo-800 flex justify-end space-x-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowAreaInput(false);
                  // Just disable drawing mode but keep the image preview in case user wants to
                  // continue working with the current image
                  setDrawingEnabled(false);
                }}
                className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-md text-sm"
              >
                Save Measurement
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // After drawing, trigger a preview update to show detection results
  useEffect(() => {
    if (drawingState.points.length > 3) {
      updatePreview();
    }
  }, [drawingState.points.length]);

  return (
    <div className="flex flex-col min-h-screen bg-indigo-950 text-white">
      <header className="p-4 bg-indigo-900 border-b border-indigo-800 sticky top-0 z-10 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
          <div className="flex items-center mb-2 sm:mb-0">
            <Activity size={24} className="text-cyan-400 mr-2" />
            <h1 className="text-xl font-bold text-white">Wound Guard</h1>
          </div>
          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
            {connected && (
              <>
                <button 
                  onClick={() => setShowManualLogDialog(true)}
                  className="flex items-center bg-indigo-800 px-1.5 py-1 rounded text-xs"
                  aria-label="Add Log"
                >
                  <ClipboardEdit size={13} className="mr-1" />
                  <span className="hidden sm:inline">Add Log</span>
                </button>
                <button 
                  onClick={() => setShowExportDialog(true)}
                  className="flex items-center bg-indigo-800 px-1.5 py-1 rounded text-xs"
                  aria-label="Export Data"
                >
                  <Download size={13} className="mr-1" />
                  <span className="hidden sm:inline">Export</span>
                </button>
                <button 
                  onClick={triggerImport}
                  className="flex items-center bg-indigo-800 px-1.5 py-1 rounded text-xs"
                  aria-label="Import Data"
                >
                  <FileUp size={13} className="mr-1" />
                  <span className="hidden sm:inline">Import</span>
                </button>
                <input 
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImportData}
                  accept=".json"
                  className="hidden"
                />
              </>
            )}
            <div className="flex items-center bg-indigo-800 px-2 sm:px-3 py-1 rounded-full">
              {connectionStatus === 'connected' ? (
                <Wifi size={16} className="text-emerald-400 mr-1 sm:mr-2" />
              ) : connectionStatus === 'connecting' ? (
                <Gauge size={16} className="text-cyan-400 mr-1 sm:mr-2 animate-pulse" />
              ) : (
                <WifiOff size={16} className="text-gray-400 mr-1 sm:mr-2" />
              )}
              <span className="text-xs text-indigo-200 truncate max-w-20 sm:max-w-32">
                {connected ? `Last: ${currentData.lastUpdate}` : "Not connected"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Welcome mode selection dialog */}
      {showWelcomeDialog && !connected && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-indigo-900 border border-indigo-700 rounded-lg shadow-2xl w-full max-w-md">
            <div className="p-4 border-b border-indigo-800">
              <h3 className="font-semibold text-xl text-white flex items-center">
                <Activity className="mr-2 h-6 w-6 text-cyan-400" />
                Welcome to WoundGuard
              </h3>
            </div>
            
            <div className="p-4">
              <p className="text-indigo-300 text-sm mb-6">
                Choose how you'd like to use the application:
              </p>
              
              <div className="space-y-4 mb-6">
                {isWebSerialSupported && (
                  <button 
                    onClick={connectToArduino}
                    className="w-full flex items-center bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white p-3 rounded-lg transition"
                  >
                    <div className="bg-blue-500/30 p-2 rounded-md mr-3">
                      <Wifi className="h-6 w-6" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Connect to Arduino</p>
                      <p className="text-xs text-blue-100">Use with real hardware sensors</p>
                    </div>
                  </button>
                )}
                
                <button 
                  onClick={startDemoMode}
                  className="w-full flex items-center bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white p-3 rounded-lg transition"
                >
                  <div className="bg-indigo-500/30 p-2 rounded-md mr-3">
                    <Gauge className="h-6 w-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Demo Mode</p>
                    <p className="text-xs text-indigo-100">Try with simulated sensor data</p>
                  </div>
                </button>
                
                <button 
                  onClick={startManualMode}
                  className="w-full flex items-center bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white p-3 rounded-lg transition"
                >
                  <div className="bg-purple-500/30 p-2 rounded-md mr-3">
                    <ClipboardEdit className="h-6 w-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Manual Mode</p>
                    <p className="text-xs text-purple-100">Track wound progress with manual entries only</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual logging dialog */}
      {showManualLogDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-indigo-900 border border-indigo-700 rounded-lg shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-indigo-800 flex-shrink-0">
              <h3 className="font-semibold text-lg text-white flex items-center">
                <ClipboardList className="mr-2 h-5 w-5 text-cyan-400" />
                Manual Data Entry
              </h3>
            </div>
            
            <div className="flex-1 overflow-hidden">
              <div className="p-4 overflow-y-auto max-h-full custom-scrollbar">
                <div className="flex justify-between border-b border-indigo-800 pb-2 mb-4">
                  <button
                    className={`px-3 py-1 rounded-md ${manualLogType === 'observation' ? 'bg-cyan-700 text-white' : 'bg-indigo-800/50 text-indigo-300'}`}
                    onClick={() => setManualLogType('observation')}
                    type="button"
                  >
                    Log Note
                  </button>
                  <button
                    className={`px-3 py-1 rounded-md ${manualLogType === 'data-entry' ? 'bg-cyan-700 text-white' : 'bg-indigo-800/50 text-indigo-300'}`}
                    onClick={() => setManualLogType('data-entry')}
                    type="button"
                  >
                    All Data
                  </button>
                </div>
                
                {manualLogType === 'observation' ? (
                  <form onSubmit={handleManualLogSubmit}>
                    <div className="mb-4">
                      <label className="block text-sm font-medium mb-2 text-indigo-300">
                        Observation Note
                      </label>
                      <textarea
                        value={manualLogDescription}
                        onChange={(e) => setManualLogDescription(e.target.value)}
                        className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white h-24"
                        placeholder="Enter observation, treatment notes, etc..."
                        required
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setShowManualLogDialog(false)}
                        className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-md text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-md text-sm"
                      >
                        Save Note
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleManualDataEntry}>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="block text-sm font-medium mb-1 text-indigo-300">
                          Area (mm²)
                        </label>
                        <input
                          type="number"
                          name="area"
                          step="0.1"
                          defaultValue={currentData.area.toFixed(1)}
                          className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 text-indigo-300">
                          Temperature (°C)
                        </label>
                        <input
                          type="number"
                          name="temperature"
                          step="0.1"
                          defaultValue={typeof currentData.temperature === 'string' ? currentData.temperature : currentData.temperature.toFixed(1)}
                          className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 text-indigo-300">
                          Humidity (%)
                        </label>
                        <input
                          type="number"
                          name="humidity"
                          defaultValue={currentData.humidity}
                          className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 text-indigo-300">
                          pH
                        </label>
                        <input
                          type="number"
                          name="ph"
                          step="0.1"
                          defaultValue={typeof currentData.ph === 'string' ? currentData.ph : currentData.ph.toFixed(1)}
                          className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white"
                          required
                        />
                      </div>
                    </div>
                    <div className="mb-4">
                      <label className="block text-sm font-medium mb-1 text-indigo-300">
                        Notes (optional)
                      </label>
                      <textarea
                        name="notes"
                        className="w-full bg-indigo-800/30 border border-indigo-700 rounded-md p-2 text-white h-16"
                        placeholder="Add optional notes..."
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setShowManualLogDialog(false)}
                        className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-md text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-md text-sm"
                      >
                        Save Data
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export options dialog */}
      {showExportDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-indigo-900 border border-indigo-700 rounded-lg shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-indigo-800 flex-shrink-0">
              <h3 className="font-semibold text-lg text-white flex items-center">
                <FileDown className="mr-2 h-5 w-5 text-cyan-400" />
                Export Data
              </h3>
            </div>
            
            <div className="p-4 overflow-y-auto custom-scrollbar flex-1">
              <p className="text-indigo-300 text-sm mb-4">
                Choose what data to include in your export:
              </p>
              
              <div className="space-y-3 mb-6">
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    id="include-historical" 
                    className="w-4 h-4 bg-indigo-800 border-indigo-600 rounded mr-2"
                    defaultChecked
                  />
                  <label htmlFor="include-historical" className="text-white">
                    Historical Data ({historicalData.length} records)
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    id="include-logs" 
                    className="w-4 h-4 bg-indigo-800 border-indigo-600 rounded mr-2" 
                    defaultChecked
                  />
                  <label htmlFor="include-logs" className="text-white">
                    Manual Log Entries ({manualLogEntries.length} entries)
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    id="include-serial" 
                    className="w-4 h-4 bg-indigo-800 border-indigo-600 rounded mr-2" 
                    defaultChecked
                  />
                  <label htmlFor="include-serial" className="text-white">
                    Serial Messages ({serialMessages.length} messages)
                  </label>
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-indigo-800 flex justify-end space-x-3 flex-shrink-0">
              <button
                onClick={() => setShowExportDialog(false)}
                className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                onClick={exportData}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-md text-sm flex items-center"
              >
                <Download size={16} className="mr-1" />
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {!connected ? (
        <div className="flex flex-col items-center justify-center flex-1 p-6 bg-gradient-to-b from-indigo-950 to-indigo-900">
          <div className="w-32 h-32 rounded-full bg-indigo-800 flex items-center justify-center mb-6">
            <Gauge size={64} className="text-cyan-400 animate-pulse" />
          </div>
          <h2 className="text-2xl font-semibold mb-2 text-white">Choose an Option</h2>
          <p className="text-indigo-300 mb-4 text-center text-sm max-w-xs">
            Select how you'd like to use WoundGuard
          </p>
          
          <div className="flex flex-col space-y-4 w-full max-w-xs">
            {isWebSerialSupported && (
              <button 
                onClick={connectToArduino}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-medium hover:from-cyan-600 hover:to-blue-700 transition shadow-lg shadow-indigo-900/50 flex items-center justify-center"
              >
                <Wifi size={18} className="mr-2" />
                Connect to Arduino
              </button>
            )}
            
            <button 
              onClick={startDemoMode}
              className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-indigo-700 transition shadow-lg shadow-indigo-900/50 flex items-center justify-center"
            >
              <Gauge size={18} className="mr-2" />
              Demo Mode
            </button>
            
            <button 
              onClick={startManualMode}
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl font-medium hover:from-purple-600 hover:to-purple-700 transition shadow-lg shadow-indigo-900/50 flex items-center justify-center"
            >
              <ClipboardEdit size={18} className="mr-2" />
              Manual Mode
            </button>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="dashboard" className="flex-1">
          <TabsList className="w-full flex justify-between bg-indigo-900/70 backdrop-blur-md p-1 rounded-none fixed z-10 top-[72px] sm:top-14 border-b border-indigo-600/50 shadow-lg">
            <TabsTrigger 
              className="flex-1 text-[10px] sm:text-xs py-2 sm:py-3 transition-all duration-300 
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="dashboard"
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger 
              className="flex-1 text-[10px] sm:text-xs py-2 sm:py-3 transition-all duration-300
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="trends"
            >
              Trends
            </TabsTrigger>
            <TabsTrigger 
              className="flex-1 text-[10px] sm:text-xs py-2 sm:py-3 transition-all duration-300
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="environment"
            >
              Environ
            </TabsTrigger>
            <TabsTrigger 
              className="flex-1 text-[10px] sm:text-xs py-2 sm:py-3 transition-all duration-300
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="serial"
            >
              Serial
            </TabsTrigger>
          </TabsList>
          
          <div className="pt-[56px] sm:pt-14"> {/* Adjusted padding for mobile tabs */}
            <TabsContent value="dashboard" className="m-0 p-4">
              {/* Manual Area Input Dialog */}
              {renderAreaInputDialog()}

              {/* Dashboard grid layout */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {/* Healing progress card */}
                <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 md:col-span-2">
                  <div className="bg-gradient-to-r from-indigo-800/80 to-indigo-900/80 backdrop-blur-sm p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-lg font-bold text-white">Healing Progress</h3>
                        <p className="text-indigo-300 text-xs">Overall improvement</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            // Reset canvas state before showing the dialog to start fresh
                            resetCanvas();
                            setShowAreaInput(true);
                          }}
                          className="flex items-center bg-cyan-700 hover:bg-cyan-600 px-3 py-1 rounded-full text-xs"
                        >
                          <Camera size={14} className="mr-1" />
                          Add Measurement
                        </button>
                        <div className={`text-xs px-3 py-1 rounded-full ${getStatusBgColor()} text-white font-medium`}>
                          {getHealingStatus()}
                        </div>
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row">
                      <div className="w-full md:w-1/3 lg:w-1/4 mb-4 md:mb-0 flex justify-center items-center">
                        <div className="h-40 w-40 max-w-full">
                          <CircularProgressIndicator percentage={healingPercentage()} />
                        </div>
                      </div>
                      <div className="w-full md:w-2/3 lg:w-3/4 flex flex-col">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                          <div className="bg-indigo-800/30 backdrop-blur-sm p-3 rounded-lg">
                            <p className="text-xs text-indigo-300">Initial Size</p>
                            <p className="text-xl font-bold text-white">{historicalData[0]?.area || 0}<span className="text-xs">mm²</span></p>
                          </div>
                          <div className="bg-indigo-800/30 backdrop-blur-sm p-3 rounded-lg">
                            <p className="text-xs text-indigo-300">Current Size</p>
                            <p className="text-xl font-bold text-white">{currentData.area.toFixed(1)}<span className="text-xs">mm²</span></p>
                          </div>
                          <div className="bg-indigo-800/30 backdrop-blur-sm p-3 rounded-lg">
                            <p className="text-xs text-indigo-300">Size Reduction</p>
                            <div className="flex items-center">
                              <p className="text-xl font-bold text-emerald-400">
                                {historicalData.length ? `-${((historicalData[0]?.area - currentData.area) / historicalData[0]?.area * 100).toFixed(0)}%` : "0%"}
                              </p>
                              {historicalData.length && (historicalData[0]?.area - currentData.area) > 0 && (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 010 1.414z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="bg-indigo-800/30 backdrop-blur-sm p-3 rounded-lg mb-3">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs text-indigo-300">Healing Rate</p>
                            <p className="text-xs font-medium text-indigo-200">
                              {healingPercentage() > 70 ? "Excellent" : healingPercentage() > 40 ? "Good" : "Needs Attention"}
                            </p>
                          </div>
                          <div className="w-full bg-indigo-950/50 rounded-full h-2">
                            <div 
                              className="h-2 rounded-full transition-all duration-700" 
                              style={{ 
                                width: `${healingPercentage()}%`, 
                                backgroundColor: getHealingColor() 
                              }}
                            ></div>
                          </div>
                        </div>

                        <div className="mt-auto">
                          <p className="text-xs text-indigo-300 mb-1">Weekly Improvement Rate</p>
                          <div className="flex items-center gap-1">
                            {weeklyProgressData.map((item, index) => (
                              <div 
                                key={index}
                                className="flex-1 h-12 flex flex-col items-center"
                              >
                                <div className="h-8 w-full flex items-end">
                                  <div 
                                    className="w-full rounded-t transition-all" 
                                    style={{ 
                                      height: `${item.rate}%`,
                                      backgroundColor: 
                                        item.rate > 15 ? '#10b981' : 
                                        item.rate > 8 ? '#f59e0b' : 
                                        '#f43f5e'
                                    }}
                                  ></div>
                                </div>
                                <span className="text-[10px] text-indigo-300">{item.week.replace('Week ', '')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Combined environmental factors card */}
                <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50">
                  <CardHeader className="p-3 pb-0">
                    <CardTitle className="text-base text-white">Environmental Factors</CardTitle>
                    <CardDescription className="text-xs text-indigo-300">Current readings</CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 mb-4">
                    <div className="space-y-4">
                      <div className="flex items-center">
                        <ThermometerSun size={18} className="text-rose-400 mr-2" />
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs text-indigo-300">Temperature</p>
                            <p className="text-xs font-medium text-indigo-200">
                              {parseFloat(typeof currentData.temperature === 'string' 
                                ? currentData.temperature : currentData.temperature.toString()) > 37.5 
                                  ? "Elevated" : "Normal"}
                            </p>
                          </div>
                          <div className="w-full bg-indigo-950/50 rounded-full h-1.5">
                            <div 
                              className="h-1.5 rounded-full" 
                              style={{ 
                                width: `${Math.max(0, Math.min(100, (parseFloat(typeof currentData.temperature === 'string' 
                                  ? currentData.temperature : currentData.temperature.toString()) - 35) / 3 * 100))}%`,
                                backgroundColor: parseFloat(typeof currentData.temperature === 'string' 
                                  ? currentData.temperature : currentData.temperature.toString()) > 37.5 
                                  ? '#f43f5e' : '#10b981'
                              }}
                            ></div>
                          </div>
                          <p className="text-xs mt-0.5 text-right text-indigo-200">
                            {typeof currentData.temperature === 'string' 
                              ? currentData.temperature 
                              : currentData.temperature.toFixed(1)}°C
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center">
                        <Droplet size={18} className="text-cyan-400 mr-2" />
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs text-indigo-300">Humidity</p>
                            <p className="text-xs font-medium text-indigo-200">
                              {currentData.humidity > 75 ? "High" : currentData.humidity < 50 ? "Low" : "Optimal"}
                            </p>
                          </div>
                          <div className="w-full bg-indigo-950/50 rounded-full h-1.5">
                            <div 
                              className="h-1.5 rounded-full" 
                              style={{ 
                                width: `${Math.max(0, Math.min(100, currentData.humidity))}%`,
                                backgroundColor: currentData.humidity > 75 ? '#f59e0b' : 
                                  currentData.humidity < 50 ? '#f59e0b' : '#06b6d4'
                              }}
                            ></div>
                          </div>
                          <p className="text-xs mt-0.5 text-right text-indigo-200">{currentData.humidity}%</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center">
                        <Microscope size={18} className="text-violet-400 mr-2" />
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs text-indigo-300">pH Level</p>
                            <p className="text-xs font-medium text-indigo-200">
                              {parseFloat(typeof currentData.ph === 'string' ? currentData.ph : currentData.ph.toString()) > 7.5 
                                ? "Alkaline" : parseFloat(typeof currentData.ph === 'string' ? currentData.ph : currentData.ph.toString()) < 6.5 
                                ? "Acidic" : "Balanced"}
                            </p>
                          </div>
                          <div className="w-full bg-indigo-950/50 rounded-full h-1.5">
                            <div 
                              className="h-1.5 rounded-full" 
                              style={{ 
                                width: `${Math.max(0, Math.min(100, (parseFloat(typeof currentData.ph === 'string' ? currentData.ph : currentData.ph.toString()) - 4) / 6 * 100))}%`,
                                backgroundColor: parseFloat(typeof currentData.ph === 'string' ? currentData.ph : currentData.ph.toString()) > 7.5 || 
                                  parseFloat(typeof currentData.ph === 'string' ? currentData.ph : currentData.ph.toString()) < 6.5 ? '#f59e0b' : '#10b981'
                              }}
                            ></div>
                          </div>
                          <p className="text-xs mt-0.5 text-right text-indigo-200">{currentData.ph}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center">
                        <AlertCircle size={18} className="text-amber-400 mr-2" />
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-xs text-indigo-300">Wound Area</p>
                            <p className="text-xs font-medium text-indigo-200">{getHealingStatus()}</p>
                          </div>
                          <div className="w-full bg-indigo-950/50 rounded-full h-1.5">
                            <div 
                              className="h-1.5 rounded-full" 
                              style={{ 
                                width: `${Math.max(0, Math.min(100, currentData.area))}%`,
                                backgroundColor: getHealingColor()
                              }}
                            ></div>
                          </div>
                          <p className="text-xs mt-0.5 text-right text-indigo-200">{currentData.area.toFixed(1)} mm²</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Layout for showing previous wound images */}
              {historicalData.filter(data => data.imageUrl).length > 0 && (
                <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 mb-4">
                  <CardHeader className="p-3 pb-0">
                    <CardTitle className="text-base text-white">Wound Images</CardTitle>
                    <CardDescription className="text-xs text-indigo-300">Visual healing progression</CardDescription>
                  </CardHeader>
                  <CardContent className="p-3 pt-1">
                    <div className="flex gap-2 overflow-x-auto py-2">
                      {historicalData
                        .filter(data => data.imageUrl)
                        .slice(-5)
                        .map((data, index) => (
                          <div key={index} className="flex-none w-24 h-32 relative">
                            <img 
                              src={data.imageUrl || ''} 
                              alt={`Wound day ${data.day}`}
                              className="w-24 h-24 object-cover rounded-md border border-indigo-700"
                            />
                            <div className="absolute bottom-9 left-0 right-0 bg-indigo-900/80 backdrop-blur-sm text-[10px] text-center text-white py-0.5">
                              Day {data.day}
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-indigo-900/80 backdrop-blur-sm text-[10px] text-center text-cyan-300 py-0.5">
                              {data.area.toFixed(1)} mm²
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* Log entries card */}
              {manualLogEntries.length > 0 && (
                <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 mb-4">
                  <CardHeader className="p-3 pb-0">
                    <CardTitle className="text-base text-white">Activity Log</CardTitle>
                    <CardDescription className="text-xs text-indigo-300">Recent notes and observations</CardDescription>
                  </CardHeader>
                  <CardContent className="p-3 pt-1">
                    <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                      {manualLogEntries.slice().reverse().map((entry, index) => (
                        <div key={index} className="text-xs border-l-2 border-cyan-600 pl-2 py-1">
                          <p className="text-indigo-300">{entry.timestamp}</p>
                          <p className="text-white">{entry.description}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            
              {/* Healing trends chart */}
              <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 mb-4">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-base text-white">Healing Progression</CardTitle>
                  <CardDescription className="text-xs text-indigo-300">Wound area trend over time</CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={historicalData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4f46e5" opacity={0.2} />
                        <XAxis 
                          dataKey="day" 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          tickFormatter={(value) => value % 5 === 0 ? value : ''}
                          stroke="#4f46e5"
                        />
                        <YAxis 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }} 
                          stroke="#4f46e5"
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area 
                          type="monotone" 
                          dataKey="area" 
                          name="Wound Area"
                          stroke="#3b82f6" 
                          strokeWidth={2}
                          fill="url(#areaGradient)"
                          activeDot={{ r: 6, fill: '#60a5fa', stroke: '#2563eb', strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="trends" className="m-0 p-4">
              <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 mb-4">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-base text-white">Wound Area Reduction</CardTitle>
                  <CardDescription className="text-xs text-indigo-300">30-day trend (mm²)</CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={historicalData}
                        margin={{ top: 10, right: 5, left: -20, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4f46e5" opacity={0.2} />
                        <XAxis 
                          dataKey="day" 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          tickFormatter={(value) => value % 5 === 0 ? value : ''}
                          stroke="#4f46e5"
                        />
                        <YAxis 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }} 
                          stroke="#4f46e5"
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area 
                          type="monotone" 
                          dataKey="area" 
                          name="Wound Area"
                          stroke="#3b82f6" 
                          strokeWidth={2}
                          fill="url(#areaGradient)"
                          activeDot={{ r: 6, fill: '#60a5fa', stroke: '#2563eb', strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              {/* Weekly healing rate card */}
              <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-base text-white">Weekly Improvement Rate</CardTitle>
                  <CardDescription className="text-xs text-indigo-300">Percentage change per week</CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={weeklyProgressData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#4f46e5" opacity={0.2} />
                        <XAxis 
                          dataKey="week"
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          stroke="#4f46e5"
                        />
                        <YAxis 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          stroke="#4f46e5"
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <defs>
                          <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={1}/>
                            <stop offset="100%" stopColor="#059669" stopOpacity={1}/>
                          </linearGradient>
                        </defs>
                        <Bar 
                          dataKey="rate" 
                          name="Improvement" 
                          fill="url(#barGradient)" 
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="environment" className="m-0 p-4">
              <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 mb-4">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-base text-white">Temperature Trend</CardTitle>
                  <CardDescription className="text-xs text-indigo-300">Historical readings (°C)</CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={historicalData}
                        margin={{ top: 10, right: 5, left: -20, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4f46e5" opacity={0.2} />
                        <XAxis 
                          dataKey="day" 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          tickFormatter={(value) => value % 5 === 0 ? value : ''}
                          stroke="#4f46e5"
                        />
                        <YAxis 
                          domain={[35, 38]} 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }} 
                          stroke="#4f46e5"
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                          type="monotone" 
                          dataKey="temperature" 
                          name="Temperature" 
                          stroke="#f43f5e" 
                          strokeWidth={2}
                          fill="url(#tempGradient)"
                          activeDot={{ r: 6, fill: '#fda4af', stroke: '#e11d48', strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-base text-white">Humidity & pH</CardTitle>
                  <CardDescription className="text-xs text-indigo-300">Environmental factors</CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={historicalData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#4f46e5" opacity={0.2} />
                        <XAxis 
                          dataKey="day" 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          tickFormatter={(value) => value % 5 === 0 ? value : ''}
                          stroke="#4f46e5"
                        />
                        <YAxis 
                          yAxisId="left" 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          stroke="#4f46e5"
                        />
                        <YAxis 
                          yAxisId="right" 
                          orientation="right" 
                          domain={[5, 9]} 
                          tick={{ fontSize: 10, fill: '#a5b4fc' }}
                          stroke="#4f46e5"
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line 
                          yAxisId="left" 
                          type="monotone" 
                          dataKey="humidity" 
                          name="Humidity" 
                          stroke="#06b6d4" 
                          strokeWidth={2} 
                          dot={false}
                          activeDot={{ r: 6, fill: '#22d3ee', stroke: '#0891b2', strokeWidth: 2 }}
                        />
                        <Line 
                          yAxisId="right" 
                          type="monotone" 
                          dataKey="ph" 
                          name="pH" 
                          stroke="#10b981" 
                          strokeWidth={2} 
                          dot={false}
                          activeDot={{ r: 6, fill: '#34d399', stroke: '#059669', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="serial" className="m-0 p-0">
              <div className="bg-gradient-to-b from-black/80 to-indigo-950/80 backdrop-blur-md text-cyan-400 p-3 font-mono text-xs h-screen overflow-y-auto">
                <div className="mb-4 p-2 bg-cyan-900/30 backdrop-blur-sm rounded border border-cyan-800/50 border-opacity-30">
                  <h3 className="text-cyan-300 font-semibold mb-1">
                    {manualMode ? "Manual Mode Activity" : "Arduino Serial Monitor"}
                  </h3>
                  <p className="text-cyan-400 opacity-70 text-xs">
                    {isWebSerialSupported 
                      ? connected 
                        ? manualMode
                          ? "Manual mode active - all data based on user entries"
                          : demoMode 
                            ? "Demo mode active - showing simulated data"
                            : "Connection established at 115200 baud (NOTE: Wound area requires manual measurement)" 
                        : "Web Serial API available - connect to device to begin"
                      : "Web Serial API not supported in this browser - using demo data"
                    }
                  </p>
                  {connected && (
                    <div className="flex gap-2 mt-2">
                      {manualMode ? (
                        <button 
                          onClick={() => {
                            setShowManualLogDialog(true);
                            setManualLogType('data-entry');
                          }}
                          className="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded-md text-xs flex items-center"
                        >
                          <ClipboardEdit size={14} className="mr-1" />
                          Add Measurement
                        </button>
                      ) : (
                        <button 
                          onClick={() => setShowAreaInput(true)}
                          className="px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded-md text-xs flex items-center"
                        >
                          <PencilRuler size={14} className="mr-1" />
                          Add Area Measurement
                        </button>
                      )}
                      <button 
                        onClick={disconnectFromDevice}
                        className="px-3 py-1 bg-red-900 hover:bg-red-800 text-white rounded-md text-xs"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
                <div className="mb-2 max-h-[70vh] overflow-y-auto">
                  {serialMessages.map((message, index) => (
                    <div 
                      key={index} 
                      className={`mb-1 break-words pl-2 border-l-2 ${message.includes('Error') ? 'border-red-600 text-red-400' : 'border-cyan-800'} hover:bg-cyan-900 hover:bg-opacity-10 transition`}
                    >
                      {message}
                    </div>
                  ))}
                </div>
                {connected && !demoMode && (
                  <div className="sticky bottom-0 pt-2">
                    <form 
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements.namedItem('command');
                        if (input && input instanceof HTMLInputElement) {
                          const command = input.value;
                          if (command && writerRef.current) {
                            try {
                              writerRef.current.write(new TextEncoder().encode(command + '\n'));
                              setSerialMessages(prev => [...prev, `> ${command}`]);
                              input.value = '';
                            } catch (error) {
                              console.error('Error sending command:', error);
                              const errorMessage = error instanceof Error ? error.message : String(error);
                              setSerialMessages(prev => [...prev, `Error sending command: ${errorMessage}`]);
                            }
                          }
                        }
                      }}
                    >
                      <input 
                        type="text" 
                        name="command"
                        className="bg-indigo-900 bg-opacity-30 border border-indigo-800 rounded px-3 py-1 flex-1 text-white"
                        placeholder="Send command..."
                      />
                      <button 
                        type="submit"
                        className="bg-blue-700 hover:bg-blue-600 px-3 py-1 rounded"
                      >
                        Send
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
};

// Custom circular progress indicator component
const CircularProgressIndicator = ({ percentage }: { percentage: number }) => {
  const radius = 80;
  const strokeWidth = 16;
  const normalizedRadius = radius - strokeWidth / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const getHealingColor = () => {
    if (percentage > 70) return '#10b981'; // Green for good progress
    if (percentage > 40) return '#f59e0b'; // Amber for moderate progress
    return '#f43f5e'; // Red for concerning progress
  };
  
  return (
    <div className="relative flex items-center justify-center">
      {/* Track circle */}
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
        <circle
          stroke="#1e2f6833"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        {/* Progress circle with gradient */}
        <circle
          stroke="url(#progressGradient)"
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="transition-all duration-700 ease-out"
        />
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={getHealingColor()} stopOpacity="0.9" />
            <stop offset="100%" stopColor={getHealingColor()} stopOpacity="0.7" />
          </linearGradient>
        </defs>
      </svg>
      
      {/* Inner content */}
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white">{percentage}%</span>
        <span className="text-xs text-indigo-200">Healing Progress</span>
        
        {/* Indicator icon based on progress */}
        <div className={`mt-1 rounded-full p-1 ${
          percentage > 70 ? 'bg-emerald-500/20' : percentage > 40 ? 'bg-amber-500/20' : 'bg-rose-500/20'
        }`}>
          {percentage > 70 ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          ) : percentage > 40 ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
};

// Export the component so it can be used in main.tsx
export default WoundTrackingApp;