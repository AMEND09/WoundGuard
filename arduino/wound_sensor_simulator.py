import time
import random

def main():
    """
    WoundGuard Sensor Simulator (Python version)
    This script simulates wound sensor readings that would normally come from Arduino
    """
    print("WoundGuard Sensor Simulator")
    print("----------------------------")
    print("Generating simulated sensor data...\n")
    
    try:
        while True:
            # Generate random sensor values within realistic ranges
            ph = round(random.uniform(4.0, 7.0), 1)
            temperature = round(random.uniform(34.5, 38.0), 1)
            moisture = random.randint(60, 90)
            
            # Output the readings in the format expected by WoundGuard
            print(f"pH Sensor Value (Potentiometer 1): {ph}")
            print(f"Temperature (Simulated by Potentiometer 2): {temperature}°C")
            print(f"Moisture Sensor Value (Photoresistor): {moisture}%")
            print("----------------------------")
            
            # Wait for a random period (5-10 seconds) before sending next readings
            sleep_time = random.randint(5, 10)
            time.sleep(sleep_time)
            
    except KeyboardInterrupt:
        print("\nExiting sensor simulation...")

if __name__ == "__main__":
    main()
