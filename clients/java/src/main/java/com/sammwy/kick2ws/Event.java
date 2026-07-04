package com.sammwy.kick2ws;

import com.google.gson.JsonObject;

/** A typed event. {@code data()} is the deserialized payload; {@code raw()} is the untouched JSON. */
public final class Event<T> {
    private final String type;
    private final int version;
    private final String id;
    private final String timestamp;
    private final T data;
    private final JsonObject raw;

    Event(String type, int version, String id, String timestamp, T data, JsonObject raw) {
        this.type = type;
        this.version = version;
        this.id = id;
        this.timestamp = timestamp;
        this.data = data;
        this.raw = raw;
    }

    public String type() {
        return type;
    }

    public int version() {
        return version;
    }

    public String id() {
        return id;
    }

    public String timestamp() {
        return timestamp;
    }

    public T data() {
        return data;
    }

    public JsonObject raw() {
        return raw;
    }
}
