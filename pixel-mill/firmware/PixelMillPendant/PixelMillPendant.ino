#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP_I2S.h>

#define SERVICE_UUID "7e5a0001-6c1d-4b5e-9a3b-2f1c0d9e8a70"
#define STATE_UUID   "7e5a0002-6c1d-4b5e-9a3b-2f1c0d9e8a70"

// X and Y are DFRobot EC11 encoder modules (A/B quadrature, powered from 3V3).
// Each encoder drives a virtual 0..4095 position so the BLE packet matches the pot version.
const int ENC_A[2] = {D0, D5};  // X, Y channel A
const int ENC_B[2] = {D1, D6};  // X, Y channel B
const int PIN_Z = A2;
// bit0 = X encoder push (prev tool), bit1 = Y encoder push (next tool), bit2 = export STL,
// bit3 = rotate view left, bit4 = rotate view right
const int BUTTON_PINS[] = {D3, D4, D7, D9, D8};
// Encoder module C outputs: flip to false if `btn` reads pressed while the knob is released.
const bool BUTTON_ACTIVE_LOW[] = {true, true, true, true, true};
const int NUM_BUTTONS = sizeof(BUTTON_PINS) / sizeof(BUTTON_PINS[0]);

const bool INVERT_X = false;  // clockwise should move the tool right
const bool INVERT_Y = true;   // clockwise should move the tool away from you
const bool INVERT_Z = false;  // slider pushed UP should read ~0

const int ENC_TICKS_PER_DETENT = 4;   // most EC11s do one full quadrature cycle per click
const int ENC_UNITS_PER_DETENT = 100; // ~41 clicks end to end (about two turns of a 20-detent EC11)
const uint16_t ENC_START = 2048;      // start centred over the stock

// XIAO ESP32-S3 Sense PDM mic (on the Sense board, not a D pin). Blowing sets bit5 (blow off chips).
const int MIC_CLK = 42;
const int MIC_DATA = 41;
const int MIC_BLOCK = 160;         // samples per read: 10 ms at 16 kHz
const uint16_t BLOW_RMS = 3000;    // tune from the `mic` column in the serial monitor
const int BLOW_BLOCKS = 12;        // ~120 ms of sustained loudness counts as a blow
const int QUIET_BLOCKS = 10;       // ~100 ms below BLOW_RMS/4 ends it (blows dip mid-breath)
const uint8_t BLOW_BIT = 1 << 5;

const int DEADBAND = 6;
const uint32_t SEND_MS = 20;
const uint32_t HEARTBEAT_MS = 500;
const uint32_t DEBOUNCE_MS = 25;

BLECharacteristic *stateChar = nullptr;
bool clientConnected = false;
float smoothZ = 0;
uint16_t pos[2] = {ENC_START, ENC_START};
uint16_t sent[3] = {0xFFFF, 0xFFFF, 0xFFFF};
uint8_t sentButtons = 0xFF;
uint8_t buttons = 0;
uint32_t buttonChangedAt[6] = {0};
uint8_t seq = 0;
uint32_t lastSend = 0;

I2SClass mic;
bool micOk = false;
float micDc = 0;
uint16_t micRms = 0;
int loudBlocks = 0;
int quietBlocks = 0;

