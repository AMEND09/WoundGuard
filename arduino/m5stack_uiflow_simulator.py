from m5stack import *
from m5ui import *
from uiflow import *
import time
import random

# Clear the screen
lcd.clear()
lcd.font(lcd.FONT_Default)
lcd.setTextColor(0xFFFFFF, 0x000000)
lcd.print("WoundGuard Simulator", 10, 10, 0xFFFFFF)
lcd.print("-------------------", 10, 30, 0xFFFFFF)

# Set up a basic UI display
def update_display(ph, temp, moisture):
    # Clear the data area
    lcd.rect(0, 50, 320, 190, 0x000000, 0x000000)
    
    # Show the current values
    lcd.print("pH: " + str(ph), 20, 60, 0x00FFFF)
    lcd.print("Temperature: " + str(temp) + " C", 20, 90, 0xFF5500)
    lcd.print("Humidity: " + str(moisture) + "%", 20, 120, 0x00FF00)
    
    # Show the last update time
    lcd.print("Updated: " + str(int(time.time())), 20, 180, 0xAAAAAA)

# Main loop
try:
    while True:
        # Generate random sensor values within realistic ranges
        ph = round(random.uniform(4.0, 7.0) * 10) / 10.0
        temp = round(random.uniform(34.5, 38.0) * 10) / 10.0
        moisture = random.randint(60, 90)
        
        # Update the display
        update_display(ph, temp, moisture)
        
        # Print values in the format expected by WoundGuard
        print("pH Sensor Value (Potentiometer 1): " + str(ph))
        print("Temperature (Simulated by Potentiometer 2): " + str(temp) + "°C")
        print("Moisture Sensor Value (Photoresistor): " + str(moisture) + "%")
        
        # Wait for a random period before next update
        wait_time = random.randint(5, 10)
        time.sleep(wait_time)
        
except Exception as e:
    # Show errors on screen
    lcd.clear()
    lcd.print("Error:", 10, 10, 0xFF0000)
    lcd.print(str(e), 10, 40, 0xFF0000)
    print("Error: " + str(e))
