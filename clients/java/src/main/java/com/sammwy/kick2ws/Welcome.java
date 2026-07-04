package com.sammwy.kick2ws;

/** Handshake message sent by the server right after connecting. */
public record Welcome(String channelId, String username, String permissions, String auth, Integer subscribers) {}
