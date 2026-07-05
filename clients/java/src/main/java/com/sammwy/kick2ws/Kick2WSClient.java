package com.sammwy.kick2ws;

import com.google.gson.FieldNamingPolicy;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sammwy.kick2ws.events.ChatMessage;
import com.sammwy.kick2ws.events.Follow;
import com.sammwy.kick2ws.events.Gift;
import com.sammwy.kick2ws.events.KicksGifted;
import com.sammwy.kick2ws.events.LivestreamMetadata;
import com.sammwy.kick2ws.events.LivestreamStatus;
import com.sammwy.kick2ws.events.ModerationBanned;
import com.sammwy.kick2ws.events.RewardRedemption;
import com.sammwy.kick2ws.events.Subscription;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Typed WebSocket client for a Kick2WS server.
 *
 * <pre>{@code
 * var client = new Kick2WSClient("wss://host", "k2ws_...");
 * client.channelFollowed.listen(ev -> System.out.println(ev.data().follower().username()));
 * client.connect();
 * }</pre>
 */
public final class Kick2WSClient {
    public final EventEmitter<ChatMessage> chatMessageSent = new EventEmitter<>(ChatMessage.class);
    public final EventEmitter<Follow> channelFollowed = new EventEmitter<>(Follow.class);
    public final EventEmitter<Subscription> channelSubscriptionNew = new EventEmitter<>(Subscription.class);
    public final EventEmitter<Subscription> channelSubscriptionRenewal = new EventEmitter<>(Subscription.class);
    public final EventEmitter<Gift> channelSubscriptionGifts = new EventEmitter<>(Gift.class);
    public final EventEmitter<RewardRedemption> channelRewardRedemptionUpdated =
            new EventEmitter<>(RewardRedemption.class);
    public final EventEmitter<LivestreamStatus> livestreamStatusUpdated = new EventEmitter<>(LivestreamStatus.class);
    public final EventEmitter<LivestreamMetadata> livestreamMetadataUpdated =
            new EventEmitter<>(LivestreamMetadata.class);
    public final EventEmitter<ModerationBanned> moderationBanned = new EventEmitter<>(ModerationBanned.class);
    public final EventEmitter<KicksGifted> kicksGifted = new EventEmitter<>(KicksGifted.class);

    /** Fires for every event; payload stays as raw JSON. */
    public final EventEmitter<JsonObject> any = new EventEmitter<>(JsonObject.class);

