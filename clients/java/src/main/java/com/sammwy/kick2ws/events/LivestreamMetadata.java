package com.sammwy.kick2ws.events;

public record LivestreamMetadata(KickUser broadcaster, Metadata metadata) {

    public record Metadata(String title, String language, Boolean hasMatureContent, Category category) {}
}
