# Kick2WS Java Client

Typed Java client for a [Kick2WS](../../README.md) server. Connect with a token
and receive your channel's Kick events as deserialized Java objects over a single
WebSocket.

- Java 17+, one dependency (Gson).
- Auto-reconnect with backoff.
- One strongly-typed emitter per Kick event.

## Install

This is a Gradle project. Build the jar or include the sources in your project:

```bash
./gradlew build      # produces build/libs/kick2ws-client-0.1.0.jar
```

If you publish it to a local/remote Maven repo, depend on it as
`com.sammwy.kick2ws:kick2ws-client:0.1.0`.

## Usage

```java
import com.sammwy.kick2ws.Kick2WSClient;

var client = new Kick2WSClient("wss://kick2ws.example.com", "k2ws_yourtoken");

client.onWelcome(w -> System.out.println("connected to channel " + w.channelId()));

client.channelFollowed.listen(ev ->
    System.out.println(ev.data().follower().username() + " followed"));

client.chatMessageSent.listen(ev ->
    System.out.println(ev.data().sender().username() + ": " + ev.data().content()));

client.channelRewardRedemptionUpdated.listen(ev ->
    System.out.println(ev.data().redeemer().username() + " redeemed " + ev.data().reward().title()));

client.connect();
```

The endpoint may be `ws(s)://` or `http(s)://` (upgraded automatically); the
`/ws?token=` path is appended for you. `connect()` is non-blocking and listeners
fire on the WebSocket thread, so keep your app alive (e.g. `Thread.currentThread().join()`).

### Event handle

Each listener receives an `Event<T>`:

| Method | Description |
| --- | --- |
| `data()` | Deserialized payload of type `T` |
| `raw()` | Untouched payload as a Gson `JsonObject` |
| `type()` | Event name, e.g. `channel.followed` |
| `version()`, `id()`, `timestamp()` | Event metadata |

Fields not modeled by a payload class are still reachable via `ev.raw()`.

### Emitters and payload types

| Emitter | Kick event | Payload type |
| --- | --- | --- |
| `chatMessageSent` | `chat.message.sent` | `ChatMessage` |
| `channelFollowed` | `channel.followed` | `Follow` |
| `channelSubscriptionNew` | `channel.subscription.new` | `Subscription` |
| `channelSubscriptionRenewal` | `channel.subscription.renewal` | `Subscription` |
| `channelSubscriptionGifts` | `channel.subscription.gifts` | `Gift` |
| `channelRewardRedemptionUpdated` | `channel.reward.redemption.updated` | `RewardRedemption` |
| `livestreamStatusUpdated` | `livestream.status.updated` | `LivestreamStatus` |
| `livestreamMetadataUpdated` | `livestream.metadata.updated` | `LivestreamMetadata` |
| `moderationBanned` | `moderation.banned` | `ModerationBanned` |
| `kicksGifted` | `kicks.gifted` | `KicksGifted` |
| `any` | every event | `JsonObject` (raw) |

Payload classes live in `com.sammwy.kick2ws.events`. User objects (`broadcaster`,
`sender`, `follower`, ...) share the `KickUser` type.

## Options

```java
client.autoReconnect(false);          // disable reconnect (default: enabled)
client.onError(e -> log.warn("ws", e));
client.close();                        // disconnect and stop reconnecting
```

## Run the example

```bash
./gradlew run --args="wss://kick2ws.example.com k2ws_yourtoken"
```
