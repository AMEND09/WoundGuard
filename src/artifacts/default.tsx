import React, { useState, useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';
import { Gauge, AlertCircle, Wifi, WifiOff, Droplet, ThermometerSun, Microscope, Activity } from 'lucide-react';

// Define interfaces for the app
interface HistoricalDataPoint {
  day: number;
  area: number;
  temperature: number | string;
  humidity: number;
  ph: number | string;
  lastUpdate?: string | null;
}

interface SensorData {
  area: number;
  temperature: number | string;
  humidity: number;
  ph: number | string;
  lastUpdate: string | null;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<any>;
  label?: string | number;
}

// Mock data to simulate Arduino serial data
const mockHistoricalData: HistoricalDataPoint[] = Array(30).fill(null).map((_, i) => ({
  day: i + 1,
  area: Math.round(100 - 70 * Math.exp(-i / 15) + Math.random() * 5),
  temperature: (36 + Math.random() * 2).toFixed(1),
  humidity: Math.round(60 + Math.random() * 20),
  ph: (7 + Math.sin(i / 5) * 0.5).toFixed(1)
}));

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
  
  // Refs for maintaining serial port connection
  const serialPortRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  
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
          // Expected format: "AREA:XX.X,TEMP:XX.X,HUM:XX.X,PH:XX.X"
          const dataMap: Record<string, number> = {};
          const dataPairs = message.trim().split(',');
          
          dataPairs.forEach(pair => {
            const [key, value] = pair.split(':');
            if (key && value) {
              dataMap[key.trim().toLowerCase()] = parseFloat(value);
            }
          });
          
          if (Object.keys(dataMap).length > 0) {
            const newData = {
              area: 'area' in dataMap ? dataMap.area : currentData.area,
              temperature: 'temp' in dataMap ? dataMap.temp : currentData.temperature,
              humidity: 'hum' in dataMap ? dataMap.hum : currentData.humidity,
              ph: 'ph' in dataMap ? dataMap.ph : currentData.ph,
              lastUpdate: new Date().toLocaleTimeString()
            };
            
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

  // Simulate connecting to Arduino
  const connectToArduino = async () => {
    setConnectionStatus('connecting');
    setSerialMessages(prev => [...prev, "Attempting to connect to Arduino..."]);
    
    if (isWebSerialSupported) {
      try {
        // Request a serial port
        const port = await (navigator as any).serial.requestPort();
        serialPortRef.current = port;
        
        // Open the port with appropriate settings (adjust baud rate as needed)
        await port.open({ baudRate: 9600 });
        
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
    
    // Set initial data
    const lastData = mockHistoricalData[mockHistoricalData.length - 1];
    setCurrentData({
      area: lastData.area,
      temperature: typeof lastData.temperature === 'string' ? parseFloat(lastData.temperature) : lastData.temperature,
      humidity: lastData.humidity,
      ph: typeof lastData.ph === 'string' ? parseFloat(lastData.ph) : lastData.ph,
      lastUpdate: new Date().toLocaleTimeString()
    });
    
    setHistoricalData(mockHistoricalData);
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

  // Function to determine wound healing status
  const getHealingStatus = () => {
    if (currentData.area < 30) return "Good";
    if (currentData.area < 60) return "Moderate";
    return "Concerning";
  };

  // Function to get color based on healing status
  const getStatusColor = () => {
    const status = getHealingStatus();
    if (status === "Good") return "text-emerald-500";
    if (status === "Moderate") return "text-amber-500";
    return "text-rose-500";
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
    if (historicalData.length === 0) return 0;
    const initial = historicalData[0]?.area || 100;
    const current = currentData.area;
    return Math.min(100, Math.max(0, Math.round((initial - current) / initial * 100)));
  };

  // Custom tooltip that's mobile-friendly
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

  // Get healing progress color
  const getHealingColor = () => {
    const percentage = healingPercentage();
    if (percentage > 70) return '#10b981'; // Green for good progress
    if (percentage > 40) return '#f59e0b'; // Amber for moderate progress
    return '#f43f5e'; // Red for concerning progress
  };

  // Custom circular progress indicator component
  const CircularProgressIndicator = ({ percentage }: { percentage: number }) => {
    const radius = 80;
    const strokeWidth = 16;
    const normalizedRadius = radius - strokeWidth / 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    
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
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            ) : percentage > 40 ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </div>
        </div>
      </div>
    );
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

  return (
    <div className="flex flex-col min-h-screen bg-indigo-950 text-white">
      <header className="p-4 bg-indigo-900 border-b border-indigo-800 sticky top-0 z-10 shadow-lg">
        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <Activity size={24} className="text-cyan-400 mr-2" />
            <h1 className="text-xl font-bold text-white">Wound Monitor</h1>
          </div>
          <div className="flex items-center bg-indigo-800 px-3 py-1 rounded-full">
            {connectionStatus === 'connected' ? (
              <Wifi size={18} className="text-emerald-400 mr-2" />
            ) : connectionStatus === 'connecting' ? (
              <Gauge size={18} className="text-cyan-400 mr-2 animate-pulse" />
            ) : (
              <WifiOff size={18} className="text-gray-400 mr-2" />
            )}
            <span className="text-xs text-indigo-200 truncate max-w-32">
              {connected ? `Last: ${currentData.lastUpdate}` : "Not connected"}
            </span>
          </div>
        </div>
      </header>

      {!connected ? (
        <div className="flex flex-col items-center justify-center flex-1 p-6 bg-gradient-to-b from-indigo-950 to-indigo-900">
          <div className="w-32 h-32 rounded-full bg-indigo-800 flex items-center justify-center mb-6">
            <Gauge size={64} className="text-cyan-400 animate-pulse" />
          </div>
          <h2 className="text-2xl font-semibold mb-2 text-white">Connect Device</h2>
          <p className="text-indigo-300 mb-2 text-center text-sm max-w-xs">
            {isWebSerialSupported 
              ? "Connect your Arduino device to start monitoring wound healing progress" 
              : "Your browser doesn't support direct device connection. Using demo mode."}
          </p>
          {!isWebSerialSupported && (
            <p className="text-amber-300 mb-6 text-center text-xs max-w-xs">
              For real device connectivity, use Chrome, Edge, or other browsers that support Web Serial API.
            </p>
          )}
          <button 
            onClick={connectToArduino}
            className="px-6 py-4 w-full max-w-xs bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-medium hover:from-cyan-600 hover:to-blue-700 active:from-cyan-700 active:to-blue-800 transition shadow-lg shadow-indigo-900/50"
          >
            {isWebSerialSupported ? "Connect to Arduino" : "Start Demo Mode"}
          </button>
        </div>
      ) : (
        <Tabs defaultValue="dashboard" className="flex-1">
          <TabsList className="w-full flex justify-between bg-indigo-900/70 backdrop-blur-md p-1 rounded-none fixed z-10 top-14 border-b border-indigo-600/50 shadow-lg">
            <TabsTrigger 
              className="flex-1 text-xs py-3 transition-all duration-300 
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="dashboard"
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger 
              className="flex-1 text-xs py-3 transition-all duration-300
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="trends"
            >
              Trends
            </TabsTrigger>
            <TabsTrigger 
              className="flex-1 text-xs py-3 transition-all duration-300
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="environment"
            >
              Environment
            </TabsTrigger>
            <TabsTrigger 
              className="flex-1 text-xs py-3 transition-all duration-300
                data-[state=inactive]:bg-indigo-800/30 data-[state=inactive]:backdrop-blur-sm data-[state=inactive]:text-indigo-200
                data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/80 data-[state=active]:to-blue-600/80 
                data-[state=active]:backdrop-blur-md data-[state=active]:text-white data-[state=active]:shadow-md rounded-md" 
              value="serial"
            >
              Serial
            </TabsTrigger>
          </TabsList>
          
          <div className="pt-14"> {/* Space for fixed tabs */}
            <TabsContent value="dashboard" className="m-0 p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {/* Healing progress card */}
                <Card className="shadow-lg bg-indigo-900/70 backdrop-blur-md border-indigo-600/50 md:col-span-2">
                  <div className="bg-gradient-to-r from-indigo-800/80 to-indigo-900/80 backdrop-blur-sm p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-lg font-bold text-white">Healing Progress</h3>
                        <p className="text-indigo-300 text-xs">Overall improvement</p>
                      </div>
                      <div className={`text-xs px-3 py-1 rounded-full ${getStatusBgColor()} text-white font-medium`}>
                        {getHealingStatus()}
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
                                  <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
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
                  <CardContent className="p-3 pt-1">
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
                        data={[
                          { week: 'Week 1', rate: 12 },
                          { week: 'Week 2', rate: 18 },
                          { week: 'Week 3', rate: 15 },
                          { week: 'Week 4', rate: 22 },
                        ]}
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
                  <h3 className="text-cyan-300 font-semibold mb-1">Arduino Serial Monitor</h3>
                  <p className="text-cyan-400 opacity-70 text-xs">
                    {isWebSerialSupported 
                      ? connected 
                        ? demoMode 
                          ? "Demo mode active - showing simulated data"
                          : "Connection established at 9600 baud" 
                        : "Web Serial API available - connect to device to begin"
                      : "Web Serial API not supported in this browser - using demo data"
                    }
                  </p>
                  {connected && (
                    <button 
                      onClick={disconnectFromDevice}
                      className="mt-2 px-3 py-1 bg-red-900 hover:bg-red-800 text-white rounded-md text-xs"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                <div className="mb-2 max-h-[70vh] overflow-y-auto">
                  {serialMessages.map((message, index) => (
                    <div 
                      key={index} 
                      className={`mb-1 break-words pl-2 border-l-2 ${message.includes && message.includes('Error') ? 'border-red-600 text-red-400' : 'border-cyan-800'} hover:bg-cyan-900 hover:bg-opacity-10 transition`}
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

export default WoundTrackingApp;