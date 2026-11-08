#pragma once
#include <stdint.h>

namespace pir {
constexpr uint8_t GPIO = 21; // GPIO12 está ocupado por D4 de la cámara.
constexpr uint32_t WARMUP_MS = 60000;
constexpr uint32_t IDLE_MS = 60000;
struct Snapshot {
    bool ready, active, cameraAllowed;
    uint32_t warmupMs, remainingMs, sequence, boot;
};
// Configura OUT como entrada con pulldown y comienza la estabilización del PIR.
void begin();
// Muestrea sin bloquear. loop() lo llama cada 100 ms, separado del stream y la IA.
void update();
// Copia el estado entre núcleos y calcula la ventana de actividad sin modificar el sensor.
Snapshot snapshot();
}
