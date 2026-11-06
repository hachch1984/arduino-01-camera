// Included by app_httpd.cpp after the stock recognizer declaration.
#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <map>
#include "cJSON.h"
#include "freertos/semphr.h"
#include "rostros_assets.h"

namespace custompage {
static SemaphoreHandle_t mutex = nullptr;
static bool storage = false;
static std::map<int, String> names;
static String pendingName, notice = "Listo. Inicia el video para reconocer rostros.";
static String lastName;
static int64_t deadline = 0, lastSeen = 0;
static uint32_t revision = 0;
static bool failed = false;

class Lock {
    bool acquired;
public:
    Lock() : acquired(mutex && xSemaphoreTake(mutex, pdMS_TO_TICKS(2000)) == pdTRUE) {}
    ~Lock() { if (acquired) xSemaphoreGive(mutex); }
    explicit operator bool() const { return acquired; }
};
static String filePath(int id, const char *ext) { return "/face-" + String(id) + ext; }
static void notify(const String &text, bool error = false) {
    notice = text; failed = error; ++revision;
}
static void expire() {
    if (is_enrolling && esp_timer_get_time() >= deadline) {
        is_enrolling = 0; pendingName = "";
        notify("Registro cancelado: no se capturo un solo rostro en 30 segundos.", true);
    }
}
static bool exists(int id) {
    for (const auto &face : recognizer.get_enrolled_ids()) if (face.id == id) return true;
    return false;
}
static String displayName(int id) {
    auto found = names.find(id);
    return found != names.end() ? found->second : "Persona #" + String(id);
}
static void begin() {
    mutex = xSemaphoreCreateMutex();
    storage = LittleFS.begin(false, "/faces", 5, "faces");
    if (!storage) {
        // Only initialize a completely erased, new partition. Never auto-format
        // an existing filesystem on a mount error.
        const esp_partition_t *part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "faces");
        bool blank = part != nullptr;
        uint8_t block[256];
        for (size_t offset = 0; blank && offset < part->size; offset += sizeof(block)) {
            if (esp_partition_read(part, offset, block, sizeof(block)) != ESP_OK) { blank = false; break; }
            for (uint8_t byte : block) if (byte != 0xff) { blank = false; break; }
        }
        if (blank && LittleFS.format()) storage = LittleFS.begin(false, "/faces", 5, "faces");
    }
    if (storage) for (const auto &face : recognizer.get_enrolled_ids()) {
        File file = LittleFS.open(filePath(face.id, ".txt"), "r");
        if (file && file.size() > 0 && file.size() <= 64) names[face.id] = file.readString();
    }
    if (!storage || !mutex) notify("No se pudo iniciar el almacenamiento de rostros.", true);
    log_i("Custom page storage: %s; http://IP/rostros", storage ? "OK" : "unavailable");
}
static bool writeFile(const String &path, const uint8_t *data, size_t size) {
    File file = LittleFS.open(path, "w");
    if (!file) return false;
    bool ok = file.write(data, size) == size;
    file.flush(); file.close();
    return ok;
}
static bool validName(const String &name) {
    if (name.length() == 0 || name.length() > 64) return false;
    for (size_t i = 0; i < name.length(); ++i) if ((uint8_t)name[i] < 32 || (uint8_t)name[i] == 127) return false;
    return true;
}
// Caller holds mutex. A request arms exactly one enrollment, not one per frame.
static bool arm(String name) {
    name.trim(); expire();
    if (!storage) { notify("Almacenamiento no disponible.", true); return false; }
    if (!validName(name)) { notify("Escribe un nombre de 1 a 64 bytes sin caracteres de control.", true); return false; }
    if (is_enrolling) { notify("Ya hay un registro pendiente.", true); return false; }
    if (recognizer.get_enrolled_id_num() >= FACE_ID_SAVE_NUMBER) { notify("No quedan espacios. Elimina un registro primero.", true); return false; }
    pendingName = name; deadline = esp_timer_get_time() + 30000000;
    detection_enabled = 1; recognition_enabled = 1; is_enrolling = 1;
    notify("Mira a la camara: esperando un solo rostro…");
    return true;
}
static void cancel() {
    is_enrolling = 0; pendingName = ""; notify("Registro cancelado.");
}
// Crop the unannotated BGR888 frame used by the recognizer, bounded to the image.
static bool portrait(fb_data_t *fb, const dl::detect::result_t &face, uint8_t **jpg, size_t *length) {
    int left = std::max(0, (int)face.box[0] - 12), top = std::max(0, (int)face.box[1] - 12);
    int right = std::min((int)fb->width, (int)face.box[2] + 13);
    int bottom = std::min((int)fb->height, (int)face.box[3] + 13);
    int width = right - left, height = bottom - top;
    if (width <= 0 || height <= 0 || fb->bytes_per_pixel != 3) return false;
    size_t size = (size_t)width * height * 3;
    uint8_t *crop = (uint8_t *)malloc(size);
    if (!crop) return false;
    for (int y = 0; y < height; ++y)
        memcpy(crop + y * width * 3, fb->data + ((top + y) * fb->width + left) * 3, width * 3);
    bool ok = fmt2jpg(crop, size, width, height, PIXFORMAT_RGB888, 80, jpg, length);
    free(crop); return ok;
}
static void enroll(fb_data_t *fb, std::list<dl::detect::result_t> *results, Tensor<uint8_t> &tensor) {
    expire();
    if (!is_enrolling || results->size() != 1) return;
    is_enrolling = 0; // Consume once, including on failure.
    String name = pendingName; pendingName = "";
    uint8_t *jpg = nullptr; size_t size = 0;
    if (!portrait(fb, results->front(), &jpg, &size)) { free(jpg); notify("No se pudo capturar la foto. Intenta otra vez.", true); return; }
    auto landmarks = results->front().keypoint;
    face_info_t known = recognizer.recognize(tensor, landmarks);
    if (known.id >= 0) {
        free(jpg); notify("Este rostro ya coincide con " + displayName(known.id) + ". No se creo un duplicado.", true); return;
    }
    auto previous = recognizer.get_enrolled_ids();
    int id = recognizer.enroll_id(tensor, landmarks, name.c_str(), false);
    if (id < 0) { free(jpg); notify("El reconocedor no pudo registrar este rostro.", true); return; }
    for (const auto &face : previous) if (face.id == id) {
        free(jpg); recognizer.set_ids_from_flash();
        notify("El reconocedor devolvio un identificador existente. No se reemplazo su foto.", true); return;
    }
    String photo = filePath(id, ".jpg"), text = filePath(id, ".txt");
    bool ok = writeFile(photo + ".tmp", jpg, size) &&
              writeFile(text + ".tmp", (const uint8_t *)name.c_str(), name.length());
    free(jpg);
    if (ok) {
        // Any stale files belong to an uncommitted enrollment with this ID.
        LittleFS.remove(photo); LittleFS.remove(text);
        ok = LittleFS.rename(photo + ".tmp", photo) && LittleFS.rename(text + ".tmp", text);
    }
    if (ok) ok = recognizer.write_ids_to_flash() == recognizer.get_enrolled_id_num();
    if (!ok) {
        recognizer.delete_id(id, false);
        LittleFS.remove(photo); LittleFS.remove(text);
        LittleFS.remove(photo + ".tmp"); LittleFS.remove(text + ".tmp");
        notify("No se pudo guardar el registro completo. Vuelve a intentarlo.", true); return;
    }
    names[id] = name; notify("Registrado: " + name);
}
static esp_err_t json(httpd_req_t *req, cJSON *value, const char *status = "200 OK") {
    if (!value) return httpd_resp_send_500(req);
    char *body = cJSON_PrintUnformatted(value); cJSON_Delete(value);
    if (!body) return httpd_resp_send_500(req);
    httpd_resp_set_status(req, status); httpd_resp_set_type(req, "application/json; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t result = httpd_resp_send(req, body, strlen(body)); free(body); return result;
}
static esp_err_t error(httpd_req_t *req, const char *message, const char *status = "400 Bad Request") {
    cJSON *body = cJSON_CreateObject(); cJSON_AddStringToObject(body, "error", message); return json(req, body, status);
}
static esp_err_t ok(httpd_req_t *req) {
    cJSON *body = cJSON_CreateObject(); cJSON_AddBoolToObject(body, "ok", true); return json(req, body);
}
static cJSON *readBody(httpd_req_t *req) {
    if (req->content_len == 0 || req->content_len > 256) return nullptr;
    char body[257]; size_t total = 0;
    while (total < req->content_len) {
        int count = httpd_req_recv(req, body + total, req->content_len - total);
        if (count <= 0) return nullptr;
        total += count;
    }
    body[total] = 0; return cJSON_Parse(body);
}
static esp_err_t list(httpd_req_t *req) {
    Lock lock; if (!lock) return error(req, "Reconocedor ocupado. Intenta otra vez.", "503 Service Unavailable");
    expire(); cJSON *body = cJSON_CreateObject();
    cJSON_AddBoolToObject(body, "storage", storage); cJSON_AddBoolToObject(body, "pending", is_enrolling);
    cJSON_AddBoolToObject(body, "failed", failed); cJSON_AddNumberToObject(body, "revision", revision);
    cJSON_AddNumberToObject(body, "limit", FACE_ID_SAVE_NUMBER); cJSON_AddStringToObject(body, "message", notice.c_str());
    cJSON_AddStringToObject(body, "lastName", esp_timer_get_time() - lastSeen < 2500000 ? lastName.c_str() : "");
    cJSON *people = cJSON_AddArrayToObject(body, "people");
    for (const auto &face : recognizer.get_enrolled_ids()) {
        cJSON *person = cJSON_CreateObject(); cJSON_AddNumberToObject(person, "id", face.id);
        cJSON_AddStringToObject(person, "name", displayName(face.id).c_str());
        cJSON_AddBoolToObject(person, "photo", storage && LittleFS.exists(filePath(face.id, ".jpg")));
        cJSON_AddItemToArray(people, person);
    }
    return json(req, body);
}
static esp_err_t registerFace(httpd_req_t *req) {
    cJSON *body = readBody(req); cJSON *value = cJSON_GetObjectItemCaseSensitive(body, "name");
    String name = cJSON_IsString(value) ? value->valuestring : ""; cJSON_Delete(body);
    Lock lock; if (!lock) return error(req, "Reconocedor ocupado.", "503 Service Unavailable");
    if (!arm(name)) return error(req, notice.c_str(), "409 Conflict");
    return ok(req);
}
static esp_err_t cancelFace(httpd_req_t *req) {
    Lock lock; if (!lock) return error(req, "Reconocedor ocupado.", "503 Service Unavailable");
    cancel(); return ok(req);
}
static esp_err_t start(httpd_req_t *req) {
    Lock lock; if (!lock) return error(req, "Reconocedor ocupado.", "503 Service Unavailable");
    // This size is supported by the stock facial pipeline (width <= 400).
    sensor_t *sensor = esp_camera_sensor_get();
    if (!sensor || sensor->status.framesize > FRAMESIZE_CIF)
        return error(req, "Selecciona 240x240 o QVGA en los ajustes de la camara antes de iniciar.");
    detection_enabled = 1; recognition_enabled = 1; return ok(req);
}
static esp_err_t removeFace(httpd_req_t *req) {
    cJSON *body = readBody(req); cJSON *value = cJSON_GetObjectItemCaseSensitive(body, "id");
    bool valid = cJSON_IsNumber(value) && value->valuedouble >= 0 && value->valuedouble <= INT_MAX && value->valuedouble == value->valueint;
    int id = valid ? value->valueint : -1; cJSON_Delete(body);
    if (!valid) return error(req, "Identificador invalido.");
    Lock lock; if (!lock) return error(req, "Reconocedor ocupado.", "503 Service Unavailable");
    expire(); if (is_enrolling) return error(req, "Cancela el registro pendiente antes de eliminar.", "409 Conflict");
    if (!exists(id)) return error(req, "El registro ya no existe.", "404 Not Found");
    String name = displayName(id);
    if (recognizer.delete_id(id, false) < 0) return error(req, "No se pudo eliminar.", "500 Internal Server Error");
    if (recognizer.write_ids_to_flash() != recognizer.get_enrolled_id_num()) {
        recognizer.set_ids_from_flash(); return error(req, "No se pudo guardar la eliminacion.", "500 Internal Server Error");
    }
    if (storage) { LittleFS.remove(filePath(id, ".jpg")); LittleFS.remove(filePath(id, ".txt")); }
    names.erase(id); lastName = ""; lastSeen = 0; notify("Eliminado: " + name); return ok(req);
}
static esp_err_t photo(httpd_req_t *req) {
    char query[160], text[16];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK || httpd_query_key_value(query, "id", text, sizeof(text)) != ESP_OK)
        return error(req, "Falta el identificador.");
    char *end; long parsed = strtol(text, &end, 10);
    if (end == text || *end || parsed < 0 || parsed > INT_MAX) return error(req, "Identificador invalido.");
    Lock lock; if (!lock) return error(req, "Reconocedor ocupado.", "503 Service Unavailable");
    if (!storage || !exists(parsed)) return error(req, "Foto no disponible.", "404 Not Found");
    File file = LittleFS.open(filePath(parsed, ".jpg"), "r");
    if (!file) return error(req, "Registro anterior sin foto.", "404 Not Found");
    httpd_resp_set_type(req, "image/jpeg"); httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    uint8_t buffer[1024];
    while (file.available()) {
        size_t count = file.read(buffer, sizeof(buffer));
        if (!count || httpd_resp_send_chunk(req, (const char *)buffer, count) != ESP_OK) return ESP_FAIL;
    }
    return httpd_resp_send_chunk(req, nullptr, 0);
}
static esp_err_t asset(httpd_req_t *req, const uint8_t *data, size_t size, const char *type) {
    httpd_resp_set_type(req, type); httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache"); return httpd_resp_send(req, (const char *)data, size);
}
static void routes(httpd_handle_t server) {
    const httpd_uri_t routes[] = {
        {.uri="/rostros", .method=HTTP_GET, .handler=[](httpd_req_t *r){return asset(r, rostros_html_gz, sizeof(rostros_html_gz), "text/html; charset=utf-8");}, .user_ctx=nullptr},
        {.uri="/rostros/app.js", .method=HTTP_GET, .handler=[](httpd_req_t *r){return asset(r, rostros_js_gz, sizeof(rostros_js_gz), "application/javascript; charset=utf-8");}, .user_ctx=nullptr},
        {.uri="/rostros/rostros.css", .method=HTTP_GET, .handler=[](httpd_req_t *r){return asset(r, rostros_css_gz, sizeof(rostros_css_gz), "text/css; charset=utf-8");}, .user_ctx=nullptr},
        {.uri="/rostros/bootstrap.min.css", .method=HTTP_GET, .handler=[](httpd_req_t *r){return asset(r, bootstrap_css_gz, sizeof(bootstrap_css_gz), "text/css; charset=utf-8");}, .user_ctx=nullptr},
        {.uri="/rostros/sweetalert2.min.js", .method=HTTP_GET, .handler=[](httpd_req_t *r){return asset(r, sweetalert_js_gz, sizeof(sweetalert_js_gz), "application/javascript; charset=utf-8");}, .user_ctx=nullptr},
        {.uri="/rostros/sweetalert2.min.css", .method=HTTP_GET, .handler=[](httpd_req_t *r){return asset(r, sweetalert_css_gz, sizeof(sweetalert_css_gz), "text/css; charset=utf-8");}, .user_ctx=nullptr},
        {.uri="/api/rostros", .method=HTTP_GET, .handler=list, .user_ctx=nullptr},
        {.uri="/api/rostros/foto", .method=HTTP_GET, .handler=photo, .user_ctx=nullptr},
        {.uri="/api/rostros/registrar", .method=HTTP_POST, .handler=registerFace, .user_ctx=nullptr},
        {.uri="/api/rostros/eliminar", .method=HTTP_POST, .handler=removeFace, .user_ctx=nullptr},
        {.uri="/api/rostros/cancelar", .method=HTTP_POST, .handler=cancelFace, .user_ctx=nullptr},
        {.uri="/api/rostros/iniciar", .method=HTTP_POST, .handler=start, .user_ctx=nullptr},
    };
    for (const auto &route : routes) ESP_ERROR_CHECK(httpd_register_uri_handler(server, &route));
}
} // namespace custompage
