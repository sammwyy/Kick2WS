package com.sammwy.kick2ws;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** Registers typed listeners for one event type and deserializes its payload. */
public final class EventEmitter<T> {
    private final Class<T> payloadType;
    private final List<Consumer<Event<T>>> listeners = new CopyOnWriteArrayList<>();

    EventEmitter(Class<T> payloadType) {
        this.payloadType = payloadType;
    }

    public void listen(Consumer<Event<T>> listener) {
        listeners.add(listener);
    }

    void emit(String type, int version, String id, String timestamp, JsonObject data, Gson gson) {
        if (listeners.isEmpty()) {
            return;
        }
        T payload = gson.fromJson(data, payloadType);
        Event<T> event = new Event<>(type, version, id, timestamp, payload, data);
        for (Consumer<Event<T>> listener : listeners) {
            listener.accept(event);
        }
    }
}
