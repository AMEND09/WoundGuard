# WoundGuard

A wound monitoring application that tracks healing progress and environmental factors.

## Features

- Track wound area, temperature, humidity, and pH values
- Visualize healing progress over time
- Manual data entry mode
- Sensor connection via Web Serial API
- Demo mode for testing
- Data import/export functionality

## Running the Application

1. Clone the repository
2. Install dependencies: `npm install`
3. Run development server: `npm run dev`
4. Build for production: `npm run build`

## Using Arduino or Sensor Simulator

### Option 1: Arduino Hardware

This application can connect to an Arduino with appropriate sensors using the Web Serial API. The Arduino should output sensor readings in this format:

```
pH Sensor Value (Potentiometer 1): 6.5
Temperature (Simulated by Potentiometer 2): 36.8°C
Moisture Sensor Value (Photoresistor): 75%
```

### Option 2: Arduino Simulator

If you don't have the hardware, you can use the provided simulator:

1. For Arduino IDE: Open `arduino/wound_sensor_simulator.ino` and upload to your Arduino
2. For Python: Run `python arduino/wound_sensor_simulator.py` and connect via serial port

### Option 3: Manual Mode

For manual tracking without any hardware:
1. Launch the application
2. Choose "Manual Mode"
3. Enter wound measurements and environmental data manually

## Deployment

This app is deployed to GitHub Pages automatically via GitHub Actions when changes are pushed to the main branch.

