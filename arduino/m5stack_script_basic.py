# Simple M5Stack simulator for WoundGuard - compatible with most M5Stack versions
import time
import random

# No fancy UI in this version, just serial output
print("WoundGuard Simulator - Basic Version")
print("-----------------------------------")

try:
    while True:
        # Generate random sensor values
        ph = int(random.random() * 30 + 40) / 10.0
        temp = int(random.random() * 35 + 345) / 10.0
        moisture = int(random.random() * 30 + 60)
        
        # Format them as strings (no f-strings for compatibility)
        ph_str = str(round(ph, 1))
        temp_str = str(round(temp, 1))
        moisture_str = str(moisture)
        
        # Output the readings in the format expected by WoundGuard
        print("pH Sensor Value (Potentiometer 1): " + ph_str)
        print("Temperature (Simulated by Potentiometer 2): " + temp_str + "°C")
        print("Moisture Sensor Value (Photoresistor): " + moisture_str + "%")
        print("-----------------------------------")
        
        # Wait before next reading
        time.sleep(random.randint(5, 10))
        
except KeyboardInterrupt:
    print("Simulation stopped")
except Exception as e:
    print("Error: " + str(e))