    private final URI uri;
    private final String httpBase;
    private final String token;
    private final Gson gson =
            new GsonBuilder().setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES).create();
    private final Map<String, EventEmitter<?>> byType = new ConcurrentHashMap<>();
    // Pinned to HTTP/1.1: Node's http server doesn't speak h2c, and the default
    // client's HTTP/2 upgrade attempt just gets the connection dropped.
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "kick2ws-reconnect");
        t.setDaemon(true);
        return t;
    });

    private Consumer<Welcome> onWelcome = w -> {};
    private Consumer<Throwable> onError = e -> {};
    private volatile boolean running;
    private volatile boolean autoReconnect = true;
    private volatile WebSocket socket;
    private int reconnectAttempts;

    public Kick2WSClient(String endpoint, String token) {
        this.uri = buildUri(endpoint, token);
        this.httpBase = buildHttpBase(endpoint);
        this.token = token;
        byType.put("chat.message.sent", chatMessageSent);
        byType.put("channel.followed", channelFollowed);
        byType.put("channel.subscription.new", channelSubscriptionNew);
        byType.put("channel.subscription.renewal", channelSubscriptionRenewal);
        byType.put("channel.subscription.gifts", channelSubscriptionGifts);
        byType.put("channel.reward.redemption.updated", channelRewardRedemptionUpdated);
        byType.put("livestream.status.updated", livestreamStatusUpdated);
        byType.put("livestream.metadata.updated", livestreamMetadataUpdated);
        byType.put("moderation.banned", moderationBanned);
        byType.put("kicks.gifted", kicksGifted);
    }

    private static URI buildUri(String endpoint, String token) {
        String base = endpoint.replaceFirst("^http", "ws").replaceAll("/+$", "");
        if (!base.endsWith("/ws")) {
            base += "/ws";
        }
        return URI.create(base + "?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8));
    }

    private static String buildHttpBase(String endpoint) {
        String base = endpoint.replaceFirst("^ws", "http").replaceAll("/+$", "");
        if (base.endsWith("/ws")) {
            base = base.substring(0, base.length() - 3);
        }
        return base;
    }

    /**
     * Synchronously calls the server to verify the token and return the identity
     * it is authenticated as. Useful to validate credentials/connectivity before
     * (or independently of) opening the WebSocket connection.
     *
     * @throws IOException if the request fails or the token is rejected.
     */
    public Me getMe() throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(httpBase + "/api/whoami"))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IOException("getMe failed: HTTP " + response.statusCode() + " " + response.body());
        }
        JsonObject body = JsonParser.parseString(response.body()).getAsJsonObject();
        return new Me(str(body, "id"), str(body, "channel_id"), str(body, "username"));
    }

    public Kick2WSClient onWelcome(Consumer<Welcome> handler) {
        this.onWelcome = handler;
        return this;
    }

    public Kick2WSClient onError(Consumer<Throwable> handler) {
        this.onError = handler;
        return this;
    }

    public Kick2WSClient autoReconnect(boolean enabled) {
        this.autoReconnect = enabled;
        return this;
    }

    /** Opens the connection. Non-blocking; listeners fire on the WebSocket thread. */
    public void connect() {
        running = true;
        open();
    }

    /** Closes the connection and stops reconnecting. */
    public void close() {
        running = false;
        WebSocket ws = socket;
        if (ws != null) {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye");
        }
        scheduler.shutdownNow();
    }

    private void open() {
        http.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .buildAsync(uri, new Handler())
                .whenComplete((ws, err) -> {
                    if (err != null) {
                        onError.accept(err);
                        scheduleReconnect();
                    } else {
                        socket = ws;
                        reconnectAttempts = 0;
                    }
                });
    }

    private void scheduleReconnect() {
        if (!running || !autoReconnect) {
            return;
        }
        long delay = Math.min(30, (long) Math.pow(2, Math.min(reconnectAttempts++, 5)));
        scheduler.schedule(this::open, delay, TimeUnit.SECONDS);
    }

    private void dispatch(String text) {
        JsonObject msg = JsonParser.parseString(text).getAsJsonObject();
        String kind = str(msg, "kind");
        if ("welcome".equals(kind)) {
            onWelcome.accept(gson.fromJson(msg, Welcome.class));
            return;
        }
        if (!"event".equals(kind)) {
            return;
        }
        String type = str(msg, "type");
        int version = msg.has("version") ? msg.get("version").getAsInt() : 1;
        String id = str(msg, "id");
        String timestamp = str(msg, "timestamp");
        JsonObject data =
                msg.has("data") && msg.get("data").isJsonObject() ? msg.getAsJsonObject("data") : new JsonObject();

        EventEmitter<?> emitter = byType.get(type);
        if (emitter != null) {
            emitter.emit(type, version, id, timestamp, data, gson);
        }
        any.emit(type, version, id, timestamp, data, gson);
    }

    private static String str(JsonObject obj, String key) {
        return obj.has(key) && !obj.get(key).isJsonNull() ? obj.get(key).getAsString() : null;
    }

    private final class Handler implements WebSocket.Listener {
        private final StringBuilder buffer = new StringBuilder();

        @Override
        public void onOpen(WebSocket ws) {
            ws.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                String message = buffer.toString();
                buffer.setLength(0);
                try {
                    dispatch(message);
                } catch (RuntimeException e) {
                    onError.accept(e);
                }
            }
            ws.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
            scheduleReconnect();
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable error) {
            onError.accept(error);
            scheduleReconnect();
        }
    }
}
