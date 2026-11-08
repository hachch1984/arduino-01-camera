#include <Arduino.h>
#include "custompage/pir_motion.h"

namespace pir {
static portMUX_TYPE mutex = portMUX_INITIALIZER_UNLOCKED;
static uint32_t started = 0, lastMotion = 0, sequence = 0, boot = 0;
static uint32_t lastStatus = 0;
static bool ready = false, active = false, seen = false;

void begin() {
    pinMode(GPIO, INPUT_PULLDOWN);
    started = millis(); boot = esp_random();
    Serial.printf("PIR GPIO%u: estabilizando durante 60 s; espera sin movimiento: 60 s.\n", GPIO);
}

void update() {
    const uint32_t now = millis();
    const bool high = digitalRead(GPIO) == HIGH;
    bool becameReady = false, changed = false, printStatus = false;
    uint32_t detection = 0;
    portENTER_CRITICAL(&mutex);
    if (!ready && uint32_t(now - started) >= WARMUP_MS) {
        ready = true; becameReady = true;
    }
    if (ready) {
        changed = high != active;
        if (high) {
            if (!active) ++sequence;
            lastMotion = now; seen = true;
        }
        active = high;
        detection = sequence;
        // Diagnóstico limitado a una línea cada 5 s, además de las transiciones inmediatas.
        printStatus = becameReady || changed || uint32_t(now - lastStatus) >= 5000;
        if (printStatus) lastStatus = now;
    }
    portEXIT_CRITICAL(&mutex);
    // No imprimir ni ejecutar reconocimiento dentro de la sección crítica.
    if (becameReady) Serial.println("PIR listo. Activa Usar PIR en la pagina web.");
    if (changed) {
        Serial.printf("[PIR GPIO%u][%lu ms] %s | OUT=%s | deteccion=%lu\n", GPIO,
            (unsigned long)now, high ? "MOVIMIENTO DETECTADO" : "SIN MOVIMIENTO: inicia espera de 60 s",
            high ? "HIGH" : "LOW", (unsigned long)detection);
    } else if (printStatus) {
        Serial.printf("[PIR GPIO%u][%lu ms] Estado actual: OUT=%s (%s) | detecciones=%lu\n", GPIO,
            (unsigned long)now, high ? "HIGH" : "LOW", high ? "movimiento activo" : "sin movimiento",
            (unsigned long)detection);
    }
}

Snapshot snapshot() {
    portENTER_CRITICAL(&mutex);
    const uint32_t now = millis();
    Snapshot data = {ready, active, false, 0, 0, sequence, boot};
    const uint32_t age = now - lastMotion;
    if (!ready) data.warmupMs = uint32_t(now - started) < WARMUP_MS ? WARMUP_MS - uint32_t(now - started) : 0;
    if (ready && seen && age < IDLE_MS) data.remainingMs = IDLE_MS - age;
    data.cameraAllowed = data.remainingMs > 0;
    portEXIT_CRITICAL(&mutex);
    return data;
}
}
