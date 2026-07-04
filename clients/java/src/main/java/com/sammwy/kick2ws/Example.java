package com.sammwy.kick2ws;

/** Run with: ./gradlew run --args="wss://your-host k2ws_yourtoken" */
public final class Example {
    public static void main(String[] args) throws InterruptedException {
        String endpoint = args.length > 0 ? args[0] : "wss://kick2ws.sammwy.com";
        String token = args.length > 1 ? args[1] : System.getenv("KICK2WS_TOKEN");

        Kick2WSClient client = new Kick2WSClient(endpoint, token);
        client.onWelcome(w -> System.out.println("connected to channel " + w.channelId()));
        client.onError(e -> System.err.println("error: " + e.getMessage()));

        client.chatMessageSent.listen(ev ->
                System.out.println("chat: " + ev.data().sender().username() + ": " + ev.data().content()));
        client.channelFollowed.listen(ev ->
                System.out.println("follow: " + ev.data().follower().username()));
        client.channelRewardRedemptionUpdated.listen(ev ->
                System.out.println("reward: " + ev.data().reward().title() + " by " + ev.data().redeemer().username()));

        client.connect();
        Thread.currentThread().join();
    }
}