// Quadrature decoding: index = (previous AB << 2) | current AB.
const int8_t QDEC[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
volatile int32_t encTicks[2] = {0, 0};
volatile uint8_t encState[2] = {0, 0};
portMUX_TYPE encMux = portMUX_INITIALIZER_UNLOCKED;

void IRAM_ATTR encUpdate(int i) {
  uint8_t ab = (digitalRead(ENC_A[i]) << 1) | digitalRead(ENC_B[i]);
  portENTER_CRITICAL_ISR(&encMux);
  encTicks[i] += QDEC[(encState[i] << 2) | ab];
  encState[i] = ab;
  portEXIT_CRITICAL_ISR(&encMux);
}
void IRAM_ATTR isrX() { encUpdate(0); }
void IRAM_ATTR isrY() { encUpdate(1); }

// Move each virtual position by whole detents, clamped so reversing responds immediately at the ends.
void updateEncoders() {
  const bool inv[2] = {INVERT_X, INVERT_Y};
  for (int i = 0; i < 2; i++) {
    portENTER_CRITICAL(&encMux);
    int32_t detents = encTicks[i] / ENC_TICKS_PER_DETENT;
    encTicks[i] -= detents * ENC_TICKS_PER_DETENT;
    portEXIT_CRITICAL(&encMux);
    if (detents == 0) continue;
    int32_t p = pos[i] + (inv[i] ? -detents : detents) * ENC_UNITS_PER_DETENT;
    pos[i] = p < 0 ? 0 : p > 4095 ? 4095 : p;
  }
}

// RMS loudness per block; a blow latches after BLOW_BLOCKS loud blocks and releases once it quietens.
void readMic() {
  if (!micOk) return;
  int16_t buf[MIC_BLOCK];
  size_t n = mic.readBytes((char *)buf, sizeof(buf)) / sizeof(int16_t);
  if (n == 0) return;
  float acc = 0;
  for (size_t i = 0; i < n; i++) {
    micDc += (buf[i] - micDc) * 0.01f;
    float s = buf[i] - micDc;
    acc += s * s;
  }
  micRms = (uint16_t)min(65535.0f, sqrtf(acc / n));
  bool blowing = buttons & BLOW_BIT;
  if (blowing) {
    quietBlocks = micRms < BLOW_RMS / 4 ? quietBlocks + 1 : 0;
    if (quietBlocks >= QUIET_BLOCKS) { buttons &= ~BLOW_BIT; loudBlocks = 0; quietBlocks = 0; }
  } else {
    loudBlocks = micRms > BLOW_RMS ? loudBlocks + 1 : 0;
    if (loudBlocks >= BLOW_BLOCKS) buttons |= BLOW_BIT;
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { clientConnected = true; }
  void onDisconnect(BLEServer *) override {
    clientConnected = false;
    BLEDevice::startAdvertising();
  }
};

uint16_t readAxis(int pin, bool invert) {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(pin);
  uint16_t v = sum / 16;
  return invert ? 4095 - v : v;
}

void readButtons() {
  uint32_t now = millis();
  for (int i = 0; i < NUM_BUTTONS; i++) {
    bool pressed = (digitalRead(BUTTON_PINS[i]) == LOW) == BUTTON_ACTIVE_LOW[i];
    bool was = buttons & (1 << i);
    if (pressed != was && now - buttonChangedAt[i] > DEBOUNCE_MS) {
      buttonChangedAt[i] = now;
      if (pressed) buttons |= (1 << i); else buttons &= ~(1 << i);
    }
  }
}

void setup() {
  Serial.begin(115200);
  // Never block on USB serial: with no monitor open, prints would otherwise stall the loop ~1 s.
  Serial.setTxTimeoutMs(0);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  for (int i = 0; i < NUM_BUTTONS; i++) pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  for (int i = 0; i < 2; i++) {
    pinMode(ENC_A[i], INPUT_PULLUP);
    pinMode(ENC_B[i], INPUT_PULLUP);
    encState[i] = (digitalRead(ENC_A[i]) << 1) | digitalRead(ENC_B[i]);
  }
  attachInterrupt(digitalPinToInterrupt(ENC_A[0]), isrX, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_B[0]), isrX, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_A[1]), isrY, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_B[1]), isrY, CHANGE);
  smoothZ = readAxis(PIN_Z, INVERT_Z);

  mic.setPinsPdmRx(MIC_CLK, MIC_DATA);
  micOk = mic.begin(I2S_MODE_PDM_RX, 16000, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  if (!micOk) Serial.println("Mic not found (is the Sense board attached?)");

  BLEDevice::init("PixelMill Pendant");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);
  stateChar = service->createCharacteristic(
      STATE_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  stateChar->addDescriptor(new BLE2902());
  service->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("Advertising as 'PixelMill Pendant'");
}

uint32_t loops = 0, loopWindowStart = 0, loopHz = 0;

void loop() {
  loops++;
  if (millis() - loopWindowStart >= 1000) { loopHz = loops; loops = 0; loopWindowStart = millis(); }
  readButtons();
  readMic();
  updateEncoders();
  smoothZ += (readAxis(PIN_Z, INVERT_Z) - smoothZ) * 0.25f;

  uint32_t now = millis();
  if (now - lastSend < SEND_MS) return;
  bool changed = buttons != sentButtons || pos[0] != sent[0] || pos[1] != sent[1];
  if (abs((int)smoothZ - (int)sent[2]) > DEADBAND) changed = true;
  if (!changed && now - lastSend < HEARTBEAT_MS) return;

  sent[0] = pos[0];
  sent[1] = pos[1];
  sent[2] = (uint16_t)smoothZ;
  sentButtons = buttons;
  lastSend = now;

  uint8_t pkt[8];
  for (int i = 0; i < 3; i++) { pkt[i * 2] = sent[i] & 0xFF; pkt[i * 2 + 1] = sent[i] >> 8; }
  pkt[6] = buttons;
  pkt[7] = seq++;
  if (clientConnected) { stateChar->setValue(pkt, sizeof(pkt)); stateChar->notify(); }
  Serial.printf("X %4u  Y %4u  Z %4u  btn %02X  mic %5u  hz %4lu\n", sent[0], sent[1], sent[2], buttons, micRms, loopHz);
}
