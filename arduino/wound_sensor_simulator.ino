/*
 * WoundGuard Sensor Simulator
 * This sketch simulates sensor readings for the WoundGuard application
 * It generates random values for pH, temperature, and moisture sensors
 * For use with the WoundGuard web application's Serial Monitor
 */

void setup() {
  // Initialize serial communication at 9600 baud rate
  Serial.begin(9600);
  Serial.println("WoundGuard Sensor Simulator");
  Serial.println("----------------------------");
  Serial.println("Generating simulated sensor data...");
  
  // Give the serial connection time to establish
  delay(1000);
}

void loop() {
  // Generate random sensor values within realistic ranges
  float ph = random(40, 70) / 10.0;           // pH range: 4.0-7.0
  float temperature = random(345, 380) / 10.0; // Temperature range: 34.5-38.0°C
  int moisture = random(60, 90);              // Moisture/humidity range: 60-90%
  
  // Output the readings in the format expected by WoundGuard
  Serial.print("pH Sensor Value (Potentiometer 1): ");
  Serial.println(ph, 1); // Display with 1 decimal place
  
  Serial.print("Temperature (Simulated by Potentiometer 2): ");
  Serial.print(temperature, 1);
  Serial.println("°C");
  
  Serial.print("Moisture Sensor Value (Photoresistor): ");
  Serial.print(moisture);
  Serial.println("%");
  
  Serial.println("----------------------------");
  
  // Wait for a random period (5-10 seconds) before sending next readings
  delay(random(5000, 10000));
}
